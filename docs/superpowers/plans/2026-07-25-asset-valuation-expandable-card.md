# Asset Valuation Expandable Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the asset detail market snapshot + trend cards with one expandable valuation card (left price, right sparkline; sparkline expands; chevron collapses).

**Architecture:** Add a pure `trendChangeCopy` helper for the collapsed/expanded change line. Build `MarketValuationCard` that owns `expanded` / `range` / chart width and reuses existing `filterTrend` / `plotTrend` / `trendStats` / View polyline drawing. Wire it into `asset/[id].tsx` and delete the old snapshot/trend cards plus the valuations history list UI.

**Tech Stack:** Expo SDK 57, React Native, Expo Symbols, TypeScript, Node assert tests

## Global Constraints

- Do not add dependencies or change APIs / market snapshot backend.
- Expand only via right sparkline; collapse only via bottom upward chevron.
- Drop high/low, sample count, data source, routine job status; show failed tip only when `run.status === 'failed'`.
- Remove the detail-page「价格历史」list; keep `getValuations` and edit-page invalidate.
- Chart stays View-based polylines (no SVG).
- Spec: `docs/superpowers/specs/2026-07-25-asset-valuation-expandable-card-design.md`.

## File Map

- Modify: `mobile/src/lib/market-trend.ts` — `trendChangeCopy` + range label map.
- Modify: `mobile/tests/market-trend.test.mjs` — copy helper cases.
- Create: `mobile/src/components/market-valuation-card.tsx` — expandable card UI.
- Modify: `mobile/src/app/asset/[id].tsx` — use new card; drop history query UI.
- Delete: `mobile/src/components/market-snapshot-card.tsx`
- Delete: `mobile/src/components/market-trend-card.tsx`

---

### Task 1: Trend change copy helper

**Files:**
- Modify: `mobile/src/lib/market-trend.ts`
- Modify: `mobile/tests/market-trend.test.mjs`

**Interfaces:**
- Consumes: existing `TrendRange`, `trendStats` return shape.
- Produces:
  - `trendRangeLabels: Record<TrendRange, string>` with `30d → '30 天'`, `90d → '90 天'`, `all → '全部'`
  - `trendChangeCopy(stats: ReturnType<typeof trendStats>, range: TrendRange): string`

- [ ] **Step 1: Extend the failing assertions**

Append to `mobile/tests/market-trend.test.mjs`:

```js
import {
  filterTrend,
  jobCopy,
  plotTrend,
  trendChangeCopy,
  trendRangeLabels,
  trendStats,
} from '../src/lib/market-trend.ts';

assert.equal(trendRangeLabels['30d'], '30 天');
assert.equal(
  trendChangeCopy({ change: 20, percent: 20, high: 120, low: 90 }, '30d'),
  '30 天 +¥20.00（+20%）',
);
assert.equal(
  trendChangeCopy({ change: -5, percent: -4.2, high: 100, low: 90 }, '90d'),
  '90 天 -¥5.00（-4.2%）',
);
assert.equal(trendChangeCopy(null, '30d'), '行情积累中');
assert.equal(
  trendChangeCopy({ change: 0, percent: null, high: 0, low: 0 }, 'all'),
  '全部 —',
);
```

Use the same currency formatting convention as `formatCurrency` in the app (`¥` + two decimals). Implement the helper with the same string rules rather than importing React Native format if that path is awkward in Node tests — duplicate the tiny currency format inline in `market-trend.ts` only if needed; prefer importing from `format.ts` if Node already loads it via the existing test pattern.

- [ ] **Step 2: Run test and confirm failure**

Run: `cd mobile && node --experimental-strip-types --test tests/market-trend.test.mjs`

Expected: FAIL — `trendChangeCopy` not exported.

- [ ] **Step 3: Implement helper**

In `mobile/src/lib/market-trend.ts`:

```ts
import { formatCurrency } from '@/lib/format';

export const trendRangeLabels: Record<TrendRange, string> = {
  '30d': '30 天',
  '90d': '90 天',
  all: '全部',
};

export function trendChangeCopy(
  stats: ReturnType<typeof trendStats>,
  range: TrendRange,
): string {
  const label = trendRangeLabels[range];
  if (!stats) return '行情积累中';
  if (stats.percent === null) return `${label} —`;
  const signed =
    stats.change > 0
      ? `+${formatCurrency(stats.change)}`
      : formatCurrency(stats.change);
  const pct =
    stats.percent > 0 ? `+${stats.percent}%` : `${stats.percent}%`;
  return `${label} ${signed}（${pct}）`;
}
```

If `@/` alias fails under Node strip-types, use a relative import `./format.ts` instead (match how other lib tests import).

