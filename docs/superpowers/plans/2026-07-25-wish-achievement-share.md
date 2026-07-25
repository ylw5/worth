# Wish Achievement Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After fulfilling a wish, show a full-screen achievement page with wish info and animated confetti; let the user save the card to the photo library and reopen it from fulfilled cards.

**Architecture:** Add an achievement route that loads a fulfilled wishlist item, renders a capturable `WishAchievementCard` (ring + copy + facts), overlays Reanimated confetti outside the capture freeze, and saves via `react-native-view-shot` + `expo-media-library`. Fulfill success `replace`s into this route; fulfilled cards `push` the same route.

**Tech Stack:** Expo SDK 57, Expo Router, React Native, Reanimated, `react-native-view-shot`, `expo-media-library`, TanStack Query, TypeScript

## Global Constraints

- Keep Expo SDK at `57.0.8`, React Native at `0.86.0`, and React at `19.2.3`.
- Install deps with `npx expo install react-native-view-shot expo-media-library` only.
- Achievement card shows only name, actual price, and fulfilled date — no funding breakdown.
- Save to album only; no system share sheet or social icons.
- Confetti animates on screen; capture uses a static frame (hide animated confetti while capturing).
- Reuse `getWishlistItem`, `formatCurrency`, `formatDate`, and existing color/spacing tokens.
- Do not add database migrations or server APIs.

## File Map

- Create `mobile/src/components/wish-achievement-card.tsx`: capturable achievement content.
- Create `mobile/src/components/wish-achievement-confetti.tsx`: Reanimated confetti overlay.
- Create `mobile/src/lib/wish-achievement-save.ts`: permission + capture + save helper.
- Create `mobile/src/app/(tabs)/(wishlist)/achievement/[id].tsx`: achievement screen.
- Modify `mobile/app.json`: `expo-media-library` plugin + photo save permission copy.
- Modify `mobile/src/app/(tabs)/(wishlist)/fulfill/[id].tsx`: `replace` to achievement on success.
- Modify `mobile/src/components/fulfilled-wishlist-card.tsx`: “分享成就” entry.
- Create `mobile/tests/wish-achievement-save.test.mjs`: pure helper / error-message coverage where extractable.

---

### Task 1: Install deps and media-library plugin

**Files:**
- Modify: `mobile/package.json` (via expo install)
- Modify: `mobile/app.json`

**Interfaces:**
- Produces: `react-native-view-shot` and `expo-media-library` available to the app; iOS/Android photo write permission strings configured.

- [ ] **Step 1: Install packages**

```bash
cd mobile && npx expo install react-native-view-shot expo-media-library
```

Expected: both packages added at Expo SDK 57-compatible versions.

- [ ] **Step 2: Configure the media-library plugin**

In `mobile/app.json` `plugins` array, add after `expo-image-picker`:

```json
[
  "expo-media-library",
  {
    "photosPermission": "允许 Worth 将心愿成就图保存到相册",
    "savePhotosPermission": "允许 Worth 将心愿成就图保存到相册",
    "isAccessMediaLocationEnabled": false
  }
]
```

- [ ] **Step 3: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/app.json
git commit -m "$(cat <<'EOF'
chore: add view-shot and media-library for achievements

EOF
)"
```

---

### Task 2: Achievement card + confetti + save helper

**Files:**
- Create: `mobile/src/components/wish-achievement-card.tsx`
- Create: `mobile/src/components/wish-achievement-confetti.tsx`
- Create: `mobile/src/lib/wish-achievement-save.ts`
- Create: `mobile/tests/wish-achievement-save.test.mjs`

**Interfaces:**
- Consumes: `colors`, `spacing`, `radius`, `typography`, `formatCurrency`, `formatDate`.
- Produces:
  - `WishAchievementCard({ name, actualPrice, fulfilledAt, showConfetti?: boolean })`
  - `WishAchievementConfetti({ active: boolean })`
  - `saveWishAchievementImage(uri: string): Promise<void>`
  - `requestWishAchievementSavePermission(): Promise<'granted' | 'denied'>`
  - `wishAchievementSaveErrorMessage(error: unknown): string`

- [ ] **Step 1: Add save helper with Chinese error messages**

Create `mobile/src/lib/wish-achievement-save.ts`:

```ts
import * as MediaLibrary from 'expo-media-library';

