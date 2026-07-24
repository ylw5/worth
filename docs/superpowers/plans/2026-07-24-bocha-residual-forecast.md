# Bocha Residual Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add weekly, evidence-backed 6- and 12-month residual forecasts for every asset category by combining Bocha Web Search results, AI evidence extraction, and deterministic depreciation math.

**Architecture:** The existing Cloudflare dispatcher creates weekly forecast runs. Each Workflow builds three bounded Bocha queries, stores the returned URLs/snippets, asks the existing OpenAI model only to normalize relevant facts into a fixed schema, then chooses either the asset’s own time-series slope or comparable-product retention slope. Forecasts remain unavailable when evidence thresholds are not met.

**Tech Stack:** Bocha Web Search API, Cloudflare Python Workflows, `httpx`, OpenAI structured output through Cloudflare AI Gateway, Pydantic, Python stdlib statistics/math, Supabase Postgres, Expo React Native.

## Global Constraints

- Call only Bocha Web Search at `POST https://api.bochaai.com/v1/web-search`; do not use OpenAI web search.
- Send `Authorization: Bearer <BOCHA_API_KEY>` and keep the key in Cloudflare Secrets.
- Search at most 3 queries with `count: 10`, `summary: true`, and `freshness: "oneYear"` per weekly asset run.
- Never send user identity, notes, photos, purchase price, or private storage URLs to Bocha.
- Store query, URL, title, snippet/summary, source site, retrieval time, and normalized fact for audit.
- Use AI for relevance matching and evidence normalization only; final prices and confidence are deterministic.
- Own-history forecasting requires at least 4 snapshot dates spanning at least 21 days.
- Comparable-retention forecasting requires at least 3 accepted observations with original retail price, current price, and release date.
- If neither threshold is met, store an unavailable result with a reason and render no future number.
- Label all future numbers “估算”, never “预测成交价” or “实时行情”.
- Before editing `mobile/`, read the exact Expo v57 docs at `https://docs.expo.dev/versions/v57.0.0/`.

---

## File Map

- Create `supabase/migrations/202607240007_residual_forecasts.sql`: profile, evidence, forecast storage and forecast RPCs.
- Modify `cloudflare/wrangler.toml`: weekly Cron and Bocha non-secret configuration.
- Modify `cloudflare/src/models.py`: evidence/profile/forecast models.
- Create `cloudflare/src/bocha.py`: constrained Web Search client.
- Create `cloudflare/src/forecast.py`: pure method selection, regression, and confidence.
- Create `cloudflare/tests/test_forecast.py`: own-history, comparable, and unavailable checks.
- Modify `cloudflare/src/main.py`: weekly forecast dispatch and Workflow.
- Create `cloudflare/src/research.py`: query building and AI fact normalization.
- Modify `mobile/src/types/domain.ts`: forecast types.
- Modify `mobile/src/lib/assets.ts`: latest forecast query.
- Create `mobile/src/components/residual-forecast.tsx`: 6/12-month values, interval, confidence, evidence disclosure.
- Modify `mobile/src/components/holding-cost-view.tsx`: append forecast when available.
- Modify `README.md`: Bocha configuration and evidence semantics.

### Task 1: Store Profiles, Evidence, and Forecasts

**Files:**
- Create: `supabase/migrations/202607240007_residual_forecasts.sql`

**Interfaces:**
- Consumes: `assets`, `analysis_runs`, `market_snapshots`.
- Produces: `asset_forecasts`; RPCs `enqueue_weekly_forecast_runs()` and `complete_forecast_run(uuid, jsonb)`.

- [ ] **Step 1: Add the migration**

