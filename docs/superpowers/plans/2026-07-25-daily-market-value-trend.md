# Daily Market Value Trend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh every unsold asset's second-hand market estimate once per day and show its historical estimate curve on the asset detail page.

**Architecture:** A Cloudflare Cron dispatches one durable Python Workflow per `(user_id, market_key, run_date)`. Existing Supabase RPCs atomically fan successful results out to matching unsold assets, while Expo reads snapshots and renders a dependency-free static line chart.

**Tech Stack:** Supabase Postgres/PostgREST, Cloudflare Python Workers and Workflows, `httpx`, OpenAI Python SDK, Expo SDK 57, React Native, TanStack Query, Node built-in test runner, pytest.

## Global Constraints

- Refresh only `in_use`, `idle`, and `listed` assets; never enqueue or update `sold` assets.
- One successful snapshot per asset and calendar date; Workflow retries update rather than duplicate it.
- Opening or refreshing asset detail must not invoke market search or AI.
- Publish only when at least five deduplicated comparable listings survive filtering.
- Keep `XIANYU_COOKIE`, `SUPABASE_SERVICE_ROLE_KEY`, and `AI_GATEWAY_API_KEY` in Cloudflare Secrets and out of logs.
- Describe results as Xianyu active-listing estimates, not completed-sale prices.
- Keep Expo at SDK 57 / React Native 0.86 and add no chart dependency.
- Preserve the user's unrelated wishlist worktree changes.
- Reuse only market-refresh files from `codex/dual-view-residual-parked`; do not restore forecast, Bocha, replacement, holding-cost, or sale-screen changes.

---

### Task 1: Make Daily Scheduling and Fan-Out Match the Product Rules

**Files:**
- Create: `supabase/migrations/202607250001_daily_market_refresh.sql`

**Interfaces:**
- Consumes: `public.assets`, `public.analysis_runs`, `public.market_snapshots`.
- Produces: corrected `enqueue_daily_market_runs()` and `complete_market_run(uuid, jsonb)`.

- [ ] **Step 1: Add the forward-only migration**

Do not edit the already-committed `202607240007_background_market_snapshots.sql`. Create:

```sql
create or replace function public.enqueue_daily_market_runs()
returns setof public.analysis_runs
language sql
security definer
set search_path = ''
as $$
  insert into public.analysis_runs (
    user_id, asset_id, market_key, kind, run_date
  )
  select
    a.user_id,
    (array_agg(a.id order by a.id))[1],
    a.market_key,
    'market',
    (now() at time zone 'Asia/Shanghai')::date
  from public.assets a
  where a.status <> 'sold'
  group by a.user_id, a.market_key
  on conflict (user_id, market_key, kind, run_date) do nothing
  returning *;
$$;

create or replace function public.complete_market_run(
  p_run_id uuid,
  p_result jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.analysis_runs;
begin
  select * into strict run
  from public.analysis_runs
  where id = p_run_id and kind = 'market' and status = 'running'
  for update;

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
    p_result->>'query',
    p_result->'samples'
  from public.assets a
  where a.user_id = run.user_id
    and a.market_key = run.market_key
    and a.status <> 'sold'
  on conflict (asset_id, snapshot_date) do update set
    run_id = excluded.run_id,
    estimated_price = excluded.estimated_price,
    price_low = excluded.price_low,
    price_high = excluded.price_high,
    sample_count = excluded.sample_count,
    query = excluded.query,
    samples = excluded.samples,
    created_at = now();

  update public.assets
  set
    latest_market_price = (p_result->>'estimated_price')::numeric,
    latest_market_price_low = (p_result->>'price_low')::numeric,
    latest_market_price_high = (p_result->>'price_high')::numeric,
    latest_valuation_at = now(),
    updated_at = now()
  where user_id = run.user_id
    and market_key = run.market_key
    and status <> 'sold';

  update public.analysis_runs
  set status = 'succeeded', finished_at = now()
  where id = run.id;
end;
$$;

revoke all on function public.enqueue_daily_market_runs() from public;
revoke all on function public.complete_market_run(uuid, jsonb) from public;
grant execute on function public.enqueue_daily_market_runs() to service_role;
grant execute on function public.complete_market_run(uuid, jsonb) to service_role;
```

