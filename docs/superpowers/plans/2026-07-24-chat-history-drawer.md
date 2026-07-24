# Chat History Drawer Implementation Plan

> **For agentic workers:** Execute inline in this session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move chat history on the evaluation home screen into a left `react-native-drawer-layout` drawer, opened from a top-left button, with user-facing copy「聊天 / 最近 / 新聊天」.

**Architecture:** Wrap `(evaluation)/index` in `Drawer`. Extract drawer UI into `ChatHistoryDrawer`. Keep `listPurchaseEvaluations` / `['purchase-evaluations']`. Preserve existing uncommitted index/_layout tweaks (removed hero copy; evaluation tab uses chat bubble icon).

**Tech Stack:** Expo Router, `react-native-drawer-layout` ^4.2.x, React Query, existing `colors` tokens, `expo-symbols` for header icon.

## Global Constraints

- User-facing copy avoids「评估」for page/drawer chrome: use「聊天」「最近」「新聊天」「还没有记录」.
- Drawer only on `(evaluation)/index`, not `[id]`.
- Do not rename `(evaluation)` route or change backend models.
- Visual style: existing light theme, not ChatGPT dark UI.
- Preserve current WIP: no hero marketing block on index; tab icon is chat bubble; `(chat)` stays `href: null`.

## File structure

| File | Responsibility |
| --- | --- |
| `mobile/package.json` | Direct dep on `react-native-drawer-layout` |
| `mobile/src/components/chat-history-drawer.tsx` | Drawer panel: title, recent list, new-chat CTA |
| `mobile/src/app/(tabs)/(evaluation)/index.tsx` | `Drawer` shell, header menu button, composer + reply only |

---

### Task 1: Add `react-native-drawer-layout` dependency

**Files:**
- Modify: `mobile/package.json`
- Modify: `mobile/package-lock.json` (via install)

- [ ] **Step 1: Install package in mobile**

Run from `mobile/`:

```bash
npx expo install react-native-drawer-layout
```

Expected: `react-native-drawer-layout` appears under `dependencies` (aligns with Expo / lockfile ~4.2.x).

- [ ] **Step 2: Commit**

```bash
git add mobile/package.json mobile/package-lock.json
git commit -m "$(cat <<'EOF'
chore: add react-native-drawer-layout dependency

EOF
)"
```

---

### Task 2: Build `ChatHistoryDrawer` content

**Files:**
- Create: `mobile/src/components/chat-history-drawer.tsx`

**Interfaces:**
- Consumes: `PurchaseEvaluation`, `evaluationDecisionLabels`, `formatDate`, `ErrorState`, `LoadingState`, `colors` / `spacing` / `radius` / `typography`, `useSafeAreaInsets`
- Produces:

```ts
export function ChatHistoryDrawer(props: {
  items: PurchaseEvaluation[];
  loading: boolean;
  errorMessage?: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
}): JSX.Element;
```

- [ ] **Step 1: Create component**

```tsx
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, LoadingState } from '@/components/screen-state';
import { colors, radius, spacing, typography } from '@/constants/colors';
import {
  evaluationDecisionLabels,
  type PurchaseEvaluation,
} from '@/lib/evaluations';
import { formatDate } from '@/lib/format';

export function ChatHistoryDrawer({
  items,
  loading,
  errorMessage,
  onSelect,
  onNewChat,
}: {
  items: PurchaseEvaluation[];
  loading: boolean;
  errorMessage?: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.surface,
        paddingTop: insets.top + spacing.md,
        paddingBottom: Math.max(insets.bottom, spacing.md),
      }}>
      <Text
        selectable
        style={{
          ...typography.sectionTitle,
          color: colors.textPrimary,
          paddingHorizontal: spacing.xl,
          marginBottom: spacing.lg,
        }}>
        聊天
      </Text>

      <Text
        selectable
        style={{
          ...typography.caption,
          color: colors.textSecondary,
          paddingHorizontal: spacing.xl,
          marginBottom: spacing.sm,
        }}>
        最近
      </Text>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.lg,
          gap: spacing.xs,
        }}>
        {loading ? <LoadingState /> : null}
        {errorMessage ? <ErrorState message={errorMessage} /> : null}
        {items.map((item) => {
          const decision = item.decision ?? 'pending';
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={item.product_title}
              onPress={() => onSelect(item.id)}
              style={({ pressed }) => ({
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.md,
                borderRadius: radius.medium,
                backgroundColor: pressed ? colors.surfaceMuted : 'transparent',
                gap: 4,
              })}>
              <Text
                selectable
                numberOfLines={2}
                style={{ ...typography.cardTitle, color: colors.textPrimary }}>
                {item.product_title}
              </Text>
              <Text
                selectable
                numberOfLines={1}
                style={{ ...typography.caption, color: colors.textSecondary }}>
                {evaluationDecisionLabels[decision]} ·{' '}
                {formatDate(item.updated_at ?? item.created_at)}
              </Text>
            </Pressable>
          );
        })}
        {!loading && !errorMessage && !items.length ? (
          <Text
            selectable
            style={{
              ...typography.label,
              color: colors.muted,
              paddingHorizontal: spacing.sm,
              paddingTop: spacing.sm,
            }}>
            还没有记录
          </Text>
        ) : null}
      </ScrollView>

      <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.md }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="新聊天"
          onPress={onNewChat}
          style={({ pressed }) => ({
            minHeight: 48,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.pill,
            backgroundColor: colors.accent,
            opacity: pressed ? 0.75 : 1,
          })}>
          <Text style={{ color: colors.onDark, fontWeight: '700', fontSize: 16 }}>
            新聊天
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Manual check** — TypeScript resolves imports; no runtime yet.

- [ ] **Step 3: Commit**

```bash
git add mobile/src/components/chat-history-drawer.tsx
git commit -m "$(cat <<'EOF'
feat: add chat history drawer content component

