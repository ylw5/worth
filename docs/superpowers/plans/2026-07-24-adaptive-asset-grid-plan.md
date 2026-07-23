# Adaptive Asset Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-column asset list with a responsive grid that renders two columns on phones, three on tablets, and four on wider screens.

**Architecture:** Keep the existing screen-level `ScrollView` and data flow. Add one pure width-to-column helper, use `useWindowDimensions()` to calculate each card width, and change the existing asset card to a vertical layout.

**Tech Stack:** Expo 57, React Native 0.86, Expo Router, TypeScript, Node test runner

## Global Constraints

- Fewer than 700 points uses 2 columns.
- 700–999 points uses 3 columns.
- 1000 points or wider uses 4 columns.
- Keep a 12-point gap between cards.
- Preserve loading, errors, empty state, data fetching, and navigation.
- Add no dependencies or unrelated refactors.

---

### Task 1: Responsive asset grid

**Files:**
- Create: `mobile/src/lib/asset-grid.ts`
- Create: `mobile/tests/asset-grid.test.mjs`
- Modify: `mobile/src/app/(tabs)/(assets)/index.tsx`
- Modify: `mobile/src/components/asset-card.tsx`

**Interfaces:**
- Produces: `getAssetGridColumns(width: number): 2 | 3 | 4`.
- Consumes: the existing `Asset`, `AssetCard`, asset query, and detail route.

- [ ] **Step 1: Write the failing breakpoint test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { getAssetGridColumns } from '../src/lib/asset-grid.ts';

test('chooses asset grid columns from the viewport width', () => {
  assert.equal(getAssetGridColumns(699), 2);
  assert.equal(getAssetGridColumns(700), 3);
  assert.equal(getAssetGridColumns(999), 3);
  assert.equal(getAssetGridColumns(1000), 4);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd mobile && node --test tests/asset-grid.test.mjs`

Expected: FAIL because `src/lib/asset-grid.ts` does not exist.

- [ ] **Step 3: Add the minimal breakpoint helper**

```ts
export function getAssetGridColumns(width: number): 2 | 3 | 4 {
  if (width >= 1000) return 4;
  if (width >= 700) return 3;
  return 2;
}
```

- [ ] **Step 4: Run the breakpoint test**

Run: `cd mobile && node --test tests/asset-grid.test.mjs`

Expected: PASS with one passing test.

- [ ] **Step 5: Make the asset list wrap into responsive columns**

In `mobile/src/app/(tabs)/(assets)/index.tsx`, extend the React Native import
and add the grid helper import:

```tsx
import {
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { getAssetGridColumns } from '@/lib/asset-grid';
```

Add the constants above `AssetsScreen` and calculate the card width at the
start of the component:

```tsx
const gridGap = 12;
const pagePadding = 20;

export default function AssetsScreen() {
  const { width } = useWindowDimensions();
  const columns = getAssetGridColumns(width);
  const cardWidth =
    (width - pagePadding * 2 - gridGap * (columns - 1)) / columns;
```

Replace only the existing `assets.map` block with:

```tsx
<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: gridGap }}>
  {assets.map((asset) => (
    <View key={asset.id} style={{ width: cardWidth }}>
      <AssetCard asset={asset} />
    </View>
  ))}
</View>
```

Keep the existing empty state outside the wrapping grid so it remains full
width.

- [ ] **Step 6: Change the existing card to a vertical layout**

In `mobile/src/components/asset-card.tsx`, keep the existing `Link`,
accessibility role, pressed opacity, colors, and route. Change the
`Pressable` and image styles to:

```tsx
style={({ pressed }) => ({
  gap: 8,
  padding: 10,
  borderRadius: 18,
  borderCurve: 'continuous',
  backgroundColor: colors.card,
  borderWidth: 1,
  borderColor: colors.border,
  opacity: pressed ? 0.7 : 1,
})}
```

```tsx
<Image
  source={asset.photo_urls?.[0]}
  contentFit="cover"
  style={{ width: '100%', aspectRatio: 1, borderRadius: 14 }}
/>
```

The complete component becomes:

```tsx
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { colors } from '@/constants/colors';
import { formatCurrency } from '@/lib/format';
import type { Asset } from '@/types/domain';

export function AssetCard({ asset }: { asset: Asset }) {
  return (
    <Link href={{ pathname: '/asset/[id]', params: { id: asset.id } }} asChild>
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => ({
          gap: 8,
          padding: 10,
          borderRadius: 18,
          borderCurve: 'continuous',
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          opacity: pressed ? 0.7 : 1,
        })}>
        <Image
          source={asset.photo_urls?.[0]}
          contentFit="cover"
          style={{ width: '100%', aspectRatio: 1, borderRadius: 14 }}
        />
        <Text
          selectable
          numberOfLines={1}
          style={{ color: colors.text, fontWeight: '700' }}>
          {asset.name}
        </Text>
        <Text
          selectable
          numberOfLines={1}
          style={{
            alignSelf: 'flex-start',
            color: colors.green,
            backgroundColor: colors.greenSoft,
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 99,
            overflow: 'hidden',
            fontSize: 12,
          }}>
          {asset.category}
        </Text>
        <Text selectable style={{ color: colors.muted, fontSize: 13 }}>
          当前参考市价
        </Text>
        <Text
          selectable
          style={{
            color:
              asset.latest_market_price === null
                ? colors.muted
                : colors.green,
            fontSize: 18,
            fontWeight: '700',
            fontVariant: ['tabular-nums'],
          }}>
          {formatCurrency(asset.latest_market_price)}
        </Text>
      </Pressable>
    </Link>
  );
}
```

- [ ] **Step 7: Run focused static checks**

Run: `cd mobile && node --test tests/asset-grid.test.mjs && npx tsc --noEmit && npm run lint`

Expected: the test passes and TypeScript and ESLint report no new errors.

- [ ] **Step 8: Verify the rendered flow**

Run: `cd mobile && npx expo start --web --port 8081`

The flow under test is: `/` → open the assets tab → resize to phone, tablet,
and wide widths → see 2, 3, and 4 aligned asset columns → open one card → reach
its asset detail screen.

Confirm page identity, meaningful content, no framework overlay, no relevant
console errors, screenshots at the three widths, and successful card
navigation.

- [ ] **Step 9: Commit the implementation**

```bash
git add mobile/src/lib/asset-grid.ts mobile/tests/asset-grid.test.mjs \
  'mobile/src/app/(tabs)/(assets)/index.tsx' \
  mobile/src/components/asset-card.tsx
git commit -m "feat: show assets in responsive grid"
```
