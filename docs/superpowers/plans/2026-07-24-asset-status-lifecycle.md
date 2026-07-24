# Asset Status Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four-state asset lifecycle controls, atomic sale recording, and append-only status history.

**Architecture:** PostgreSQL owns lifecycle consistency through two transaction functions and an `assets.status` trigger. The Expo app exposes a small status screen and a required sale form, then invalidates the existing React Query caches. Current-asset totals filter out sold rows without hiding their cards.

**Tech Stack:** Supabase PostgreSQL/RLS, Expo SDK 57, Expo Router, React Native, TanStack Query, Node test runner, TypeScript.

## Global Constraints

- Reuse the existing `in_use | idle | listed | sold` database constraint.
- Every actual status change must append exactly one immutable status event.
- Sale date and sale price are required; sale price must be positive and sale date cannot be in the future.
- Sale data and the `sold` status must change in one database transaction.
- Do not add dependencies, AI UI, event timeline UI, sale platform, notes, fees, or multi-sale support.
- Preserve unrelated changes in `server/app/market.py` and `server/tests/test_market.py`.

---

### Task 1: Database lifecycle ownership

**Files:**
- Create: `supabase/migrations/202607240006_asset_status_lifecycle.sql`

**Interfaces:**
- Consumes: `public.assets(id, user_id, status, created_at, updated_at)`.
- Produces: `asset_sales`, `asset_status_events`, `set_asset_status(uuid, text)`, and `record_asset_sale(uuid, date, numeric)`.

- [ ] **Step 1: Create the tables, trigger, backfill, and RPC functions**

The migration must:

```sql
create table public.asset_sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  asset_id uuid not null unique references public.assets(id) on delete cascade,
  sold_at date not null check (sold_at <= current_date),
  sale_price numeric(12, 2) not null check (sale_price > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.asset_status_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  from_status text check (
    from_status is null
    or from_status in ('in_use', 'idle', 'listed', 'sold')
  ),
  to_status text not null check (
    to_status in ('in_use', 'idle', 'listed', 'sold')
  ),
  created_at timestamptz not null default now()
);

insert into public.asset_status_events (
  user_id, asset_id, from_status, to_status, created_at
)
select user_id, id, null, status, created_at
from public.assets;
```

Add owner-only `select` RLS policies to both tables. Revoke direct `insert`, `update`, and `delete` from `anon` and `authenticated`.

Create a `security definer` trigger function with `set search_path = ''` that inserts one event only when `old.status is distinct from new.status`. Attach it as an `after update of status` trigger.

Create `set_asset_status(p_asset_id uuid, p_status text)` as a `security definer` function that:

```sql
if p_status not in ('in_use', 'idle', 'listed') then
  raise exception 'invalid direct asset status';
end if;

delete from public.asset_sales
where asset_id = p_asset_id
  and user_id = (select auth.uid());

update public.assets
set status = p_status, updated_at = now()
where id = p_asset_id
  and user_id = (select auth.uid());

if not found then
  raise exception 'asset not found';
end if;
```

Create `record_asset_sale(p_asset_id uuid, p_sold_at date, p_sale_price numeric)` as a `security definer` function that validates the date and price, upserts `asset_sales`, then updates the owned asset to `sold`. Grant only function execution and table selection to `authenticated`.

- [ ] **Step 2: Review SQL invariants**

Run:

```bash
rg -n "security definer|set search_path|auth.uid|status|sale_price|sold_at" \
  supabase/migrations/202607240006_asset_status_lifecycle.sql
```

Expected: both RPCs check `auth.uid()`, both use an empty search path, direct table writes are revoked, and the trigger records status changes.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/202607240006_asset_status_lifecycle.sql
git commit -m "feat: persist asset lifecycle events"
```

### Task 2: Domain types and sale validation

**Files:**
- Modify: `mobile/src/types/domain.ts`
- Create: `mobile/src/lib/asset-status.ts`
- Create: `mobile/src/lib/sale-input.ts`
- Create: `mobile/tests/asset-status.test.mjs`
- Create: `mobile/tests/sale-input.test.mjs`

**Interfaces:**
- Consumes: existing `Asset` and `parsePurchaseInput`.
- Produces: `AssetStatus`, `assetStatuses`, `assetStatusLabels`, `isCurrentAsset`, `AssetSale`, and `parseSaleInput`.

- [ ] **Step 1: Write the failing checks**

```js
test('status labels cover the fixed lifecycle', () => {
  assert.deepEqual(assetStatuses, ['in_use', 'idle', 'listed', 'sold']);
  assert.equal(assetStatusLabels.sold, '已卖出');
  assert.equal(isCurrentAsset({ status: 'sold' }), false);
  assert.equal(isCurrentAsset({ status: 'listed' }), true);
});

