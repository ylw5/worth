# Cloudflare Background Market Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move routine second-hand market collection out of the asset detail request path and into a Cloudflare Cron + Workflow pipeline that records auditable daily snapshots and visible job status.

**Architecture:** Keep the current FastAPI image-analysis and cutout service unchanged. A separate Python Worker calls a small set of service-role-only Supabase RPCs, runs one durable Workflow per user and normalized market key, queries the existing Xianyu source asynchronously, filters comparable listings with the existing OpenAI model through Cloudflare AI Gateway, and atomically fans the result out to matching assets.

**Tech Stack:** Cloudflare Python Workers and Workflows, Wrangler, `httpx`, `openai`, Pydantic, Supabase Postgres/PostgREST, Expo Router, TanStack Query, Node built-in test runner, pytest.

## Global Constraints

- Background execution only: opening or refreshing an asset detail page must not invoke market search or AI.
- One Workflow instance processes one `(user_id, market_key, run_date)`; retries must not create duplicate daily snapshots.
- Keep `XIANYU_COOKIE`, `SUPABASE_SERVICE_ROLE_KEY`, and model credentials in Cloudflare Secrets; never return or log their values.
- Keep the current FastAPI `/analyze` and `/cutout` paths deployed where `rembg` works; do not bundle `rembg` into the Worker.
- Preserve the uncommitted changes in `server/app/market.py` and `server/tests/test_market.py`.
- A price is publishable only with at least 5 accepted, deduplicated comparable samples.
- Show source, sample count, collection time, and job status; never label sampled listings as real-time completed-sale data.
- Use Cloudflare compatibility date `2026-07-24` and enable `python_workers` and `python_workflows`.
- Before editing `mobile/`, read the exact Expo v57 docs at `https://docs.expo.dev/versions/v57.0.0/`.

---

## File Map

- Create `supabase/migrations/202607240006_background_market_snapshots.sql`: job, evidence, snapshot tables and atomic RPCs.
- Create `cloudflare/pyproject.toml`: Worker-only Python dependencies, isolated from the FastAPI/rembg environment.
- Create `cloudflare/wrangler.toml`: Cron, Workflow, variables, and bindings.
- Create `cloudflare/src/main.py`: scheduled dispatcher and Workflow entrypoint.
- Create `cloudflare/src/supabase.py`: minimal PostgREST/RPC client.
- Create `cloudflare/src/market.py`: async Xianyu request and listing normalization.
- Create `cloudflare/src/filter.py`: structured comparable filtering and valuation.
- Create `cloudflare/src/models.py`: Worker boundary models.
- Create `cloudflare/tests/test_filter.py`: one deterministic price-path check.
- Modify `mobile/src/types/domain.ts`: snapshot and run status types.
- Modify `mobile/src/lib/assets.ts`: read latest snapshot and run.
- Create `mobile/src/components/market-snapshot-card.tsx`: read-only current-market/status UI.
- Modify `mobile/src/app/asset/[id].tsx`: replace manual refresh card with the background result.
- Create `mobile/tests/market-snapshot.test.mjs`: verify status copy and trend calculation.
- Modify `README.md`: deploy, secret, and smoke-test commands.

### Task 1: Persist Idempotent Background Runs and Snapshots

**Files:**
- Create: `supabase/migrations/202607240006_background_market_snapshots.sql`

**Interfaces:**
- Consumes: existing `public.assets`, `public.valuations`, and `public.record_valuation`.
- Produces: `public.analysis_runs`, `public.market_snapshots`; RPCs `enqueue_daily_market_runs()`, `claim_analysis_run(uuid)`, `complete_market_run(uuid, jsonb)`, and `fail_analysis_run(uuid, text)`.

- [ ] **Step 1: Write the migration**

