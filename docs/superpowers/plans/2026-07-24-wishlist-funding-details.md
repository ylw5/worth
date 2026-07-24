# Wishlist Funding Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show “忍住消费” and “已卖闲置” funding details below the wishlist carousel, and use both sources in each wishlist card's main progress.

**Architecture:** Keep Supabase as the owner-scoped source of truth and add two ordered list queries through the existing client and RLS. Sum both sources with the existing pure progress helper, then render an accessible two-tab detail panel directly in the wishlist screen without a migration, RPC, dependency, or extra component file.

**Tech Stack:** Expo SDK 57.0.8, React Native 0.86.0, Expo Router 57.0.8, TanStack Query 5, Supabase JS 2, TypeScript 6, Node test runner

## Global Constraints

- Keep Expo SDK at `57.0.8`, React Native at `0.86.0`, React at `19.2.3`, and Expo Router at `57.0.8`; use the [Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/) and [Expo Router 57 reference](https://docs.expo.dev/versions/v57.0.0/sdk/router/).
- Do not add dependencies, database migrations, RPCs, aggregate tables, caches, pagination, filters, animation, or detail navigation.
- Tab labels must be exactly `忍住消费` and `已卖闲置`.
- Count only `spending_resolutions` rows whose `confirmed_at` is non-null.
- Use actual `asset_sales.sale_price`; never substitute estimated market value.
- All wishlist cards share the same user-level total: confirmed spending resolutions plus asset sales.
- Keep each source's detail list ordered newest first.
- Refresh both sources when the wishlist screen regains focus.
- Reuse existing RLS, query error states, `formatCurrency`, `formatDate`, `formatDateOnly`, colors, spacing, radii, and typography.
- Preserve unrelated uncommitted work. In particular, do not stage `docs/superpowers/plans/2026-07-24-wishlist-carousel.md` or the current local `WishlistCard` extraction unless the user explicitly assigns ownership of those changes.

## File Map

- Modify `mobile/src/lib/spending-resolutions.ts`: return confirmed spending-resolution detail rows in newest-first order.
- Modify `mobile/src/lib/assets.ts`: return asset-sale rows with the corresponding asset name in newest-first order.
- Modify `mobile/src/lib/wishlist-progress.ts`: rename the source-specific sum helper to a generic money helper.
- Modify `mobile/tests/wishlist-progress.test.mjs`: verify separate source totals and combined progress.
- Modify `mobile/src/app/(tabs)/(wishlist)/index.tsx`: query both sources, compute combined progress, refresh on focus, and render the two-tab details panel.

---

### Task 1: Read ordered funding detail rows

**Files:**
- Modify: `mobile/src/lib/spending-resolutions.ts:4-77`
- Modify: `mobile/src/lib/assets.ts:1-68`

**Interfaces:**
- Consumes: existing `supabase`, owner RLS, `SpendingResolution`, and `AssetSale`.
- Produces:
  - `ConfirmedSpendingResolution = SpendingResolution & { confirmed_at: string }`
  - `listConfirmedSpendingResolutions(): Promise<ConfirmedSpendingResolution[]>`
  - `AssetSaleWithName = AssetSale & { asset: { name: string } }`
  - `listAssetSales(): Promise<AssetSaleWithName[]>`

- [ ] **Step 1: Add the detail query beside the existing amount-only query**

In `mobile/src/lib/spending-resolutions.ts`, add the refined confirmed type after `SpendingResolution`:

```ts
export type ConfirmedSpendingResolution = SpendingResolution & {
  confirmed_at: string;
};
```

Keep `listConfirmedSpendingResolutionAmounts` compiling until Task 3, and add:

```ts
export async function listConfirmedSpendingResolutions(): Promise<
  ConfirmedSpendingResolution[]
> {
  const { data, error } = await supabase
    .from('spending_resolutions')
    .select('*')
    .not('confirmed_at', 'is', null)
    .order('confirmed_at', { ascending: false });
  fail(error);
  return ((data ?? []) as ConfirmedSpendingResolution[]).map((resolution) => ({
    ...resolution,
    amount: Number(resolution.amount),
  }));
}
```

- [ ] **Step 2: Add the joined asset-sale list query**

In `mobile/src/lib/assets.ts`, add this exported type below `fail`:

```ts
export type AssetSaleWithName = AssetSale & {
  asset: { name: string };
};
```

Add this function immediately after `getAssetSale`:

```ts
export async function listAssetSales(): Promise<AssetSaleWithName[]> {
  const { data, error } = await supabase
    .from('asset_sales')
    .select('*, asset:assets(name)')
    .order('sold_at', { ascending: false });
  fail(error);
  return ((data ?? []) as unknown as AssetSaleWithName[]).map((sale) => ({
    ...sale,
    sale_price: Number(sale.sale_price),
  }));
}
```

- [ ] **Step 3: Run the TypeScript check**

Run:

```bash
cd mobile && npx tsc --noEmit
```

Expected: PASS from a clean committed baseline. Do not repair or stage unrelated
working-tree errors as part of this task.

- [ ] **Step 4: Commit only the data-query changes**

```bash
git add mobile/src/lib/spending-resolutions.ts mobile/src/lib/assets.ts
git commit -m "feat: list wishlist funding sources"
```

---

### Task 2: Generalize and test funding totals

**Files:**
- Modify: `mobile/src/lib/wishlist-progress.ts:1-14`
- Modify: `mobile/tests/wishlist-progress.test.mjs:1-22`
- Modify: `mobile/src/app/(tabs)/(wishlist)/index.tsx:29,41`

**Interfaces:**
- Consumes: arrays of normalized numeric amounts from Task 1.
- Produces:
  - `sumAmounts(amounts: number[]): number`
  - existing `getWishlistProgress(fundedAmount: number, targetAmount: number)`

- [ ] **Step 1: Write the failing combined-funding test**

Replace `mobile/tests/wishlist-progress.test.mjs` with:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getWishlistProgress,
  sumAmounts,
} from '../src/lib/wishlist-progress.ts';

