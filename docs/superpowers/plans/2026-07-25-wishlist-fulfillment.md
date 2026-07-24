# Wishlist Fulfillment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user fulfill a wishlist item with an actual purchase price, allocate reusable balances from confirmed spending resolutions and asset sales, show the resulting funding history, and atomically undo the fulfillment.

**Architecture:** A Supabase migration owns the money boundary: it stores immutable allocation rows and exposes security-definer functions for fulfill and undo. The Expo client computes a preview in integer cents, but the database revalidates ownership and balances under row locks. React Query continues to fetch the existing source records and adds one allocation query; no server API or new dependency is introduced.

**Tech Stack:** PostgreSQL/Supabase migrations and RLS, Expo SDK 57, Expo Router, React Native, TanStack Query, TypeScript, Node's built-in test runner.

## Global Constraints

- Keep `wishlist_items.target_price` as the unfinished-state expected amount.
- Require a positive `actual_price` when fulfilling.
- Allow one source record to fund multiple wishlist items without exceeding its original amount.
- Allow zero selected sources and derive the remaining amount as self-paid.
- Allocate selected sources in selection order; only the last needed source may be partial.
- Never silently increase self-pay after a concurrent balance change; reject and ask the user to confirm again.
- Fulfill and undo must each be one atomic database operation.
- A fulfilled wishlist item must be undone before it can be deleted or changed.
- Do not add dependencies, a FastAPI endpoint, automatic source selection, partial fulfillment, notifications, animations, or editable completed ledgers.
- Before editing Expo code, read the exact SDK 57 documentation at `https://docs.expo.dev/versions/v57.0.0/`; do not rely on older Expo Router behavior.

---

## File Map

- Create `supabase/migrations/202607250002_wishlist_fulfillment.sql`: schema, RLS, shared sale guard, fulfill RPC, and undo RPC.
- Create `mobile/src/lib/wishlist-allocations.ts`: pure cent-based balance, preview, and summary calculations.
- Create `mobile/tests/wishlist-allocations.test.mjs`: the single runnable logic check for allocation behavior.
- Create `mobile/src/lib/wishlist-fulfillment.ts`: allocation query and RPC wrappers.
- Modify `mobile/src/lib/wishlist.ts`: expose fulfillment columns on `WishlistItem` and normalize numeric values.
- Create `mobile/src/app/(tabs)/(wishlist)/fulfill/[id].tsx`: actual-price form, ordered source selection, preview, and confirmation.
- Modify `mobile/src/components/wishlist-card.tsx`: add the fulfillment entry point.
- Create `mobile/src/components/fulfilled-wishlist-card.tsx`: completed funding breakdown, expansion, and undo action.
- Modify `mobile/src/app/(tabs)/(wishlist)/index.tsx`: use available rather than lifetime funds, separate active/completed items, and refresh allocations.

---

### Task 1: Pure Allocation Math

**Files:**
- Create: `mobile/src/lib/wishlist-allocations.ts`
- Create: `mobile/tests/wishlist-allocations.test.mjs`

**Interfaces:**
- Consumes: persisted `WishlistFundingAllocation`-shaped objects with nullable source IDs.
- Produces:
  - `FundingSourceType = 'spending_resolution' | 'asset_sale'`
  - `FundingAllocationInput`
  - `SelectableFundingSource`
  - `getAllocatedAmount(allocations, sourceType, sourceId): number`
  - `getAvailableAmount(originalAmount, allocatedAmount): number`
  - `buildAllocationPreview(actualPrice, selectedSources): AllocationPreview`
  - `parseFulfillmentPrice(value): { price: number } | { error: string }`

- [ ] **Step 1: Write the failing allocation test**

