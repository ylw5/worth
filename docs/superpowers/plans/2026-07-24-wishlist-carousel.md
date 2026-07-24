# Wishlist Horizontal Carousel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the wishlist vertical card stack with a horizontal peeking carousel (centered active card, adjacent cards partially visible, page dots).

**Architecture:** Extract pure layout metrics (`cardWidth`, side padding, snap interval, active index from offset) into a tiny helper with a Node test. Rewire `WishlistScreen` to a horizontal snapping `FlatList` plus a dots row; keep queries, delete, and detail navigation unchanged.

**Tech Stack:** Expo SDK 57, React Native 0.86, Expo Router, TanStack Query, Node test runner, TypeScript

## Global Constraints

- Keep Expo SDK at `57.0.8`, React Native at `0.86.0`, and React at `19.2.3`; see [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/).
- Do not add dependencies, migrations, or data-layer changes.
- Card width ≈ 86% of screen width; side peek ≈ 8–12%; use `snapToInterval` and `decelerationRate="fast"`.
- Show page dots only when there are 2+ items.
- Empty, loading, and error states stay outside the carousel.
- Truncate long notes with `numberOfLines` so cards do not stretch unbounded.
- Preserve delete confirm/flow and detail route push.
- Restore the visible “查看今日卖出方案” label if it is currently commented out in local WIP.
- Do not touch evaluation/chat files.

## File Map

- Create `mobile/src/lib/wishlist-carousel.ts`: pure carousel metrics + index-from-offset.
- Create `mobile/tests/wishlist-carousel.test.mjs`: regression for metrics and index snapping.
- Modify `mobile/src/app/(tabs)/(wishlist)/index.tsx`: horizontal FlatList + dots.

---

### Task 1: Carousel layout helper

**Files:**
- Create: `mobile/src/lib/wishlist-carousel.ts`
- Create: `mobile/tests/wishlist-carousel.test.mjs`

**Interfaces:**
- Consumes: nothing (pure math).
- Produces:
  - `getWishlistCarouselMetrics(screenWidth: number, options?: { cardWidthRatio?: number; gap?: number }): { cardWidth: number; gap: number; sidePadding: number; snapInterval: number }`
  - `getWishlistCarouselIndex(offsetX: number, snapInterval: number, itemCount: number): number`

- [ ] **Step 1: Write the failing helper test**

Create `mobile/tests/wishlist-carousel.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getWishlistCarouselIndex,
  getWishlistCarouselMetrics,
} from '../src/lib/wishlist-carousel.ts';

test('derives card width, side padding, and snap interval for peeking carousel', () => {
  const metrics = getWishlistCarouselMetrics(390, {
    cardWidthRatio: 0.86,
    gap: 12,
  });
  assert.equal(metrics.cardWidth, 335.4);
  assert.equal(metrics.gap, 12);
  assert.equal(metrics.sidePadding, 27.3);
  assert.equal(metrics.snapInterval, 347.4);
});

test('maps scroll offset to a clamped carousel index', () => {
  assert.equal(getWishlistCarouselIndex(0, 347.4, 3), 0);
  assert.equal(getWishlistCarouselIndex(347.4, 347.4, 3), 1);
  assert.equal(getWishlistCarouselIndex(694.8, 347.4, 3), 2);
  assert.equal(getWishlistCarouselIndex(1000, 347.4, 3), 2);
  assert.equal(getWishlistCarouselIndex(-10, 347.4, 3), 0);
  assert.equal(getWishlistCarouselIndex(0, 347.4, 0), 0);
});
```

- [ ] **Step 2: Run the test and verify the helper is missing**

Run:

```bash
cd mobile && node --test tests/wishlist-carousel.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/lib/wishlist-carousel.ts`.

- [ ] **Step 3: Add the minimum helper**

Create `mobile/src/lib/wishlist-carousel.ts`:

```ts
const DEFAULT_CARD_WIDTH_RATIO = 0.86;
const DEFAULT_GAP = 12;

export const getWishlistCarouselMetrics = (
  screenWidth: number,
  options?: { cardWidthRatio?: number; gap?: number },
) => {
  const cardWidthRatio = options?.cardWidthRatio ?? DEFAULT_CARD_WIDTH_RATIO;
  const gap = options?.gap ?? DEFAULT_GAP;
  const cardWidth = screenWidth * cardWidthRatio;
  const sidePadding = (screenWidth - cardWidth) / 2;
  return {
    cardWidth,
    gap,
    sidePadding,
    snapInterval: cardWidth + gap,
  };
};

export const getWishlistCarouselIndex = (
  offsetX: number,
  snapInterval: number,
  itemCount: number,
) => {
  if (itemCount <= 0 || snapInterval <= 0) return 0;
  const raw = Math.round(offsetX / snapInterval);
  return Math.min(Math.max(raw, 0), itemCount - 1);
};
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
cd mobile && node --test tests/wishlist-carousel.test.mjs
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/wishlist-carousel.ts mobile/tests/wishlist-carousel.test.mjs
git commit -m "$(cat <<'EOF'
feat: add wishlist carousel layout helper

EOF
)"
```

---

### Task 2: Wire horizontal carousel UI on wishlist screen

**Files:**
- Modify: `mobile/src/app/(tabs)/(wishlist)/index.tsx`