```sql
alter table public.assets
add column valuation_profile jsonb not null default '{}'::jsonb;

create table public.asset_forecasts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  run_id uuid not null unique references public.analysis_runs(id) on delete cascade,
  forecast_date date not null,
  method text not null check (
    method in ('own_history', 'comparable_retention', 'unavailable')
  ),
  value_6m numeric(12, 2) check (value_6m > 0),
  low_6m numeric(12, 2) check (low_6m > 0),
  high_6m numeric(12, 2) check (high_6m >= low_6m),
  value_12m numeric(12, 2) check (value_12m > 0),
  low_12m numeric(12, 2) check (low_12m > 0),
  high_12m numeric(12, 2) check (high_12m >= low_12m),
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  reason text not null,
  profile jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (asset_id, forecast_date)
);

create index asset_forecasts_asset_date_idx
  on public.asset_forecasts (asset_id, forecast_date desc);
alter table public.asset_forecasts enable row level security;
create policy asset_forecasts_owner on public.asset_forecasts
  for select to authenticated using ((select auth.uid()) = user_id);

create function public.enqueue_weekly_forecast_runs()
returns setof public.analysis_runs
language sql
security definer
set search_path = ''
as $$
  insert into public.analysis_runs (
    user_id, asset_id, market_key, kind, run_date
  )
  select a.user_id, a.id, a.id::text, 'forecast', current_date
  from public.assets a
  where a.status <> 'sold' and a.latest_market_price is not null
  on conflict (user_id, market_key, kind, run_date) do nothing
  returning *;
$$;

create function public.complete_forecast_run(p_run_id uuid, p_result jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare run public.analysis_runs;
begin
  select * into strict run from public.analysis_runs
  where id = p_run_id and kind = 'forecast' and status = 'running' for update;

  insert into public.asset_forecasts (
    user_id, asset_id, run_id, forecast_date, method,
    value_6m, low_6m, high_6m, value_12m, low_12m, high_12m,
    confidence, reason, profile, evidence
  ) values (
    run.user_id, run.asset_id, run.id, run.run_date, p_result->>'method',
    nullif(p_result->>'value_6m', '')::numeric,
    nullif(p_result->>'low_6m', '')::numeric,
    nullif(p_result->>'high_6m', '')::numeric,
    nullif(p_result->>'value_12m', '')::numeric,
    nullif(p_result->>'low_12m', '')::numeric,
    nullif(p_result->>'high_12m', '')::numeric,
    (p_result->>'confidence')::numeric,
    p_result->>'reason', p_result->'profile', p_result->'evidence'
  )
  on conflict (asset_id, forecast_date) do update set
    run_id = excluded.run_id, method = excluded.method,
    value_6m = excluded.value_6m, low_6m = excluded.low_6m,
    high_6m = excluded.high_6m, value_12m = excluded.value_12m,
    low_12m = excluded.low_12m, high_12m = excluded.high_12m,
    confidence = excluded.confidence, reason = excluded.reason,
    profile = excluded.profile, evidence = excluded.evidence,
    created_at = now();

  update public.assets
  set valuation_profile = p_result->'profile', updated_at = now()
  where id = run.asset_id;
  update public.analysis_runs
  set status = 'succeeded', finished_at = now()
  where id = run.id;
end;
$$;

revoke all on function public.enqueue_weekly_forecast_runs() from public;
revoke all on function public.complete_forecast_run(uuid, jsonb) from public;
grant execute on function public.enqueue_weekly_forecast_runs() to service_role;
grant execute on function public.complete_forecast_run(uuid, jsonb) to service_role;
```

- [ ] **Step 2: Apply and lint**

Run: `npx supabase db reset && npx supabase db lint`

Expected: exit code 0 with no new RLS warning.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/202607240007_residual_forecasts.sql
git commit -m "feat: add residual forecast storage"
```

### Task 2: Implement the Deterministic Forecast Engine

**Files:**
- Modify: `cloudflare/src/models.py`
- Create: `cloudflare/src/forecast.py`
- Create: `cloudflare/tests/test_forecast.py`

**Interfaces:**
- Consumes: current market price, dated snapshots, and normalized comparable observations.
- Produces: `forecast(current_value, snapshots, comparables, profile, evidence) -> ForecastResult`.

- [ ] **Step 1: Add forecast models**

Append to `cloudflare/src/models.py`:

```python
from datetime import date
from typing import Literal

class ValuationProfile(BaseModel):
    category: str
    subcategory: str = ""
    brand: str = ""
    model: str = ""
    generation: str = ""
    release_date: date | None = None
    original_retail_price: float | None = Field(default=None, gt=0)
    attributes: dict[str, str] = Field(default_factory=dict)

class Evidence(BaseModel):
    query: str
    url: str
    title: str
    summary: str
    site_name: str = ""
    source_type: Literal[
        "official", "marketplace", "auction", "industry", "other"
    ] = "other"
    observed_at: date | None = None
    price_type: Literal[
        "retail", "listing", "completed_sale", "recycle_quote", "unknown"
    ] = "unknown"
    currency: str = "CNY"
    condition: str = ""
    specifications: dict[str, str] = Field(default_factory=dict)
    retrieved_at: str
    relevant: bool
    product_name: str = ""
    release_date: date | None = None
    original_retail_price: float | None = Field(default=None, gt=0)
    current_price: float | None = Field(default=None, gt=0)
    spec_match: float = Field(default=0, ge=0, le=1)

