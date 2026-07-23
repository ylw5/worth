# Asset Purchase Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users optionally record an asset's actual purchase date and purchase price when creating or editing it, then view those values on the detail screen.

**Architecture:** Keep editable purchase values as strings in the existing shared mobile form so partially typed input remains stable. A small pure parser validates and normalizes them before the existing Supabase create/update calls; the database stores a nullable `date` and positive nullable `numeric`, while valuation requests explicitly omit both fields.

**Tech Stack:** Expo SDK 57, React Native 0.86, TypeScript 6, Supabase Postgres, Node test runner

## Global Constraints

- Both fields are optional.
- Purchase date precision is calendar date only, entered as `YYYY-MM-DD`.
- Purchase price must be greater than 0 when present.
- Purchase details must not affect market valuation.
- Reuse the existing shared form and React Native `TextInput`.
- Add no dependency, date picker, state manager, or server endpoint.

---

### Task 1: Purchase input contract and validation

**Files:**
- Create: `mobile/src/lib/purchase-input.ts`
- Create: `mobile/tests/purchase-input.test.mjs`

**Interfaces:**
- Produces: `parsePurchaseInput(purchaseDate: string, purchasePrice: string)` returning either `{ input }` or `{ error }`.

- [ ] **Step 1: Write the failing parser test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePurchaseInput } from '../src/lib/purchase-input.ts';

test('allows omitted purchase details', () => {
  assert.deepEqual(parsePurchaseInput('', ''), {
    input: { purchase_date: null, purchase_price: null },
  });
});

test('normalizes valid purchase details', () => {
  assert.deepEqual(parsePurchaseInput(' 2026-07-24 ', ' 3999.50 '), {
    input: { purchase_date: '2026-07-24', purchase_price: 3999.5 },
  });
});

test('rejects invalid calendar dates', () => {
  assert.deepEqual(parsePurchaseInput('2026-02-30', ''), {
    error: '买入日期必须是有效的 YYYY-MM-DD 日期',
  });
  assert.deepEqual(parsePurchaseInput('2026/07/24', ''), {
    error: '买入日期必须是有效的 YYYY-MM-DD 日期',
  });
});

test('rejects non-positive purchase prices', () => {
  assert.deepEqual(parsePurchaseInput('', '0'), {
    error: '买入价格必须大于 0',
  });
  assert.deepEqual(parsePurchaseInput('', '-1'), {
    error: '买入价格必须大于 0',
  });
});
```

- [ ] **Step 2: Run the parser test and verify it fails**

Run:

```bash
cd mobile
node --test tests/purchase-input.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/lib/purchase-input.ts`.

- [ ] **Step 3: Add the minimal parser**

Create `mobile/src/lib/purchase-input.ts`:

```ts
export type PurchaseInput = {
  purchase_date: string | null;
  purchase_price: number | null;
};

export function parsePurchaseInput(
  purchaseDate: string,
  purchasePrice: string,
): { input: PurchaseInput } | { error: string } {
  const date = purchaseDate.trim();
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (
    date &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date)
  ) {
    return { error: '买入日期必须是有效的 YYYY-MM-DD 日期' };
  }

  const priceText = purchasePrice.trim();
  const price = priceText ? Number(priceText) : null;
  if (price !== null && (!Number.isFinite(price) || price <= 0)) {
    return { error: '买入价格必须大于 0' };
  }

  return {
    input: {
      purchase_date: date || null,
      purchase_price: price,
    },
  };
}
```

- [ ] **Step 4: Run the parser test**

Run:

```bash
cd mobile
node --test tests/purchase-input.test.mjs
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit the validated input contract**

```bash
git add mobile/src/lib/purchase-input.ts mobile/tests/purchase-input.test.mjs
git commit -m "feat: validate asset purchase details"
```

### Task 2: Database, shared form, and persistence flow

