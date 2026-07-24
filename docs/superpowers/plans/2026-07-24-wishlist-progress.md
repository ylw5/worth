# Wishlist Progress Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each wishlist item as a progress card using the user's confirmed AI-assisted savings total and that item's target price.

**Architecture:** Query confirmed `spending_resolutions.amount` rows through the existing Supabase client and RLS, sum them once in the wishlist screen, then derive each card's percentage from its target price. Keep the money arithmetic in one pure helper so the aggregation and progress cap have one runnable Node test.

**Tech Stack:** Expo SDK 57, React Native 0.86, Expo Router, TanStack Query, Supabase JS, Node test runner, TypeScript

## Global Constraints

- Keep Expo SDK at `57.0.8`, React Native at `0.86.0`, and React at `19.2.3`; the version mapping is documented in the [Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/).
- Do not add dependencies, database migrations, RPCs, or cached total fields.
- Count only `spending_resolutions` rows whose `confirmed_at` is not null.
- Use the same user-level saved total on every wishlist card.
- Round the displayed percentage to an integer and cap only the progress bar width at 100%.
- Preserve the existing delete action, notes, empty state, and “查看今日卖出方案” link.
- Do not touch the pre-existing changes in the evaluation and chat files.

## File Map

- Create `mobile/src/lib/wishlist-progress.ts`: pure saved-total and percentage calculations.
- Create `mobile/tests/wishlist-progress.test.mjs`: minimal money/progress regression check.
- Modify `mobile/src/lib/spending-resolutions.ts`: owner-scoped query for confirmed amounts.
- Modify `mobile/src/app/(tabs)/(wishlist)/index.tsx`: run the second query and render progress cards.

---

### Task 1: Add and render wishlist progress

**Files:**
- Create: `mobile/src/lib/wishlist-progress.ts`
- Create: `mobile/tests/wishlist-progress.test.mjs`
- Modify: `mobile/src/lib/spending-resolutions.ts:67`
- Modify: `mobile/src/app/(tabs)/(wishlist)/index.tsx:1-175`

**Interfaces:**
- Consumes: existing `supabase`, `fail`, `formatCurrency`, wishlist query, and design tokens.
- Produces: `sumSavings(amounts: number[]): number`, `getWishlistProgress(savedAmount: number, targetAmount: number): { percentage: number; barPercentage: number }`, and `listConfirmedSpendingResolutionAmounts(): Promise<number[]>`.

- [ ] **Step 1: Write the failing progress calculation test**

Create `mobile/tests/wishlist-progress.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getWishlistProgress,
  sumSavings,
} from '../src/lib/wishlist-progress.ts';

test('sums confirmed savings and derives capped wishlist progress', () => {
  assert.equal(sumSavings([]), 0);
  assert.equal(sumSavings([699, 237]), 936);
  assert.deepEqual(getWishlistProgress(936, 1280), {
    percentage: 73,
    barPercentage: 73,
  });
  assert.deepEqual(getWishlistProgress(1500, 1280), {
    percentage: 117,
    barPercentage: 100,
  });
});
```

- [ ] **Step 2: Run the test and verify the helper is missing**

Run:

```bash
cd mobile && node --test tests/wishlist-progress.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/lib/wishlist-progress.ts`.

- [ ] **Step 3: Add the minimum pure calculation helper**

Create `mobile/src/lib/wishlist-progress.ts`:

```ts
export const sumSavings = (amounts: number[]) =>
  amounts.reduce((total, amount) => total + amount, 0);

export const getWishlistProgress = (
  savedAmount: number,
  targetAmount: number,
) => {
  const percentage = Math.round((savedAmount / targetAmount) * 100);
  return {
    percentage,
    barPercentage: Math.min(percentage, 100),
  };
};
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
cd mobile && node --test tests/wishlist-progress.test.mjs
```

Expected: one test passes.

- [ ] **Step 5: Add the confirmed-amount query**

Append to `mobile/src/lib/spending-resolutions.ts`:

```ts
export async function listConfirmedSpendingResolutionAmounts(): Promise<
  number[]
> {
  const { data, error } = await supabase
    .from('spending_resolutions')
    .select('amount')
    .not('confirmed_at', 'is', null);
  fail(error);
  return (data ?? []).map(({ amount }) => Number(amount));
}
```

This query returns only rows visible through the existing owner-select RLS policy. Pending rows never reach the summation helper.

- [ ] **Step 6: Add the savings query and shared total to the wishlist screen**

Add these imports to `mobile/src/app/(tabs)/(wishlist)/index.tsx`:

```ts
import { listConfirmedSpendingResolutionAmounts } from '@/lib/spending-resolutions';
import {
  getWishlistProgress,
  sumSavings,
} from '@/lib/wishlist-progress';
```

Immediately after the existing wishlist `useQuery`, add:

```ts
  const savingsQuery = useQuery({
    queryKey: ['spending-resolutions', 'confirmed-amounts'],
    queryFn: listConfirmedSpendingResolutionAmounts,
  });
  const savedAmount = sumSavings(savingsQuery.data ?? []);
```

Replace the current loading and query-error lines with:

```tsx
        {query.isLoading || savingsQuery.isLoading ? <LoadingState /> : null}
        {query.error ? <ErrorState message={query.error.message} /> : null}
        {savingsQuery.error ? (
          <ErrorState message={savingsQuery.error.message} />
        ) : null}
```

- [ ] **Step 7: Replace the existing wishlist card map with progress cards**

Replace the current `(query.data ?? []).map(...)` block with:

```tsx
        {!savingsQuery.isLoading && !savingsQuery.error
          ? (query.data ?? []).map((item) => {
              const progress = getWishlistProgress(
                savedAmount,
                item.target_price,
              );
              return (
                <View
                  key={item.id}
                  style={{
                    padding: spacing.lg,
                    gap: spacing.md,
                    backgroundColor: colors.surface,
                    borderRadius: radius.large,
                    borderCurve: 'continuous',
                  }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      gap: spacing.md,
                    }}>
                    <Text
                      selectable
                      style={{
                        flex: 1,
                        color: colors.textSecondary,
                        ...typography.cardTitle,
                      }}>
                      {item.name}
                    </Text>
                    <Pressable
                      accessibilityLabel={`删除${item.name}`}
                      accessibilityRole="button"
                      disabled={deletingId === item.id}
                      hitSlop={8}
                      onPress={() => confirmDelete(item.id, item.name)}>
                      <Text
                        style={{ color: colors.danger, ...typography.label }}>
                        删除
                      </Text>
                    </Pressable>
                  </View>
                  <Text
                    selectable
                    style={{
                      color: colors.textPrimary,
                      fontSize: 34,
                      fontWeight: '700',
                      fontVariant: ['tabular-nums'],
                    }}>
                    {formatCurrency(savedAmount)} /{' '}
                    {item.target_price.toLocaleString('zh-CN', {
                      maximumFractionDigits: 0,
                    })}
                  </Text>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.md,
                    }}>
                    <View
                      accessibilityLabel={`${item.name}心愿进度`}
                      accessibilityRole="progressbar"
                      accessibilityValue={{
                        min: 0,
                        max: 100,
                        now: progress.barPercentage,
                        text: `${progress.percentage}%`,
                      }}
                      style={{
                        flex: 1,
                        height: 12,
                        overflow: 'hidden',
                        backgroundColor: colors.surfaceMuted,
                        borderRadius: radius.pill,
                      }}>
                      <View
                        style={{
                          width: `${progress.barPercentage}%`,
                          height: '100%',
                          backgroundColor: colors.accent,
                          borderRadius: radius.pill,
                        }}
                      />
                    </View>
                    <Text
                      selectable
                      style={{
                        minWidth: 44,
                        color: colors.textPrimary,
                        fontSize: 18,
                        fontWeight: '700',
                        fontVariant: ['tabular-nums'],
                      }}>
                      {progress.percentage}%
                    </Text>
                  </View>
                  {item.notes ? (
                    <Text
                      selectable
                      style={{
                        color: colors.textSecondary,
                        ...typography.body,
                      }}>
                      {item.notes}
                    </Text>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      router.push({
                        pathname: '/(tabs)/(wishlist)/[id]',
                        params: { id: item.id },
                      })
                    }
                    style={({ pressed }) => ({
                      alignSelf: 'flex-start',
                      paddingVertical: 5,
                      opacity: pressed ? 0.6 : 1,
                    })}>
                    <Text style={{ color: colors.green, fontWeight: '700' }}>
                      查看今日卖出方案
                    </Text>
                  </Pressable>
                </View>
              );
            })
          : null}
```

Update the empty-state condition so it does not render while the savings query is unresolved:

```tsx
        {!query.isLoading &&
        !query.error &&
        !savingsQuery.isLoading &&
        !savingsQuery.error &&
        !query.data?.length ? (
```

- [ ] **Step 8: Run focused and regression checks**

Run:

```bash
cd mobile && node --test tests/wishlist-progress.test.mjs tests/spending-resolutions.test.mjs && npx tsc --noEmit
```

Expected: both test files pass and TypeScript exits with code 0.

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only the four wishlist-progress files are changed by this task, alongside the three pre-existing user changes in the evaluation and chat files.

- [ ] **Step 9: Commit only the wishlist progress files**

```bash
git add \
  mobile/src/lib/wishlist-progress.ts \
  mobile/tests/wishlist-progress.test.mjs \
  mobile/src/lib/spending-resolutions.ts \
  'mobile/src/app/(tabs)/(wishlist)/index.tsx'
git commit -m "feat: show wishlist savings progress"
```
