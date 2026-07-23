# Wishlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native “心愿单” tab where each signed-in user can list, add, and delete wishlist items.

**Architecture:** Store wishlist items in a dedicated Supabase table protected by owner-only RLS. Add a small client data module, a pure input parser with one runnable test, and an Expo Router stack containing the list and add screens.

**Tech Stack:** Expo 57, Expo Router native tabs, React Native, TanStack Query, Supabase Postgres, Node test runner

## Global Constraints

- Fields are name, required positive target price, and optional notes.
- Support list, add, and confirmed delete only.
- Do not add links, images, editing, sorting, purchase status, AI, or dependencies.
- Reuse the existing colors, currency formatter, loading state, and error state.
- Preserve unrelated working-tree changes.

---

### Task 1: Wishlist persistence

**Files:**
- Create: `supabase/migrations/202607240001_create_wishlist_items.sql`
- Create: `mobile/src/lib/wishlist.ts`

**Interfaces:**
- Produces: `WishlistItem`, `WishlistInput`, `listWishlistItems()`, `createWishlistItem(userId, input)`, and `deleteWishlistItem(id)`.

- [ ] **Step 1: Create the database migration**

```sql
create table public.wishlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  target_price numeric(12, 2) not null check (target_price > 0),
  notes text not null default '',
  created_at timestamptz not null default now()
);

create index wishlist_items_user_created_idx
  on public.wishlist_items (user_id, created_at desc);

alter table public.wishlist_items enable row level security;

create policy wishlist_items_owner on public.wishlist_items
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
```

- [ ] **Step 2: Add the minimal Supabase client API**

```ts
import { supabase } from '@/lib/supabase';

export type WishlistInput = {
  name: string;
  target_price: number;
  notes: string;
};

export type WishlistItem = WishlistInput & {
  id: string;
  user_id: string;
  created_at: string;
};

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function listWishlistItems(): Promise<WishlistItem[]> {
  const { data, error } = await supabase
    .from('wishlist_items')
    .select('*')
    .order('created_at', { ascending: false });
  fail(error);
  return (data ?? []) as WishlistItem[];
}

export async function createWishlistItem(
  userId: string,
  input: WishlistInput,
): Promise<WishlistItem> {
  const { data, error } = await supabase
    .from('wishlist_items')
    .insert({ ...input, user_id: userId })
    .select('*')
    .single();
  fail(error);
  return data as WishlistItem;
}

export async function deleteWishlistItem(id: string) {
  const { error } = await supabase.from('wishlist_items').delete().eq('id', id);
  fail(error);
}
```

- [ ] **Step 3: Run focused static checks**

Run: `cd mobile && npx tsc --noEmit`

Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Commit the new persistence files**

```bash
git add supabase/migrations/202607240001_create_wishlist_items.sql mobile/src/lib/wishlist.ts
git commit -m "feat: add wishlist persistence"
```

### Task 2: Wishlist input validation

**Files:**
- Create: `mobile/src/lib/wishlist-input.ts`
- Create: `mobile/tests/wishlist-input.test.mjs`

**Interfaces:**
- Consumes: `WishlistInput` from `@/lib/wishlist`.
- Produces: `parseWishlistInput(name, targetPrice, notes)`, returning either `{ input: WishlistInput }` or `{ error: string }`.

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { parseWishlistInput } from '../src/lib/wishlist-input.ts';

