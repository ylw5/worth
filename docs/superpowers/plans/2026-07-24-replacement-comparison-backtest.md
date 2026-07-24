# Replacement Comparison and Forecast Backtest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user compare the cash required to replace an asset now versus in 6 or 12 months, record actual sales, and measure forecast error against later market snapshots or realized sale prices.

**Architecture:** Reuse existing wishlist items as replacement targets and keep the comparison formula transparent: target price minus the current asset’s estimated residual value. Store explicit scenario assumptions rather than subjective advice; actual-sale rows and a security-invoker SQL view provide backtest outcomes without a second analytics service.

**Tech Stack:** Supabase Postgres/RLS, Expo Router, React Native Modal/Pressable, TanStack Query, TypeScript, Node built-in test runner.

## Global Constraints

- Reuse `wishlist_items`; do not create a second replacement-target catalog.
- A replacement comparison requires a wishlist target price, current market value, and an available 6- or 12-month forecast.
- Assume the replacement target price stays unchanged over the selected horizon and display that assumption.
- Output only numeric comparison; do not choose “现在换” or “以后换” for the user.
- Treat wishlist `target_price` as user-entered/public reference price, not a verified transaction price.
- Prefer realized `asset_sales.sale_price` over a nearby market snapshot when backtesting.
- Backtest only when an observation exists within 30 days of the forecast target date.
- All user-facing tables must retain owner RLS.
- Before editing `mobile/`, read the exact Expo v57 docs at `https://docs.expo.dev/versions/v57.0.0/`.

---

## File Map

- Create `supabase/migrations/202607240008_replacement_and_backtests.sql`: replacement snapshots, actual sales, and backtest view.
- Create `mobile/src/lib/replacement.ts`: pure cash-gap comparison.
- Create `mobile/tests/replacement.test.mjs`: 6/12-month and unavailable checks.
- Modify `mobile/src/types/domain.ts`: wishlist, scenario, and sale types.
- Modify `mobile/src/lib/assets.ts`: record sale and scenario snapshot.
- Modify `mobile/src/lib/wishlist.ts`: list targets for selection.
- Create `mobile/src/components/replacement-comparison.tsx`: target/horizon selection and numeric output.
- Create `mobile/src/app/asset/[id]/sale.tsx`: minimal actual-sale form.
- Modify `mobile/src/app/asset/[id].tsx`: link sale recording and render comparison.
- Modify `README.md`: assumptions and backtest query.

### Task 1: Add Replacement, Sale, and Backtest Storage

**Files:**
- Create: `supabase/migrations/202607240008_replacement_and_backtests.sql`

**Interfaces:**
- Consumes: `assets`, `wishlist_items`, `asset_forecasts`, `market_snapshots`.
- Produces: `replacement_scenarios`, `asset_sales`, `forecast_backtest_results`.

- [ ] **Step 1: Add tables with owner policies**

```sql
alter table public.wishlist_items
add column price_source_url text,
add column price_checked_at timestamptz;

create table public.replacement_scenarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  wishlist_item_id uuid not null
    references public.wishlist_items(id) on delete cascade,
  forecast_id uuid not null
    references public.asset_forecasts(id) on delete cascade,
  horizon_months integer not null check (horizon_months in (6, 12)),
  target_price numeric(12, 2) not null check (target_price > 0),
  current_asset_value numeric(12, 2) not null check (current_asset_value > 0),
  future_asset_value numeric(12, 2) not null check (future_asset_value > 0),
  change_now_cash numeric(12, 2) not null,
  change_later_cash numeric(12, 2) not null,
  waiting_cash_difference numeric(12, 2) not null,
  assumptions jsonb not null,
  created_at timestamptz not null default now()
);

create index replacement_scenarios_asset_created_idx
  on public.replacement_scenarios (asset_id, created_at desc);
alter table public.replacement_scenarios enable row level security;
create policy replacement_scenarios_owner on public.replacement_scenarios
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.assets
      where assets.id = asset_id and assets.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.wishlist_items
      where wishlist_items.id = wishlist_item_id
        and wishlist_items.user_id = (select auth.uid())
    )
  );

create table public.asset_sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  asset_id uuid not null unique references public.assets(id) on delete cascade,
  sold_at date not null check (sold_at <= current_date),
  sale_price numeric(12, 2) not null check (sale_price > 0),
  platform text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);

alter table public.asset_sales enable row level security;
create policy asset_sales_owner on public.asset_sales
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.assets
      where assets.id = asset_id and assets.user_id = (select auth.uid())
    )
  );

create function public.record_asset_sale(
  p_asset_id uuid,
  p_sold_at date,
  p_sale_price numeric,
  p_platform text,
  p_notes text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.asset_sales (
    user_id, asset_id, sold_at, sale_price, platform, notes
  ) values (
    (select auth.uid()), p_asset_id, p_sold_at, p_sale_price,
    p_platform, p_notes
  )
  on conflict (asset_id) do update set
    sold_at = excluded.sold_at,
    sale_price = excluded.sale_price,
    platform = excluded.platform,
    notes = excluded.notes;

  update public.assets
  set status = 'sold', updated_at = now()
  where id = p_asset_id and user_id = (select auth.uid());
  if not found then raise exception 'asset not found'; end if;
end;
$$;
```