test('sums separate funding sources and derives combined wishlist progress', () => {
  const spendingTotal = sumAmounts([699, 237]);
  const salesTotal = sumAmounts([500, 120]);
  const fundedAmount = spendingTotal + salesTotal;

  assert.equal(sumAmounts([]), 0);
  assert.equal(spendingTotal, 936);
  assert.equal(salesTotal, 620);
  assert.equal(fundedAmount, 1556);
  assert.deepEqual(getWishlistProgress(fundedAmount, 2000), {
    percentage: 78,
    barPercentage: 78,
  });
  assert.deepEqual(getWishlistProgress(fundedAmount, 1280), {
    percentage: 122,
    barPercentage: 100,
  });
});
```

- [ ] **Step 2: Run the focused test and verify the renamed helper is missing**

Run:

```bash
cd mobile && node --test tests/wishlist-progress.test.mjs
```

Expected: FAIL because `sumAmounts` is not exported.

- [ ] **Step 3: Rename the pure sum helper**

Replace the first export in `mobile/src/lib/wishlist-progress.ts`:

```ts
export const sumAmounts = (amounts: number[]) =>
  amounts.reduce((total, amount) => total + amount, 0);
```

In `mobile/src/app/(tabs)/(wishlist)/index.tsx`, temporarily keep the existing behavior compiling by replacing:

```ts
import { sumSavings } from '@/lib/wishlist-progress';
```

with:

```ts
import { sumAmounts } from '@/lib/wishlist-progress';
```

and replace:

```ts
const savedAmount = sumSavings(savingsQuery.data ?? []);
```

with:

```ts
const savedAmount = sumAmounts(savingsQuery.data ?? []);
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
cd mobile && node --test tests/wishlist-progress.test.mjs
```

Expected: PASS (1 test).

- [ ] **Step 5: Commit only the helper rename and its direct caller**

Stage only the exact helper/test changes and the two renamed lines in the wishlist screen. Do not stage the existing local card-extraction hunks:

```bash
git add mobile/src/lib/wishlist-progress.ts mobile/tests/wishlist-progress.test.mjs
git add -p 'mobile/src/app/(tabs)/(wishlist)/index.tsx'
git diff --cached --check
git commit -m "test: cover combined wishlist funding"
```

Expected staged screen hunk: only `sumSavings` → `sumAmounts` in the import and call.

---

### Task 3: Render combined progress and the two-tab detail panel

**Files:**
- Modify: `mobile/src/app/(tabs)/(wishlist)/index.tsx:1-352`

**Interfaces:**
- Consumes:
  - `listConfirmedSpendingResolutions()` and `ConfirmedSpendingResolution` from Task 1.
  - `listAssetSales()` and `AssetSaleWithName` from Task 1.
  - `sumAmounts()` and `getWishlistProgress()` from Task 2.
  - existing `formatCurrency`, `formatDate`, `formatDateOnly`, React Query, and design tokens.
- Produces: combined wishlist-card progress and an accessible `忍住消费` / `已卖闲置` detail module.

- [ ] **Step 1: Update imports and add the local tab type**

In `mobile/src/app/(tabs)/(wishlist)/index.tsx`:

```ts
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { Link, router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { ErrorState, LoadingState } from '@/components/screen-state';
import { colors, radius, spacing, typography } from '@/constants/colors';
import {
  listAssetSales,
  type AssetSaleWithName,
} from '@/lib/assets';
import {
  formatCurrency,
  formatDate,
  formatDateOnly,
} from '@/lib/format';
import {
  listConfirmedSpendingResolutions,
  type ConfirmedSpendingResolution,
} from '@/lib/spending-resolutions';
import {
  deleteWishlistItem,
  listWishlistItems,
} from '@/lib/wishlist';
import {
  getWishlistCarouselIndex,
  getWishlistCarouselMetrics,
} from '@/lib/wishlist-carousel';
import {
  getWishlistProgress,
  sumAmounts,
} from '@/lib/wishlist-progress';

type FundingTab = 'spending' | 'sales';
```

- [ ] **Step 2: Add the complete local funding panel**

Add this function above `WishlistScreen` in the same file:

```tsx
function WishlistFundingDetails({
  resolutions,
  sales,
}: {
  resolutions: ConfirmedSpendingResolution[];
  sales: AssetSaleWithName[];
}) {
  const [activeTab, setActiveTab] = useState<FundingTab>('spending');
  const spendingTotal = sumAmounts(
    resolutions.map((resolution) => resolution.amount),
  );
  const salesTotal = sumAmounts(sales.map((sale) => sale.sale_price));
  const tabs: { key: FundingTab; label: string; total: number }[] = [
    { key: 'spending', label: '忍住消费', total: spendingTotal },
    { key: 'sales', label: '已卖闲置', total: salesTotal },
  ];
  const activeTotal =
    activeTab === 'spending' ? spendingTotal : salesTotal;

  return (
    <View
      style={{
        marginHorizontal: spacing.xl,
        padding: spacing.lg,
        gap: spacing.lg,
        backgroundColor: colors.surface,
        borderRadius: radius.large,
        borderCurve: 'continuous',
      }}>
      <View
        accessibilityRole="tablist"
        style={{
          flexDirection: 'row',
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}>
        {tabs.map((tab) => {
          const selected = tab.key === activeTab;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setActiveTab(tab.key)}
              style={{
                flex: 1,
                minHeight: 44,
                alignItems: 'center',
                justifyContent: 'center',
                borderBottomWidth: 2,
                borderBottomColor: selected
                  ? colors.accent
                  : 'transparent',
              }}>
              <Text
                style={{
                  color: selected
                    ? colors.textPrimary
                    : colors.textSecondary,
                  ...typography.label,
                  fontWeight: selected ? '700' : '400',
                }}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ gap: spacing.xs }}>
        <Text
          selectable
          style={{ color: colors.textSecondary, ...typography.label }}>
          累计金额
        </Text>
        <Text
          selectable
          style={{
            color: colors.textPrimary,
            ...typography.sectionTitle,
            fontVariant: ['tabular-nums'],
          }}>
          {formatCurrency(activeTotal)}
        </Text>
      </View>

      <View style={{ gap: spacing.md }}>
        {activeTab === 'spending' ? (
          resolutions.length ? (
            resolutions.map((resolution) => (
              <View
                key={resolution.id}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  gap: spacing.md,
                  paddingVertical: spacing.sm,
                }}>
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <Text
                    selectable
                    numberOfLines={2}
                    style={{
                      color: colors.textPrimary,
                      ...typography.body,
                    }}>
                    {resolution.product_snapshot.title}
                  </Text>
                  <Text
                    selectable
                    style={{
                      color: colors.textSecondary,
                      ...typography.caption,
                    }}>
                    {formatDate(resolution.confirmed_at)}
                  </Text>
                </View>
                <Text
                  selectable
                  style={{
                    color: colors.textPrimary,
                    ...typography.body,
                    fontWeight: '600',
                    fontVariant: ['tabular-nums'],
                  }}>
                  {formatCurrency(resolution.amount)}
                </Text>
              </View>
            ))
          ) : (
            <Text
              selectable
              style={{ color: colors.textSecondary, ...typography.body }}>
              还没有忍住消费记录
            </Text>
          )
        ) : sales.length ? (
          sales.map((sale) => (
            <View
              key={sale.id}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: spacing.md,
                paddingVertical: spacing.sm,
              }}>
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Text
                  selectable
                  numberOfLines={2}
                  style={{
                    color: colors.textPrimary,
                    ...typography.body,
                  }}>
                  {sale.asset.name}
                </Text>
                <Text
                  selectable
                  style={{
                    color: colors.textSecondary,
                    ...typography.caption,
                  }}>
                  {formatDateOnly(sale.sold_at)}
                </Text>
              </View>
              <Text
                selectable
                style={{
                  color: colors.textPrimary,
                  ...typography.body,
                  fontWeight: '600',
                  fontVariant: ['tabular-nums'],
                }}>
                {formatCurrency(sale.sale_price)}
              </Text>
            </View>
          ))
        ) : (
          <Text
            selectable
            style={{ color: colors.textSecondary, ...typography.body }}>
            还没有已卖闲置记录
          </Text>
        )}
      </View>
    </View>
  );
}
```

- [ ] **Step 3: Replace the amount-only query with both detail queries**

At the start of `WishlistScreen`, replace the current savings query, amount calculation, and focus refresh with:

```ts
const resolutionsQuery = useQuery({
  queryKey: ['spending-resolutions', 'confirmed'],
  queryFn: listConfirmedSpendingResolutions,
});
const salesQuery = useQuery({
  queryKey: ['asset-sales'],
  queryFn: listAssetSales,
});
const resolutions = resolutionsQuery.data ?? [];
const sales = salesQuery.data ?? [];
const spendingTotal = sumAmounts(
  resolutions.map((resolution) => resolution.amount),
);
const salesTotal = sumAmounts(sales.map((sale) => sale.sale_price));
const fundedAmount = spendingTotal + salesTotal;
const refetchResolutions = resolutionsQuery.refetch;
const refetchSales = salesQuery.refetch;