Create `mobile/tests/wishlist-allocations.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAllocationPreview,
  getAllocatedAmount,
  getAvailableAmount,
  parseFulfillmentPrice,
} from '../src/lib/wishlist-allocations.ts';

const allocations = [
  {
    spending_resolution_id: 'skip-1',
    asset_sale_id: null,
    amount: 300,
  },
  {
    spending_resolution_id: null,
    asset_sale_id: 'sale-1',
    amount: 1200,
  },
  {
    spending_resolution_id: 'skip-1',
    asset_sale_id: null,
    amount: 200,
  },
];

test('derives remaining source balances from prior allocations', () => {
  assert.equal(
    getAllocatedAmount(allocations, 'spending_resolution', 'skip-1'),
    500,
  );
  assert.equal(
    getAllocatedAmount(allocations, 'asset_sale', 'sale-1'),
    1200,
  );
  assert.equal(getAvailableAmount(800, 500), 300);
  assert.equal(getAvailableAmount(800, 900), 0);
});

test('allocates in selection order and partially uses only the last source', () => {
  assert.deepEqual(
    buildAllocationPreview(6000, [
      {
        source_type: 'spending_resolution',
        source_id: 'skip-1',
        available_amount: 800,
      },
      {
        source_type: 'asset_sale',
        source_id: 'sale-1',
        available_amount: 5000,
      },
      {
        source_type: 'asset_sale',
        source_id: 'sale-2',
        available_amount: 1000,
      },
    ]),
    {
      allocations: [
        {
          source_type: 'spending_resolution',
          source_id: 'skip-1',
          amount: 800,
        },
        {
          source_type: 'asset_sale',
          source_id: 'sale-1',
          amount: 5000,
        },
        {
          source_type: 'asset_sale',
          source_id: 'sale-2',
          amount: 200,
        },
      ],
      funded_amount: 6000,
      self_paid_amount: 0,
    },
  );
});

test('supports insufficient and empty funding without floating-point drift', () => {
  assert.deepEqual(
    buildAllocationPreview(0.3, [
      {
        source_type: 'spending_resolution',
        source_id: 'skip-1',
        available_amount: 0.1,
      },
      {
        source_type: 'asset_sale',
        source_id: 'sale-1',
        available_amount: 0.2,
      },
    ]),
    {
      allocations: [
        {
          source_type: 'spending_resolution',
          source_id: 'skip-1',
          amount: 0.1,
        },
        {
          source_type: 'asset_sale',
          source_id: 'sale-1',
          amount: 0.2,
        },
      ],
      funded_amount: 0.3,
      self_paid_amount: 0,
    },
  );
  assert.deepEqual(buildAllocationPreview(1000, []), {
    allocations: [],
    funded_amount: 0,
    self_paid_amount: 1000,
  });
});

test('validates the actual fulfillment price', () => {
  assert.deepEqual(parseFulfillmentPrice(''), {
    error: '请填写实际成交价',
  });
  assert.deepEqual(parseFulfillmentPrice('0'), {
    error: '实际成交价必须大于 0',
  });
  assert.deepEqual(parseFulfillmentPrice(' 3999.50 '), {
    price: 3999.5,
  });
});
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run:

```bash
cd mobile
node --experimental-strip-types --test tests/wishlist-allocations.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `wishlist-allocations.ts`.

- [ ] **Step 3: Implement cent-based allocation math**

Create `mobile/src/lib/wishlist-allocations.ts`:

```ts
export type FundingSourceType = 'spending_resolution' | 'asset_sale';

export type FundingAllocationInput = {
  source_type: FundingSourceType;
  source_id: string;
  amount: number;
};

export type SelectableFundingSource = Omit<
  FundingAllocationInput,
  'amount'
> & {
  available_amount: number;
};

export type FundingAllocationRecord = {
  spending_resolution_id: string | null;
  asset_sale_id: string | null;
  amount: number;
};

export type AllocationPreview = {
  allocations: FundingAllocationInput[];
  funded_amount: number;
  self_paid_amount: number;
};

const toCents = (amount: number) => Math.round(amount * 100);
const fromCents = (amount: number) => amount / 100;

export function getAllocatedAmount(
  allocations: FundingAllocationRecord[],
  sourceType: FundingSourceType,
  sourceId: string,
) {
  const sourceField =
    sourceType === 'spending_resolution'
      ? 'spending_resolution_id'
      : 'asset_sale_id';
  return fromCents(
    allocations.reduce(
      (total, allocation) =>
        allocation[sourceField] === sourceId
          ? total + toCents(allocation.amount)
          : total,
      0,
    ),
  );
}

export function getAvailableAmount(
  originalAmount: number,
  allocatedAmount: number,
) {
  return fromCents(
    Math.max(toCents(originalAmount) - toCents(allocatedAmount), 0),
  );
}

export function buildAllocationPreview(
  actualPrice: number,
  selectedSources: SelectableFundingSource[],
): AllocationPreview {
  let remaining = Math.max(toCents(actualPrice), 0);
  const allocations: FundingAllocationInput[] = [];

  for (const source of selectedSources) {
    if (!remaining) break;
    const used = Math.min(
      Math.max(toCents(source.available_amount), 0),
      remaining,
    );
    if (!used) continue;
    allocations.push({
      source_type: source.source_type,
      source_id: source.source_id,
      amount: fromCents(used),
    });
    remaining -= used;
  }

  const actual = Math.max(toCents(actualPrice), 0);
  return {
    allocations,
    funded_amount: fromCents(actual - remaining),
    self_paid_amount: fromCents(remaining),
  };
}

export function parseFulfillmentPrice(
  value: string,
): { price: number } | { error: string } {
  if (!value.trim()) return { error: '请填写实际成交价' };
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) {
    return { error: '实际成交价必须大于 0' };
  }
  return { price: fromCents(toCents(price)) };
}
```

- [ ] **Step 4: Run the focused and existing wishlist tests**

Run:

```bash
cd mobile
node --experimental-strip-types --test \
  tests/wishlist-allocations.test.mjs \
  tests/wishlist-progress.test.mjs \
  tests/wishlist-input.test.mjs
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit the pure calculation boundary**

```bash
git add mobile/src/lib/wishlist-allocations.ts mobile/tests/wishlist-allocations.test.mjs
git commit -m "feat: calculate wishlist funding allocations"
```

---

### Task 2: Atomic Database Ledger

**Files:**
- Create: `supabase/migrations/202607250002_wishlist_fulfillment.sql`

**Interfaces:**
- Consumes: `wishlist_items`, confirmed `spending_resolutions`, and `asset_sales`.
- Produces:
  - `wishlist_items.actual_price numeric(12,2)`
  - `wishlist_items.fulfilled_at timestamptz`
  - `wishlist_funding_allocations`
  - `fulfill_wishlist_item(uuid, numeric, jsonb): void`
  - `unfulfill_wishlist_item(uuid): void`

- [ ] **Step 1: Add the schema, permissions, and shared mutation guard**

Create `supabase/migrations/202607250002_wishlist_fulfillment.sql` with:

```sql
alter table public.wishlist_items
  add column actual_price numeric(12, 2)
    check (actual_price is null or actual_price > 0),
  add column fulfilled_at timestamptz,
  add constraint wishlist_items_fulfillment_state_check
    check ((actual_price is null) = (fulfilled_at is null));

create table public.wishlist_funding_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wishlist_item_id uuid not null references public.wishlist_items(id),
  spending_resolution_id uuid references public.spending_resolutions(id),
  asset_sale_id uuid references public.asset_sales(id),
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  check (
    (spending_resolution_id is not null)::integer
    + (asset_sale_id is not null)::integer = 1
  )
);

create unique index wishlist_allocations_resolution_once_idx
  on public.wishlist_funding_allocations (
    wishlist_item_id,
    spending_resolution_id
  )
  where spending_resolution_id is not null;

create unique index wishlist_allocations_sale_once_idx
  on public.wishlist_funding_allocations (
    wishlist_item_id,
    asset_sale_id
  )
  where asset_sale_id is not null;

create index wishlist_allocations_user_wishlist_idx
  on public.wishlist_funding_allocations (user_id, wishlist_item_id);
create index wishlist_allocations_resolution_idx
  on public.wishlist_funding_allocations (spending_resolution_id)
  where spending_resolution_id is not null;
create index wishlist_allocations_sale_idx
  on public.wishlist_funding_allocations (asset_sale_id)
  where asset_sale_id is not null;

alter table public.wishlist_funding_allocations enable row level security;

create policy wishlist_allocations_owner_select
  on public.wishlist_funding_allocations
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.wishlist_funding_allocations
  from anon, authenticated;
grant select on table public.wishlist_funding_allocations to authenticated;

drop policy wishlist_items_owner on public.wishlist_items;

create policy wishlist_items_owner_select
  on public.wishlist_items
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy wishlist_items_owner_insert
  on public.wishlist_items
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy wishlist_items_owner_delete_unfulfilled
  on public.wishlist_items
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and fulfilled_at is null
  );

revoke update on table public.wishlist_items from authenticated;

create function public.prevent_allocated_asset_sale_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.wishlist_funding_allocations
    where asset_sale_id = old.id
  ) then
    raise exception 'sale is allocated';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger asset_sales_prevent_allocated_change
