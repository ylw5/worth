# Camera Gate Blank Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While `/capture?camera=1` waits for the system camera (and until the first photo is confirmed), show a blank page instead of the asset form so it never flashes on enter or cancel.

**Architecture:** Add an `awaitingInitialCamera` gate on the existing capture screen. When the route intent is `camera=1`, start gated; render only a full-screen `colors.background` view with `headerShown: false`. Clear the gate only after the first photo is accepted into `addPhotos`. Cancel / failure paths keep the gate up until `router.replace` leaves the screen.

**Tech Stack:** Expo Router, React Native, TypeScript, existing `expo-image-picker` flow

## Global Constraints

- Only change `mobile/src/app/(tabs)/(capture)/index.tsx`.
- Blank gate uses `colors.background`; no spinner or copy.
- Non-`camera=1` capture entry still shows the empty form immediately.
- Keep existing cancel / permission / failure return-home behavior.

---

### Task 1: Gate capture UI until first camera photo

**Files:**
- Modify: `mobile/src/app/(tabs)/(capture)/index.tsx`

**Interfaces:**
- Consumes: existing `camera` search param and initial-camera `useEffect`.
- Produces: `awaitingInitialCamera` boolean that suppresses form UI until first photo is accepted.

- [x] **Step 1: Add gate state initialized from the camera intent**

Near the other `useState` / `useRef` declarations in `CaptureScreen`, add:

```tsx
const [awaitingInitialCamera, setAwaitingInitialCamera] = useState(
  camera === '1',
);
```

Keep `openedInitialCamera` as the one-shot guard for launching the picker.

- [ ] **Step 2: Clear the gate only after a confirmed first photo**

In the initial-camera `useEffect`, after a successful `pickerAssetsToPhotos` result and before/around `addInitialPhotos`, clear the gate:

```tsx
if (result.canceled) {
  returnHome();
  return;
}

const firstPhoto = pickerAssetsToPhotos(result.assets, 1);
if (!firstPhoto.length) {
  fail('无法读取拍摄的照片');
  return;
}
setAwaitingInitialCamera(false);
await addInitialPhotos(firstPhoto);
```

Leave cancel, permission denial, and catch paths as they are (still `returnHome` / `fail`) so the blank gate stays up until navigation completes.

- [ ] **Step 3: Render blank UI while gated**

At the top of the component return, when `awaitingInitialCamera` is true:

```tsx
if (awaitingInitialCamera) {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1, backgroundColor: colors.background }} />
    </>
  );
}
```

Import `View` from `react-native` if not already imported. Keep the existing form return unchanged for the ungated path (including `headerShown: true` / title `录入物品`).

- [ ] **Step 4: Manual verification**

On a device/simulator with a camera:

1. Assets header `+` → blank, then system camera (no form flash).
2. Cancel camera → assets home without form flash.
3. Confirm photo → form appears with the first photo processing.
4. Empty-state `/capture` (no `camera=1`) still opens the empty form immediately.
5. Deny camera permission → alert, then home; no form flash.

- [ ] **Step 5: Commit**

```bash
git add 'mobile/src/app/(tabs)/(capture)/index.tsx'
git commit -m "$(cat <<'EOF'
fix: hide capture form while opening camera

EOF
)"
```