export async function requestWishAchievementSavePermission(): Promise<
  'granted' | 'denied'
> {
  const current = await MediaLibrary.getPermissionsAsync();
  if (current.granted) return 'granted';
  const requested = await MediaLibrary.requestPermissionsAsync();
  return requested.granted ? 'granted' : 'denied';
}

export async function saveWishAchievementImage(uri: string): Promise<void> {
  await MediaLibrary.saveToLibraryAsync(uri);
}

export function wishAchievementSaveErrorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string' &&
    (error as { message: string }).message.includes('permission')
  ) {
    return '需要相册权限才能保存，请在设置中开启';
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return '保存失败，请重试';
}
```

- [ ] **Step 2: Add a focused test for error messages**

Create `mobile/tests/wish-achievement-save.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { wishAchievementSaveErrorMessage } from '../src/lib/wish-achievement-save.ts';

test('maps permission and unknown save errors', () => {
  assert.equal(
    wishAchievementSaveErrorMessage(new Error('Missing permission')),
    '需要相册权限才能保存，请在设置中开启',
  );
  assert.equal(
    wishAchievementSaveErrorMessage(new Error('disk full')),
    'disk full',
  );
  assert.equal(
    wishAchievementSaveErrorMessage(null),
    '保存失败，请重试',
  );
});
```

Run:

```bash
cd mobile && node --test tests/wish-achievement-save.test.mjs
```

Expected: PASS (helper exists). If import of `expo-media-library` fails in Node, keep permission/save functions in the same file but ensure the test only imports `wishAchievementSaveErrorMessage` — if needed, split the pure message helper into the same file and the test still passes because unused MediaLibrary imports are side-effect free enough; if Node fails on native module resolution, move `wishAchievementSaveErrorMessage` to `wish-achievement-save-messages.ts` and import from both.

Preferred split if Node cannot load `expo-media-library`:

- `mobile/src/lib/wish-achievement-save-messages.ts` — pure `wishAchievementSaveErrorMessage`
- `mobile/src/lib/wish-achievement-save.ts` — permission + save, imports the message helper for re-export if useful
- Test imports the messages file only

- [ ] **Step 3: Build `WishAchievementCard`**

Create `mobile/src/components/wish-achievement-card.tsx` as a white, centered column:

- Outer `View` with padding, white background, enough vertical padding for a shareable card.
- Ring: 160×160 outer circle, 12px `accent` border, inner white fill; centered “100%” (`typography.display`); small check circle on the top of the ring (`accent` fill, white check via `SymbolView` or “✓” text).
- Wish name under the ring, centered, max 2 lines, `typography.sectionTitle`.
- Title “心愿达成！” and subtitle “恭喜实现心愿”.
- Fact rows with a leading “★” and label/value pairs:
  - 心愿名称 → `name`
  - 实际成交价 → `formatCurrency(actualPrice)`
  - 实现日期 → `formatDate(fulfilledAt)`
- No close button, no save button inside this component.

Props:

```ts
export function WishAchievementCard({
  name,
  actualPrice,
  fulfilledAt,
}: {
  name: string;
  actualPrice: number;
  fulfilledAt: string;
})
```

- [ ] **Step 4: Build animated confetti**

Create `mobile/src/components/wish-achievement-confetti.tsx`:

- Fixed set of ~12 pieces with predetermined `left`/`delay`/`color`/`size`/`rotation`.
- Colors from `colors.accent`, `colors.danger`, and soft greens/oranges as hex literals `#7BC67E`, `#F5A524` (only for confetti accents).
- When `active` is true, each piece uses Reanimated `useSharedValue` + `withDelay`/`withTiming` to fall from above the ring area and gently rotate; loop once or twice then settle — keep it light.
- When `active` is false, render `null` (used during capture).
- `pointerEvents="none"` on the overlay container.