before update or delete on public.asset_sales
for each row execute function public.prevent_allocated_asset_sale_change();
```

- [ ] **Step 2: Add the fulfill function**

Append to the same migration:

```sql
create function public.fulfill_wishlist_item(
  p_wishlist_item_id uuid,
  p_actual_price numeric,
  p_allocations jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wishlist public.wishlist_items%rowtype;
  v_allocation record;
  v_source_amount numeric;
  v_used_amount numeric;
  v_funded_amount numeric;
begin
  if p_actual_price is null
    or p_actual_price <= 0
    or scale(p_actual_price) > 2 then
    raise exception 'invalid actual price';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'invalid allocations';
  end if;

  select *
  into v_wishlist
  from public.wishlist_items
  where id = p_wishlist_item_id
    and user_id = (select auth.uid())
  for update;

  if not found then
    raise exception 'wishlist item not found';
  end if;
  if v_wishlist.fulfilled_at is not null then
    raise exception 'wishlist item already fulfilled';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_allocations)
      as item(source_type text, source_id uuid, amount numeric)
    where source_type not in ('spending_resolution', 'asset_sale')
      or source_id is null
      or amount is null
      or amount <= 0
      or scale(amount) > 2
  ) then
    raise exception 'invalid allocation';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_allocations)
      as item(source_type text, source_id uuid, amount numeric)
    group by source_type, source_id
    having count(*) > 1
  ) then
    raise exception 'duplicate funding source';
  end if;

  select coalesce(sum(amount), 0)
  into v_funded_amount
  from jsonb_to_recordset(p_allocations)
    as item(source_type text, source_id uuid, amount numeric);

  if v_funded_amount > p_actual_price then
    raise exception 'allocations exceed actual price';
  end if;

  perform source.id
  from public.spending_resolutions as source
  where source.id in (
    select source_id
    from jsonb_to_recordset(p_allocations)
      as item(source_type text, source_id uuid, amount numeric)
    where source_type = 'spending_resolution'
  )
  order by source.id
  for update;

  perform source.id
  from public.asset_sales as source
  where source.id in (
    select source_id
    from jsonb_to_recordset(p_allocations)
      as item(source_type text, source_id uuid, amount numeric)
    where source_type = 'asset_sale'
  )
  order by source.id
  for update;

  for v_allocation in
    select source_type, source_id, amount
    from jsonb_to_recordset(p_allocations)
      as item(source_type text, source_id uuid, amount numeric)
  loop
    if v_allocation.source_type = 'spending_resolution' then
      select source.amount, coalesce(sum(existing.amount), 0)
      into v_source_amount, v_used_amount
      from public.spending_resolutions as source
      left join public.wishlist_funding_allocations as existing
        on existing.spending_resolution_id = source.id
      where source.id = v_allocation.source_id
        and source.user_id = (select auth.uid())
        and source.confirmed_at is not null
      group by source.id, source.amount;

      if not found then
        raise exception 'funding source not found';
      end if;

      if v_allocation.amount > v_source_amount - v_used_amount then
        raise exception 'funding balance changed';
      end if;

      insert into public.wishlist_funding_allocations (
        user_id,
        wishlist_item_id,
        spending_resolution_id,
        amount
      )
      values (
        (select auth.uid()),
        p_wishlist_item_id,
        v_allocation.source_id,
        v_allocation.amount
      );
    else
      select source.sale_price, coalesce(sum(existing.amount), 0)
      into v_source_amount, v_used_amount
      from public.asset_sales as source
      left join public.wishlist_funding_allocations as existing
        on existing.asset_sale_id = source.id
      where source.id = v_allocation.source_id
        and source.user_id = (select auth.uid())
      group by source.id, source.sale_price;

      if not found then
        raise exception 'funding source not found';
      end if;

      if v_allocation.amount > v_source_amount - v_used_amount then
        raise exception 'funding balance changed';
      end if;

      insert into public.wishlist_funding_allocations (
        user_id,
        wishlist_item_id,
        asset_sale_id,
        amount
      )
      values (
        (select auth.uid()),
        p_wishlist_item_id,
        v_allocation.source_id,
        v_allocation.amount
      );
    end if;
  end loop;

  update public.wishlist_items
  set actual_price = p_actual_price,
      fulfilled_at = now()
  where id = p_wishlist_item_id;
