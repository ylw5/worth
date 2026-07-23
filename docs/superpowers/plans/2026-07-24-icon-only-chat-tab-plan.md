# Icon-Only Chat Tab Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show four icon-only native tabs and add an empty chat destination between wishlist and account.

**Architecture:** Reuse Expo Router 57 `NativeTabs` and its native `Label hidden` API. Add a `(chat)` route group with the same stack structure as the existing tab groups; no chatbot UI, state, or dependency is introduced.

**Tech Stack:** Expo 57, Expo Router NativeTabs, React Native, TypeScript

## Global Constraints

- Keep the existing asset, wishlist, and account routes and order.
- Use iOS `bubble.left.fill` and Android `chat_bubble` for the chat icon.
- Keep the chat page empty.
- Add no dependency or custom tab bar.

---

### Task 1: Icon-only navigation and empty chat route

**Files:**
- Modify: `mobile/src/app/(tabs)/_layout.tsx`
- Create: `mobile/src/app/(tabs)/(chat)/_layout.tsx`
- Create: `mobile/src/app/(tabs)/(chat)/index.tsx`

**Interfaces:**
- Consumes: Expo Router `NativeTabs`, `Stack`, and the existing `colors.background` token.
- Produces: A `(chat)` tab route addressable by `NativeTabs.Trigger name="(chat)"`.

- [ ] **Step 1: Hide every tab label and add the chat trigger**

Use `NativeTabs.Trigger.Label hidden` for all four triggers and place this trigger between wishlist and account:

```tsx
<NativeTabs.Trigger name="(chat)">
  <NativeTabs.Trigger.Icon sf="bubble.left.fill" md="chat_bubble" />
  <NativeTabs.Trigger.Label hidden />
</NativeTabs.Trigger>
```

- [ ] **Step 2: Add the chat stack**

Create `mobile/src/app/(tabs)/(chat)/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';

import { colors } from '@/constants/colors';

export default function ChatLayout() {
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.background },
        headerShown: false,
      }}
    />
  );
}
```

- [ ] **Step 3: Add the empty chat screen**

Create `mobile/src/app/(tabs)/(chat)/index.tsx`:

```tsx
export default function ChatScreen() {
  return null;
}
```

- [ ] **Step 4: Run static checks**

Run:

```bash
cd mobile
npx tsc --noEmit
npm run lint
```

Expected: both commands exit successfully with no new errors.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/app/'(tabs)'/_layout.tsx \
  mobile/src/app/'(tabs)'/'(chat)'/_layout.tsx \
  mobile/src/app/'(tabs)'/'(chat)'/index.tsx
git commit -m "feat: add icon-only chat tab"
```