- [ ] **Step 2: Reset and lint the local database**

Run:

```bash
npx supabase db reset
npx supabase db lint
```

Expected: reset succeeds; lint reports no new warning for either replaced security-definer function.

- [ ] **Step 3: Commit the migration**

```bash
git add supabase/migrations/202607250001_daily_market_refresh.sql
git commit -m "fix: refresh every unsold market daily"
```

---

### Task 2: Restore Only the Background Market Worker

**Files:**
- Create: `cloudflare/.gitignore`
- Create: `cloudflare/pyproject.toml`
- Create: `cloudflare/pylock.toml`
- Create: `cloudflare/uv.lock`
- Create: `cloudflare/wrangler.toml`
- Create: `cloudflare/src/__init__.py`
- Create: `cloudflare/src/main.py`
- Create: `cloudflare/src/market.py`
- Create: `cloudflare/src/filter.py`
- Create: `cloudflare/src/models.py`
- Create: `cloudflare/src/supabase.py`
- Create: `cloudflare/tests/test_filter.py`
- Create: `cloudflare/tests/test_market.py`

**Interfaces:**
- Consumes: Supabase RPCs from Task 1 and bindings `MARKET_WORKFLOW`, `SUPABASE_URL`, `OPENAI_MODEL`.
- Produces: `Default.scheduled(...)`, `MarketWorkflow.run(...)`, and `collect_market_result(env, asset)`.

- [ ] **Step 1: Recover the already-debugged market modules and locks**

Use the parked branch as an exact source, limited to the shared runtime and market files:

```bash
git restore --source=codex/dual-view-residual-parked -- \
  cloudflare/.gitignore \
  cloudflare/pyproject.toml \
  cloudflare/pylock.toml \
  cloudflare/uv.lock \
  cloudflare/src/__init__.py \
  cloudflare/src/market.py \
  cloudflare/src/filter.py \
  cloudflare/src/supabase.py \
  cloudflare/tests/test_filter.py \
  cloudflare/tests/test_market.py
```

Expected: no `forecast.py`, `research.py`, or `bocha.py` exists.

- [ ] **Step 2: Create market-only boundary models**

Create `cloudflare/src/models.py`:

```python
from pydantic import BaseModel, Field


class Sample(BaseModel):
    item_id: str
    title: str
    price: float = Field(gt=0)
    url: str


class MarketResult(BaseModel):
    estimated_price: float = Field(gt=0)
    price_low: float = Field(gt=0)
    price_high: float = Field(gt=0)
    sample_count: int = Field(ge=5)
    query: str
    samples: list[Sample]
```

- [ ] **Step 3: Create a market-only Worker configuration**

Create `cloudflare/wrangler.toml`:

```toml
name = "worth-background"
main = "src/main.py"
compatibility_date = "2026-07-25"
compatibility_flags = ["python_workers", "python_workflows"]

[vars]
OPENAI_MODEL = "openai/gpt-5.4"
SUPABASE_URL = "https://etvfpaabcsgjorapopts.supabase.co"

[secrets]
required = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "XIANYU_COOKIE",
  "AI_GATEWAY_API_KEY",
]

[triggers]
crons = ["0 18 * * *"]

[[workflows]]
name = "market-workflow"
binding = "MARKET_WORKFLOW"
class_name = "MarketWorkflow"
```

The trigger runs at 02:00 Asia/Shanghai because Cloudflare Cron uses UTC.

- [ ] **Step 4: Create the market-only entrypoint**

Create `cloudflare/src/main.py`:

```python
from workers import Response, WorkerEntrypoint, WorkflowEntrypoint

from supabase import Supabase


def database(env):
    return Supabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        return Response.json({"status": "ok"})

    async def scheduled(self, controller, env, ctx):
        runs = await database(env).rpc("enqueue_daily_market_runs")
        for run in runs:
            await env.MARKET_WORKFLOW.create(
                {"id": run["id"], "params": {"run_id": run["id"]}}
            )


class MarketWorkflow(WorkflowEntrypoint):
    async def run(self, event, step):
        run_id = event["payload"]["run_id"]
        db = database(self.env)

        @step.do("claim")
        async def claim():
            return await db.rpc(
                "claim_analysis_run",
                {"p_run_id": run_id},
            )

        @step.do("load asset")
        async def load_asset(claim):
            if not claim:
                return None
            return await db.asset(claim["asset_id"])

        @step.do(
            "collect and filter",
            config={
                "retries": {
                    "limit": 2,
                    "delay": "5 seconds",
                    "backoff": "exponential",
                },
                "timeout": "2 minutes",
            },
        )
        async def collect_and_filter(load_asset):
            if not load_asset:
                return None
            from filter import collect_market_result

            result = await collect_market_result(self.env, load_asset)
            return result.model_dump(mode="json")

        @step.do("save snapshot")
        async def save_snapshot(collect_and_filter):
            if not collect_and_filter:
                return {"status": "skipped"}
            await db.rpc(
                "complete_market_run",
                {
                    "p_run_id": run_id,
                    "p_result": collect_and_filter,
                },
            )
            return {"status": "succeeded"}

        try:
            await claim()
            await load_asset()
            await collect_and_filter()
            return await save_snapshot()
        except Exception as error:
            await db.rpc(
                "fail_analysis_run",
                {"p_run_id": run_id, "p_message": str(error)},
            )
            raise
```

- [ ] **Step 5: Run deterministic worker checks**

```bash
cd cloudflare
uv run pytest tests/test_filter.py tests/test_market.py -q
npx wrangler@latest deploy --dry-run
```

Expected: both pytest files pass; Wrangler successfully packages one scheduled handler and one Workflow class.

- [ ] **Step 6: Commit the Worker**

```bash
git add cloudflare
git commit -m "feat: restore daily market workflow"
```

---

### Task 3: Add Snapshot Queries and Pure Trend Calculations

**Files:**
- Modify: `mobile/src/types/domain.ts`
- Modify: `mobile/src/lib/assets.ts`
- Create: `mobile/src/lib/market-trend.ts`
- Create: `mobile/tests/market-trend.test.mjs`

**Interfaces:**
- Consumes: `market_snapshots` and `analysis_runs` rows protected by existing RLS.
- Produces: `getMarketInsight(asset)`, `jobCopy(...)`, `filterTrend(...)`, `trendStats(...)`, and `plotTrend(...)`.

- [ ] **Step 1: Write the failing trend check**

Create `mobile/tests/market-trend.test.mjs`:

```js
import assert from 'node:assert/strict';
import {
  filterTrend,
  jobCopy,
  plotTrend,
  trendStats,
} from '../src/lib/market-trend.ts';

const snapshots = [
  { snapshot_date: '2026-04-01', estimated_price: 80 },
  { snapshot_date: '2026-07-01', estimated_price: 100 },
  { snapshot_date: '2026-07-20', estimated_price: 90 },
  { snapshot_date: '2026-07-25', estimated_price: 120 },
];

assert.deepEqual(
  filterTrend(snapshots, '30d').map((row) => row.estimated_price),
  [100, 90, 120],
);
assert.deepEqual(trendStats(snapshots.slice(1)), {
  change: 20,
  percent: 20,
  high: 120,
  low: 90,
});
assert.deepEqual(plotTrend([snapshots[3]], 280, 120), [
  { x: 0, y: 60 },
]);
assert.deepEqual(plotTrend([], 280, 120), []);
assert.equal(jobCopy({ status: 'running' }), '行情更新中');
assert.equal(
  jobCopy({ status: 'failed' }),
  '本次更新失败，仍展示上次结果',
);
console.log('market trend checks passed');
```