end;
$$;
```

- [ ] **Step 3: Add undo and function permissions**

Append:

```sql
create function public.unfulfill_wishlist_item(
  p_wishlist_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wishlist public.wishlist_items%rowtype;
begin
  select *
  into v_wishlist
  from public.wishlist_items
  where id = p_wishlist_item_id
    and user_id = (select auth.uid())
  for update;

  if not found then
    raise exception 'wishlist item not found';
  end if;
  if v_wishlist.fulfilled_at is null then
    raise exception 'wishlist item is not fulfilled';
  end if;

  delete from public.wishlist_funding_allocations
  where wishlist_item_id = p_wishlist_item_id
    and user_id = (select auth.uid());

  update public.wishlist_items
  set actual_price = null,
      fulfilled_at = null
  where id = p_wishlist_item_id;
end;
$$;

revoke all on function public.prevent_allocated_asset_sale_change()
  from public;
revoke all on function public.fulfill_wishlist_item(uuid, numeric, jsonb)
  from public;
revoke all on function public.unfulfill_wishlist_item(uuid)
  from public;

grant execute on function public.fulfill_wishlist_item(uuid, numeric, jsonb)
  to authenticated;
grant execute on function public.unfulfill_wishlist_item(uuid)
  to authenticated;
```

- [ ] **Step 4: Verify and apply the migration**

Run without printing the database URL:

```bash
source .env.local
npx supabase db push \
  --db-url "$POSTGRES_URL_NON_POOLING" \
  --include-all \
  --dry-run
npx supabase db push \
  --db-url "$POSTGRES_URL_NON_POOLING" \
  --include-all
npx supabase db lint \
  --db-url "$POSTGRES_URL_NON_POOLING"
```

Expected: the dry run lists `202607250002_wishlist_fulfillment.sql`; push applies it once; lint reports no new RLS or security-definer warning.

- [ ] **Step 5: Verify the database boundary through the authenticated app session**

Use two disposable wishlist items and the same source record:

1. Fulfill the first wish with part of the source.
2. Fulfill the second wish with the remaining part.
3. Attempt to reuse more than the remaining balance and expect `funding balance changed`.
4. Attempt to edit or revert an allocated asset sale and expect `sale is allocated`.
5. Undo the first wish and verify that its allocation rows disappear and the source balance returns.
6. Fulfill a wish with no sources and verify direct deletion is rejected until undo.
7. From a second authenticated user, attempt to fulfill, undo, or allocate the first user's records and expect `not found` or an empty RLS result.

Expected: no source's allocation sum exceeds its original amount; failed operations leave both wishlist and allocation rows unchanged.

- [ ] **Step 6: Commit the database ledger**

```bash
git add supabase/migrations/202607250002_wishlist_fulfillment.sql
git commit -m "feat: add wishlist funding ledger"
```

---

### Task 3: Client Data Boundary

**Files:**
- Create: `mobile/src/lib/wishlist-fulfillment.ts`
- Modify: `mobile/src/lib/wishlist.ts`

**Interfaces:**
- Consumes: Task 1's `FundingAllocationInput` and Task 2's table/RPC names.
- Produces:
  - `WishlistFundingAllocation`
  - `listWishlistFundingAllocations(): Promise<WishlistFundingAllocation[]>`
  - `fulfillWishlistItem(wishlistItemId, actualPrice, allocations): Promise<void>`
  - `unfulfillWishlistItem(wishlistItemId): Promise<void>`
  - `WishlistItem.actual_price: number | null`
  - `WishlistItem.fulfilled_at: string | null`

- [ ] **Step 1: Add the Supabase allocation API**

Create `mobile/src/lib/wishlist-fulfillment.ts`:

```ts
import type { FundingAllocationInput } from '@/lib/wishlist-allocations';
import { supabase } from '@/lib/supabase';

export type WishlistFundingAllocation = {
  id: string;
  user_id: string;
  wishlist_item_id: string;
  spending_resolution_id: string | null;
  asset_sale_id: string | null;
  amount: number;
  created_at: string;
};

function fail(error: { message: string } | null) {
  if (!error) return;
  if (error.message.includes('funding balance changed')) {
    throw new Error('资金余额已变化，请重新确认');
  }
  if (error.message.includes('sale is allocated')) {
    throw new Error('这笔成交款已用于心愿，请先撤销对应心愿');
  }
  throw new Error(error.message);
}

export async function listWishlistFundingAllocations(): Promise<
  WishlistFundingAllocation[]
> {
  const { data, error } = await supabase
    .from('wishlist_funding_allocations')
    .select('*')
    .order('created_at', { ascending: false });
  fail(error);
  return ((data ?? []) as WishlistFundingAllocation[]).map((allocation) => ({
    ...allocation,
    amount: Number(allocation.amount),
  }));
}

export async function fulfillWishlistItem(
  wishlistItemId: string,
  actualPrice: number,
  allocations: FundingAllocationInput[],
) {
  const { error } = await supabase.rpc('fulfill_wishlist_item', {
    p_wishlist_item_id: wishlistItemId,
    p_actual_price: actualPrice,
    p_allocations: allocations,
  });
  fail(error);
}

export async function unfulfillWishlistItem(wishlistItemId: string) {
  const { error } = await supabase.rpc('unfulfill_wishlist_item', {
    p_wishlist_item_id: wishlistItemId,
  });
  fail(error);
}
```

- [ ] **Step 2: Extend and normalize `WishlistItem`**

Change `mobile/src/lib/wishlist.ts`:

```ts
export type WishlistItem = WishlistInput & {
  id: string;
  user_id: string;
  actual_price: number | null;
  fulfilled_at: string | null;
  created_at: string;
};

const normalizeWishlistItem = (item: WishlistItem): WishlistItem => ({
  ...item,
  target_price: Number(item.target_price),
  actual_price:
    item.actual_price === null ? null : Number(item.actual_price),
});
```

Then apply `normalizeWishlistItem` to all three read/write results:

```ts
return ((data ?? []) as WishlistItem[]).map(normalizeWishlistItem);
```

```ts
return normalizeWishlistItem(data as WishlistItem);
```

Use the second form in both `getWishlistItem` and `createWishlistItem`.

- [ ] **Step 3: Run static checks**

Run:

```bash
cd mobile
npx tsc --noEmit
npm run lint
```

Expected: both exit 0 with no new errors.

- [ ] **Step 4: Commit the client data boundary**

```bash
git add mobile/src/lib/wishlist-fulfillment.ts mobile/src/lib/wishlist.ts
git commit -m "feat: expose wishlist fulfillment data"
```

---

### Task 4: Fulfillment Confirmation Screen

**Files:**
- Create: `mobile/src/app/(tabs)/(wishlist)/fulfill/[id].tsx`

**Interfaces:**
- Consumes:
  - `getWishlistItem(id)`
  - `listConfirmedSpendingResolutions()`
  - `listAssetSales()`
  - `listWishlistFundingAllocations()`
  - `getAllocatedAmount`, `getAvailableAmount`, `buildAllocationPreview`, `parseFulfillmentPrice`
  - `fulfillWishlistItem(id, actualPrice, allocations)`
- Produces: route `/(tabs)/(wishlist)/fulfill/[id]`.

- [ ] **Step 1: Build source rows from existing records and allocation balances**

In the new screen, define this local view type and source builder above the component:

```ts
type FundingSourceRow = SelectableFundingSource & {
  name: string;
  original_amount: number;
  allocated_amount: number;
};

function buildSources(
  resolutions: ConfirmedSpendingResolution[],
  sales: AssetSaleWithName[],
  allocations: WishlistFundingAllocation[],
): FundingSourceRow[] {
  const spending = resolutions.map((resolution) => {
    const allocated = getAllocatedAmount(
      allocations,
      'spending_resolution',
      resolution.id,
    );
    return {
      source_type: 'spending_resolution' as const,
      source_id: resolution.id,
      name: resolution.product_snapshot.title,
      original_amount: resolution.amount,
      allocated_amount: allocated,
      available_amount: getAvailableAmount(resolution.amount, allocated),
    };
  });
  const saleSources = sales.map((sale) => {
    const allocated = getAllocatedAmount(
      allocations,
      'asset_sale',
      sale.id,
    );
    return {
      source_type: 'asset_sale' as const,
      source_id: sale.id,
      name: sale.asset.name,
      original_amount: sale.sale_price,
      allocated_amount: allocated,
      available_amount: getAvailableAmount(sale.sale_price, allocated),
    };
  });
  return [...spending, ...saleSources].filter(
    (source) => source.available_amount > 0,
  );
}
```

- [ ] **Step 2: Implement ordered selection, validation, and submit state**

The screen component must use these exact query keys and state transitions:

```ts
const { id } = useLocalSearchParams<{ id: string }>();
const queryClient = useQueryClient();
const wishlistQuery = useQuery({
  queryKey: ['wishlist', id],
  queryFn: () => getWishlistItem(id),
  enabled: Boolean(id),
});
const resolutionsQuery = useQuery({
  queryKey: ['spending-resolutions', 'confirmed'],
  queryFn: listConfirmedSpendingResolutions,
});
const salesQuery = useQuery({
  queryKey: ['asset-sales'],
  queryFn: listAssetSales,
});
const allocationsQuery = useQuery({
  queryKey: ['wishlist-funding-allocations'],
  queryFn: listWishlistFundingAllocations,
});
const [actualPrice, setActualPrice] = useState('');
const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
const [error, setError] = useState('');

useEffect(() => {
  if (wishlistQuery.data) {
    setActualPrice((current) =>
      current || String(wishlistQuery.data.target_price)
    );
  }
}, [wishlistQuery.data]);

const sources = buildSources(
  resolutionsQuery.data ?? [],
  salesQuery.data ?? [],
  allocationsQuery.data ?? [],
);
const sourceKey = (source: SelectableFundingSource) =>
  `${source.source_type}:${source.source_id}`;
const selectedSources = selectedKeys.flatMap((key) => {
  const source = sources.find((candidate) => sourceKey(candidate) === key);
  return source ? [source] : [];
});
const parsedPrice = parseFulfillmentPrice(actualPrice);
const preview = buildAllocationPreview(
  'price' in parsedPrice ? parsedPrice.price : 0,
  selectedSources,
);

const toggleSource = (source: FundingSourceRow) => {
  const key = sourceKey(source);
  setSelectedKeys((current) =>
    current.includes(key)
      ? current.filter((candidate) => candidate !== key)
      : [...current, key],
  );
};

const save = async () => {
  const parsed = parseFulfillmentPrice(actualPrice);
  if ('error' in parsed) {
    setError(parsed.error);
    return;
  }
  setError('');
  try {
    await fulfillWishlistItem(id, parsed.price, preview.allocations);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['wishlist'] }),
      queryClient.invalidateQueries({
        queryKey: ['wishlist-funding-allocations'],
      }),
    ]);
    router.back();
  } catch (caught) {
    setError(caught instanceof Error ? caught.message : '实现心愿失败');
    if (
      caught instanceof Error
      && caught.message === '资金余额已变化，请重新确认'
    ) {
      await allocationsQuery.refetch();
      setSelectedKeys([]);
    }
  }
};
```

Use `useMutation` instead of a separate loading boolean:

```ts
const fulfillMutation = useMutation({ mutationFn: save });
```

The submit button calls `fulfillMutation.mutate()` and is disabled while pending. Do not clear `actualPrice` on balance conflict.

- [ ] **Step 3: Render the native confirmation UI**

Use the existing `ScrollView`, `TextInput`, `Pressable`, `ActivityIndicator`, `LoadingState`, `ErrorState`, `colors`, `radius`, `spacing`, `typography`, and `formatCurrency` patterns. Render in this order:

1. `Stack.Screen` title `实现心愿`.
2. Actual-price decimal input labelled `实际成交价`.
3. `忍住消费` section and then `已卖闲置`.
4. Each source row as a checkbox-like `Pressable` with:
   - accessible checked state;
   - source name;
   - `原金额` and `已使用`;
   - `可用` amount;
   - when selected, the current preview allocation amount.
5. Empty copy `没有可用记录` per empty group.
6. Summary card with `实际成交价`, `资金抵扣`, and `自付金额`.
7. Inline error.
8. Submit button text `确认实现`.

The selected indicator can be a 22px native `View` with a text checkmark. Do not add a checkbox package. The source order is the order in `selectedKeys`, not the display order.

- [ ] **Step 4: Run focused checks**

Run:

```bash
cd mobile
node --experimental-strip-types --test tests/wishlist-allocations.test.mjs
npx tsc --noEmit
npm run lint
```

Expected: tests pass; TypeScript and lint exit 0.

- [ ] **Step 5: Commit the confirmation screen**

```bash
git add mobile/src/app/'(tabs)'/'(wishlist)'/fulfill/'[id].tsx'
git commit -m "feat: add wishlist fulfillment screen"
```

---

### Task 5: Active and Fulfilled Wishlist Surfaces

**Files:**
- Modify: `mobile/src/components/wishlist-card.tsx`
- Create: `mobile/src/components/fulfilled-wishlist-card.tsx`
- Modify: `mobile/src/app/(tabs)/(wishlist)/index.tsx`

**Interfaces:**
- Consumes:
  - `WishlistItem.actual_price` and `fulfilled_at`
  - all source lists and `WishlistFundingAllocation[]`
  - `unfulfillWishlistItem(id)`
  - Task 1 balance helpers
- Produces:
  - unfinished carousel funded by current available balance;
  - completed list with source breakdown and undo.

- [ ] **Step 1: Add the fulfillment entry point to `WishlistCard`**

After the existing `查看今日卖出方案` action, add:

```tsx
<Pressable
  accessibilityRole="button"
  accessibilityLabel={`实现${item.name}`}
  onPress={() =>
    router.push({
      pathname: '/(tabs)/(wishlist)/fulfill/[id]',
      params: { id: item.id },
    })
  }
  style={({ pressed }) => ({
    alignSelf: 'flex-start',
    paddingVertical: 5,
    opacity: pressed ? 0.6 : 1,
  })}>
  <Text style={{ color: colors.accent, fontWeight: '700' }}>
    实现心愿
  </Text>