**Files:**
- Create: `supabase/migrations/202607240002_add_asset_purchase_details.sql`
- Modify: `mobile/src/types/domain.ts`
- Modify: `mobile/src/lib/assets.ts`
- Modify: `mobile/src/lib/api.ts`
- Modify: `mobile/src/components/asset-form-fields.tsx`
- Modify: `mobile/src/app/confirm.tsx`
- Modify: `mobile/src/app/asset/[id]/edit.tsx`

**Interfaces:**
- Consumes: `parsePurchaseInput` from Task 1.
- Produces: nullable `assets.purchase_date` and `assets.purchase_price` columns.
- Produces: `AssetInput.purchase_date: string` and `AssetInput.purchase_price: string` for editable form state.
- Produces: `AssetWriteInput` with `purchase_date: string | null` and `purchase_price: number | null` for persistence.
- Produces: `createAsset(..., input: AssetWriteInput)` and `updateAsset(..., input: AssetWriteInput, ...)`.
- Produces: two optional fields in the existing shared create/edit form.
- Preserves: `/analyze` still returns only AI-recognized fields and `/estimate` receives no purchase fields.

- [ ] **Step 1: Add the database migration**

Create `supabase/migrations/202607240002_add_asset_purchase_details.sql`:

```sql
alter table public.assets
add column purchase_date date,
add column purchase_price numeric(12, 2)
  check (purchase_price > 0);
```

- [ ] **Step 2: Extend editable and persisted domain types**

In `mobile/src/types/domain.ts`, add the editable fields and split the persisted shape:

```ts
export type AssetInput = {
  name: string;
  brand: string;
  model: string;
  specs: Record<string, string>;
  category: Category;
  condition: string;
  search_query: string;
  purchase_date: string;
  purchase_price: string;
};

export type AssetWriteInput = Omit<
  AssetInput,
  'purchase_date' | 'purchase_price'
> & {
  purchase_date: string | null;
  purchase_price: number | null;
};

export type Asset = AssetWriteInput & {
  id: string;
  user_id: string;
  photo_paths: string[];
  photo_urls?: string[];
  latest_market_price: number | null;
  latest_valuation_at: string | null;
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 3: Make persistence accept normalized inputs**

In `mobile/src/lib/assets.ts`, import `AssetWriteInput` instead of `AssetInput`, then update both signatures:

```ts
export async function createAsset(
  userId: string,
  photoPaths: string[],
  input: AssetWriteInput,
): Promise<Asset> {
```

```ts
export async function updateAsset(
  id: string,
  input: AssetWriteInput,
  photoPaths?: string[],
): Promise<Asset> {
```

Keep the existing insert/update bodies unchanged so Supabase receives the normalized nullable values.

- [ ] **Step 4: Initialize blank form values after AI analysis**

In `mobile/src/lib/api.ts`, make the recognition response exclude purchase fields and append blank editable values:

```ts
type RecognitionInput = Omit<
  AssetInput,
  'purchase_date' | 'purchase_price'
>;

export const analyzePhotos = async (imageUrls: string[]) => ({
  ...(await request<RecognitionInput>('/analyze', {
    image_urls: imageUrls,
  })),
  purchase_date: '',
  purchase_price: '',
});
```

- [ ] **Step 5: Keep purchase details out of valuation requests**

Replace `estimateAsset` in `mobile/src/lib/api.ts`:

```ts
export const estimateAsset = (
  asset: AssetInput | AssetWriteInput,
) =>
  request<ValuationResult>('/estimate', {
    name: asset.name,
    brand: asset.brand,
    model: asset.model,
    specs: asset.specs,
    category: asset.category,
    condition: asset.condition,
    search_query: asset.search_query,
  });
```

Import `AssetWriteInput` with `AssetInput`. Listing the existing valuation fields is intentional: the server model and matching prompt remain unchanged, and purchase details cannot leak into valuation later.

- [ ] **Step 6: Add the two shared form fields**

Extend `Field` in `mobile/src/components/asset-form-fields.tsx` to forward an optional keyboard type:

```tsx
import {
  Pressable,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
```

```tsx
function Field({
  label,
  value,
  onChangeText,
  multiline = false,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  keyboardType?: TextInputProps['keyboardType'];
}) {
```

Pass `keyboardType={keyboardType}` to `TextInput`, then add these fields after “成色”:

```tsx
<Field
  label="实际买入日期（YYYY-MM-DD，可选）"
  value={form.purchase_date}
  onChangeText={(purchase_date) => onChange({ ...form, purchase_date })}
/>
<Field
  label="实际买入价格（元，可选）"
  keyboardType="decimal-pad"
  value={form.purchase_price}
  onChangeText={(purchase_price) =>
    onChange({ ...form, purchase_price })
  }
/>
```

- [ ] **Step 7: Validate and normalize the create form**

In `mobile/src/app/confirm.tsx`, import `parsePurchaseInput`. Inside `save`, after the existing name/search validation:

```ts
const purchase = parsePurchaseInput(
  form.purchase_date,
  form.purchase_price,
);
if ('error' in purchase) {
  setError(purchase.error);
  return;
}
```

Build the persisted input with the normalized values:

```ts
const input = {
  ...form,
  ...purchase.input,
  specs: textToSpecs(specsText),
};
```

- [ ] **Step 8: Initialize, validate, and normalize the edit form**

In `mobile/src/app/asset/[id]/edit.tsx`, initialize editable strings:

```ts
purchase_date: asset.purchase_date ?? '',
purchase_price: asset.purchase_price?.toString() ?? '',
```

Import `parsePurchaseInput`. Inside `save`, after the existing name/search validation, use the same validation block as the create screen:

```ts
const purchase = parsePurchaseInput(
  form.purchase_date,
  form.purchase_price,
);
if ('error' in purchase) {
  setError(purchase.error);
  return;
}
```

Normalize the write payload:

```ts
const input = {
  ...form,
  ...purchase.input,
  specs: textToSpecs(specsText),
};
```

- [ ] **Step 9: Run focused checks**

Run:

```bash
cd mobile
node --test tests/purchase-input.test.mjs
npx tsc --noEmit
npm run lint
cd ..
git diff --check
```

Expected: 4 parser tests PASS; TypeScript, Expo lint, and `git diff --check` exit 0.

- [ ] **Step 10: Commit the working create/edit flow**

```bash
git add supabase/migrations/202607240002_add_asset_purchase_details.sql mobile/src/types/domain.ts mobile/src/lib/assets.ts mobile/src/lib/api.ts mobile/src/components/asset-form-fields.tsx mobile/src/app/confirm.tsx 'mobile/src/app/asset/[id]/edit.tsx'
git commit -m "feat: persist asset purchase details"
```

### Task 3: Detail display and end-to-end verification

**Files:**
- Modify: `mobile/src/app/asset/[id].tsx`

**Interfaces:**
- Consumes: persisted nullable purchase fields on `Asset`.
- Produces: purchase date and formatted purchase price rows on the existing detail screen.

- [ ] **Step 1: Show purchase details on the asset detail screen**

In the basic information rows in `mobile/src/app/asset/[id].tsx`, add:

```tsx
['买入日期', asset.purchase_date || '—'],
[
  '买入价格',
  asset.purchase_price === null
    ? '—'
    : formatCurrency(asset.purchase_price),
],
```

Keep the existing “添加时间” row and asset list card unchanged.

- [ ] **Step 2: Run all focused checks**

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

- [ ] **Step 3: Review the user-visible flow**

Run the app with:

```bash
cd mobile
npm start
```

Verify:

- A newly analyzed asset starts with both purchase fields blank.
- Blank values save successfully.
- `2026-02-30` is rejected without sending a save.
- `2026-07-24` and `3999.50` save successfully.
- Editing pre-fills the stored values.
- The detail screen shows `2026-07-24` and the formatted CNY price.
- Refreshing market price does not send or use purchase details.

- [ ] **Step 4: Commit the completed UI flow**

```bash
git add 'mobile/src/app/asset/[id].tsx'
git commit -m "feat: show asset purchase details"
```