class ForecastResult(BaseModel):
    method: Literal["own_history", "comparable_retention", "unavailable"]
    value_6m: float | None = None
    low_6m: float | None = None
    high_6m: float | None = None
    value_12m: float | None = None
    low_12m: float | None = None
    high_12m: float | None = None
    confidence: float = Field(ge=0, le=1)
    reason: str
    profile: ValuationProfile
    evidence: list[Evidence]
```

- [ ] **Step 2: Write method-selection checks**

```python
# cloudflare/tests/test_forecast.py
from datetime import date, timedelta
from src.forecast import forecast
from src.models import Evidence, ValuationProfile

PROFILE = ValuationProfile(category="数码", brand="A", model="B")

def test_uses_own_history_after_four_points_and_21_days():
    start = date(2026, 1, 1)
    snapshots = [
        {"snapshot_date": (start + timedelta(days=i * 10)).isoformat(),
         "estimated_price": 1000 - i * 50}
        for i in range(4)
    ]
    result = forecast(850, snapshots, [], PROFILE, [])
    assert result.method == "own_history"
    assert result.value_6m < 850
    assert result.value_12m < result.value_6m

def test_falls_back_to_comparable_retention():
    evidence = [
        Evidence(
            query="q", url=f"https://example.com/{i}", title="x", summary="x",
            retrieved_at="2026-07-24T00:00:00Z", relevant=True,
            release_date=date(2025 - i, 1, 1),
            original_retail_price=1000, current_price=800 - i * 100,
            spec_match=0.9,
        )
        for i in range(3)
    ]
    result = forecast(800, [], evidence, PROFILE, evidence)
    assert result.method == "comparable_retention"
    assert result.value_12m is not None

def test_withholds_number_when_evidence_is_insufficient():
    result = forecast(800, [], [], PROFILE, [])
    assert result.method == "unavailable"
    assert result.value_6m is None
    assert result.confidence == 0
```

- [ ] **Step 3: Run the checks and observe the missing module**

Run: `cd cloudflare && python -m pytest tests/test_forecast.py -q`

Expected: FAIL because `src.forecast` does not exist.

- [ ] **Step 4: Implement log-linear regression with stdlib**

```python
# cloudflare/src/forecast.py
from datetime import date
from math import exp, log, sqrt
from .models import Evidence, ForecastResult, ValuationProfile

def _fit(points: list[tuple[float, float]]) -> tuple[float, float]:
    xs = [point[0] for point in points]
    ys = [log(point[1]) for point in points]
    x_mean = sum(xs) / len(xs)
    y_mean = sum(ys) / len(ys)
    denominator = sum((x - x_mean) ** 2 for x in xs)
    if denominator == 0:
        raise ValueError("forecast observations have no time span")
    slope = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, ys)) / denominator
    residuals = [y - (y_mean + slope * (x - x_mean)) for x, y in zip(xs, ys)]
    error = sqrt(sum(value * value for value in residuals) / len(residuals))
    return slope, error

def _result(method, current, slope, error, confidence, reason, profile, evidence):
    def values(days):
        center = max(1, current * exp(slope * days))
        spread = max(
            current * 0.05,
            current * min(0.5, error + (1 - confidence) * 0.25 + days / 3650),
        )
        return tuple(round(value, 2) for value in (
            center, max(1, center - spread), center + spread
        ))
    six = values(183)
    twelve = values(365)
    return ForecastResult(
        method=method,
        value_6m=six[0], low_6m=six[1], high_6m=six[2],
        value_12m=twelve[0], low_12m=twelve[1], high_12m=twelve[2],
        confidence=round(confidence, 3), reason=reason,
        profile=profile, evidence=evidence,
    )