</Pressable>
```

Keep the existing sell-plan action. Do not add a menu item or another modal.

- [ ] **Step 2: Create the fulfilled card**

Create `mobile/src/components/fulfilled-wishlist-card.tsx` with props:

```ts
type FulfilledWishlistCardProps = {
  item: WishlistItem & {
    actual_price: number;
    fulfilled_at: string;
  };
  allocations: WishlistFundingAllocation[];
  resolutions: ConfirmedSpendingResolution[];
  sales: AssetSaleWithName[];
  undoing: boolean;
  onUndo: (id: string, name: string) => void;
};
```

Derive the rows and totals inside the component:

```ts
const itemAllocations = allocations.filter(
  (allocation) => allocation.wishlist_item_id === item.id,
);
const resolutionNames = new Map(
  resolutions.map((resolution) => [
    resolution.id,
    resolution.product_snapshot.title,
  ]),
);
const saleNames = new Map(sales.map((sale) => [sale.id, sale.asset.name]));
const spendingTotal = sumAmounts(
  itemAllocations
    .filter((allocation) => allocation.spending_resolution_id)
    .map((allocation) => allocation.amount),
);
const salesTotal = sumAmounts(
  itemAllocations
    .filter((allocation) => allocation.asset_sale_id)
    .map((allocation) => allocation.amount),
);
const selfPaid = Math.max(
  item.actual_price - spendingTotal - salesTotal,
  0,
);
```

Render the name, `formatCurrency(item.actual_price)`, `formatDate(item.fulfilled_at)`, the three totals, and a native expand/collapse action labelled `查看资金明细` / `收起资金明细`. Expanded rows use the source name maps and allocation amount. Render `全部自付` when there are no allocation rows.

The `撤销实现` button must call:

```ts
Alert.alert(
  '撤销实现？',
  `“${item.name}”会回到未实现，已使用资金将恢复。`,
  [
    { text: '取消', style: 'cancel' },
    {
      text: '撤销实现',
      style: 'destructive',
      onPress: () => onUndo(item.id, item.name),
    },
  ],
);
```

Use only existing color, radius, spacing, and typography tokens.

- [ ] **Step 3: Query allocations and calculate available funds on the wishlist page**

In `mobile/src/app/(tabs)/(wishlist)/index.tsx`, add:

```ts
const allocationsQuery = useQuery({
  queryKey: ['wishlist-funding-allocations'],
  queryFn: listWishlistFundingAllocations,
});
const allocations = allocationsQuery.data ?? [];
const spendingTotal = sumAmounts(
  resolutions.map((resolution) =>
    getAvailableAmount(
      resolution.amount,
      getAllocatedAmount(
        allocations,
        'spending_resolution',
        resolution.id,
      ),
    ),
  ),
);
const salesTotal = sumAmounts(
  sales.map((sale) =>
    getAvailableAmount(
      sale.sale_price,
      getAllocatedAmount(allocations, 'asset_sale', sale.id),
    ),
  ),
);
const fundedAmount = spendingTotal + salesTotal;
```

Replace `items` with:

```ts
const items = query.data ?? [];
const activeItems = items.filter((item) => !item.fulfilled_at);
const fulfilledItems = items.flatMap((item) =>
  item.actual_price !== null && item.fulfilled_at
    ? [
        item as WishlistItem & {
          actual_price: number;
          fulfilled_at: string;
        },
      ]
    : [],
);
```

Use `activeItems` for carousel data, index bounds, dots, and empty active state. Keep the page-level empty state based on `items.length === 0`.

Add `allocationsQuery` to loading, error, and focus refresh:

```ts
const fundingLoading =
  resolutionsQuery.isLoading
  || salesQuery.isLoading
  || allocationsQuery.isLoading;