useFocusEffect(
  useCallback(() => {
    void Promise.all([refetchResolutions(), refetchSales()]);
  }, [refetchResolutions, refetchSales]),
);
```

After the screen no longer imports it, delete
`listConfirmedSpendingResolutionAmounts` from
`mobile/src/lib/spending-resolutions.ts`; the detail query is now its only
replacement.

- [ ] **Step 4: Include both funding queries in loading and error gates**

Use these booleans before the return:

```ts
const fundingLoading = resolutionsQuery.isLoading || salesQuery.isLoading;
const fundingError = resolutionsQuery.error ?? salesQuery.error;
```

Replace the existing savings loading/error conditions with:

```tsx
{query.isLoading || fundingLoading ? <LoadingState /> : null}
{query.error ? <ErrorState message={query.error.message} /> : null}
{fundingError ? <ErrorState message={fundingError.message} /> : null}
```

The empty-state condition must be:

```ts
!query.isLoading &&
!query.error &&
!fundingLoading &&
!fundingError &&
items.length === 0
```

The ready-state condition must be:

```ts
!fundingLoading && !fundingError && items.length > 0
```

- [ ] **Step 5: Use the combined amount in every wishlist card**

In the carousel's `renderItem`, calculate:

```ts
const progress = getWishlistProgress(
  fundedAmount,
  item.target_price,
);
```

In the card's main amount text, render:

```tsx
{formatCurrency(fundedAmount)} /{' '}
{item.target_price.toLocaleString('zh-CN', {
  maximumFractionDigits: 0,
})}
```

Do not change the target amount, progress cap, delete action, notes, or “查看今日卖出方案” action.

- [ ] **Step 6: Make the screen vertically scrollable and render the panel below the carousel**

Replace the root content `<View style={{ flex: 1, backgroundColor: colors.background }}>` with:

```tsx
{/* ponytail: ScrollView is enough for personal history; paginate with a vertical FlatList only when record counts make rendering measurable. */}
<ScrollView
  contentInsetAdjustmentBehavior="automatic"
  style={{ flex: 1, backgroundColor: colors.background }}
  contentContainerStyle={{ paddingBottom: spacing.xxxl }}>