**Interfaces:**
- Consumes: `getWishlistCarouselMetrics`, `getWishlistCarouselIndex` from `@/lib/wishlist-carousel`; existing wishlist/savings queries; `formatCurrency`; `getWishlistProgress`; design tokens.
- Produces: wishlist home renders a horizontal peeking carousel with optional page dots.

- [ ] **Step 1: Replace vertical list with horizontal FlatList + dots**

In `mobile/src/app/(tabs)/(wishlist)/index.tsx`:

1. Update imports:

```ts
import { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  getWishlistCarouselIndex,
  getWishlistCarouselMetrics,
} from '@/lib/wishlist-carousel';
```

Keep existing `Link`, `router`, `Stack`, `useFocusEffect`, query, delete, progress, and design-token imports. Remove `ScrollView` if unused.

2. Inside `WishlistScreen`, after savings state, add:

```ts
const { width: screenWidth } = useWindowDimensions();
const { cardWidth, gap, sidePadding, snapInterval } =
  getWishlistCarouselMetrics(screenWidth, { gap: spacing.md });
const items = query.data ?? [];
const [activeIndex, setActiveIndex] = useState(0);

const onCarouselScrollEnd = useCallback(
  (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setActiveIndex(
      getWishlistCarouselIndex(
        event.nativeEvent.contentOffset.x,
        snapInterval,
        items.length,
      ),
    );
  },
  [items.length, snapInterval],
);
```

3. Replace the outer `ScrollView` body with a `View` that:
   - Uses `flex: 1` and `backgroundColor: colors.background`.
   - Keeps loading / query errors / savings errors / `deleteError` at the top with horizontal padding `spacing.xl`.
   - When `!query.isLoading && !query.error && !savingsQuery.isLoading && !savingsQuery.error && items.length === 0`, render the existing empty-state card (same copy and Link), padded with `spacing.xl`.
   - When items are ready (`!savingsQuery.isLoading && !savingsQuery.error && items.length > 0`), render:

```tsx
<View style={{ flexGrow: 0, paddingTop: spacing.xl, gap: spacing.lg }}>
  <FlatList
    horizontal
    data={items}
    keyExtractor={(item) => item.id}
    showsHorizontalScrollIndicator={false}
    decelerationRate="fast"
    snapToInterval={snapInterval}
    snapToAlignment="start"
    disableIntervalMomentum
    contentContainerStyle={{
      paddingHorizontal: sidePadding,
    }}
    onMomentumScrollEnd={onCarouselScrollEnd}
    renderItem={({ item, index }) => {
      const progress = getWishlistProgress(savedAmount, item.target_price);
      return (
        <View
          style={{
            width: cardWidth,
            marginRight: index === items.length - 1 ? 0 : gap,
            padding: spacing.lg,
            gap: spacing.md,
            backgroundColor: colors.surface,
            borderRadius: radius.large,
            borderCurve: 'continuous',
          }}>
          {/* existing card header: name + delete */}
          {/* existing amount + progress bar */}
          {item.notes ? (
            <Text
              selectable
              numberOfLines={3}
              style={{
                color: colors.textSecondary,
                ...typography.body,
              }}>
              {item.notes}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`查看${item.name}今日卖出方案`}
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
    }}
  />
  {items.length > 1 ? (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingBottom: spacing.xl,
      }}>
      {items.map((item, index) => (
        <View
          key={item.id}
          accessibilityLabel={
            index === activeIndex
              ? `第${index + 1}张，当前`
              : `第${index + 1}张`
          }
          style={{
            width: 8,
            height: 8,
            borderRadius: radius.pill,
            backgroundColor:
              index === activeIndex ? colors.accent : colors.border,
          }}
        />
      ))}
    </View>
  ) : null}
</View>
```

Reuse the existing name/delete row, amount text, and progress bar JSX inside `renderItem` (same styles and a11y props as today). Do not leave the detail CTA commented out.

4. Clamp `activeIndex` when the list shrinks after delete: if `activeIndex >= items.length && items.length > 0`, set it to `items.length - 1` (small `useEffect` is fine).

- [ ] **Step 2: Typecheck the mobile app**

Run:

```bash
cd mobile && npx tsc --noEmit
```

Expected: exit 0 with no errors in the touched files.

- [ ] **Step 3: Manual verification checklist**

On iOS simulator or device:

1. Multiple wishlist items: swipe left/right; active card centered; neighbors peek; dots match index.
2. Single item: one centered card, no dots.
3. Empty list: “还没有心愿” + add link.
4. Delete still confirms and removes; carousel updates.
5. “查看今日卖出方案” still navigates to `/(tabs)/(wishlist)/[id]`.
6. Long notes truncate to 3 lines.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/app/\(tabs\)/\(wishlist\)/index.tsx
git commit -m "$(cat <<'EOF'
feat: swipe between wishlist cards horizontally

EOF
)"
```

---

## Spec coverage

| Spec requirement | Task |
| --- | --- |
| Horizontal FlatList peeking carousel (~86% width) | Task 1 metrics + Task 2 FlatList |
| snap + fast deceleration | Task 2 |
| Side padding centers first/last | Task 1 `sidePadding` + Task 2 |
| Dots when 2+ items | Task 2 |
| Empty/loading/error outside carousel | Task 2 |
| Truncate long notes | Task 2 `numberOfLines={3}` |
| Delete + detail unchanged | Task 2 |
| No new deps / no data-layer changes | Global + both tasks |