test('sale input requires a valid date and positive price', () => {
  assert.deepEqual(parseSaleInput('', ''), {
    error: '请填写成交日期和成交价',
  });
  assert.deepEqual(parseSaleInput('9999-12-31', '100'), {
    error: '成交日期不能晚于今天',
  });
  assert.deepEqual(parseSaleInput('2026-07-24', '0'), {
    error: '成交价必须大于 0',
  });
  assert.deepEqual(parseSaleInput('2026-07-24', '88.50'), {
    input: { sold_at: '2026-07-24', sale_price: 88.5 },
  });
});
```

- [ ] **Step 2: Run checks and verify failure**

Run:

```bash
cd mobile && node --test tests/asset-status.test.mjs tests/sale-input.test.mjs
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the fixed status metadata and parser**

Add to `domain.ts`:

```ts
export const assetStatuses = ['in_use', 'idle', 'listed', 'sold'] as const;
export type AssetStatus = (typeof assetStatuses)[number];

export type AssetSale = {
  id: string;
  asset_id: string;
  user_id: string;
  sold_at: string;
  sale_price: number;
  created_at: string;
  updated_at: string;
};
```

Add `status: AssetStatus` to `Asset`.

Implement `asset-status.ts`:

```ts
import { assetStatuses, type AssetStatus } from '@/types/domain';

export { assetStatuses };
export const assetStatusLabels: Record<AssetStatus, string> = {
  in_use: '持有',
  idle: '闲置',
  listed: '出售中',
  sold: '已卖出',
};
export const isCurrentAsset = (asset: { status: AssetStatus }) =>
  asset.status !== 'sold';
```

Implement `sale-input.ts` by reusing `parsePurchaseInput`, translating its validation results into成交-specific copy and requiring both values.

- [ ] **Step 4: Run checks**

Run:

```bash
cd mobile && node --test tests/asset-status.test.mjs tests/sale-input.test.mjs
```

Expected: 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/types/domain.ts mobile/src/lib/asset-status.ts \
  mobile/src/lib/sale-input.ts mobile/tests/asset-status.test.mjs \
  mobile/tests/sale-input.test.mjs
git commit -m "feat: define asset lifecycle states"
```

### Task 3: Supabase lifecycle calls

**Files:**
- Modify: `mobile/src/lib/assets.ts`

**Interfaces:**
- Consumes: `AssetStatus`, `AssetSale`, `set_asset_status`, and `record_asset_sale`.
- Produces: `getAssetSale(id)`, `setAssetStatus(id, status)`, and `recordAssetSale(id, soldAt, salePrice)`.

- [ ] **Step 1: Add the smallest authenticated data functions**

```ts
export async function getAssetSale(assetId: string): Promise<AssetSale | null> {
  const { data, error } = await supabase
    .from('asset_sales')
    .select('*')
    .eq('asset_id', assetId)
    .maybeSingle();
  fail(error);
  return data as AssetSale | null;
}

export async function setAssetStatus(id: string, status: Exclude<AssetStatus, 'sold'>) {
  const { error } = await supabase.rpc('set_asset_status', {
    p_asset_id: id,
    p_status: status,
  });
  fail(error);
}

export async function recordAssetSale(
  id: string,
  soldAt: string,
  salePrice: number,
) {
  const { error } = await supabase.rpc('record_asset_sale', {
    p_asset_id: id,
    p_sold_at: soldAt,
    p_sale_price: salePrice,
  });
  fail(error);
}
```

- [ ] **Step 2: Type-check**

Run:

```bash
cd mobile && npx tsc --noEmit
```

Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add mobile/src/lib/assets.ts
git commit -m "feat: expose asset lifecycle mutations"
```

### Task 4: Status and sale screens

**Files:**
- Modify: `mobile/src/components/purchase-date-field.tsx`
- Modify: `mobile/src/components/purchase-date-field.web.tsx`
- Create: `mobile/src/app/asset/[id]/status.tsx`
- Create: `mobile/src/app/asset/[id]/sale.tsx`
- Modify: `mobile/src/app/_layout.tsx`