```

Close it with `</ScrollView>`.

Inside the ready-state container, immediately after the page-dot block, add:

```tsx
<WishlistFundingDetails resolutions={resolutions} sales={sales} />
```

Remove `paddingBottom: spacing.xl` from the page-dot row so the parent `gap` controls the spacing between dots and the details panel.

- [ ] **Step 7: Run focused tests, type checking, and lint**

Run:

```bash
cd mobile && node --test tests/wishlist-progress.test.mjs tests/wishlist-carousel.test.mjs
npx tsc --noEmit
npx eslint 'src/app/(tabs)/(wishlist)/index.tsx' src/lib/spending-resolutions.ts src/lib/assets.ts src/lib/wishlist-progress.ts tests/wishlist-progress.test.mjs
```

Expected: all Node tests PASS, TypeScript emits no errors, and ESLint emits no errors.

- [ ] **Step 8: Manually verify the visible behavior**

Run:

```bash
cd mobile && npm run ios
```

Verify:

1. A wishlist card's main amount equals the visible `忍住消费` total plus the visible `已卖闲置` total.
2. The progress percentage uses that combined amount and remains visually capped at 100%.
3. `忍住消费` is initially selected and shows product title, amount, and confirmation date newest first.
4. Tapping `已卖闲置` selects it and shows asset name, actual sale price, and sold date newest first.
5. Each empty source shows its own empty message.
6. Adding a confirmed spending resolution or recording a sale, then returning to the wishlist tab, refreshes the relevant total and list.
7. Multiple wish cards still swipe horizontally and share the same combined total.
8. The vertical page scroll reaches all detail rows without breaking horizontal carousel swipes.

- [ ] **Step 9: Commit only the feature changes**

Inspect the patch and exclude pre-existing user work:

```bash
git diff --check
git status --short
git add mobile/src/lib/spending-resolutions.ts mobile/src/lib/assets.ts mobile/src/lib/wishlist-progress.ts mobile/tests/wishlist-progress.test.mjs
git add -p 'mobile/src/app/(tabs)/(wishlist)/index.tsx'
git diff --cached --check
git diff --cached --stat
git commit -m "feat: show wishlist funding details"
```

Expected staged scope: the two funding queries, generic amount helper/test, and wishlist funding UI only. Do not stage the untracked carousel plan or any unapproved component extraction.