- [ ] **Step 2: Run it and confirm the missing module**

```bash
cd mobile
node --test tests/market-trend.test.mjs
```

Expected: FAIL because `src/lib/market-trend.ts` does not exist.

- [ ] **Step 3: Add the minimal pure helper**

Create `mobile/src/lib/market-trend.ts`:

```ts
export type TrendRange = '30d' | '90d' | 'all';

type TrendRow = {
  snapshot_date: string;
  estimated_price: number;
};

export function jobCopy(run: { status: string } | null) {
  if (!run) return '等待后台更新';
  if (run.status === 'queued') return '已排队';
  if (run.status === 'running') return '行情更新中';
  if (run.status === 'failed') return '本次更新失败，仍展示上次结果';
  return '已更新';
}

export function filterTrend(rows: TrendRow[], range: TrendRange) {
  if (range === 'all' || rows.length === 0) return rows;
  const cutoff = new Date(`${rows.at(-1)!.snapshot_date}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - (range === '30d' ? 30 : 90));
  const date = cutoff.toISOString().slice(0, 10);
  return rows.filter((row) => row.snapshot_date >= date);
}

export function trendStats(rows: TrendRow[]) {
  if (rows.length === 0) return null;
  const first = rows[0].estimated_price;
  const last = rows.at(-1)!.estimated_price;
  const prices = rows.map((row) => row.estimated_price);
  return {
    change: last - first,
    percent:
      first === 0 ? null : Math.round(((last - first) / first) * 1000) / 10,
    high: Math.max(...prices),
    low: Math.min(...prices),
  };
}

export function plotTrend(rows: TrendRow[], width: number, height: number) {
  if (rows.length === 0 || width <= 0 || height <= 0) return [];
  if (rows.length === 1) return [{ x: 0, y: height / 2 }];
  const prices = rows.map((row) => row.estimated_price);
  const low = Math.min(...prices);
  const span = Math.max(...prices) - low || 1;
  return rows.map((row, index) => ({
    x: (index / (rows.length - 1)) * width,
    y: height - ((row.estimated_price - low) / span) * height,
  }));
}
```

- [ ] **Step 4: Add database-facing types**

Add `market_key: string` to `Asset` and append:

```ts
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

- [ ] **Step 5: Add the read-only query**

Import `MarketInsight` in `mobile/src/lib/assets.ts` and append:

```ts
export async function getMarketInsight(
  asset: Asset,
): Promise<MarketInsight> {
  const [snapshots, runs] = await Promise.all([
    supabase
      .from('market_snapshots')
      .select('*')
      .eq('asset_id', asset.id)
      .order('snapshot_date', { ascending: true }),
    supabase
      .from('analysis_runs')
      .select('*')
      .eq('market_key', asset.market_key)
      .eq('kind', 'market')
      .order('created_at', { ascending: false })
      .limit(1),
  ]);
  fail(snapshots.error);
  fail(runs.error);
  return {
    snapshots: (snapshots.data ?? []) as MarketInsight['snapshots'],
    run: ((runs.data ?? [])[0] as MarketInsight['run']) ?? null,
  };
}
```

- [ ] **Step 6: Run the pure check and type/lint validation**

```bash
cd mobile
node --test tests/market-trend.test.mjs
npx tsc --noEmit
npm run lint
```

Expected: the trend check passes and TypeScript/lint report no new errors.

- [ ] **Step 7: Commit the data layer**

```bash
git add mobile/src/types/domain.ts mobile/src/lib/assets.ts \
  mobile/src/lib/market-trend.ts mobile/tests/market-trend.test.mjs
git commit -m "feat: read daily market trends"
```

---

### Task 4: Render the Detail Curve and Remove Request-Time Estimation

**Files:**
- Create: `mobile/src/components/market-snapshot-card.tsx`
- Create: `mobile/src/components/market-trend-card.tsx`
- Modify: `mobile/src/app/asset/[id].tsx`