```sql
create table public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  market_key text not null,
  kind text not null check (kind in ('market', 'forecast')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed')),
  run_date date not null default current_date,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, market_key, kind, run_date)
);

create table public.market_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  run_id uuid not null references public.analysis_runs(id) on delete cascade,
  snapshot_date date not null,
  estimated_price numeric(12, 2) not null check (estimated_price > 0),
  price_low numeric(12, 2) not null check (price_low > 0),
  price_high numeric(12, 2) not null check (price_high >= price_low),
  sample_count integer not null check (sample_count >= 5),
  query text not null check (length(trim(query)) > 0),
  source text not null default 'xianyu_active_listings',
  samples jsonb not null,
  created_at timestamptz not null default now(),
  unique (asset_id, snapshot_date)
);

create index analysis_runs_due_idx
  on public.analysis_runs (status, kind, run_date);
create index market_snapshots_asset_date_idx
  on public.market_snapshots (asset_id, snapshot_date desc);

alter table public.analysis_runs enable row level security;
alter table public.market_snapshots enable row level security;
create policy analysis_runs_owner on public.analysis_runs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy market_snapshots_owner on public.market_snapshots
  for select to authenticated using ((select auth.uid()) = user_id);

alter table public.assets
add column market_key text generated always as (
  md5(lower(trim(search_query)) || '|' || condition)
) stored;
create index assets_user_market_key_idx
  on public.assets (user_id, market_key);

create function public.enqueue_daily_market_runs()
returns setof public.analysis_runs
language sql
security definer
set search_path = ''
as $$
  insert into public.analysis_runs (
    user_id, asset_id, market_key, kind, run_date
  )
  select a.user_id, (array_agg(a.id order by a.id))[1],
         a.market_key, 'market', current_date
  from public.assets a
  where a.status <> 'sold'
    and (
      a.latest_valuation_at is null
      or a.latest_valuation_at < now() - interval '20 hours'
    )
  group by a.user_id, a.market_key
  on conflict (user_id, market_key, kind, run_date) do nothing
  returning *;
$$;

create function public.claim_analysis_run(p_run_id uuid)
returns public.analysis_runs
language plpgsql
security definer
set search_path = ''
as $$
declare claimed public.analysis_runs;
begin
  update public.analysis_runs
  set status = 'running', started_at = now(),
      attempt_count = attempt_count + 1, error_message = null
  where id = p_run_id and status in ('queued', 'failed')
  returning * into claimed;
  return claimed;
end;
$$;

create function public.complete_market_run(p_run_id uuid, p_result jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare run public.analysis_runs;
begin
  select * into strict run from public.analysis_runs
  where id = p_run_id and status = 'running' for update;

  insert into public.market_snapshots (
    user_id, asset_id, run_id, snapshot_date, estimated_price,
    price_low, price_high, sample_count, query, samples
  )
  select
    run.user_id, a.id, run.id, run.run_date,
    (p_result->>'estimated_price')::numeric,
    (p_result->>'price_low')::numeric,
    (p_result->>'price_high')::numeric,
    (p_result->>'sample_count')::integer,
    p_result->>'query', p_result->'samples'
  from public.assets a
  where a.user_id = run.user_id and a.market_key = run.market_key
  on conflict (asset_id, snapshot_date) do update set
    estimated_price = excluded.estimated_price,
    price_low = excluded.price_low,
    price_high = excluded.price_high,
    sample_count = excluded.sample_count,
    query = excluded.query,
    samples = excluded.samples,
    created_at = now();

  update public.assets set
    latest_market_price = (p_result->>'estimated_price')::numeric,
    latest_market_price_low = (p_result->>'price_low')::numeric,
    latest_market_price_high = (p_result->>'price_high')::numeric,
    latest_valuation_at = now(), updated_at = now()
  where user_id = run.user_id and market_key = run.market_key;

  update public.analysis_runs
  set status = 'succeeded', finished_at = now()
  where id = run.id;
end;
$$;

create function public.fail_analysis_run(p_run_id uuid, p_message text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.analysis_runs
  set status = 'failed', error_message = left(p_message, 500), finished_at = now()
  where id = p_run_id;
$$;

revoke all on function public.enqueue_daily_market_runs() from public;
revoke all on function public.claim_analysis_run(uuid) from public;
revoke all on function public.complete_market_run(uuid, jsonb) from public;
revoke all on function public.fail_analysis_run(uuid, text) from public;
grant execute on function public.enqueue_daily_market_runs() to service_role;
grant execute on function public.claim_analysis_run(uuid) to service_role;
grant execute on function public.complete_market_run(uuid, jsonb) to service_role;
grant execute on function public.fail_analysis_run(uuid, text) to service_role;
```