const fundingError =
  resolutionsQuery.error
  ?? salesQuery.error
  ?? allocationsQuery.error;
```

```ts
void Promise.all([
  refetchResolutions(),
  refetchSales(),
  allocationsQuery.refetch(),
]);
```

- [ ] **Step 4: Make the existing funding details show available balances**

Extend `WishlistFundingDetails` to accept `allocations`. Change each tab total from lifetime amounts to current available amounts using `getAllocatedAmount` and `getAvailableAmount`. Change the total label from `累计金额` to `可用金额`.

For a partially used record, render:

```tsx
<Text style={{ color: colors.textSecondary, ...typography.caption }}>
  原 {formatCurrency(originalAmount)} · 已使用 {formatCurrency(usedAmount)}
</Text>
```

Render the right-hand amount as the available amount. Keep zero-balance records visible in this historical detail module, but show `可用 ¥0`; only the fulfillment screen filters them out.

- [ ] **Step 5: Add undo and the completed section**

Add state and handler:

```ts
const [undoingId, setUndoingId] = useState<string | null>(null);
const [undoError, setUndoError] = useState('');

const undoFulfillment = async (id: string) => {
  setUndoingId(id);
  setUndoError('');
  try {
    await unfulfillWishlistItem(id);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['wishlist'] }),
      queryClient.invalidateQueries({
        queryKey: ['wishlist-funding-allocations'],
      }),
    ]);
  } catch (caught) {
    setUndoError(caught instanceof Error ? caught.message : '撤销失败');
  } finally {
    setUndoingId(null);
  }
};
```

Render `undoError` with the existing `ErrorState`. Below the active carousel and `WishlistFundingDetails`, render:

```tsx
{fulfilledItems.length ? (
  <View
    style={{
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xxxl,
      gap: spacing.md,
    }}>
    <Text
      selectable
      style={{ color: colors.textPrimary, ...typography.sectionTitle }}>
      已实现
    </Text>
    {fulfilledItems.map((item) => (
      <FulfilledWishlistCard
        key={item.id}
        item={item}
        allocations={allocations}
        resolutions={resolutions}
        sales={sales}
        undoing={undoingId === item.id}
        onUndo={(id) => void undoFulfillment(id)}
      />
    ))}
  </View>
) : null}
```

When there are fulfilled items but no active items, show a small `还没有待实现的心愿` card plus the existing add link instead of hiding the completed section.

- [ ] **Step 6: Run the full mobile validation**

Run:

```bash
cd mobile
node --experimental-strip-types --test tests/*.test.mjs
npx tsc --noEmit
npm run lint
```

Expected: all Node tests pass; TypeScript and lint exit 0.

- [ ] **Step 7: Verify the user flow on one native target and web**

1. Create a wish and confirm its unfinished progress uses only unallocated balances.
2. Open `实现心愿`; verify actual price defaults to expected price.
3. Select sources in a known order and verify the final source becomes partial.
4. Confirm with insufficient sources and verify the self-paid amount.
5. Verify the wish leaves the carousel and appears under `已实现`.
6. Expand details and compare every row with the selected sources.
7. Undo and verify the wish returns to the carousel and all balances return.
8. Fulfill using no sources and verify `全部自付`.
9. Trigger a stale-balance conflict from another session; verify the price remains, selections clear, and no ledger changes.

Expected: native and web show the same amounts and state transitions; no duplicate allocation or optimistic balance flash appears.

- [ ] **Step 8: Commit the completed product flow**

```bash
git add \
  mobile/src/components/wishlist-card.tsx \
  mobile/src/components/fulfilled-wishlist-card.tsx \
  mobile/src/app/'(tabs)'/'(wishlist)'/index.tsx
git commit -m "feat: show fulfilled wishlist funding"
```

---

## Final Verification

- [ ] Run the repository-relevant checks from the workspace root:

```bash
cd mobile
node --experimental-strip-types --test tests/*.test.mjs
npx tsc --noEmit
npm run lint
cd ..
npx supabase db lint --db-url "$POSTGRES_URL_NON_POOLING"
git status --short
```

Expected: tests pass, static checks exit 0, database lint has no new warning, and the worktree contains only intentional changes.

- [ ] Review the final diff against `docs/superpowers/specs/2026-07-25-wishlist-fulfillment-design.md`.

Every changed line must support one of: atomic allocation, available-balance calculation, fulfillment confirmation, completed-history display, or undo. Remove any unrelated refactor before handoff.
