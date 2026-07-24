# Fixed Asset Condition Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make image recognition, asset confirmation, asset editing, and persisted data use the same six fixed condition values.

**Architecture:** Define the condition enum once in each runtime boundary: a Python `Literal` for OpenAI/Pydantic output and a TypeScript tuple for the mobile UI. Reuse the existing pill selector style in `AssetFormFields`, then clean old rows and enforce the same values with a PostgreSQL check constraint.

**Tech Stack:** Python 3.11+, Pydantic, OpenAI structured outputs, Expo 57, React Native, TypeScript, Supabase PostgreSQL

## Global Constraints

- Allowed values are exactly `全新未使用`, `几乎全新`, `轻微使用痕迹`, `明显使用痕迹`, `重度使用或有瑕疵`, and `无法判断`.
- AI must use `无法判断` when photos do not provide enough visible evidence and must not infer `全新未使用` from appearance alone.
- Existing non-enum database values become `无法判断`; existing enum values remain unchanged.
- Do not add dependencies, category-specific grading systems, or a separate defect-description field.

---

### Task 1: Constrain server recognition output

**Files:**
- Modify: `server/app/models.py`
- Modify: `server/app/openai_service.py`
- Test: `server/tests/test_openai_service.py`

**Interfaces:**
- Produces: `Condition`, a Python `Literal` used by both `AssetRecognition.condition` and `AIAssetRecognition.condition`.
- Produces: `/analyze` responses whose `condition` is always one of the six allowed values.

- [ ] **Step 1: Add a failing schema validation test**

Add `AssetRecognition` to the test imports and append:

```python
def test_condition_rejects_free_text() -> None:
    with pytest.raises(ValidationError):
        AssetRecognition(
            name="相机",
            category="数码",
            condition="有一点旧",
            search_query="相机",
        )
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd server
pytest tests/test_openai_service.py::test_condition_rejects_free_text -v
```

Expected: FAIL because the current `condition: str` accepts `有一点旧`.

- [ ] **Step 3: Add the shared server enum**

In `server/app/models.py`, add:

```python
Condition = Literal[
    "全新未使用",
    "几乎全新",
    "轻微使用痕迹",
    "明显使用痕迹",
    "重度使用或有瑕疵",
    "无法判断",
]
```

Change both condition fields to:

```python
condition: Condition
```

- [ ] **Step 4: Tell image analysis how to use the enum**

Extend the analyze system prompt in `server/app/openai_service.py` with:

```python
"成色只能使用给定枚举，只根据照片可见外观判断；"
"仅凭外观不得判断为全新未使用，证据不足时选择无法判断。"
```

- [ ] **Step 5: Run the complete server test suite**

Run:

```bash
cd server
pytest
```

Expected: all tests PASS.

- [ ] **Step 6: Commit the server change**

```bash
git add server/app/models.py server/app/openai_service.py server/tests/test_openai_service.py
git commit -m "feat: constrain recognized asset condition"
```

### Task 2: Replace mobile free text with fixed choices

**Files:**
- Modify: `mobile/src/types/domain.ts`
- Modify: `mobile/src/components/asset-form-fields.tsx`
- Create: `mobile/tests/condition.test.mjs`

**Interfaces:**
- Produces: `conditions`, a readonly tuple containing the six display and storage values.
- Produces: `Condition = (typeof conditions)[number]`.
- Consumes: `AssetInput.condition: Condition`.

- [ ] **Step 1: Add a failing tuple test**

Create `mobile/tests/condition.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';

import { conditions } from '../src/types/domain.ts';

test('condition options stay fixed and ordered', () => {
  assert.deepEqual(conditions, [
    '全新未使用',
    '几乎全新',
    '轻微使用痕迹',
    '明显使用痕迹',
    '重度使用或有瑕疵',
    '无法判断',
  ]);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd mobile
node --test tests/condition.test.mjs
```

Expected: FAIL because `conditions` is not exported.

- [ ] **Step 3: Define the mobile enum**

Add to `mobile/src/types/domain.ts`:

```typescript
export const conditions = [
  '全新未使用',
  '几乎全新',
  '轻微使用痕迹',
  '明显使用痕迹',
  '重度使用或有瑕疵',
  '无法判断',
] as const;

export type Condition = (typeof conditions)[number];
```

Change:

```typescript
condition: string;
```

to:

```typescript
condition: Condition;
```

- [ ] **Step 4: Render condition pills instead of a text input**

Import `conditions` in `mobile/src/components/asset-form-fields.tsx`:

```typescript
import { categories, conditions, type AssetInput } from '@/types/domain';
```

Replace the existing condition `Field` with:

```tsx
<View style={{ gap: spacing.sm }}>
  <Text selectable style={{ color: colors.textSecondary, ...typography.label }}>
    成色
  </Text>
  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
    {conditions.map((condition) => (
      <Pressable
        key={condition}
        onPress={() => onChange({ ...form, condition })}
        style={{
          minHeight: 38,
          paddingHorizontal: spacing.lg,
          borderRadius: radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor:
            form.condition === condition
              ? colors.textPrimary
              : colors.surfaceMuted,
        }}>
        <Text
          style={{
            color:
              form.condition === condition
                ? colors.onDark
                : colors.textSecondary,
            ...typography.label,
          }}>
          {condition}
        </Text>
      </Pressable>
    ))}
  </View>
</View>
```

- [ ] **Step 5: Run mobile tests, type checking, and lint**

Run:

```bash
cd mobile
node --test tests/*.test.mjs
npx tsc --noEmit
npm run lint
```

Expected: all tests PASS, TypeScript exits 0, and lint exits 0.

- [ ] **Step 6: Commit the mobile change**

```bash
git add mobile/src/types/domain.ts mobile/src/components/asset-form-fields.tsx mobile/tests/condition.test.mjs
git commit -m "feat: select asset condition from fixed options"
```

### Task 3: Clean and constrain persisted conditions

**Files:**
- Create: `supabase/migrations/202607240003_constrain_asset_condition.sql`

**Interfaces:**
- Consumes: the same six literal strings defined in Tasks 1 and 2.
- Produces: `assets_condition_check`, which rejects every other database value.

- [ ] **Step 1: Add the migration**

Create `supabase/migrations/202607240003_constrain_asset_condition.sql`:

```sql
update public.assets
set condition = '无法判断'
where condition not in (
  '全新未使用',
  '几乎全新',
  '轻微使用痕迹',
  '明显使用痕迹',
  '重度使用或有瑕疵',
  '无法判断'
);

alter table public.assets
  alter column condition set default '无法判断',
  add constraint assets_condition_check
  check (
    condition in (
      '全新未使用',
      '几乎全新',
      '轻微使用痕迹',
      '明显使用痕迹',
      '重度使用或有瑕疵',
      '无法判断'
    )
  );
```

- [ ] **Step 2: Verify migration ordering and SQL contents**

Run:

```bash
ls supabase/migrations
rg -n "update public.assets|set default '无法判断'|assets_condition_check" supabase/migrations/202607240003_constrain_asset_condition.sql
git diff --check
```

Expected: `202607240003_constrain_asset_condition.sql` sorts after the existing `202607240002` migration, the update, valid default, and constraint are present, and `git diff --check` prints nothing.

- [ ] **Step 3: Run the final focused verification**

Run:

```bash
cd server
pytest
cd ../mobile
node --test tests/*.test.mjs
npx tsc --noEmit
npm run lint
```

Expected: every command exits 0.

- [ ] **Step 4: Commit the migration**

```bash
git add supabase/migrations/202607240003_constrain_asset_condition.sql
git commit -m "feat: constrain stored asset condition"
```