- [ ] **Step 5: Commit**

```bash
git add \
  mobile/src/components/wish-achievement-card.tsx \
  mobile/src/components/wish-achievement-confetti.tsx \
  mobile/src/lib/wish-achievement-save.ts \
  mobile/src/lib/wish-achievement-save-messages.ts \
  mobile/tests/wish-achievement-save.test.mjs
git commit -m "$(cat <<'EOF'
feat: add wish achievement card and save helpers

EOF
)"
```

(Only add the messages file if the Node-split was needed.)

---

### Task 3: Achievement screen + navigation hooks

**Files:**
- Create: `mobile/src/app/(tabs)/(wishlist)/achievement/[id].tsx`
- Modify: `mobile/src/app/(tabs)/(wishlist)/fulfill/[id].tsx`
- Modify: `mobile/src/components/fulfilled-wishlist-card.tsx`

**Interfaces:**
- Consumes: `getWishlistItem`, card/confetti/save helpers, `captureRef` from `react-native-view-shot`.
- Produces: route `/(tabs)/(wishlist)/achievement/[id]` that loads, displays, saves, and closes.

- [ ] **Step 1: Create the achievement screen**

Create `mobile/src/app/(tabs)/(wishlist)/achievement/[id].tsx`:

```tsx
import { useMutation, useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { ErrorState, LoadingState } from '@/components/screen-state';
import { WishAchievementCard } from '@/components/wish-achievement-card';
import { WishAchievementConfetti } from '@/components/wish-achievement-confetti';
import { colors, spacing, typography } from '@/constants/colors';
import {
  requestWishAchievementSavePermission,
  saveWishAchievementImage,
  wishAchievementSaveErrorMessage,
} from '@/lib/wish-achievement-save';
import { getWishlistItem } from '@/lib/wishlist';

export default function WishAchievementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const cardRef = useRef<View>(null);
  const [capturing, setCapturing] = useState(false);

  const query = useQuery({
    queryKey: ['wishlist', id],
    queryFn: () => getWishlistItem(id),
    enabled: Boolean(id),
  });

  const item = query.data;
  const fulfilled =
    item &&
    item.actual_price !== null &&
    item.fulfilled_at !== null;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const permission = await requestWishAchievementSavePermission();
      if (permission === 'denied') {
        throw new Error('需要相册权限才能保存，请在设置中开启');
      }
      setCapturing(true);
      // Allow confetti to unmount before capture
      await new Promise((resolve) => setTimeout(resolve, 50));
      const uri = await captureRef(cardRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });
      await saveWishAchievementImage(uri);
    },
    onSuccess: () => {
      Alert.alert('已保存', '已保存到相册，可去微信等应用分享');
    },
    onError: (error) => {
      Alert.alert('保存失败', wishAchievementSaveErrorMessage(error));
    },
    onSettled: () => {
      setCapturing(false);
    },
  });

  const close = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)/(wishlist)');
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View
        style={{
          flex: 1,
          backgroundColor: colors.surface,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}>
        <View
          style={{
            paddingHorizontal: spacing.xl,
            paddingVertical: spacing.md,
          }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭"
            hitSlop={8}
            onPress={close}
            style={{
              width: 44,
              height: 44,
              alignItems: 'flex-start',
              justifyContent: 'center',
            }}>
            <Text
              style={{
                color: colors.textPrimary,
                fontSize: 28,
                fontWeight: '400',
                lineHeight: 32,
              }}>
              ×
            </Text>
          </Pressable>
        </View>

        {query.isLoading ? <LoadingState /> : null}
        {query.error ? <ErrorState message={query.error.message} /> : null}
        {!query.isLoading && !query.error && !fulfilled ? (
          <ErrorState message="该心愿尚未实现，无法展示成就" />
        ) : null}

        {fulfilled ? (
          <View
            style={{
              flex: 1,
              justifyContent: 'center',
              paddingHorizontal: spacing.xl,
            }}>
            <View style={{ position: 'relative' }}>
              {!capturing ? <WishAchievementConfetti active /> : null}
              <View ref={cardRef} collapsable={false}>
                <WishAchievementCard
                  name={item.name}
                  actualPrice={item.actual_price!}
                  fulfilledAt={item.fulfilled_at!}
                />
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="保存图片"
              disabled={saveMutation.isPending || capturing}
              onPress={() => saveMutation.mutate()}
              style={({ pressed }) => ({
                marginTop: spacing.xxxl,
                alignSelf: 'center',
                minWidth: 200,
                minHeight: 52,
                paddingHorizontal: spacing.xxxl,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 999,
                backgroundColor: colors.textPrimary,
                opacity:
                  pressed || saveMutation.isPending || capturing ? 0.65 : 1,
              })}>
              {saveMutation.isPending || capturing ? (
                <ActivityIndicator color={colors.onDark} />
              ) : (
                <Text
                  style={{
                    color: colors.onDark,
                    ...typography.cardTitle,
                    fontWeight: '700',
                  }}>
                  保存图片
                </Text>
              )}
            </Pressable>
          </View>
        ) : null}
      </View>
    </>
  );
}
```

