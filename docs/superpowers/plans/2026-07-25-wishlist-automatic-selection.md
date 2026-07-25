# Wishlist Automatic Funding Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically select enough available funding records when the fulfillment screen opens while preserving manual user adjustments.

**Architecture:** Add one pure prefix-selection helper beside the existing cent-based allocation math. The screen uses `null` as the automatic-mode sentinel and materializes the current automatic keys only when the user first toggles a source. No database or query changes are needed.

**Tech Stack:** Expo SDK 57, React Native, TanStack Query, TypeScript, Node's built-in test runner.

## Global Constraints

- Default order is the existing page order: all `spending_resolution` sources before `asset_sale` sources.
- Select the shortest source prefix that covers the actual price; select all sources when funds are insufficient.
- Never select a source whose current transaction usage would be zero.
- Actual-price changes recompute defaults only before the first manual adjustment.
- After the first manual toggle, preserve source choices and keep recalculating only their usage amounts.
- A balance conflict returns the screen to automatic mode using refreshed balances.
- Do not change the database, queries, source display order, or add dependencies.

---

### Task 1: Automatic Defaults with Manual Override

**Files:**
- Modify: `mobile/src/lib/wishlist-allocations.ts`
- Modify: `mobile/tests/wishlist-allocations.test.mjs`
- Modify: `mobile/src/app/(tabs)/(wishlist)/fulfill/[id].tsx`

**Interfaces:**
- Consumes: existing `SelectableFundingSource`, `buildAllocationPreview`, and the screen's `sourceKey`.
- Produces: `selectAutomaticFundingSources(actualPrice, sources): SelectableFundingSource[]`.

- [ ] **Step 1: Write the failing pure-function test**

Append to `mobile/tests/wishlist-allocations.test.mjs`:

```js
test('selects the shortest available prefix for automatic funding', () => {
  const sources = [
    {
      source_type: 'spending_resolution',
      source_id: 'skip-1',
      available_amount: 800,
    },
    {
      source_type: 'spending_resolution',
      source_id: 'skip-empty',
      available_amount: 0,
    },
    {
      source_type: 'asset_sale',
      source_id: 'sale-1',
      available_amount: 5000,
    },
    {
      source_type: 'asset_sale',
      source_id: 'sale-2',
      available_amount: 1000,
    },
  ];

  assert.deepEqual(
    selectAutomaticFundingSources(1000, sources).map(
      (source) => source.source_id,
    ),
    ['skip-1', 'sale-1'],
  );
  assert.deepEqual(
    selectAutomaticFundingSources(10000, sources).map(
      (source) => source.source_id,
    ),
    ['skip-1', 'sale-1', 'sale-2'],
  );
  assert.deepEqual(selectAutomaticFundingSources(0, sources), []);
});
```

Add `selectAutomaticFundingSources` to the existing import list.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd mobile
node --experimental-strip-types --test tests/wishlist-allocations.test.mjs
```

Expected: FAIL because `selectAutomaticFundingSources` is not exported.

- [ ] **Step 3: Implement the minimum prefix selector**

Append to `mobile/src/lib/wishlist-allocations.ts`:

```ts
export function selectAutomaticFundingSources(
  actualPrice: number,
  sources: SelectableFundingSource[],
) {
  let remaining = Math.max(toCents(actualPrice), 0);
  const selected: SelectableFundingSource[] = [];

  for (const source of sources) {
    if (!remaining) break;
    const available = Math.max(toCents(source.available_amount), 0);
    if (!available) continue;
    selected.push(source);
    remaining -= Math.min(available, remaining);
  }

  return selected;
}
```

- [ ] **Step 4: Switch the screen from empty defaults to automatic mode**

In `mobile/src/app/(tabs)/(wishlist)/fulfill/[id].tsx`, import `selectAutomaticFundingSources` and replace:

```ts
const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
```

with:

```ts
const [manualSelectedKeys, setManualSelectedKeys] = useState<
  string[] | null
>(null);
```

After `parsedPrice`, derive the effective selection:

```ts
const automaticSelectedKeys = selectAutomaticFundingSources(
  'price' in parsedPrice ? parsedPrice.price : 0,
  sources,
).map(sourceKey);
const selectedKeys = manualSelectedKeys ?? automaticSelectedKeys;
```

Keep `selectedSources` and `preview` derived from `selectedKeys`, moving them below this block.

Replace `toggleSource` with:

```ts
const toggleSource = (source: FundingSourceRow) => {
  const key = sourceKey(source);
  setError('');
  setManualSelectedKeys((current) => {
    const effective = current ?? automaticSelectedKeys;
    return effective.includes(key)
      ? effective.filter((candidate) => candidate !== key)
      : [...effective, key];
  });
};
```

In the balance-conflict branch, replace:

```ts
setSelectedKeys([]);
```

with:

```ts
setManualSelectedKeys(null);
```

Do not add an effect. Automatic selection remains derived from the latest price and source balances until the user first toggles a row.

- [ ] **Step 5: Run focused and static validation**

Run:

```bash
cd mobile
node --experimental-strip-types --test tests/wishlist-allocations.test.mjs
npx eslint \
  src/lib/wishlist-allocations.ts \
  'src/app/(tabs)/(wishlist)/fulfill/[id].tsx'
npx tsc --noEmit --allowImportingTsExtensions
```

Expected: allocation tests, targeted lint, and compatible TypeScript check all pass.

- [ ] **Step 6: Commit**

```bash
git add \
  mobile/src/lib/wishlist-allocations.ts \
  mobile/tests/wishlist-allocations.test.mjs \
  'mobile/src/app/(tabs)/(wishlist)/fulfill/[id].tsx'
git commit -m "feat: auto-select wishlist funding"
```