def forecast(current_value, snapshots, comparables, profile, evidence):
    ordered = sorted(snapshots, key=lambda row: row["snapshot_date"])
    if len(ordered) >= 4:
        start = date.fromisoformat(ordered[0]["snapshot_date"])
        span = (date.fromisoformat(ordered[-1]["snapshot_date"]) - start).days
        if span >= 21:
            points = [
                ((date.fromisoformat(row["snapshot_date"]) - start).days,
                 float(row["estimated_price"]))
                for row in ordered
            ]
            slope, error = _fit(points)
            confidence = min(0.95, (
                min(len(points) / 12, 1) * 0.30
                + min(span / 90, 1) * 0.25
                + 1 * 0.20
                + 1 * 0.15
                + 1 * 0.10
            ))
            return _result(
                "own_history", current_value, slope, error, confidence,
                f"基于 {len(points)} 个历史快照，跨度 {span} 天",
                profile, evidence,
            )

    today = date.today()
    points = []
    accepted = [
        item for item in comparables
        if item.relevant and item.release_date and item.original_retail_price
        and item.current_price and item.spec_match >= 0.7
    ]
    for item in accepted:
        age = max(1, (today - item.release_date).days)
        retention = item.current_price / item.original_retail_price
        if 0.03 <= retention <= 2:
            points.append((age, retention))
    if len(points) >= 3:
        slope, error = _fit(points)
        source_count = len({item.site_name or item.url for item in accepted})
        average_match = sum(item.spec_match for item in accepted) / len(accepted)
        age_span = max(point[0] for point in points) - min(point[0] for point in points)
        confidence = min(0.85, (
            min(len(points) / 8, 1) * 0.30
            + min(age_span / 730, 1) * 0.25
            + min(source_count / 3, 1) * 0.20
            + average_match * 0.15
            + 1 * 0.10
        ))
        return _result(
            "comparable_retention", current_value, slope, error, confidence,
            f"基于 {len(points)} 个同类产品公开价格样本",
            profile, evidence,
        )

    return ForecastResult(
        method="unavailable", confidence=0,
        reason="历史跨度不足 21 天，且可核验同类样本少于 3 个",
        profile=profile, evidence=evidence,
    )
```

- [ ] **Step 5: Run the checks**

Run: `cd cloudflare && python -m pytest tests/test_forecast.py -q`

Expected: `3 passed`.

- [ ] **Step 6: Commit**

```bash
git add cloudflare/src/models.py cloudflare/src/forecast.py \
  cloudflare/tests/test_forecast.py
git commit -m "feat: add deterministic residual forecast"
```

### Task 3: Search Bocha and Normalize Evidence

**Files:**
- Create: `cloudflare/src/bocha.py`
- Create: `cloudflare/src/research.py`

**Interfaces:**
- Consumes: public asset fields and `BOCHA_API_KEY`.
- Produces: `research(env, asset) -> tuple[ValuationProfile, list[Evidence]]`.

- [ ] **Step 1: Add the constrained Bocha client**

```python
# cloudflare/src/bocha.py
import httpx
from workers.workflows import NonRetryableError

async def web_search(api_key: str, query: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            "https://api.bochaai.com/v1/web-search",
            headers={
                "authorization": f"Bearer {api_key}",
                "content-type": "application/json",
            },
            json={
                "query": query,
                "freshness": "oneYear",
                "summary": True,
                "count": 10,
            },
        )
    if response.status_code in (401, 403):
        raise NonRetryableError("bocha_auth_failed")
    if response.status_code == 429:
        raise NonRetryableError("bocha_quota_exhausted")
    response.raise_for_status()
    body = response.json()
    return body.get("data", {}).get("webPages", {}).get("value", [])
```

- [ ] **Step 2: Build exactly three category-neutral queries**

```python
# cloudflare/src/research.py
from datetime import datetime, timezone
from openai import AsyncOpenAI
from pydantic import BaseModel
from .bocha import web_search
from .models import Evidence, ValuationProfile

class NormalizedResearch(BaseModel):
    profile: ValuationProfile
    facts: list[Evidence]

def queries(asset: dict) -> list[str]:
    identity = " ".join(filter(None, [
        asset["brand"], asset["model"], asset["name"],
        " ".join(f"{key}{value}" for key, value in asset["specs"].items()),
    ]))
    return [
        f"{identity} 官方首发价 上市时间",
        f"{identity} 二手价格 2026",
        f"{asset['category']} {asset.get('subcategory', '')} 同代 产品 保值率 二手价格",
    ]

async def research(env, asset: dict):
    raw = []
    retrieved_at = datetime.now(timezone.utc).isoformat()
    for query in queries(asset):
        for page in await web_search(env.BOCHA_API_KEY, query):
            raw.append({
                "query": query,
                "url": page.get("url", ""),
                "title": page.get("name", ""),
                "summary": page.get("summary") or page.get("snippet", ""),
                "site_name": page.get("siteName", ""),
                "retrieved_at": retrieved_at,
            })
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
                "Normalize only facts explicitly supported by the supplied search "
                "records. Preserve each query and URL. Mark irrelevant facts false. "
                "Do not infer a price, date, or specification absent from the record. "
                "Use source_type official only when the URL is the matching brand or "
                "institution domain. Keep listing, completed-sale and recycle prices "
                "as different price_type values."
            )},
            {"role": "user", "content": str({"asset": asset, "records": raw})},
        ],
        text_format=NormalizedResearch,
    )
    return response.output_parsed.profile, response.output_parsed.facts