**Interfaces:**
- Consumes: `MarketInsight` and pure functions from Task 3.
- Produces: current-market status card and 30-day/90-day/all static line chart.

- [ ] **Step 1: Restore the proven current-market card**

Recover only the card:

```bash
git restore --source=codex/dual-view-residual-parked -- \
  mobile/src/components/market-snapshot-card.tsx
```

Then import `jobCopy` from `@/lib/market-trend`, remove the 7-day/30-day change row, and read the latest ascending snapshot with:

```ts
const latest = insight.snapshots.at(-1);
```

Keep the existing current price, range, sample count, job status, source, and timestamp copy.

- [ ] **Step 2: Add the dependency-free chart**

Create `mobile/src/components/market-trend-card.tsx`:

```tsx
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/constants/colors';
import { formatCurrency } from '@/lib/format';
import {
  filterTrend,
  plotTrend,
  trendStats,
  type TrendRange,
} from '@/lib/market-trend';
import type { MarketSnapshot } from '@/types/domain';

const ranges: [TrendRange, string][] = [
  ['30d', '30 天'],
  ['90d', '90 天'],
  ['all', '全部'],
];
const chartHeight = 120;

export function MarketTrendCard({
  snapshots,
}: {
  snapshots: MarketSnapshot[];
}) {
  const [range, setRange] = useState<TrendRange>('30d');
  const [width, setWidth] = useState(0);
  const rows = filterTrend(snapshots, range);
  const points = plotTrend(rows, width, chartHeight);
  const stats = trendStats(rows);

  return (
    <View
      style={{
        padding: spacing.lg,
        gap: spacing.lg,
        borderRadius: radius.large,
        borderCurve: 'continuous',
        backgroundColor: colors.surface,
      }}>
      <View style={{ gap: spacing.md }}>
        <Text style={{ color: colors.textPrimary, ...typography.cardTitle }}>
          市场趋势
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {ranges.map(([value, label]) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: range === value }}
              onPress={() => setRange(value)}
              style={{
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                borderRadius: radius.pill,
                backgroundColor:
                  range === value ? colors.accentSoft : colors.surfaceMuted,
              }}>
              <Text style={{ color: colors.textPrimary, ...typography.label }}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {rows.length === 0 ? (
        <Text style={{ color: colors.textSecondary, ...typography.body }}>
          暂无行情
        </Text>
      ) : (
        <>
          <View
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            style={{ height: chartHeight }}>
            {points.slice(1).map((point, index) => {
              const previous = points[index];
              const dx = point.x - previous.x;
              const dy = point.y - previous.y;
              const length = Math.hypot(dx, dy);
              return (
                <View
                  key={`${rows[index].snapshot_date}-line`}
                  style={{
                    position: 'absolute',
                    left: (point.x + previous.x - length) / 2,
                    top: (point.y + previous.y) / 2,
                    width: length,
                    height: 2,
                    backgroundColor: colors.accent,
                    transform: [
                      { rotate: `${Math.atan2(dy, dx)}rad` },
                    ],
                  }}
                />
              );
            })}
            {points.map((point, index) => (
              <View
                key={rows[index].snapshot_date}
                style={{
                  position: 'absolute',
                  left: point.x - 3,
                  top: point.y - 3,
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: colors.accent,
                }}
              />
            ))}
          </View>
          {rows.length === 1 ? (
            <Text style={{ color: colors.textSecondary, ...typography.label }}>
              行情积累中
            </Text>
          ) : null}
          {stats ? (
            <Text
              selectable
              style={{ color: colors.textSecondary, ...typography.label }}>
              涨跌 {stats.change >= 0 ? '+' : ''}
              {formatCurrency(stats.change)} ·{' '}
              {stats.percent === null
                ? '—'
                : `${stats.percent >= 0 ? '+' : ''}${stats.percent}%`}
              {' · '}最高 {formatCurrency(stats.high)}
              {' · '}最低 {formatCurrency(stats.low)}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}
```

