# Native Purchase Date Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the purchase-date text box with platform-native date selection on Android, iOS, and Web while preserving the existing nullable `YYYY-MM-DD` persistence contract.

**Architecture:** Keep `AssetInput.purchase_date` as a string so the existing save and database path stays unchanged. A native component uses the installed Expo UI `DateTimePicker` on Android/iOS, a Web override uses `<input type="date">`, and both emit the same validated date-only string.

**Tech Stack:** Expo SDK 57, React Native 0.86, `@expo/ui` 57, React Native Web, TypeScript 6, Node test runner

## Global Constraints

- Android uses `@expo/ui/community/datetime-picker` with Material 3.
- iOS uses the same package with SwiftUI.
- Web uses the browser-native `<input type="date">`.
- The date remains optional and can be cleared.
- Future dates are not selectable or accepted.
- Persist dates as `YYYY-MM-DD`.
- Add no dependency, custom calendar, state manager, database migration, or server endpoint.

---

### Task 1: Date-only conversion and future-date validation

**Files:**
- Modify: `mobile/src/lib/purchase-input.ts`
- Modify: `mobile/tests/purchase-input.test.mjs`

**Interfaces:**
- Produces: `formatPurchaseDate(date: Date): string`.
- Preserves: `parsePurchaseInput(purchaseDate, purchasePrice)` result shape.
- Adds: future purchase dates return `{ error: '买入日期不能晚于今天' }`.

- [ ] **Step 1: Extend the failing tests**

Add to `mobile/tests/purchase-input.test.mjs`:

```js
import {
  formatPurchaseDate,
  parsePurchaseInput,
} from '../src/lib/purchase-input.ts';

test('formats a local date without a timezone shift', () => {
  assert.equal(
    formatPurchaseDate(new Date(2026, 6, 24, 23, 30)),
    '2026-07-24',
  );
});

test('rejects future purchase dates', () => {
  assert.deepEqual(parsePurchaseInput('9999-12-31', ''), {
    error: '买入日期不能晚于今天',
  });
});
```

Replace the existing single-function import rather than adding a second import from the same module.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd mobile
node --test tests/purchase-input.test.mjs
```

Expected: FAIL because `formatPurchaseDate` is not exported and the future-date assertion does not match.

- [ ] **Step 3: Add the minimal date helper and validation**

At the top of `mobile/src/lib/purchase-input.ts`, add:

```ts
export function formatPurchaseDate(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
}
```

After the existing valid-calendar-date check in `parsePurchaseInput`, add:

```ts
if (date && date > formatPurchaseDate(new Date())) {
  return { error: '买入日期不能晚于今天' };
}
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
cd mobile
node --test tests/purchase-input.test.mjs
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit the validation change**

```bash
git add mobile/src/lib/purchase-input.ts mobile/tests/purchase-input.test.mjs
git commit -m "feat: reject future asset purchase dates"
```

### Task 2: Platform-native purchase date field

**Files:**
- Create: `mobile/src/components/purchase-date-field.tsx`
- Create: `mobile/src/components/purchase-date-field.web.tsx`
- Modify: `mobile/src/components/asset-form-fields.tsx`

**Interfaces:**
- Consumes: `value: string` and `onChange(value: string): void`.
- Consumes: `formatPurchaseDate(date: Date): string`.
- Produces: `PurchaseDateField`, resolved to Expo UI on Android/iOS and native HTML on Web.

- [ ] **Step 1: Add the Android/iOS component**

Create `mobile/src/components/purchase-date-field.tsx`:

```tsx
import DateTimePicker from '@expo/ui/community/datetime-picker';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { colors } from '@/constants/colors';
import { formatPurchaseDate } from '@/lib/purchase-input';

export function PurchaseDateField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(new Date());

  const show = () => {
    setDraft(value ? new Date(`${value}T00:00:00`) : new Date());
    setOpen(true);
  };

  return (
    <View style={{ gap: 7 }}>
      <Text selectable style={{ color: colors.muted, fontSize: 13 }}>
        实际买入日期（可选）
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Pressable
          accessibilityLabel="选择实际买入日期"
          accessibilityRole="button"
          onPress={show}
          style={({ pressed }) => ({
            flex: 1,
            padding: 14,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            borderCurve: 'continuous',
            backgroundColor: colors.card,
            opacity: pressed ? 0.65 : 1,
          })}>
          <Text style={{ color: value ? colors.text : colors.muted }}>
            {value || '请选择日期'}
          </Text>
        </Pressable>
        {value ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => onChange('')}>
            <Text style={{ color: colors.green }}>清空</Text>
          </Pressable>
        ) : null}
      </View>
      {open ? (
        <>
          <DateTimePicker
            accentColor={colors.green}
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            maximumDate={new Date()}
            mode="date"
            onDismiss={() => setOpen(false)}
            onValueChange={(_, date) => {
              if (Platform.OS === 'android') {
                onChange(formatPurchaseDate(date));
                setOpen(false);
              } else {
                setDraft(date);
              }
            }}
            presentation="dialog"
            value={draft}
          />
          {Platform.OS === 'ios' ? (
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 18 }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setOpen(false)}>
                <Text style={{ color: colors.muted }}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  onChange(formatPurchaseDate(draft));
                  setOpen(false);
                }}>
                <Text style={{ color: colors.green, fontWeight: '700' }}>
                  确定
                </Text>
              </Pressable>
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
```

- [ ] **Step 2: Add the Web-native override**

Create `mobile/src/components/purchase-date-field.web.tsx`:

```tsx
import { Pressable, Text, View } from 'react-native';

import { colors } from '@/constants/colors';
import { formatPurchaseDate } from '@/lib/purchase-input';

export function PurchaseDateField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={{ gap: 7 }}>
      <Text selectable style={{ color: colors.muted, fontSize: 13 }}>
        实际买入日期（可选）
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <input
          aria-label="实际买入日期"
          max={formatPurchaseDate(new Date())}
          onChange={(event) => onChange(event.currentTarget.value)}
          type="date"
          value={value}
          style={{
            flex: 1,
            minWidth: 0,
            padding: 14,
            border: `1px solid ${colors.border}`,
            borderRadius: 12,
            background: colors.card,
            color: colors.text,
            font: 'inherit',
          }}
        />
        {value ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => onChange('')}>
            <Text style={{ color: colors.green }}>清空</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
```

- [ ] **Step 3: Replace the shared text field**

Import the new component in `mobile/src/components/asset-form-fields.tsx`:

```ts
import { PurchaseDateField } from '@/components/purchase-date-field';
```

Replace the existing purchase-date `Field`:

```tsx
<PurchaseDateField
  value={form.purchase_date}
  onChange={(purchase_date) => onChange({ ...form, purchase_date })}
/>
```

Keep the purchase-price `Field` unchanged.

- [ ] **Step 4: Run complete static and unit checks**

Run:

```bash
cd mobile
node --test tests/*.test.mjs
npx tsc --noEmit
npm run lint
cd ..
git diff --check
```

Expected: all Node tests PASS; TypeScript, Expo lint, and `git diff --check` exit 0.

- [ ] **Step 5: Build all platform bundles**

Run:

```bash
cd mobile
npx expo export --platform web --output-dir /tmp/worth-date-picker-web
npx expo export --platform ios --output-dir /tmp/worth-date-picker-ios
npx expo export --platform android --output-dir /tmp/worth-date-picker-android
```

Expected: Web, iOS, and Android exports finish successfully without adding files to the repository.

- [ ] **Step 6: Verify the rendered interactions**

Start Expo Web and verify:

- The flow under test is: edit asset → browser-native purchase date input → select/clear date → save validation.
- The input DOM has `type="date"` and `max` equal to today.
- A valid date updates the controlled form value.
- Clearing returns the field to an empty value.
- The page has no framework overlay or relevant console errors.

On an available Android/iOS simulator or Expo Go device, verify:

- Tapping the field opens the platform-native picker.
- Android confirm and iOS “确定” emit `YYYY-MM-DD`.
- “取消” leaves the previous value unchanged.
- “清空” returns an empty value.
- Future dates are disabled.

- [ ] **Step 7: Commit the platform field**

```bash
git add mobile/src/components/purchase-date-field.tsx mobile/src/components/purchase-date-field.web.tsx mobile/src/components/asset-form-fields.tsx
git commit -m "feat: use native asset purchase date picker"
```
