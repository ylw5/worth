# Dual View and Holding Cost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved “年化持有成本 / 今日行情” switch to the asset detail page and calculate transparent holding-cost metrics from purchase price, ownership duration, and the latest background market snapshot.

**Architecture:** Keep all arithmetic in one dependency-free TypeScript module and all remote reads in the existing asset query layer. The detail screen owns the selected tab, while focused components render either holding cost or the background market result; a small View-based chart avoids adding a chart dependency.

**Tech Stack:** Expo Router, React Native, TanStack Query, Expo SecureStore, TypeScript/JavaScript, Node built-in test runner.

## Global Constraints

- Require both purchase price and purchase date before showing holding-cost numbers.
- Calculate average daily loss as `(purchase price - current residual value) / max(owned days, 1)` and annualized change with `365.25` days.
- Show arithmetic and data timestamps; do not render subjective “换新建议”.
- This phase draws historical points only; it must not invent future residual values.
- The “今日行情” tab reads only background snapshots created in phase 1.
- Reuse installed Expo SecureStore and existing color/typography tokens; add no dependency.
- Use accessible buttons with selected state and a minimum 44-point touch target.
- Before editing `mobile/`, read the exact Expo v57 docs at `https://docs.expo.dev/versions/v57.0.0/`.

---

## File Map

- Create `mobile/src/lib/holding-cost.ts`: pure date and money calculations.
- Create `mobile/tests/holding-cost.test.mjs`: boundary check for dates and gains.
- Create `mobile/src/components/value-view-toggle.tsx`: accessible two-option control.
- Create `mobile/src/components/residual-history-chart.tsx`: dependency-free historical chart.
- Create `mobile/src/components/holding-cost-view.tsx`: metric copy and missing-input state.
- Create `mobile/src/components/value-insights.tsx`: owns selected view persistence.
- Modify `mobile/src/app/asset/[id].tsx`: replace the standalone market card with the combined module.

### Task 1: Lock the Holding-Cost Formula

**Files:**
- Create: `mobile/src/lib/holding-cost.ts`
- Create: `mobile/tests/holding-cost.test.mjs`

**Interfaces:**
- Produces: `holdingCost({ purchasePrice, currentValue, purchaseDate, now })` and `historicalPoints(purchasePrice, purchaseDate, snapshots)`.

- [ ] **Step 1: Write the failing check**

```js
// mobile/tests/holding-cost.test.mjs
import assert from 'node:assert/strict';
import { holdingCost, historicalPoints } from '../src/lib/holding-cost.ts';

const result = holdingCost({
  purchasePrice: 2000,
  currentValue: 1180,
  purchaseDate: '2026-01-01',
  now: new Date('2026-07-20T00:00:00Z'),
});
assert.deepEqual(result, {
  ownedDays: 200,
  totalLoss: 820,
  dailyLoss: 4.1,
  annualizedLoss: 1497.53,
});

assert.equal(
  holdingCost({
    purchasePrice: 1000,
    currentValue: 1200,
    purchaseDate: '2026-07-20',
    now: new Date('2026-07-20T12:00:00Z'),
  }).dailyLoss,
  -200,
);

assert.deepEqual(
  historicalPoints(2000, '2026-01-01', [
    { snapshot_date: '2026-07-20', estimated_price: 1180 },
    { snapshot_date: '2026-07-19', estimated_price: 1200 },
  ]),
  [
    { date: '2026-01-01', value: 2000, kind: 'purchase' },
    { date: '2026-07-19', value: 1200, kind: 'market' },
    { date: '2026-07-20', value: 1180, kind: 'market' },
  ],
);
console.log('holding cost checks passed');
```

- [ ] **Step 2: Run the check and observe the missing module**

Run: `cd mobile && node --test tests/holding-cost.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the minimum pure module**

```js
// mobile/src/lib/holding-cost.ts
const DAY_MS = 86_400_000;

function utcDay(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) throw new Error('无效日期');
  return date;
}

export function holdingCost({
  purchasePrice,
  currentValue,
  purchaseDate,
  now = new Date(),
}: {
  purchasePrice: number | null;
  currentValue: number | null;
  purchaseDate: string | null;
  now?: Date;
}) {
  if (purchasePrice == null || currentValue == null || !purchaseDate) return null;
  const ownedDays = Math.max(
    1,
    Math.floor(
      (utcDay(now.toISOString()).getTime() - utcDay(purchaseDate).getTime())
      / DAY_MS,
    ),
  );
  const totalLoss = purchasePrice - currentValue;
  return {
    ownedDays,
    totalLoss,
    dailyLoss: Math.round((totalLoss / ownedDays) * 100) / 100,
    annualizedLoss: Math.round((totalLoss / ownedDays) * 365.25 * 100) / 100,
  };
}