test('validates and normalizes wishlist input', () => {
  assert.deepEqual(parseWishlistInput('', '100', ''), {
    error: '请填写名称',
  });
  assert.deepEqual(parseWishlistInput('相机', '0', ''), {
    error: '目标价格必须大于 0',
  });
  assert.deepEqual(parseWishlistInput(' 相机 ', '3999', ' 旅行用 '), {
    input: { name: '相机', target_price: 3999, notes: '旅行用' },
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd mobile && node --test tests/wishlist-input.test.mjs`

Expected: FAIL because `wishlist-input.ts` does not exist.

- [ ] **Step 3: Implement the parser**

```ts
import type { WishlistInput } from '@/lib/wishlist';

export function parseWishlistInput(
  name: string,
  targetPrice: string,
  notes: string,
): { input: WishlistInput } | { error: string } {
  if (!name.trim()) return { error: '请填写名称' };
  const price = Number(targetPrice);
  if (!Number.isFinite(price) || price <= 0) {
    return { error: '目标价格必须大于 0' };
  }
  return {
    input: {
      name: name.trim(),
      target_price: price,
      notes: notes.trim(),
    },
  };
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd mobile && node --test tests/wishlist-input.test.mjs`

Expected: PASS with one passing test.

- [ ] **Step 5: Commit validation**

```bash
git add mobile/src/lib/wishlist-input.ts mobile/tests/wishlist-input.test.mjs
git commit -m "test: validate wishlist input"
```

### Task 3: Add wishlist screen

**Files:**
- Create: `mobile/src/app/(tabs)/(wishlist)/_layout.tsx`
- Create: `mobile/src/app/(tabs)/(wishlist)/add.tsx`

**Interfaces:**
- Consumes: `parseWishlistInput`, `createWishlistItem`, `useSession()`, and the `['wishlist']` query key.

- [ ] **Step 1: Add the wishlist stack layout**

```tsx
import { Stack } from 'expo-router';

import { colors } from '@/constants/colors';

export default function WishlistLayout() {
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
      }}
    />
  );
}
```

- [ ] **Step 2: Add the form screen**

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors } from '@/constants/colors';
import { createWishlistItem } from '@/lib/wishlist';
import { parseWishlistInput } from '@/lib/wishlist-input';
import { useSession } from '@/providers/session-provider';

function Field({
  label,
  value,
  onChangeText,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string }) {
  return (
    <View style={{ gap: 7 }}>
      <Text style={{ color: colors.muted, fontSize: 13 }}>{label}</Text>
      <TextInput
        {...props}
        value={value}
        onChangeText={onChangeText}
        style={{
          minHeight: props.multiline ? 96 : undefined,
          color: colors.text,
          fontSize: 16,
          padding: 14,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          borderCurve: 'continuous',
          backgroundColor: colors.card,
          textAlignVertical: props.multiline ? 'top' : 'center',
        }}
      />
    </View>
  );
}

export default function AddWishlistScreen() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const parsed = parseWishlistInput(name, targetPrice, notes);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    if (!session) return;
    setLoading(true);
    setError('');
    try {
      await createWishlistItem(session.user.id, parsed.input);
      await queryClient.invalidateQueries({ queryKey: ['wishlist'] });
      router.back();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: '添加心愿' }} />
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: 20, gap: 18 }}>
          <Field
            label="名称"
            value={name}
            onChangeText={setName}
            placeholder="例如：旅行相机"
          />
          <Field
            label="目标价格"
            value={targetPrice}
            onChangeText={setTargetPrice}
            keyboardType="decimal-pad"
            placeholder="0"
          />
          <Field
            label="备注（可选）"
            value={notes}
            onChangeText={setNotes}
            multiline
            placeholder="为什么想要它"
          />
          {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={loading}
            onPress={save}
            style={({ pressed }) => ({
              alignItems: 'center',
              padding: 16,
              borderRadius: 14,
              borderCurve: 'continuous',
              backgroundColor: colors.green,
              opacity: pressed || loading ? 0.65 : 1,
            })}>
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={{ color: 'white', fontSize: 17, fontWeight: '700' }}>
                保存
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
```

- [ ] **Step 3: Run focused checks**

Run: `cd mobile && node --test tests/wishlist-input.test.mjs && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 4: Commit the add flow**

```bash
git add 'mobile/src/app/(tabs)/(wishlist)/_layout.tsx' 'mobile/src/app/(tabs)/(wishlist)/add.tsx'
git commit -m "feat: add wishlist form"
```

### Task 4: Wishlist tab, list, and delete

**Files:**
- Create: `mobile/src/app/(tabs)/(wishlist)/index.tsx`
- Modify: `mobile/src/app/(tabs)/_layout.tsx`

**Interfaces:**
- Consumes: `listWishlistItems()`, `deleteWishlistItem(id)`, `formatCurrency()`, and the `['wishlist']` query key.

- [ ] **Step 1: Add the native tab trigger**

Insert this trigger between assets and account:

```tsx
<NativeTabs.Trigger name="(wishlist)">
  <NativeTabs.Trigger.Icon sf="heart.fill" md="favorite" />
  <NativeTabs.Trigger.Label>心愿单</NativeTabs.Trigger.Label>
</NativeTabs.Trigger>
```

- [ ] **Step 2: Add the list screen**

```tsx
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { Link, Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { ErrorState, LoadingState } from '@/components/screen-state';
import { colors } from '@/constants/colors';
import { formatCurrency } from '@/lib/format';
import {
  deleteWishlistItem,
  listWishlistItems,
} from '@/lib/wishlist';

export default function WishlistScreen() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['wishlist'],
    queryFn: listWishlistItems,
  });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const confirmDelete = (id: string, name: string) => {
    Alert.alert('删除心愿', `确定删除“${name}”吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          setDeletingId(id);
          setDeleteError('');
          try {
            await deleteWishlistItem(id);
            await queryClient.invalidateQueries({ queryKey: ['wishlist'] });
          } catch (caught) {
            setDeleteError(
              caught instanceof Error ? caught.message : '删除失败',
            );
          } finally {
            setDeletingId(null);
          }
        },
      },
    ]);
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: '心愿单',
          headerLargeTitle: true,
          headerRight: () => (
            <Link href="/(tabs)/(wishlist)/add" asChild>
              <Pressable
                accessibilityLabel="添加心愿"
                accessibilityRole="button"
                hitSlop={8}>
                <SymbolView
                  name={{ ios: 'plus', android: 'add', web: 'add' }}
                  size={24}
                  tintColor={colors.green}
                />
              </Pressable>
            </Link>
          ),
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, gap: 12 }}>
        {query.isLoading ? <LoadingState /> : null}
        {query.error ? <ErrorState message={query.error.message} /> : null}
        {deleteError ? <ErrorState message={deleteError} /> : null}
        {(query.data ?? []).map((item) => (
          <View
            key={item.id}
            style={{
              padding: 16,
              gap: 8,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 18,
              borderCurve: 'continuous',
            }}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: 12,
              }}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>
                  {item.name}
                </Text>
                <Text style={{ color: colors.green, fontSize: 20 }}>
                  {formatCurrency(item.target_price)}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={deletingId === item.id}
                onPress={() => confirmDelete(item.id, item.name)}
                hitSlop={8}>
                <Text style={{ color: colors.danger }}>删除</Text>
              </Pressable>
            </View>
            {item.notes ? (
              <Text style={{ color: colors.muted }}>{item.notes}</Text>
            ) : null}
          </View>
        ))}
        {!query.isLoading && !query.error && !query.data?.length ? (
          <View
            style={{
              padding: 32,
              alignItems: 'center',
              gap: 12,
              backgroundColor: colors.card,
              borderRadius: 18,
              borderCurve: 'continuous',
            }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>
              还没有心愿
            </Text>
            <Link
              href="/(tabs)/(wishlist)/add"
              style={{ color: colors.green }}>
              添加第一个心愿
            </Link>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
```

- [ ] **Step 3: Run all mobile checks**

Run: `cd mobile && node --test tests/*.test.mjs && npx tsc --noEmit && npm run lint`

Expected: all tests, TypeScript, and ESLint pass. If an unrelated pre-existing check fails, record the exact failure and rerun checks scoped to the new files.

- [ ] **Step 4: Review the final diff**

Run: `git diff --check && git diff --stat`

Expected: no whitespace errors; only the wishlist files and the single native-tab trigger are added by this feature.

- [ ] **Step 5: Commit only the wishlist hunk and new file**

Because `mobile/src/app/(tabs)/_layout.tsx` already has user changes, stage only the new trigger hunk with `git add -p`, then stage the new list screen:

```bash
git add -p 'mobile/src/app/(tabs)/_layout.tsx'
git add 'mobile/src/app/(tabs)/(wishlist)/index.tsx'
git commit -m "feat: add wishlist tab"
```