**Interfaces:**
- Consumes: `setAssetStatus`, `recordAssetSale`, `getAssetSale`, `parseSaleInput`, and the existing query keys.
- Produces: navigable status selection and required sale form.

- [ ] **Step 1: Make the existing date field label reusable**

Add optional `label` and `accessibilityLabel` props, defaulting both to the existing purchase-date copy. Use the props in the visible label and press/input accessibility labels.

- [ ] **Step 2: Add the status screen**

Render the four fixed statuses as 48-point accessible press targets. For `sold`, navigate to `/asset/[id]/sale`. For other statuses, call `setAssetStatus`; if the current status is `sold`, require `Alert.alert` confirmation before submitting. On success invalidate `['asset', id]`, `['asset-sale', id]`, and `['assets']`, then `router.back()`.

- [ ] **Step 3: Add the sale screen**

Load `getAssetSale(id)` and prefill existing sale values. Render:

```tsx
<PurchaseDateField
  label="成交日期"
  accessibilityLabel="选择成交日期"
  value={soldAt}
  onChange={setSoldAt}
/>
<TextInput
  accessibilityLabel="成交价"
  keyboardType="decimal-pad"
  value={salePrice}
  onChangeText={setSalePrice}
/>
```

Validate with `parseSaleInput`; call `recordAssetSale`; invalidate the three lifecycle query keys; then return to the asset detail with `router.dismissTo({ pathname: '/asset/[id]', params: { id } })`.

- [ ] **Step 4: Register both routes**

Add `asset/[id]/status` titled “物品状态” and `asset/[id]/sale` titled “成交记录” to the root stack.

- [ ] **Step 5: Run static checks**

Run:

```bash
cd mobile && npm run lint && npx tsc --noEmit
```

Expected: both exit with code 0.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/components/purchase-date-field.tsx \
  mobile/src/components/purchase-date-field.web.tsx \
  'mobile/src/app/asset/[id]/status.tsx' \
  'mobile/src/app/asset/[id]/sale.tsx' mobile/src/app/_layout.tsx
git commit -m "feat: add asset lifecycle controls"
```

### Task 5: Detail, card, and current-asset summary

**Files:**
- Modify: `mobile/src/app/asset/[id].tsx`
- Modify: `mobile/src/app/(tabs)/(assets)/index.tsx`
- Modify: `mobile/src/components/asset-card.tsx`

**Interfaces:**
- Consumes: `assetStatusLabels`, `isCurrentAsset`, and `getAssetSale`.
- Produces: visible status, sale details, sold-card chip, sold filtering, and disabled sold valuation.

- [ ] **Step 1: Add lifecycle UI to detail**

Query `getAssetSale` when `asset.status === 'sold'`. Add a linked “物品状态” row showing the current label. For sold assets, show成交日期 and成交价 in the basic-information card. Hide the entire “刷新价格” button for sold assets while preserving the last reference price and history as read-only evidence.

- [ ] **Step 2: Filter current summary values**

In the asset list:

```ts
const currentAssets = assets.filter(isCurrentAsset);
const total = currentAssets.reduce(
  (sum, asset) => sum + (asset.latest_market_price ?? 0),
  0,
);
const pending = currentAssets.filter(
  (asset) => asset.latest_market_price === null,
).length;
```

Build category counts from `currentAssets`. Keep all assets in the grid and change the summary copy to show current count plus sold count.

- [ ] **Step 3: Add the sold status chip**

Overlay a gray `已卖出` chip in the image’s top-right when `asset.status === 'sold'`. Use `surfaceMuted` and `textSecondary`; keep the full card as one press target.

- [ ] **Step 4: Run all mobile checks**

Run:

```bash
cd mobile && node --test tests/*.test.mjs && npm run lint && npx tsc --noEmit
```

Expected: all tests pass; lint and type-check exit with code 0.

- [ ] **Step 5: Review the final diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only lifecycle files plus the user’s pre-existing server changes are present.

- [ ] **Step 6: Commit**

```bash
git add 'mobile/src/app/asset/[id].tsx' \
  'mobile/src/app/(tabs)/(assets)/index.tsx' \
  mobile/src/components/asset-card.tsx
git commit -m "feat: reflect sold assets in portfolio"
```