export function historicalPoints(
  purchasePrice: number | null,
  purchaseDate: string | null,
  snapshots: { snapshot_date: string; estimated_price: number }[],
): { date: string; value: number; kind: 'purchase' | 'market' }[] {
  if (purchasePrice == null || !purchaseDate) return [];
  return [
    { date: purchaseDate, value: purchasePrice, kind: 'purchase' },
    ...snapshots
      .map(({ snapshot_date, estimated_price }) => ({
        date: snapshot_date,
        value: estimated_price,
        kind: 'market',
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  ];
}
```

- [ ] **Step 4: Run the check**

Run: `cd mobile && node --test tests/holding-cost.test.mjs`

Expected: `holding cost checks passed`.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/holding-cost.ts mobile/tests/holding-cost.test.mjs
git commit -m "feat: calculate asset holding cost"
```

### Task 2: Build the Accessible Toggle and Historical Chart

**Files:**
- Create: `mobile/src/components/value-view-toggle.tsx`
- Create: `mobile/src/components/residual-history-chart.tsx`

**Interfaces:**
- Consumes: `value: 'holding' | 'market'`, `onChange`, and historical `{date,value,kind}` points.
- Produces: reusable visual controls with no data fetching.

- [ ] **Step 1: Implement the toggle**

```tsx
// mobile/src/components/value-view-toggle.tsx
import { Pressable, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '@/constants/colors';

type ValueView = 'holding' | 'market';

export function ValueViewToggle({
  value,
  onChange,
}: {
  value: ValueView;
  onChange: (value: ValueView) => void;
}) {
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        padding: spacing.xs,
        borderRadius: radius.large,
        backgroundColor: colors.background,
      }}>
      {([
        ['holding', '年化持有成本'],
        ['market', '今日行情'],
      ] as const).map(([key, label]) => (
        <Pressable
          key={key}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === key }}
          onPress={() => onChange(key)}
          style={{
            flex: 1,
            minHeight: 44,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.medium,
            backgroundColor: value === key ? colors.surface : 'transparent',
          }}>
          <Text style={{ ...typography.body, fontWeight: '700' }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
```

- [ ] **Step 2: Implement a native View-based chart**

```tsx
// mobile/src/components/residual-history-chart.tsx
import { Text, View } from 'react-native';
import { colors, spacing, typography } from '@/constants/colors';

type Point = { date: string; value: number; kind: 'purchase' | 'market' };

export function ResidualHistoryChart({ points }: { points: Point[] }) {
  if (points.length < 2) return null;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const span = Math.max(Math.max(...values) - min, 1);
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={{ ...typography.body, fontWeight: '700' }}>残值曲线</Text>
      <View
        accessibilityLabel={`残值从 ${points[0].value} 变化到 ${points.at(-1)?.value}`}
        style={{
          height: 150,
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: 2,
        }}>
        {points.map((point) => (
          <View
            key={`${point.date}-${point.kind}`}
            style={{
              flex: 1,
              minWidth: 3,
              height: 8 + ((point.value - min) / span) * 130,
              borderRadius: 3,
              backgroundColor:
                point.kind === 'purchase' ? colors.textTertiary : colors.accent,
            }}
          />
        ))}
      </View>
      <Text style={{ color: colors.textSecondary, ...typography.label }}>
        仅展示买入价与已采集历史，不包含未来预测
      </Text>
    </View>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `cd mobile && npx tsc --noEmit`

Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/components/value-view-toggle.tsx \
  mobile/src/components/residual-history-chart.tsx
git commit -m "feat: add valuation view controls"
```

### Task 3: Compose the Approved Detail Module

**Files:**
- Create: `mobile/src/components/holding-cost-view.tsx`
- Create: `mobile/src/components/value-insights.tsx`
- Modify: `mobile/src/app/asset/[id].tsx`

**Interfaces:**
- Consumes: `Asset`, `MarketInsight`, and the phase-1 `MarketSnapshotCard`.
- Produces: `<ValueInsights asset={asset} insight={insight} />`.

- [ ] **Step 1: Add the holding-cost view**

```tsx
// mobile/src/components/holding-cost-view.tsx
import { Text, View } from 'react-native';
import { colors, spacing, typography } from '@/constants/colors';
import { formatCurrency } from '@/lib/format';
import { historicalPoints, holdingCost } from '@/lib/holding-cost';
import type { Asset, MarketInsight } from '@/types/domain';
import { ResidualHistoryChart } from './residual-history-chart';

const amount = (value: number) =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 2,
  }).format(value);

export function HoldingCostView({
  asset,
  insight,
}: {
  asset: Asset;
  insight: MarketInsight;
}) {
  const latest = insight.snapshots[0]?.estimated_price ?? asset.latest_market_price;
  const result = holdingCost({
    purchasePrice: asset.purchase_price,
    currentValue: latest,
    purchaseDate: asset.purchase_date,
  });
  if (!result) {
    return (
      <Text style={{ color: colors.textSecondary, ...typography.body }}>
        补充买入日期和价格，并等待一次后台估值后即可计算。
      </Text>
    );
  }
  const points = historicalPoints(
    asset.purchase_price,
    asset.purchase_date,
    insight.snapshots,
  );
  return (
    <View style={{ gap: spacing.lg }}>
      <View>
        <Text style={{ color: colors.textSecondary, ...typography.label }}>
          {result.dailyLoss < 0 ? '平均每天增值' : '平均每天花掉'}
        </Text>
        <Text style={{ color: colors.textPrimary, ...typography.display }}>
          {amount(Math.abs(result.dailyLoss))}
        </Text>
        <Text style={{ color: colors.textSecondary, ...typography.body }}>
          已持有 {result.ownedDays} 天 · 累计变化 {formatCurrency(result.totalLoss)}
          {' · '}年化{result.annualizedLoss < 0 ? '增值' : '持有成本'}{' '}
          {formatCurrency(Math.abs(result.annualizedLoss))}
        </Text>
        {result.ownedDays < 30 ? (
          <Text style={{ color: colors.textSecondary, ...typography.label }}>
            持有不足 30 天，年化结果波动较大
          </Text>
        ) : null}
      </View>
      <ResidualHistoryChart points={points} />
    </View>
  );
}
```

- [ ] **Step 2: Persist the selected view and compose both tabs**

```tsx
// mobile/src/components/value-insights.tsx
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { colors, radius, spacing, typography } from '@/constants/colors';
import type { Asset, MarketInsight } from '@/types/domain';
import { HoldingCostView } from './holding-cost-view';
import { MarketSnapshotCard } from './market-snapshot-card';
import { ValueViewToggle } from './value-view-toggle';

const KEY = 'worth:value-view';
type ValueView = 'holding' | 'market';

export function ValueInsights({
  asset,
  insight,
}: {
  asset: Asset;
  insight: MarketInsight;
}) {
  const defaultView: ValueView =
    asset.purchase_date && asset.purchase_price ? 'holding' : 'market';
  const [view, setView] = useState<ValueView>(defaultView);
  useEffect(() => {
    SecureStore.getItemAsync(KEY).then((saved) => {
      if (saved === 'holding' || saved === 'market') setView(saved);
    });
  }, []);
  const select = (next: ValueView) => {
    setView(next);
    void SecureStore.setItemAsync(KEY, next);
  };
  return (
    <View
      style={{
        padding: spacing.lg,
        gap: spacing.xl,
        borderRadius: radius.large,
        backgroundColor: colors.surface,
      }}>
      <Text style={{ ...typography.sectionTitle }}>价值参考</Text>
      <ValueViewToggle value={view} onChange={select} />
      {view === 'holding' ? (
        <HoldingCostView asset={asset} insight={insight} />
      ) : (
        <MarketSnapshotCard insight={insight} />
      )}
    </View>
  );
}
```

- [ ] **Step 3: Replace the phase-1 standalone card**

In `mobile/src/app/asset/[id].tsx`, import `ValueInsights`, remove the direct `MarketSnapshotCard` import, and render:

```tsx
<ValueInsights
  asset={asset}
  insight={marketQuery.data ?? { snapshots: [], run: null }}
/>
```

Keep the basic-information and price-history sections unchanged.

- [ ] **Step 4: Run all mobile checks**

Run: `cd mobile && node --test tests/*.test.mjs && npm run lint && npx tsc --noEmit`

Expected: all Node checks pass, lint exits 0, and TypeScript exits 0.

- [ ] **Step 5: Manual verification**

Open one asset with complete purchase data and verify:

- “年化持有成本” is selected on first use.
- The amount matches `(purchase_price - latest_market_price) / owned_days`.
- Switching to “今日行情” shows the same background snapshot as phase 1.
- Relaunching the app restores the selected tab.
- An asset without purchase data shows the non-blocking completion prompt.
- VoiceOver/TalkBack announces each toggle as a selected or unselected tab.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/components/holding-cost-view.tsx \
  mobile/src/components/value-insights.tsx 'mobile/src/app/asset/[id].tsx'
git commit -m "feat: add dual valuation views"
```