- [ ] **Step 4: Re-run tests**

Run: `cd mobile && node --experimental-strip-types --test tests/market-trend.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/market-trend.ts mobile/tests/market-trend.test.mjs
git commit -m "feat: add trend change copy helper"
```

---

### Task 2: MarketValuationCard

**Files:**
- Create: `mobile/src/components/market-valuation-card.tsx`

**Interfaces:**
- Consumes: `MarketInsight`; `filterTrend`, `plotTrend`, `trendStats`, `trendChangeCopy`, `trendRangeLabels`, `jobCopy` from `@/lib/market-trend`.
- Produces: `export function MarketValuationCard({ insight }: { insight: MarketInsight })`

- [ ] **Step 1: Create the component**

Create `mobile/src/components/market-valuation-card.tsx` with:

- State: `expanded` (default false), `range` (default `'30d'`), `width` for chart layout.
- Latest price from `insight.snapshots.at(-1)`.
- Filtered rows via `filterTrend(snapshots, range)`; stats via `trendStats(rows)`.
- Collapsed row: left column (label「当前参考市价」, display price, `trendChangeCopy` colored with `colors.green` when `change > 0`, `colors.danger` when `change < 0`, else secondary); right column `Pressable` sparkline (~56–64px tall, ~96–112px wide) that sets `expanded` true. Empty rows: show「暂无行情」in the right slot; do not expand usefully (still allow press → expanded empty chart ok).
- Expanded: hide/omit sparkline; keep left summary; show range pills; large chart (~120px) using the same absolute View line/dot technique as the old `MarketTrendCard`; bottom centered `Pressable` with `SymbolView` `chevron.up` that sets `expanded` false; `hitSlop` ≥ 8.
- If `insight.run?.status === 'failed'`, show `jobCopy(insight.run)` under the change line in `colors.danger`.
- Single-point rows: draw one dot; change copy already covers「行情积累中」when stats null — for one point `trendStats` still returns change 0; keep existing `trendStats` behavior. If only one point after filter, show copy from helper (0 change) or optionally treat `rows.length < 2` as「行情积累中」in the component when calling the helper — prefer: when `rows.length < 2`, display「行情积累中」instead of calling copy with zero delta.

Extract a small inner `TrendPolyline` for sparkline + large chart to avoid duplicating plot math.

- [ ] **Step 2: Smoke-check TypeScript / imports**

Ensure SymbolView import matches wishlist (`expo-symbols`), colors/spacing/radius/typography from `@/constants/colors`, `formatCurrency` for the big price.

- [ ] **Step 3: Commit**

```bash
git add mobile/src/components/market-valuation-card.tsx
git commit -m "feat: add expandable market valuation card"
```

---

### Task 3: Wire detail page and remove old UI

**Files:**
- Modify: `mobile/src/app/asset/[id].tsx`
- Delete: `mobile/src/components/market-snapshot-card.tsx`
- Delete: `mobile/src/components/market-trend-card.tsx`

**Interfaces:**
- Consumes: `MarketValuationCard`
- Produces: detail page with single valuation card; no history list

- [ ] **Step 1: Update asset detail**

In `mobile/src/app/asset/[id].tsx`:

- Remove `getValuations` import and `historyQuery`.
- Remove `formatDate` if only used by history (keep if still used in details).
- Replace:

```tsx
<MarketSnapshotCard insight={insightQuery.data} />
<MarketTrendCard snapshots={insightQuery.data.snapshots} />
```

with:

```tsx
<MarketValuationCard insight={insightQuery.data} />
```

- Delete the entire「价格历史」`View` block at the bottom.

- [ ] **Step 2: Delete obsolete components**

Delete `market-snapshot-card.tsx` and `market-trend-card.tsx`. Grep to confirm no remaining imports.

- [ ] **Step 3: Run market-trend tests**

Run: `cd mobile && node --experimental-strip-types --test tests/market-trend.test.mjs`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add mobile/src/app/asset/[id].tsx
git add -u mobile/src/components/market-snapshot-card.tsx mobile/src/components/market-trend-card.tsx
git commit -m "feat: use expandable valuation card on asset detail"
```

---

## Spec coverage

| Spec item | Task |
| --- | --- |
| Collapsed left price + change, right sparkline | 2 |
| Expand via sparkline only | 2 |
| Collapse via upward chevron only | 2 |
| Range pills + large chart when expanded | 2 |
| Drop redundant copy / failed-only tip | 2 |
| Replace old cards; remove price history | 3 |
| Reuse market-trend helpers; no new deps | 1–2 |
| `trendChangeCopy` testable | 1 |