- [ ] **Step 2: Apply locally and inspect the schema**

Run: `npx supabase db reset`

Expected: exit code 0 and migration `202607240006_background_market_snapshots.sql` is applied.

Run: `npx supabase db lint`

Expected: no new security-definer or RLS warning from this migration.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/202607240006_background_market_snapshots.sql
git commit -m "feat: add background market snapshot storage"
```

### Task 2: Create the Smallest Deployable Worker

**Files:**
- Create: `cloudflare/pyproject.toml`
- Create: `cloudflare/wrangler.toml`
- Create: `cloudflare/src/models.py`
- Create: `cloudflare/src/supabase.py`
- Create: `cloudflare/src/main.py`

**Interfaces:**
- Consumes: RPCs from Task 1 and Worker bindings `MARKET_WORKFLOW`, `SUPABASE_URL`, `OPENAI_MODEL`.
- Produces: scheduled dispatcher plus `MarketWorkflow.run(event, step)`.

- [ ] **Step 1: Add Worker configuration**

```toml
# cloudflare/pyproject.toml
[project]
name = "worth-background"
version = "0.1.0"
requires-python = ">=3.13"
dependencies = ["httpx>=0.28,<1", "openai>=1.97,<2", "pydantic>=2.11,<3"]

[dependency-groups]
dev = ["pytest>=8.4,<9"]
```

```toml
# cloudflare/wrangler.toml
name = "worth-background"
main = "src/main.py"
compatibility_date = "2026-07-24"
compatibility_flags = ["python_workers", "python_workflows"]

[vars]
OPENAI_MODEL = "openai/gpt-5.4"

[triggers]
crons = ["0 18 * * *"]

[[workflows]]
name = "market-workflow"
binding = "MARKET_WORKFLOW"
class_name = "MarketWorkflow"
```

- [ ] **Step 2: Add boundary models and RPC client**

```python
# cloudflare/src/models.py
from pydantic import BaseModel, Field

class Run(BaseModel):
    id: str
    asset_id: str

class Asset(BaseModel):
    id: str
    name: str
    brand: str
    model: str
    specs: dict[str, str]
    category: str
    condition: str
    search_query: str

class Sample(BaseModel):
    item_id: str
    title: str
    price: float = Field(gt=0)
    url: str

class MarketResult(BaseModel):
    estimated_price: float
    price_low: float
    price_high: float
    sample_count: int = Field(ge=5)
    query: str
    samples: list[Sample]
```

```python
# cloudflare/src/supabase.py
import httpx

class Supabase:
    def __init__(self, url: str, service_key: str):
        self.base = f"{url.rstrip('/')}/rest/v1"
        self.headers = {
            "apikey": service_key,
            "authorization": f"Bearer {service_key}",
            "content-type": "application/json",
        }

    async def rpc(self, name: str, payload: dict | None = None):
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{self.base}/rpc/{name}",
                headers=self.headers,
                json=payload or {},
            )
        response.raise_for_status()
        return response.json() if response.content else None

    async def asset(self, asset_id: str):
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                f"{self.base}/assets",
                headers={**self.headers, "accept": "application/vnd.pgrst.object+json"},
                params={"id": f"eq.{asset_id}", "select": "*"},
            )
        response.raise_for_status()
        return response.json()
```

- [ ] **Step 3: Add dispatcher and Workflow shell**

```python
# cloudflare/src/main.py
from workers import WorkerEntrypoint
from workers.workflows import WorkflowEntrypoint
from .supabase import Supabase

def database(env):
    return Supabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

class Default(WorkerEntrypoint):
    async def fetch(self, request):
        return Response.json({"status": "ok"})

    async def scheduled(self, controller, env, ctx):
        runs = await database(env).rpc("enqueue_daily_market_runs")
        for offset in range(0, len(runs), 100):
            await env.MARKET_WORKFLOW.create_batch([
                {"id": run["id"], "params": {"run_id": run["id"]}}
                for run in runs[offset:offset + 100]
            ])

