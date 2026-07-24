# Two-Level Asset Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add status-first and category-second filters to the asset list, with both selections applied together.

**Architecture:** Keep filter state in the existing asset list screen and reuse the lifecycle values and labels from `asset-status.ts`. Put the two-condition predicate beside those lifecycle helpers so one small Node test can verify the combination logic without rendering Expo UI.

**Tech Stack:** Expo SDK 57, React Native 0.86, React 19, TypeScript, Node test runner

## Global Constraints

- The first row is status: 全部、持有、闲置、出售中、已卖出.
- The second row is category: 全部 plus every category present in the full asset list.
- Both filters apply as an intersection.
- Summary totals do not change with filters.
- Reuse the existing horizontal pill style and existing status constants.
- Do not add APIs, database fields, dependencies, or a reusable filter component.

---

### Task 1: Add combined asset filtering

**Files:**
- Modify: `mobile/src/lib/asset-status.ts`
- Modify: `mobile/tests/asset-status.test.mjs`
- Modify: `mobile/src/app/(tabs)/(assets)/index.tsx`

**Interfaces:**
- Consumes: `AssetStatus`, `assetStatuses`, and `assetStatusLabels` from `mobile/src/lib/asset-status.ts`.
- Produces: `matchesAssetFilters(asset, status, category): boolean`.

- [ ] **Step 1: Add a failing combination test**

Extend the import in `mobile/tests/asset-status.test.mjs` with
`matchesAssetFilters`, then add:

```js
test('status and category filters apply together', () => {
  const asset = { status: 'idle', category: '数码' };

  assert.equal(matchesAssetFilters(asset, null, null), true);
  assert.equal(matchesAssetFilters(asset, 'idle', null), true);
  assert.equal(matchesAssetFilters(asset, 'listed', null), false);
  assert.equal(matchesAssetFilters(asset, null, '数码'), true);
  assert.equal(matchesAssetFilters(asset, null, '家电'), false);
  assert.equal(matchesAssetFilters(asset, 'idle', '数码'), true);
  assert.equal(matchesAssetFilters(asset, 'idle', '家电'), false);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
cd mobile && node --experimental-strip-types --test tests/asset-status.test.mjs
```

Expected: FAIL because `matchesAssetFilters` is not exported.

- [ ] **Step 3: Add the minimal predicate**

Append to `mobile/src/lib/asset-status.ts`:

```ts
export const matchesAssetFilters = (
  asset: { status: AssetStatus; category: string },
  status: AssetStatus | null,
  category: string | null,
) =>
  (status === null || asset.status === status) &&
  (category === null || asset.category === category);
```

- [ ] **Step 4: Add the status-first filter row**

In `mobile/src/app/(tabs)/(assets)/index.tsx`, import:

```ts
import {
  assetStatusLabels,
  assetStatuses,
  isCurrentAsset,
  matchesAssetFilters,
  type AssetStatus,
} from '@/lib/asset-status';
```

Add status state beside category state:

```ts
const [selectedStatus, setSelectedStatus] = useState<AssetStatus | null>(null);
const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
```

Build categories from `assets`, not `currentAssets`, so a category containing
only sold items remains selectable:

```ts
const categories = useMemo(
  () =>
    Object.keys(
      assets.reduce<Record<string, true>>((result, asset) => {
        result[asset.category] = true;
        return result;
      }, {}),
    ).sort((a, b) => a.localeCompare(b, 'zh-CN')),
  [assets],
);
```

Apply both selections:

```ts
const filteredAssets = assets.filter((asset) =>
  matchesAssetFilters(asset, selectedStatus, selectedCategory),
);
```

Before the existing category row, render an always-visible horizontal row with
“全部” followed by `assetStatuses`. Use the existing 28-point pill styles,
`assetStatusLabels[status]` for text, and
`accessibilityState={{ selected }}` on every status button.

Update the category loop from tuple entries to strings:

```tsx
{categories.map((category) => {
```

Wrap the two rows in one `View` with `gap: spacing.md`, preserving the category
row only when `categories.length > 1`.

Change the non-empty-list empty message to:

```tsx
{assets.length ? '该筛选下暂无资产' : '还没有资产'}
```

- [ ] **Step 5: Run focused and project checks**

Run:

```bash
cd mobile
node --experimental-strip-types --test tests/asset-status.test.mjs
npx tsc --noEmit
npm run lint
```

Expected: the focused test, TypeScript check, and lint all pass.

- [ ] **Step 6: Review and commit**

Run:

```bash
git diff --check
git diff -- mobile/src/lib/asset-status.ts mobile/tests/asset-status.test.mjs 'mobile/src/app/(tabs)/(assets)/index.tsx'
git add mobile/src/lib/asset-status.ts mobile/tests/asset-status.test.mjs 'mobile/src/app/(tabs)/(assets)/index.tsx'
git commit -m "feat: add two-level asset filters"
```

Expected: only the status helper, its focused test, and the asset list UI are
committed.