Adjust imports if `wishAchievementSaveErrorMessage` lives in the messages file — re-export it from `wish-achievement-save.ts` so the screen import stays one path.

- [ ] **Step 2: Navigate from fulfill success**

In `mobile/src/app/(tabs)/(wishlist)/fulfill/[id].tsx`, change `onSuccess` from `router.back()` to:

```ts
onSuccess: async () => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['wishlist'] }),
    queryClient.invalidateQueries({
      queryKey: ['wishlist-funding-allocations'],
    }),
  ]);
  router.replace({
    pathname: '/(tabs)/(wishlist)/achievement/[id]',
    params: { id },
  });
},
```

- [ ] **Step 3: Add “分享成就” on fulfilled cards**

In `mobile/src/components/fulfilled-wishlist-card.tsx`:

1. Import `router` from `expo-router`.
2. Above the undo button, add:

```tsx
<Pressable
  accessibilityRole="button"
  accessibilityLabel={`分享成就${item.name}`}
  onPress={() =>
    router.push({
      pathname: '/(tabs)/(wishlist)/achievement/[id]',
      params: { id: item.id },
    })
  }
  style={({ pressed }) => ({
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    opacity: pressed ? 0.6 : 1,
  })}>
  <Text style={{ color: colors.accent, fontWeight: '700' }}>
    分享成就
  </Text>
</Pressable>
```

- [ ] **Step 4: Typecheck**

```bash
cd mobile && npx tsc --noEmit && node --test tests/wish-achievement-save.test.mjs
```

Expected: exit 0; save-message test passes.

- [ ] **Step 5: Commit**

```bash
git add \
  'mobile/src/app/(tabs)/(wishlist)/achievement/[id].tsx' \
  'mobile/src/app/(tabs)/(wishlist)/fulfill/[id].tsx' \
  mobile/src/components/fulfilled-wishlist-card.tsx
git commit -m "$(cat <<'EOF'
feat: open wish achievement share after fulfill

EOF
)"
```

---

### Task 4: Manual verification checklist

- [ ] Confirm fulfill → lands on achievement with correct name/price/date; confetti animates.
- [ ] Close → wishlist list (item under 已实现).
- [ ] 分享成就 → same page again.
- [ ] 保存图片 → album has PNG without close/save chrome; confetti not smeared.
- [ ] Deny photos permission → Chinese alert; stay on page.
- [ ] Open achievement for a non-fulfilled id (if reachable) → error, no save.

---

## Spec coverage

| Spec requirement | Task |
| --- | --- |
| Full-screen achievement after fulfill (`replace`) | Task 3 |
| Ring 100%, title, name/price/date | Task 2–3 |
| Animated confetti; static on capture | Task 2–3 |
| Save to album + Chinese prompts | Task 1–3 |
| Reopen from fulfilled card | Task 3 |
| No share sheet / funding details / server | All tasks (out of scope) |