```

- [ ] **Step 3: Add a no-private-fields boundary check**

Run:

```bash
rg -n "user_id|purchase_price|notes|photo|signed" \
  cloudflare/src/bocha.py cloudflare/src/research.py
```

Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add cloudflare/src/bocha.py cloudflare/src/research.py
git commit -m "feat: collect forecast evidence with bocha"
```

### Task 4: Schedule and Complete Weekly Forecast Runs

**Files:**
- Modify: `cloudflare/wrangler.toml`
- Modify: `cloudflare/src/supabase.py`
- Modify: `cloudflare/src/main.py`

**Interfaces:**
- Consumes: Task 1 RPCs, Task 2 forecast engine, Task 3 research.
- Produces: `ForecastWorkflow` bound as `FORECAST_WORKFLOW`.

- [ ] **Step 1: Add the weekly binding**

Change `cloudflare/wrangler.toml` to:

```toml
[triggers]
crons = ["0 18 * * *", "0 19 * * 0"]

[[workflows]]
name = "market-workflow"
binding = "MARKET_WORKFLOW"
class_name = "MarketWorkflow"

[[workflows]]
name = "forecast-workflow"
binding = "FORECAST_WORKFLOW"
class_name = "ForecastWorkflow"
```

- [ ] **Step 2: Add one filtered-table helper**

Append to `cloudflare/src/supabase.py`:

```python
    async def rows(self, table: str, params: dict):
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                f"{self.base}/{table}", headers=self.headers, params=params
            )
        response.raise_for_status()
        return response.json()
```

- [ ] **Step 3: Dispatch by Cron expression and run the forecast**

Update `Default.scheduled` in `cloudflare/src/main.py`:

```python
    async def scheduled(self, controller, env, ctx):
        if controller.cron == "0 19 * * 0":
            runs = await database(env).rpc("enqueue_weekly_forecast_runs")
            workflow = env.FORECAST_WORKFLOW
        else:
            runs = await database(env).rpc("enqueue_daily_market_runs")
            workflow = env.MARKET_WORKFLOW
        for offset in range(0, len(runs), 100):
            await workflow.create_batch([
                {"id": run["id"], "params": {"run_id": run["id"]}}
                for run in runs[offset:offset + 100]
            ])
```

Append:

```python
class ForecastWorkflow(WorkflowEntrypoint):
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
            snapshots = await step.do("load snapshots", lambda: db.rows(
                "market_snapshots",
                {"asset_id": f"eq.{run['asset_id']}",
                 "select": "snapshot_date,estimated_price",
                 "order": "snapshot_date.asc", "limit": "180"},
            ))
            from .research import research
            profile, evidence = await step.do(
                "bocha research",
                {"retries": {"limit": 2, "delay": "10 seconds",
                             "backoff": "exponential"}, "timeout": "3 minutes"},
                lambda: research(self.env, asset),
            )
            from .forecast import forecast
            result = forecast(
                float(asset["latest_market_price"]),
                snapshots, evidence, profile, evidence,
            )
            await step.do("save forecast", lambda: db.rpc(
                "complete_forecast_run",
                {"p_run_id": run_id, "p_result": result.model_dump(mode="json")},
            ))
            return {"status": "succeeded", "method": result.method}
        except Exception as error:
            await step.do("record failure", lambda: db.rpc(
                "fail_analysis_run",
                {"p_run_id": run_id, "p_message": str(error)},
            ))
            raise
```

- [ ] **Step 4: Verify the deploy bundle**

Run: `cd cloudflare && npx wrangler deploy --dry-run`

Expected: build succeeds with two Workflow bindings and two Cron expressions.

- [ ] **Step 5: Commit**

```bash
git add cloudflare/wrangler.toml cloudflare/src/supabase.py cloudflare/src/main.py
git commit -m "feat: schedule weekly residual forecasts"
```

### Task 5: Render Forecasts Without Hiding Uncertainty