- [ ] **Step 2: Add a security-invoker backtest view**

Append:

```sql
create view public.forecast_backtest_results
with (security_invoker = true)
as
select
  f.user_id,
  f.id as forecast_id,
  f.asset_id,
  h.horizon_months,
  f.forecast_date,
  (f.forecast_date + make_interval(months => h.horizon_months))::date
    as target_date,
  h.predicted_value,
  coalesce(s.sale_price, m.estimated_price) as observed_value,
  case
    when coalesce(s.sale_price, m.estimated_price) is null then null
    else round(
      abs(h.predicted_value - coalesce(s.sale_price, m.estimated_price))
      / coalesce(s.sale_price, m.estimated_price),
      4
    )
  end as absolute_percentage_error,
  case when s.sale_price is not null then 'sale' else 'market_snapshot' end
    as observation_source
from public.asset_forecasts f
cross join lateral (
  values (6, f.value_6m), (12, f.value_12m)
) as h(horizon_months, predicted_value)
left join lateral (
  select sale_price
  from public.asset_sales
  where asset_sales.asset_id = f.asset_id
    and abs(asset_sales.sold_at - (
      f.forecast_date + make_interval(months => h.horizon_months)
    )::date) <= 30
  order by abs(asset_sales.sold_at - (
    f.forecast_date + make_interval(months => h.horizon_months)
  )::date)
  limit 1
) s on true
left join lateral (
  select estimated_price
  from public.market_snapshots
  where market_snapshots.asset_id = f.asset_id
    and abs(market_snapshots.snapshot_date - (
      f.forecast_date + make_interval(months => h.horizon_months)
    )::date) <= 30
  order by abs(market_snapshots.snapshot_date - (
    f.forecast_date + make_interval(months => h.horizon_months)
  )::date)
  limit 1
) m on s.sale_price is null
where h.predicted_value is not null;

grant select on public.forecast_backtest_results to authenticated;
```

- [ ] **Step 3: Apply and lint**

Run: `npx supabase db reset && npx supabase db lint`

Expected: exit code 0. An authenticated user can select only their own view rows because the view invokes underlying RLS.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/202607240008_replacement_and_backtests.sql
git commit -m "feat: add replacement and forecast outcomes"
```

### Task 2: Lock the Replacement Formula

**Files:**
- Create: `mobile/src/lib/replacement.ts`
- Create: `mobile/tests/replacement.test.mjs`

**Interfaces:**
- Produces: `compareReplacement(targetPrice, currentValue, futureValue)`.

- [ ] **Step 1: Write the failing check**

```js
// mobile/tests/replacement.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { compareReplacement } from '../src/lib/replacement.ts';

test('compares current and delayed replacement cash', () => {
  assert.deepEqual(compareReplacement(5000, 1800, 1200), {
    changeNowCash: 3200,
    changeLaterCash: 3800,
    waitingCashDifference: 600,
  });
});

test('allows an asset to be worth more than the target', () => {
  assert.equal(compareReplacement(1000, 1200, 900).changeNowCash, -200);
});

test('withholds comparison when a value is absent', () => {
  assert.equal(compareReplacement(5000, 1800, null), null);
});
```

- [ ] **Step 2: Run and observe the missing module**

Run: `cd mobile && node --test tests/replacement.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the pure function**

```ts
// mobile/src/lib/replacement.ts
export function compareReplacement(
  targetPrice: number | null,
  currentValue: number | null,
  futureValue: number | null,
) {
  if (targetPrice == null || currentValue == null || futureValue == null) {
    return null;
  }
  const changeNowCash = targetPrice - currentValue;
  const changeLaterCash = targetPrice - futureValue;
  return {
    changeNowCash,
    changeLaterCash,
    waitingCashDifference: changeLaterCash - changeNowCash,
  };
}
```

