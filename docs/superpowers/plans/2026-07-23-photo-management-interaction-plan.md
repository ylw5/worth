# Photo Management Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the photo-source buttons with one add-photo empty state, add drag sorting, and replace the reanalysis switch with an explicit button.

**Architecture:** Keep `expo-image-picker` as the camera and gallery implementation. Add `react-native-sortables` only for ordering the existing `AssetPhoto[]`; the first array entry remains the cover. Keep reanalysis as an optional edit-screen action and leave save plus automatic valuation unchanged.

**Tech Stack:** Expo SDK 57, React Native 0.86, Expo Image Picker, React Native Sortables, React Native Gesture Handler, Reanimated 4.

## Global Constraints

- Android and iOS only.
- Every asset retains 1–5 photos.
- The first photo is the cover.
- “重新解析照片” never runs automatically.
- “保存并重新估价” always saves the current form and photo order.
- Do not add crop, filters, annotations, or a full image-editor SDK.

---

### Task 1: Add-photo empty state and drag sorting

**Files:**
- Modify: `mobile/package.json`
- Modify: `mobile/package-lock.json`
- Modify: `mobile/src/app/_layout.tsx`
- Modify: `mobile/src/components/asset-photo-picker.tsx`
- Test: `mobile/tests/photos.test.mjs`

**Interfaces:**
- Consumes: `AssetPhoto`, `maxAssetPhotos`, and `setCover(photos, index)` from `mobile/src/lib/photos.ts`.
- Produces: the existing `AssetPhotoPicker({ photos, onChange, onError })` interface; `onChange` receives the final ordered array after drag, cover selection, addition, or deletion.

- [ ] **Step 1: Verify the existing photo-order test**

Run:

```bash
cd mobile
node --experimental-strip-types --test tests/photos.test.mjs
```

Expected: one passing `setCover` test.

- [ ] **Step 2: Install the maintained drag-list package**

Run:

```bash
cd mobile
npm install react-native-sortables@1.9.4
```

Expected: `package.json` and `package-lock.json` include `react-native-sortables`.

- [ ] **Step 3: Add the gesture-handler root required by the package**

In `mobile/src/app/_layout.tsx`, import:

```tsx
import { GestureHandlerRootView } from 'react-native-gesture-handler';
```

Wrap the existing provider tree without changing its contents:

```tsx
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SessionProvider>
        <QueryClientProvider client={queryClient}>
          <DraftProvider>
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                contentStyle: { backgroundColor: colors.background },
                headerShadowVisible: false,
                headerBackButtonDisplayMode: 'minimal',
              }}>
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen
                name="confirm"
                options={{ title: '确认资产信息', presentation: 'modal' }}
              />
              <Stack.Screen name="asset/[id]" options={{ title: '资产详情' }} />
              <Stack.Screen
                name="asset/[id]/edit"
                options={{ title: '编辑物品' }}
              />
            </Stack>
          </DraftProvider>
        </QueryClientProvider>
      </SessionProvider>
    </GestureHandlerRootView>
  );
}
```

- [ ] **Step 4: Replace the two source buttons with one system chooser**

In `mobile/src/components/asset-photo-picker.tsx`, remove `AddButton`, import `Alert`, and add this function after `pickPhotos`:

```tsx
const chooseSource = () => {
  Alert.alert('添加照片', '请选择照片来源', [
    { text: '拍照', onPress: () => void takePhoto() },
    { text: '从相册选择', onPress: () => void pickPhotos() },
    { text: '取消', style: 'cancel' },
  ]);
};
```

This keeps camera and gallery permission/error handling in their existing functions.

- [ ] **Step 5: Render photos with the open-source draggable list**

Import the package in `mobile/src/components/asset-photo-picker.tsx`:

```tsx
import Sortable from 'react-native-sortables';
```

Replace the wrapped photo grid and old source buttons with:

```tsx
<ScrollView
  horizontal
  showsHorizontalScrollIndicator={false}
  contentContainerStyle={{ flexDirection: 'row', gap: 10 }}>
  <Sortable.Grid
    data={photos}
    rows={1}
    rowHeight={140}
    columnGap={10}
    activeItemScale={1.04}
    keyExtractor={(photo) => photo.id}
    onDragEnd={({ data }) => onChange(data)}
    renderItem={({ item: photo, index }) => (
      // Render the existing photo card. Tapping sets the cover; long-pressing
      // and dragging changes the order.
    )}
  />
  {photos.length < maxAssetPhotos ? (
    // Render the dashed add-photo tile and call chooseSource when pressed.
  ) : null}
</ScrollView>
```