**Files:**
- Modify: `mobile/src/types/domain.ts`
- Modify: `mobile/src/lib/assets.ts`
- Create: `mobile/src/components/residual-forecast.tsx`
- Modify: `mobile/src/components/holding-cost-view.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: latest `asset_forecasts` row.
- Produces: optional `forecast` in `MarketInsight` and a read-only forecast block.

- [ ] **Step 1: Add the domain type**

Append to `mobile/src/types/domain.ts`:

```ts
export type AssetForecast = {
  id: string;
  asset_id: string;
  forecast_date: string;
  method: 'own_history' | 'comparable_retention' | 'unavailable';
  value_6m: number | null;
  low_6m: number | null;
  high_6m: number | null;
  value_12m: number | null;
  low_12m: number | null;
  high_12m: number | null;
  confidence: number;
  reason: string;
  evidence: {
    url: string;
    title: string;
    site_name: string;
    relevant: boolean;
  }[];
  created_at: string;
};
```

Add `forecast: AssetForecast | null` to `MarketInsight`. In `getMarketInsight`, query the latest `asset_forecasts` row in the existing `Promise.all`, and return its first row.

- [ ] **Step 2: Render the result or withholding reason**

```tsx
// mobile/src/components/residual-forecast.tsx
import { Text, View } from 'react-native';
import { colors, spacing, typography } from '@/constants/colors';
import { formatCurrency, formatDate } from '@/lib/format';
import type { AssetForecast } from '@/types/domain';

export function ResidualForecast({
  forecast,
}: {
  forecast: AssetForecast | null;
}) {
  if (!forecast) return null;
  if (forecast.method === 'unavailable') {
    return (
      <Text style={{ color: colors.textSecondary, ...typography.label }}>
        暂不提供未来估算：{forecast.reason}
      </Text>
    );
  }
  const level =
    forecast.confidence >= 0.75
      ? '高'
      : forecast.confidence >= 0.5
        ? '中'
        : '低';
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={{ ...typography.body, fontWeight: '700' }}>未来残值估算</Text>
      <Text style={{ ...typography.body }}>
        6 个月 {formatCurrency(forecast.value_6m)}
        {' · '}{formatCurrency(forecast.low_6m)}–
        {formatCurrency(forecast.high_6m)}
      </Text>
      <Text style={{ ...typography.body }}>
        12 个月 {formatCurrency(forecast.value_12m)}
        {' · '}{formatCurrency(forecast.low_12m)}–
        {formatCurrency(forecast.high_12m)}
      </Text>
      <Text style={{ color: colors.textSecondary, ...typography.label }}>
        置信度 {Math.round(forecast.confidence * 100)}%（{level}）·{' '}
        {forecast.reason}
        {' · '}更新于 {formatDate(forecast.created_at)}
      </Text>
      <Text style={{ color: colors.textTertiary, ...typography.label }}>
        基于历史行情与博查检索到的公开资料，结果为估算，不构成交易建议
      </Text>
    </View>
  );
}
```

- [ ] **Step 3: Append it below the historical chart**

In `mobile/src/components/holding-cost-view.tsx`, import `ResidualForecast` and render:

```tsx
<ResidualHistoryChart points={points} />
<ResidualForecast forecast={insight.forecast} />
```

Update all empty `MarketInsight` literals to include `forecast: null`.

- [ ] **Step 4: Configure and smoke-test Bocha**

Run:

```bash
cd cloudflare
npx wrangler secret put BOCHA_API_KEY
npx wrangler deploy
npx wrangler workflows trigger forecast-workflow \
  '{"run_id":"<forecast run id returned by enqueue_weekly_forecast_runs>"}'
```

Expected: one `asset_forecasts` row is stored. Its `evidence` entries retain the exact public URL and query, and its future values are either all present or all absent with method `unavailable`.

- [ ] **Step 5: Document source semantics**

Add to `README.md`:

```markdown
### Residual forecasts

Weekly forecast runs use Bocha Web Search for public evidence and the existing
model only to normalize cited facts. The numeric forecast is calculated by
`cloudflare/src/forecast.py`. The app withholds future values until either
four market dates span 21 days or three verifiable comparable-retention
observations are available.
```

- [ ] **Step 6: Run and commit**

Run: `cd mobile && npm run lint && npx tsc --noEmit`

Expected: exit code 0.

```bash
git add mobile/src/types/domain.ts mobile/src/lib/assets.ts \
  mobile/src/components/residual-forecast.tsx \
  mobile/src/components/holding-cost-view.tsx README.md
git commit -m "feat: show evidence-backed residual forecasts"
```