class MarketWorkflow(WorkflowEntrypoint):
    async def run(self, event, step):
        run_id = event["payload"]["run_id"]
        db = database(self.env)
        try:
            run = await step.do("claim", lambda: db.rpc(
                "claim_analysis_run", {"p_run_id": run_id}
            ))
            if not run:
                return {"status": "skipped"}
            asset = await step.do("load asset", lambda: db.asset(run["asset_id"]))
            result = await self.collect(step, asset)
            await step.do("save snapshot", lambda: db.rpc(
                "complete_market_run",
                {"p_run_id": run_id, "p_result": result.model_dump(mode="json")},
            ))
            return {"status": "succeeded"}
        except Exception as error:
            await step.do("record failure", lambda: db.rpc(
                "fail_analysis_run",
                {"p_run_id": run_id, "p_message": str(error)},
            ))
            raise

    async def collect(self, step, asset):
        from .filter import collect_market_result
        return await step.do(
            "collect and filter",
            {"retries": {"limit": 2, "delay": "5 seconds", "backoff": "exponential"},
             "timeout": "2 minutes"},
            lambda: collect_market_result(self.env, asset),
        )
```

- [ ] **Step 4: Verify the Worker imports**

Run: `cd cloudflare && npx wrangler deploy --dry-run`

Expected: the build succeeds and reports one scheduled handler and one Workflow class.

- [ ] **Step 5: Commit**

```bash
git add cloudflare/pyproject.toml cloudflare/wrangler.toml cloudflare/src
git commit -m "feat: add cloudflare market workflow"
```

### Task 3: Collect, Filter, and Calculate One Auditable Snapshot

**Files:**
- Create: `cloudflare/src/market.py`
- Create: `cloudflare/src/filter.py`
- Create: `cloudflare/tests/test_filter.py`

**Interfaces:**
- Consumes: asset dict and secrets `XIANYU_COOKIE`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_GATEWAY_TOKEN`.
- Produces: `async collect_market_result(env, asset) -> MarketResult`.

- [ ] **Step 1: Write the deterministic valuation check**

```python
# cloudflare/tests/test_filter.py
from src.filter import summarize
from src.models import Sample

def test_summarize_deduplicates_and_uses_quartile_range():
    samples = [
        Sample(item_id=str(i), title=f"item {i}", price=price, url=f"https://x/{i}")
        for i, price in enumerate([80, 90, 100, 110, 120, 999])
    ]
    result = summarize("camera", samples + [samples[2]])
    assert result.estimated_price == 105
    assert result.price_low == 92.5
    assert result.price_high == 117.5
    assert result.sample_count == 6
```

- [ ] **Step 2: Run the check and observe the missing module**

Run: `cd cloudflare && python -m pytest tests/test_filter.py -q`

Expected: FAIL because `src.filter` does not exist.

- [ ] **Step 3: Add the async market client**

Before editing, run `git diff -- server/app/market.py server/tests/test_market.py`; preserve that retry behavior without editing those two files. Create:

```python
# cloudflare/src/market.py
import hashlib
import json
import re
import time
from http.cookies import SimpleCookie
import httpx
from .models import Sample

SEARCH_URL = (
    "https://h5api.m.goofish.com/h5/"
    "mtop.taobao.idlemtopsearch.pc.search/1.0/"
)
HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
    "Origin": "https://www.goofish.com",
    "Referer": "https://www.goofish.com/",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36"
    ),
}

def _cookies(value: str) -> dict[str, str]:
    parsed = SimpleCookie()
    parsed.load(value)
    return {key: morsel.value for key, morsel in parsed.items()}

def _sign(timestamp: str, token: str, data: str) -> str:
    return hashlib.md5(
        f"{token}&{timestamp}&34839810&{data}".encode()
    ).hexdigest()

def _candidate(result: dict) -> Sample | None:
    main = result.get("data", {}).get("item", {}).get("main", {})
    content = main.get("exContent", {})
    price_text = content.get("detailParams", {}).get("soldPrice", "")
    if not price_text:
        price_text = "".join(
            str(part.get("text", "")) for part in content.get("price", [])
        )
    match = re.search(r"\d+(?:\.\d+)?", str(price_text).replace(",", ""))
    if not match or float(match.group()) <= 0:
        return None
    return Sample(
        item_id=content.get("itemId", ""),
        title=content.get("title", ""),
        price=float(match.group()),
        url=main.get("targetUrl", ""),
    )

async def search(cookie: str, query: str, limit: int = 30) -> list[Sample]:
    if not cookie:
        raise RuntimeError("Market data source is not configured")
    found: dict[str, Sample] = {}
    async with httpx.AsyncClient(
        cookies=_cookies(cookie), headers=HEADERS, timeout=20
    ) as client:
        for page in range(1, max(1, (limit + 29) // 30) + 1):
            payload = {
                "pageNumber": page, "keyword": query, "fromFilter": False,
                "rowsPerPage": 30, "searchReqFromPage": "pcSearch",
                "propValueStr": {"searchFilter": ""},
                "extraFilterValue": "{}", "userPositionJson": "{}",
                "sortValue": "", "sortField": "", "customDistance": "",
                "gps": "", "customGps": "",
            }
            data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
            for attempt in range(2):
                timestamp = str(int(time.time() * 1000))
                token = client.cookies.get("_m_h5_tk", "").split("_")[0]
                response = await client.post(
                    SEARCH_URL,
                    params={
                        "jsv": "2.7.2", "appKey": "34839810", "t": timestamp,
                        "sign": _sign(timestamp, token, data), "v": "1.0",
                        "type": "originaljson", "accountSite": "xianyu",
                        "dataType": "json", "timeout": "20000",
                        "api": "mtop.taobao.idlemtopsearch.pc.search",
                        "sessionOption": "AutoLoginOnly",
                        "spm_cnt": "a21ybx.search.0.0",
                    },
                    data={"data": data},
                )
                response.raise_for_status()
                body = response.json()
                ret = body.get("ret", [])
                if any(value.startswith("SUCCESS") for value in ret):
                    break
                expired = any(
                    value.startswith("FAIL_SYS_TOKEN_EXOIRED") for value in ret
                )
                if attempt or not expired:
                    raise RuntimeError("Market search is temporarily unavailable")
            for raw in body.get("data", {}).get("resultList", []):
                item = _candidate(raw)
                if item and item.item_id:
                    found[item.item_id] = item
    return list(found.values())[:limit]
```

- [ ] **Step 4: Add structured filtering and stdlib statistics**

```python
# cloudflare/src/filter.py
from statistics import median, quantiles
from openai import AsyncOpenAI
from pydantic import BaseModel
from .market import search
from .models import MarketResult, Sample

class MatchResult(BaseModel):
    accepted_item_ids: list[str]

def summarize(query: str, samples: list[Sample]) -> MarketResult:
    unique = {sample.item_id: sample for sample in samples}
    accepted = sorted(unique.values(), key=lambda item: item.price)
    if len(accepted) < 5:
        raise ValueError("insufficient comparable samples")
    prices = [item.price for item in accepted]
    count = len(prices)
    quartiles = quantiles(prices, n=4, method="inclusive")
    return MarketResult(
        estimated_price=round(median(prices), 2),
        price_low=round(quartiles[0], 2),
        price_high=round(quartiles[2], 2),
        sample_count=count,
        query=query,
        samples=accepted,
    )

async def collect_market_result(env, asset) -> MarketResult:
    query = asset["search_query"].strip() or " ".join(
        value for value in [asset["brand"], asset["model"], asset["name"]] if value
    )
    candidates = await search(env.XIANYU_COOKIE, query)
    client = AsyncOpenAI(
        api_key=env.CLOUDFLARE_AI_GATEWAY_TOKEN,
        base_url=(
            "https://api.cloudflare.com/client/v4/accounts/"
            f"{env.CLOUDFLARE_ACCOUNT_ID}/ai/v1"
        ),
    )
    response = await client.responses.parse(
        model=env.OPENAI_MODEL,
        input=[
            {"role": "system", "content": (
                "Select only whole-product listings matching category, brand, model, "
                "specification and condition. Reject accessories, wanted posts, rentals, "
                "repairs, deposits, duplicates and implausible prices."
            )},
            {"role": "user", "content": str({
                "asset": asset,
                "candidates": [item.model_dump() for item in candidates],
            })},
        ],
        text_format=MatchResult,
    )
    accepted = set(response.output_parsed.accepted_item_ids)
    return summarize(query, [item for item in candidates if item.item_id in accepted])
```

- [ ] **Step 5: Run the check**

Run: `cd cloudflare && python -m pytest tests/test_filter.py -q`