- [ ] **Step 4: Run the check**

Run: `cd mobile && node --test tests/replacement.test.mjs`

Expected: `3 tests passed`.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/replacement.ts mobile/tests/replacement.test.mjs
git commit -m "feat: calculate replacement cash gap"
```

### Task 3: Read Targets and Record Scenario Snapshots

**Files:**
- Modify: `mobile/src/types/domain.ts`
- Modify: `mobile/src/lib/assets.ts`
- Modify: `mobile/src/lib/wishlist.ts`

**Interfaces:**
- Consumes: authenticated Supabase client.
- Produces: `recordReplacementScenario`, `recordAssetSale`, and typed wishlist rows including price-source metadata.

- [ ] **Step 1: Add types**

Append to `mobile/src/types/domain.ts`:

```ts
export type WishlistItem = {
  id: string;
  user_id: string;
  name: string;
  target_price: number;
  notes: string;
  price_source_url: string | null;
  price_checked_at: string | null;
  created_at: string;
};

export type ReplacementScenarioInput = {
  asset_id: string;
  wishlist_item_id: string;
  forecast_id: string;
  horizon_months: 6 | 12;
  target_price: number;
  current_asset_value: number;
  future_asset_value: number;
  change_now_cash: number;
  change_later_cash: number;
  waiting_cash_difference: number;
  assumptions: {
    target_price_constant: true;
    fees_included: false;
    source: 'user_wishlist';
  };
};
```

If `WishlistItem` already exists in `mobile/src/lib/wishlist.ts`, move that exact shape to `domain.ts` rather than defining it twice.

- [ ] **Step 2: Add authenticated writes**

Append to `mobile/src/lib/assets.ts`:

```ts
export async function recordReplacementScenario(
  input: ReplacementScenarioInput,
) {
  const { data, error } = await supabase
    .from('replacement_scenarios')
    .insert(input)
    .select('*')
    .single();
  fail(error);
  return data;
}

export async function recordAssetSale(input: {
  asset_id: string;
  sold_at: string;
  sale_price: number;
  platform: string;
  notes: string;
}) {
  const { error } = await supabase.rpc('record_asset_sale', {
    p_asset_id: input.asset_id,
    p_sold_at: input.sold_at,
    p_sale_price: input.sale_price,
    p_platform: input.platform,
    p_notes: input.notes,
  });
  fail(error);
}
```

Keep `listWishlistItems()` in `mobile/src/lib/wishlist.ts`; update only its return cast to the shared `WishlistItem[]` type.

- [ ] **Step 3: Type-check**

Run: `cd mobile && npx tsc --noEmit`

Expected: exit code 0 with one shared `WishlistItem` definition.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/types/domain.ts mobile/src/lib/assets.ts mobile/src/lib/wishlist.ts
git commit -m "feat: persist replacement comparisons and sales"
```

### Task 4: Add Numeric Replacement Comparison to Asset Detail

**Files:**
- Create: `mobile/src/components/replacement-comparison.tsx`
- Modify: `mobile/src/components/holding-cost-view.tsx`

**Interfaces:**
- Consumes: asset, latest forecast, `listWishlistItems()`, pure comparison, and `recordReplacementScenario()`.
- Produces: a target/horizon selector and saveable assumption snapshot.

- [ ] **Step 1: Build a native selector without adding a picker dependency**

Create `ReplacementComparison` using `Modal`, `Pressable`, `Text`, and `View`. It must:

```tsx
const futureValue =
  horizon === 6 ? forecast?.value_6m : forecast?.value_12m;
const comparison = compareReplacement(
  selected?.target_price ?? null,
  asset.latest_market_price,
  futureValue,
);
```

Render the selected wishlist name, two accessible horizon buttons (`6 个月`, `12 个月`), and:

```tsx
<Text>现在换需补 {formatCurrency(comparison.changeNowCash)}</Text>
<Text>
  {horizon} 个月后换预计需补 {formatCurrency(comparison.changeLaterCash)}
</Text>
<Text>
  等待期间补差变化 {formatCurrency(comparison.waitingCashDifference)}
</Text>
<Text>
  假设目标物价格不变，未计交易手续费；仅作数值对比，不构成换新建议
</Text>
```

When the user taps “保存对比”, call:

```ts
recordReplacementScenario({
  asset_id: asset.id,
  wishlist_item_id: selected.id,
  forecast_id: forecast.id,
  horizon_months: horizon,
  target_price: selected.target_price,
  current_asset_value: asset.latest_market_price!,
  future_asset_value: futureValue!,
  change_now_cash: comparison.changeNowCash,
  change_later_cash: comparison.changeLaterCash,
  waiting_cash_difference: comparison.waitingCashDifference,
  assumptions: {
    target_price_constant: true,
    fees_included: false,
    source: 'user_wishlist',
  },
});
```

