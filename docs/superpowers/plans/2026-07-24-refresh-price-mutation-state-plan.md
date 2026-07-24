# Refresh Price Mutation State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep asset detail “刷新价格” pending/error (and post-success price data) visible after leaving and re-entering the detail screen while the app stays alive.

**Architecture:** Give the existing React Query refresh mutation a stable `mutationKey` per asset. Drive the button spinner/disabled state from `useIsMutating`, and error text from `useMutationState`, so UI state comes from the mutation cache instead of the component-local `useMutation` observer. Keep `onSuccess` invalidations unchanged so a refresh that finishes off-screen still updates price queries when the user returns.

**Tech Stack:** Expo Router, React Native, TypeScript, `@tanstack/react-query` ^5.101.4

## Global Constraints

- Scope is App-process lifetime only; no kill/cold-start recovery.
- No backend/API changes to `/estimate` or `recordValuation`.
- No list-level refresh progress or global toast.
- Sold assets still do not show the refresh button.
- Primary file: `mobile/src/app/asset/[id].tsx`.

## File Structure

- Modify: `mobile/src/app/asset/[id].tsx` — add `refreshPriceMutationKey`, wire `mutationKey` / `useIsMutating` / `useMutationState`, guard against duplicate mutate.
- No new modules unless a one-line key helper is kept at the top of the same file (preferred; YAGNI).

---

### Task 1: Persist refresh UI state via mutation cache

**Files:**
- Modify: `mobile/src/app/asset/[id].tsx`

**Interfaces:**
- Consumes: existing `estimateAsset`, `recordValuation`, `useMutation`, `useQueryClient`, asset detail queries.
- Produces: `refreshPriceMutationKey(assetId: string) => readonly ['refresh-price', string]` used by `useMutation`, `useIsMutating`, and `useMutationState`.

- [x] **Step 1: Add the shared mutation key helper**

Near the top of `mobile/src/app/asset/[id].tsx` (after imports), add:

```ts
const refreshPriceMutationKey = (assetId: string) =>
  ['refresh-price', assetId] as const;
```

- [x] **Step 2: Import mutation observers**

Change the React Query import to:

```ts
import {
  useIsMutating,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
```

- [x] **Step 3: Replace the local-only refresh mutation wiring**

Inside `AssetDetailScreen`, after `saleQuery`, replace the current `refresh` mutation block with:

```ts
  const refreshKey = id ? refreshPriceMutationKey(id) : (['refresh-price'] as const);
  const refreshPending = useIsMutating({ mutationKey: refreshKey }) > 0;
  const refreshError = useMutationState({
    filters: { mutationKey: refreshKey },
    select: (mutation) => mutation.state.error,
  }).at(-1);
  const refresh = useMutation({
    mutationKey: refreshKey,
    mutationFn: async () => {
      if (!assetQuery.data) return;
      const valuation = await estimateAsset(assetQuery.data);
      await recordValuation(assetQuery.data.id, valuation);
      return valuation;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['asset', id] }),
        queryClient.invalidateQueries({ queryKey: ['valuations', id] }),
        queryClient.invalidateQueries({ queryKey: ['assets'] }),
      ]);
    },
  });
```

Notes for the implementer:

- Do **not** use `refresh.isPending` or `refresh.error` for UI after this change; they reset on remount.
- `refreshKey` without `id` is only a safe fallback while params load; the screen already early-returns when asset loading fails, and the button only renders for non-sold assets with a real `id`.

- [x] **Step 4: Guard duplicate refreshes and bind UI to cache state**

Update the error + button block that currently uses `refresh.error` / `refresh.isPending` to:

```tsx
          {refreshError instanceof Error ? (
            <Text selectable style={{ color: colors.danger, ...typography.label }}>
              {refreshError.message}
            </Text>
          ) : null}
          {asset.status !== 'sold' ? (
            <Pressable
              accessibilityRole="button"
              disabled={refreshPending}
              onPress={() => {
                if (refreshPending) return;
                refresh.mutate();
              }}
              style={({ pressed }) => ({
                alignItems: 'center',
                minHeight: 48,
                justifyContent: 'center',
                padding: spacing.md,
                borderRadius: radius.small,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
                opacity: pressed || refreshPending ? 0.65 : 1,
              })}>
              {refreshPending ? (
                <ActivityIndicator color={colors.textPrimary} />
              ) : (
                <Text
                  style={{
                    ...typography.body,
                    color: colors.textPrimary,
                    fontWeight: '700',
                  }}>
                  刷新价格
                </Text>
              )}
            </Pressable>
          ) : null}
```

- [x] **Step 5: Run static checks**

Run:

```bash
cd mobile
npx tsc --noEmit
npm run lint
```

Expected: both exit 0 with no new errors related to this file.

- [ ] **Step 6: Manual verification**

With the Expo app running against a real/dev backend:

1. Open a non-sold asset detail → tap **刷新价格** → confirm spinner + disabled button.
2. While still pending, navigate back, then open the same asset again → spinner and disabled button must still show.
3. Wait until the request finishes while off the detail screen, then re-enter → price / history reflect the new valuation (or unchanged price if estimate returned the same), and button is enabled again (no spinner).
4. Force a failure if practical (e.g. stop API / bad network), leave and re-enter while failed → red error text still visible; button enabled so the user can retry.
5. Open a different asset while A is refreshing → B must not show A’s spinner.

- [x] **Step 7: Commit** (`ea3189f`)

```bash
git add mobile/src/app/asset/'[id]'.tsx
git commit -m "fix: keep refresh-price mutation state across detail remounts"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
| --- | --- |
| `mutationKey: ['refresh-price', assetId]` | Task 1 Step 1–3 |
| Pending via `useIsMutating` | Task 1 Step 3–4 |
| Error via `useMutationState` | Task 1 Step 3–4 |
| Duplicate mutate guard | Task 1 Step 4 |
| Success invalidations unchanged | Task 1 Step 3 |
| UI: spinner / disable / error text / sold unchanged | Task 1 Step 4 |
| No backend / list progress / kill-recovery | Out of scope (constraints) |