Expected: `1 passed`.

- [ ] **Step 6: Commit**

```bash
git add cloudflare/src/market.py cloudflare/src/filter.py cloudflare/tests/test_filter.py
git commit -m "feat: collect auditable market snapshots"
```

### Task 4: Show Background Result and Status on the Detail Page

**Files:**
- Modify: `mobile/src/types/domain.ts`
- Modify: `mobile/src/lib/assets.ts`
- Create: `mobile/src/lib/market-snapshot.ts`
- Create: `mobile/src/components/market-snapshot-card.tsx`
- Modify: `mobile/src/app/asset/[id].tsx`
- Create: `mobile/tests/market-snapshot.test.mjs`

**Interfaces:**
- Consumes: latest `market_snapshots` and `analysis_runs` rows.
- Produces: `getMarketInsight(asset)` and `<MarketSnapshotCard insight={...} />`.

- [ ] **Step 1: Write the status/trend check**

```js
// mobile/tests/market-snapshot.test.mjs
import assert from 'node:assert/strict';
import {
  changeOverDays,
  jobCopy,
  percentChange,
} from '../src/lib/market-snapshot.ts';

assert.equal(jobCopy({ status: 'running' }), '行情更新中');
assert.equal(jobCopy({ status: 'failed' }), '本次更新失败，仍展示上次结果');
assert.equal(percentChange(120, 100), 20);
assert.equal(percentChange(100, null), null);
assert.equal(
  changeOverDays([
    { snapshot_date: '2026-07-24', estimated_price: 120 },
    { snapshot_date: '2026-07-17', estimated_price: 100 },
  ], 7),
  20,
);
console.log('market snapshot checks passed');
```

- [ ] **Step 2: Add pure helpers**

```js
// mobile/src/lib/market-snapshot.ts
export function jobCopy(run: { status: string } | null) {
  if (!run) return '等待后台更新';
  if (run.status === 'queued') return '已排队';
  if (run.status === 'running') return '行情更新中';
  if (run.status === 'failed') return '本次更新失败，仍展示上次结果';
  return '已更新';
}

export function percentChange(
  current: number | null,
  previous: number | null,
) {
  if (current == null || previous == null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function changeOverDays(
  snapshots: { snapshot_date: string; estimated_price: number }[],
  days: number,
) {
  const latest = snapshots[0];
  if (!latest) return null;
  const target = new Date(`${latest.snapshot_date}T00:00:00Z`);
  target.setUTCDate(target.getUTCDate() - days);
  const baseline = snapshots.find(
    (row) => row.snapshot_date <= target.toISOString().slice(0, 10),
  );
  return percentChange(latest.estimated_price, baseline?.estimated_price ?? null);
}
```

- [ ] **Step 3: Add domain types and query**

Add to `mobile/src/types/domain.ts`:

```ts
// Add these existing/database-generated fields to Asset:
market_key: string;
subcategory: string;
status: 'in_use' | 'idle' | 'listed' | 'sold';
latest_market_price_low: number | null;
latest_market_price_high: number | null;

export type MarketSnapshot = {
  id: string;
  asset_id: string;
  snapshot_date: string;
  estimated_price: number;
  price_low: number;
  price_high: number;
  sample_count: number;
  query: string;
  source: 'xianyu_active_listings';
  created_at: string;
};

export type AnalysisRun = {
  id: string;
  asset_id: string;
  market_key: string;
  kind: 'market' | 'forecast';
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  error_message: string | null;
  created_at: string;
  finished_at: string | null;
};

export type MarketInsight = {
  snapshots: MarketSnapshot[];
  run: AnalysisRun | null;
};
```

Add to `mobile/src/lib/assets.ts`:

```ts
export async function getMarketInsight(asset: Asset): Promise<MarketInsight> {
  const [snapshots, runs] = await Promise.all([
    supabase.from('market_snapshots').select('*').eq('asset_id', asset.id)
      .order('snapshot_date', { ascending: false }).limit(30),
    supabase.from('analysis_runs').select('*').eq('market_key', asset.market_key)
      .eq('kind', 'market').order('created_at', { ascending: false }).limit(1),
  ]);
  fail(snapshots.error);
  fail(runs.error);
  return {
    snapshots: (snapshots.data ?? []) as MarketSnapshot[],
    run: ((runs.data ?? [])[0] as AnalysisRun | undefined) ?? null,
  };
}
```