- [ ] **Step 6: Run focused checks**

Run:

```bash
cd mobile
node --experimental-strip-types --test tests/photos.test.mjs
npx tsc --noEmit
npm run lint
```

Expected: all commands exit successfully.

- [ ] **Step 7: Commit the photo-manager integration**

```bash
git add mobile/package.json mobile/package-lock.json mobile/src/app/_layout.tsx mobile/src/components/asset-photo-picker.tsx
git commit -m "feat(mobile): add draggable photo manager"
```

---

### Task 2: Replace the reanalysis switch with a button

**Files:**
- Modify: `mobile/src/app/asset/[id]/edit.tsx`
- Test: `mobile/tests/photos.test.mjs`

**Interfaces:**
- Consumes: existing `previewRecognition()` and `save()` functions in the edit screen.
- Produces: independent “重新解析照片” and “保存并重新估价” actions with shared mutual exclusion through `pendingAction`.

- [ ] **Step 1: Remove switch state and distinguish pending actions**

Remove `Switch` from the React Native import and replace:

```tsx
const [reanalyze, setReanalyze] = useState(true);
const [loading, setLoading] = useState(false);
```

with:

```tsx
const [pendingAction, setPendingAction] = useState<
  'reanalyze' | 'save' | null
>(null);
const loading = pendingAction !== null;
```

In `previewRecognition`, replace `setLoading(true)` and `setLoading(false)` with:

```tsx
setPendingAction('reanalyze');
```

and:

```tsx
setPendingAction(null);
```

In `save`, replace `setLoading(true)` with:

```tsx
setPendingAction('save');
```

Replace both save-path `setLoading(false)` calls with:

```tsx
setPendingAction(null);
```

- [ ] **Step 2: Replace the switch row with the explicit reanalysis button**

Replace the `photosChanged` switch block with:

```tsx
{photosChanged ? (
  <Pressable
    accessibilityRole="button"
    disabled={loading}
    onPress={previewRecognition}
    style={({ pressed }) => ({
      alignItems: 'center',
      padding: 14,
      borderRadius: 14,
      borderCurve: 'continuous',
      borderWidth: 1,
      borderColor: colors.green,
      opacity: pressed || loading ? 0.65 : 1,
    })}>
    {pendingAction === 'reanalyze' ? (
      <ActivityIndicator color={colors.green} />
    ) : (
      <Text style={{ color: colors.green, fontWeight: '700' }}>
        重新解析照片
      </Text>
    )}
  </Pressable>
) : null}
```

Keep the existing success message so users know the parsed fields are ready to review.

- [ ] **Step 3: Make the primary button save unconditionally**

Set the primary button handler to:

```tsx
onPress={save}
```

Render its activity state and label as:

```tsx
{pendingAction === 'save' ? (
  <ActivityIndicator color="white" />
) : (
  <Text style={{ color: 'white', fontSize: 17, fontWeight: '700' }}>
    保存并重新估价
  </Text>
)}
```

- [ ] **Step 4: Run static and bundle checks**

Run:

```bash
cd mobile
node --experimental-strip-types --test tests/*.test.mjs
npx tsc --noEmit
npm run lint
npx expo export --platform android --output-dir /tmp/worth-photo-manager-android
npx expo export --platform ios --output-dir /tmp/worth-photo-manager-ios
```

Expected: two Node tests pass; TypeScript, lint, Android export, and iOS export all exit successfully.

- [ ] **Step 5: Verify Android behavior in Expo Go**

Run:

```bash
cd mobile
npm start -- --clear
```

Verify:

1. Edit an asset and tap the dashed “添加照片” card.
2. Confirm the source chooser offers camera, gallery, and cancel.
3. Add a photo, long-press it, and drag it before the current cover.
4. Confirm the first photo receives the cover label.
5. Confirm “重新解析照片” appears and runs only when tapped.
6. Confirm “保存并重新估价” can be tapped without first reanalyzing.
7. Confirm the saved detail and asset list use the new first photo as cover.

- [ ] **Step 6: Commit the reanalysis interaction**

```bash
git add 'mobile/src/app/asset/[id]/edit.tsx'
git commit -m "feat(mobile): make photo reanalysis explicit"
```