EOF
)"
```

---

### Task 3: Wire drawer into evaluation home screen

**Files:**
- Modify: `mobile/src/app/(tabs)/(evaluation)/index.tsx`

**Interfaces:**
- Consumes: `Drawer` from `react-native-drawer-layout`, `ChatHistoryDrawer`, `SymbolView` for menu icon
- Produces: home screen with `open` state; header title「聊天」; history only in drawer

- [ ] **Step 1: Rewrite screen shell**

Key behaviors in `index.tsx`:

1. `const [open, setOpen] = useState(false)`
2. Wrap body in:

```tsx
<Drawer
  open={open}
  onOpen={() => setOpen(true)}
  onClose={() => setOpen(false)}
  drawerPosition="left"
  drawerType="front"
  drawerStyle={{ width: '80%', backgroundColor: colors.surface }}
  overlayStyle={{ backgroundColor: 'rgba(11, 11, 13, 0.35)' }}
  renderDrawerContent={() => (
    <ChatHistoryDrawer
      items={history.data ?? []}
      loading={history.isLoading}
      errorMessage={history.error?.message}
      onSelect={(id) => {
        setOpen(false);
        router.push({
          pathname: '/(tabs)/(evaluation)/[id]',
          params: { id },
        });
      }}
      onNewChat={() => {
        setPrompt('');
        setPhotos([]);
        setError('');
        setChatReply('');
        setOpen(false);
      }}
    />
  )}
>
  {/* KeyboardAvoidingView + ScrollView with composer + chatReply only */}
</Drawer>
```

3. `Stack.Screen` options:

```tsx
<Stack.Screen
  options={{
    title: '聊天',
    headerLargeTitle: false,
    headerLeft: () => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? '关闭历史' : '打开历史'}
        onPress={() => setOpen((value) => !value)}
        hitSlop={8}
        style={{
          width: 36,
          height: 36,
          marginLeft: 4,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 99,
          backgroundColor: colors.surfaceMuted,
        }}>
        <SymbolView
          name={{
            ios: 'line.3.horizontal',
            android: 'menu',
            web: 'menu',
          }}
          size={18}
          tintColor={colors.textPrimary}
        />
      </Pressable>
    ),
  }}
/>
```

4. Remove the inline「最近评估」block from the `ScrollView`.
5. Keep composer, error text, and `chatReply` bubble.
6. Keep existing analyze / upload logic unchanged.

- [ ] **Step 2: Manual test on device/simulator**

- Open evaluation tab → title「聊天」, no inline history list
- Tap menu → drawer slides from left with「最近」list
- Tap overlay / swipe → closes
- Tap a history row → navigates to detail
- Tap「新聊天」→ clears draft inputs and closes drawer
- Edge swipe from left opens drawer

- [ ] **Step 3: Commit**

```bash
git add mobile/src/app/\(tabs\)/\(evaluation\)/index.tsx mobile/src/app/\(tabs\)/_layout.tsx
git commit -m "$(cat <<'EOF'
feat: open chat history in a left drawer

EOF
)"
```

Include `_layout.tsx` only if its WIP (chat bubble tab icon / hide `(chat)`) is still uncommitted and should ship with this feature.

---

## Spec coverage

| Spec requirement | Task |
| --- | --- |
| `react-native-drawer-layout` direct dep | 1 |
| Drawer content: 聊天 / 最近 / list / 新聊天 | 2 |
| Index: Drawer shell, header button, remove inline history | 3 |
| Select → push detail; 新聊天 clears local state | 3 |
| Light theme, ~80% width, overlay | 3 |
| No detail-page drawer / no route rename | (out of scope) |
