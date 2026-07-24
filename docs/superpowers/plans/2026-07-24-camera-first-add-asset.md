# Camera-First Add Asset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open the system full-screen camera from the asset header plus button, return home on cancellation, and seed the existing add form with the first confirmed photo.

**Architecture:** Reuse the installed Expo ImagePicker and the existing photo-processing pipeline. Add one shared conversion helper for picker assets, then pass a route intent that makes the existing capture screen open the camera once.

**Tech Stack:** Expo SDK 57, Expo Router, React Native, TypeScript, `expo-image-picker`, Node test runner

## Global Constraints

- Reuse `expo-image-picker`; add no camera dependency.
- Accept only the first photo from the initial camera flow.
- Cancel, denied permission, or camera failure returns to “我的资产” without a draft.
- Keep all existing add-form photo and gallery behavior.
- Do not add global temporary state.

---

### Task 1: Share picker-asset conversion

**Files:**
- Modify: `mobile/src/lib/photos.ts`
- Modify: `mobile/src/components/asset-photo-picker.tsx`
- Test: `mobile/tests/photos.test.mjs`

**Interfaces:**
- Consumes: picker-like objects shaped as `{ uri: string; base64?: string | null }`.
- Produces: `pickerAssetsToPhotos(assets, limit, timestamp?) => AssetPhoto[]`.

- [ ] **Step 1: Write the failing conversion test**

Append to `mobile/tests/photos.test.mjs`:

```js
import {
  maxAssetPhotos,
  pickerAssetsToPhotos,
  setCover,
} from '../src/lib/photos.ts';

test('converts only readable picker assets up to the requested limit', () => {
  const assets = [
    { uri: 'first.jpg', base64: 'first' },
    { uri: 'missing.jpg', base64: null },
    { uri: 'third.jpg', base64: 'third' },
  ];

  assert.deepEqual(pickerAssetsToPhotos(assets, 2, 123), [
    {
      id: 'first.jpg-123-0',
      uri: 'first.jpg',
      base64: 'first',
    },
  ]);
});
```

Replace the existing `photos.ts` import with the import shown above; keep the
existing `node:assert/strict` and `node:test` imports.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
cd mobile
node --test tests/photos.test.mjs
```

Expected: FAIL because `pickerAssetsToPhotos` is not exported.

- [ ] **Step 3: Add the minimal shared helper**

Append to `mobile/src/lib/photos.ts`:

```ts
type PickerAsset = {
  uri: string;
  base64?: string | null;
};

export function pickerAssetsToPhotos(
  assets: PickerAsset[],
  limit: number,
  timestamp = Date.now(),
) {
  return assets.slice(0, limit).flatMap((asset, index) =>
    asset.base64
      ? [
          {
            id: `${asset.uri}-${timestamp}-${index}`,
            uri: asset.uri,
            base64: asset.base64,
          },
        ]
      : [],
  );
}
```

In `mobile/src/components/asset-photo-picker.tsx`, import `pickerAssetsToPhotos` from `@/lib/photos` and replace the inline `flatMap` conversion with:

```ts
const selected = assets.slice(0, remaining);
const next = pickerAssetsToPhotos(selected, remaining);
if (next.length !== selected.length) {
  onError('无法读取所选照片');
  return;
}
```

- [ ] **Step 4: Run the focused test and TypeScript**

Run:

```bash
cd mobile
node --test tests/photos.test.mjs
npx tsc --noEmit
```

Expected: the photo tests pass and TypeScript exits with code 0.

- [ ] **Step 5: Commit the shared conversion**

```bash
git add mobile/src/lib/photos.ts mobile/src/components/asset-photo-picker.tsx mobile/tests/photos.test.mjs
git commit -m "refactor: share picker photo conversion"
```

### Task 2: Open the initial camera from the header plus button

**Files:**
- Modify: `mobile/src/app/(tabs)/(assets)/index.tsx`
- Modify: `mobile/src/app/(tabs)/(capture)/index.tsx`

**Interfaces:**
- Consumes: `/capture?camera=1` and `pickerAssetsToPhotos`.
- Produces: one-shot initial camera behavior feeding `addPhotos(added: AssetPhoto[])`.

- [ ] **Step 1: Route the header plus button with camera intent**

Change only the header-right link in `mobile/src/app/(tabs)/(assets)/index.tsx`:

```tsx
<Link href={{ pathname: '/capture', params: { camera: '1' } }} asChild>
```

Leave the empty-state `/capture` link unchanged.

- [ ] **Step 2: Add the one-shot initial camera effect**

In `mobile/src/app/(tabs)/(capture)/index.tsx`:

```ts
import * as ImagePicker from 'expo-image-picker';
import {
  router,
  Stack,
  useLocalSearchParams,
  useNavigation,
} from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
} from 'react-native';
import {
  pickerAssetsToPhotos,
  type AssetPhoto,
} from '@/lib/photos';
```

Inside `CaptureScreen`, add:

```ts
const { camera } = useLocalSearchParams<{ camera?: string }>();
const openedInitialCamera = useRef(false);
```

After `addPhotos`, add:

```ts
useEffect(() => {
  if (camera !== '1' || openedInitialCamera.current || !session) return;
  openedInitialCamera.current = true;

  const returnHome = () => router.replace('/(tabs)/(assets)');
  const fail = (message: string) =>
    Alert.alert('无法拍照', message, [{ text: '知道了', onPress: returnHome }], {
      cancelable: false,
    });

  void (async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        fail('需要相机权限才能拍照');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        base64: true,
        quality: 0.8,
        cameraType: ImagePicker.CameraType.back,
      });
      if (result.canceled) {
        returnHome();
        return;
      }

      const firstPhoto = pickerAssetsToPhotos(result.assets, 1);
      if (!firstPhoto.length) {
        fail('无法读取拍摄的照片');
        return;
      }
      await addPhotos(firstPhoto);
    } catch (caught) {
      fail(caught instanceof Error ? caught.message : '拍照失败');
    }
  })();
}, [addPhotos, camera, session]);
```

The `openedInitialCamera` ref makes reruns harmless even though `addPhotos` is recreated during render.

- [ ] **Step 3: Run static and automated checks**

Run:

```bash
cd mobile
npx tsc --noEmit
npm run lint
node --test tests/*.test.mjs
```

Expected: all commands exit with code 0.

- [ ] **Step 4: Verify the native interaction**

Run on a device or simulator with a camera:

```bash
cd mobile
npm run ios
```

Verify:

1. Header plus opens the system full-screen camera.
2. Camera cancel returns to “我的资产”.
3. Confirming a photo shows the existing add form with one photo processing.
4. Denying permission shows “无法拍照”; “知道了” returns home.
5. The empty-state add button still opens the form without auto-opening the camera.

- [ ] **Step 5: Commit the camera-first flow**

```bash
git add 'mobile/src/app/(tabs)/(assets)/index.tsx' 'mobile/src/app/(tabs)/(capture)/index.tsx'
git commit -m "feat: open camera before adding an asset"
```

### Task 3: Final scope check

**Files:**
- Verify only; no planned modifications.

**Interfaces:**
- Consumes: Tasks 1 and 2 commits.
- Produces: a clean, reviewable feature branch.

- [ ] **Step 1: Check the final diff and worktree**

Run:

```bash
git status --short
git diff d0eb742...HEAD --check
git diff d0eb742...HEAD --stat
```

Expected: clean worktree, no whitespace errors, and changes limited to the design, plan, shared photo helper/test, photo picker, assets header, and capture screen.