- [ ] **Step 4: Render the card and remove request-time refresh**

Create `MarketSnapshotCard` with the existing `colors`, `radius`, `spacing`, and `typography`. It must render:

```tsx
const change7d = changeOverDays(insight.snapshots, 7);
const change30d = changeOverDays(insight.snapshots, 30);

<View>
  <Text>当前参考市价</Text>
  <Text>{formatCurrency(latest?.estimated_price ?? null)}</Text>
  <Text>
    {latest
      ? `${formatCurrency(latest.price_low)}–${formatCurrency(latest.price_high)} · ${latest.sample_count} 个在售样本`
      : '暂无可靠估价'}
  </Text>
  <Text>{jobCopy(insight.run)}</Text>
  <Text>
    近 7 天 {change7d == null ? '样本不足' : `${change7d > 0 ? '+' : ''}${change7d}%`}
    {' · '}近 30 天 {change30d == null ? '样本不足' : `${change30d > 0 ? '+' : ''}${change30d}%`}
  </Text>
  {latest ? <Text>数据源：闲鱼在售样本 · {formatDate(latest.created_at)}</Text> : null}
</View>
```

In `mobile/src/app/asset/[id].tsx`, delete the `estimateAsset`, `recordValuation`, `useMutation`, `useQueryClient`, refresh button, and related error/loading state. After `assetQuery.data` exists, add one `useQuery` with key `['market-insight', id]`, `queryFn: () => getMarketInsight(assetQuery.data!)`, and `enabled: Boolean(assetQuery.data)`; pass it to `MarketSnapshotCard` and retain the existing price-history list.

- [ ] **Step 5: Run checks**

Run: `cd mobile && node --test tests/market-snapshot.test.mjs`

Expected: `market snapshot checks passed`.

Run: `cd mobile && npm run lint`

Expected: exit code 0.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/types/domain.ts mobile/src/lib/assets.ts \
  mobile/src/lib/market-snapshot.ts mobile/src/components/market-snapshot-card.tsx \
  'mobile/src/app/asset/[id].tsx' mobile/tests/market-snapshot.test.mjs
git commit -m "feat: show background market status"
```

### Task 5: Deploy and Prove One End-to-End Run

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: completed Tasks 1–4 and a deployed Supabase project.
- Produces: repeatable operations instructions and one verified production snapshot.

- [ ] **Step 1: Configure secrets without printing values**

Run:

```bash
cd cloudflare
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put XIANYU_COOKIE
npx wrangler secret put CLOUDFLARE_AI_GATEWAY_TOKEN
```

Add `SUPABASE_URL` and `CLOUDFLARE_ACCOUNT_ID` to `[vars]` in `cloudflare/wrangler.toml`; neither is a secret.

- [ ] **Step 2: Deploy**

Run: `cd cloudflare && npx wrangler deploy`

Expected: deployment succeeds and lists the daily Cron plus `MARKET_WORKFLOW`.

- [ ] **Step 3: Trigger and inspect without exposing secrets**

Run:

```bash
curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/enqueue_daily_market_runs" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "content-type: application/json"
cd cloudflare && npx wrangler workflows trigger market-workflow \
  '{"run_id":"<id returned by the RPC>"}'
```

Expected: the matching `analysis_runs` row becomes `succeeded`, exactly one `market_snapshots` row exists for the asset/date, and the asset detail page shows the same median, range, count, source, and timestamp.

- [ ] **Step 4: Document deployment and the known upstream constraint**

Add to `README.md`:

```markdown
## Background market analysis

`cloudflare/` runs one daily Workflow per due asset. Configure the three
secrets listed above, deploy with `npx wrangler deploy`, and inspect
`analysis_runs` before debugging the mobile UI.

The Xianyu endpoint uses authenticated, non-public behavior. If a deployed
smoke run is rejected while the same cookie works locally, keep the database
and Workflow unchanged and move only `cloudflare/src/market.py` behind a
stable-egress collector.
```

- [ ] **Step 5: Commit**

```bash
git add cloudflare/wrangler.toml README.md
git commit -m "docs: add background valuation operations"
```