If there is no wishlist item, render a link to the existing wishlist tab. If forecast is unavailable, render its withholding reason and disable saving.

- [ ] **Step 2: Add the component to the holding view**

Append below `ResidualForecast` in `mobile/src/components/holding-cost-view.tsx`:

```tsx
<ReplacementComparison asset={asset} forecast={insight.forecast} />
```

- [ ] **Step 3: Run checks and verify manually**

Run: `cd mobile && npm run lint && npx tsc --noEmit`

Expected: exit code 0.

Manual expected behavior:

- Target selection lists the existing wishlist rows only.
- Switching horizon changes only the forecast field used.
- No comparison appears without all three numeric inputs.
- Saved row contains exactly the values displayed on screen.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/components/replacement-comparison.tsx \
  mobile/src/components/holding-cost-view.tsx
git commit -m "feat: compare replacement timing"
```

### Task 5: Record a Real Sale and Close the Asset Lifecycle

**Files:**
- Create: `mobile/src/app/asset/[id]/sale.tsx`
- Modify: `mobile/src/app/asset/[id].tsx`

**Interfaces:**
- Consumes: `recordAssetSale`.
- Produces: validated sale date/price form and sold asset state.

- [ ] **Step 1: Add a minimal native form**

Use the existing input styling from `mobile/src/components/asset-form-fields.tsx` and the existing `parsePurchaseInput` date/price validation by calling:

```ts
const parsed = parsePurchaseInput(soldAt, salePrice);
if ('error' in parsed || !parsed.input.purchase_date || !parsed.input.purchase_price) {
  setError('请填写有效的成交日期和成交价');
  return;
}
await recordAssetSale({
  asset_id: id,
  sold_at: parsed.input.purchase_date,
  sale_price: parsed.input.purchase_price,
  platform: platform.trim(),
  notes: notes.trim(),
});
router.back();
```

The screen must include labels “成交日期”, “成交价”, “平台（选填）”, and “备注（选填）”, plus a 48-point “保存成交记录” button.

- [ ] **Step 2: Link from the asset detail header**

Keep the existing “编辑” link. Add a secondary `Pressable` labeled “已出售” in the basic-information section only when `asset.status !== 'sold'`, linking to `/asset/[id]/sale`.

- [ ] **Step 3: Verify**

Run: `cd mobile && npm run lint && npx tsc --noEmit`

Expected: exit code 0.

Manual expected behavior: saving a valid sale creates or updates one `asset_sales` row, marks the asset `sold`, and future scheduled market/forecast enqueues exclude it.

- [ ] **Step 4: Commit**

```bash
git add 'mobile/src/app/asset/[id]/sale.tsx' 'mobile/src/app/asset/[id].tsx'
git commit -m "feat: record realized asset sales"
```

### Task 6: Verify Backtest Evidence and Document the Ceiling

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: matured forecasts and later observations.
- Produces: auditable error query and explicit recalibration threshold.

- [ ] **Step 1: Query only matured outcomes**

Run in Supabase SQL editor:

```sql
select
  horizon_months,
  count(*) as observations,
  round(avg(absolute_percentage_error), 4) as mean_absolute_percentage_error
from public.forecast_backtest_results
where observed_value is not null
group by horizon_months
order by horizon_months;
```

Expected before forecasts mature: zero rows. Expected after observations mature: one row per available horizon with count and mean absolute percentage error.

- [ ] **Step 2: Add operational documentation**

Add to `README.md`:

```markdown
### Replacement comparison and backtesting

Replacement comparison assumes the wishlist target price stays constant and
excludes transaction fees. `forecast_backtest_results` compares each matured
6/12-month estimate with a realized sale first, otherwise the nearest market
snapshot within 30 days.

Do not auto-calibrate the model until a category has at least 30 matured
observations for the same horizon. Before that threshold, report error only;
changing coefficients from a handful of outcomes would make the forecast less
stable rather than more accurate.
```

- [ ] **Step 3: Run the full checks**

Run:

```bash
cd mobile && node --test tests/*.test.mjs && npm run lint && npx tsc --noEmit
cd ../cloudflare && python -m pytest -q
cd .. && npx supabase db lint
```

Expected: all tests pass and both linters/type checks exit 0.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: define forecast backtest operations"
```