- [ ] **Step 3: Wire the read-only cards into asset detail**

In `mobile/src/app/asset/[id].tsx`:

- Remove `useIsMutating`, `useMutation`, `useMutationState`, `useQueryClient`, `ActivityIndicator`, `estimateAsset`, `recordValuation`, `refreshPriceMutationKey`, and the refresh mutation/button.
- Remove the old `latest = historyQuery.data?.[0]` variable after replacing its price card.
- Import `MarketSnapshotCard`, `MarketTrendCard`, and `getMarketInsight`.
- After `assetQuery`, add:

```tsx
const insightQuery = useQuery({
  queryKey: ['market-insight', id],
  queryFn: () => getMarketInsight(assetQuery.data!),
  enabled: Boolean(assetQuery.data),
});
```

- Replace the current reference-price card with:

```tsx
{insightQuery.error ? (
  <ErrorState message={insightQuery.error.message} />
) : insightQuery.data ? (
  <>
    <MarketSnapshotCard insight={insightQuery.data} />
    <MarketTrendCard snapshots={insightQuery.data.snapshots} />
  </>
) : (
  <LoadingState />
)}
```

- Keep the existing asset metadata and bottom `价格历史` list unchanged.

- [ ] **Step 4: Verify mobile behavior**

```bash
cd mobile
node --test tests/*.test.mjs
npx tsc --noEmit
npm run lint
```

Expected: all Node checks pass; TypeScript and lint report no new errors. Search verification:

```bash
rg -n "estimateAsset|recordValuation|刷新价格" 'src/app/asset/[id].tsx'
```

Expected: no matches, proving asset detail is read-only.

- [ ] **Step 5: Commit the detail UI**

```bash
git add mobile/src/components/market-snapshot-card.tsx \
  mobile/src/components/market-trend-card.tsx \
  'mobile/src/app/asset/[id].tsx'
git commit -m "feat: show daily market value curve"
```

---

### Task 5: Document Deployment and Run the Local Regression Gate

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: completed database, Worker, and mobile tasks.
- Produces: operator commands for secrets, migration, deployment, and smoke checks.

- [ ] **Step 1: Add operations documentation**

Append:

````markdown
## 每日市场估值

后台 Worker 每天 02:00（Asia/Shanghai）为未售资产创建行情任务。已售资产不再刷新，失败任务不会覆盖最近一次成功估值。

首次部署：

```bash
npx supabase db push
cd cloudflare
npx wrangler@latest secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler@latest secret put XIANYU_COOKIE
npx wrangler@latest secret put AI_GATEWAY_API_KEY
npx wrangler@latest deploy
```

密钥只输入到 Wrangler Secret 提示中，不写入 `.env`、配置文件或日志。

本地验证：

```bash
cd cloudflare && uv run pytest -q
cd mobile && node --test tests/*.test.mjs
cd mobile && npx tsc --noEmit && npm run lint
```
````

- [ ] **Step 2: Run the complete local gate**

```bash
cd cloudflare && uv run pytest -q
cd cloudflare && npx wrangler@latest deploy --dry-run
cd mobile && node --test tests/*.test.mjs
cd mobile && npx tsc --noEmit
cd mobile && npm run lint
git diff --check
```

Expected: all feature checks pass. If a repo-wide check fails only in the user's pre-existing wishlist files, rerun the targeted feature checks and report that boundary without editing the wishlist work.

- [ ] **Step 3: Commit documentation**

```bash
git add README.md
git commit -m "docs: add daily market refresh operations"
```

- [ ] **Step 4: Production deployment gate**

Do not deploy or enter secrets without explicit user authorization. When authorized, run the documented migration and Wrangler deployment, then verify:

1. `enqueue_daily_market_runs()` returns no row for a sold asset.
2. One unsold asset's `analysis_runs` row reaches `succeeded`.
3. Exactly one `market_snapshots` row exists for that asset and date.
4. The detail page shows the same median, range, sample count, source, and curve point.
