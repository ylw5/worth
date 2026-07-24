# Spending Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the shopping Agent propose a priced “不买” action, persist an owner-scoped product snapshot, and count it exactly once after the user confirms.

**Architecture:** Keep the existing hidden decision-marker protocol and add one amount marker. A Supabase RPC atomically saves each Assistant reply and updates the single pending resolution for that evaluation; a second RPC confirms it idempotently. The Expo chat reads the record, renders it below its triggering Assistant message, and never maintains a separate total counter.

**Tech Stack:** Expo SDK 57, React Native 0.86, TanStack Query, Supabase Postgres/RLS/RPC, FastAPI, DeepSeek/OpenAI text services, Node test runner, pytest.

## Global Constraints

- Do not add a 24-hour timer, notifications, undo, achievements, rankings, or a total-cache column.
- Do not choose or add a page for displaying the aggregate total.
- Do not add dependencies.
- Unknown price means the Agent asks one question and emits no decision/action marker.
- Only confirmed records contribute to the future aggregate.
- One evaluation has at most one resolution; confirmed records are immutable.
- Preserve the existing uncommitted chat UI work and edit it surgically.
- Read `https://docs.expo.dev/versions/v57.0.0/` before changing the Expo UI, as required by `mobile/AGENTS.md`.

## File Map

- Create `supabase/migrations/202607240011_spending_resolutions.sql`: table, restored decision field, RLS, atomic reply-save RPC, and idempotent confirmation RPC.
- Create `mobile/src/lib/spending-resolution-markers.ts`: pure reply-marker parsing.
- Create `mobile/src/lib/spending-resolutions.ts`: record types, Supabase reads, and RPC calls.
- Create `mobile/tests/spending-resolutions.test.mjs`: parser and amount-validation checks.
- Modify `server/app/deepseek_service.py`: require a known price before a skip action and emit the exact amount marker.
- Modify `server/app/openai_service.py`: apply the same protocol to the fallback provider.
- Modify `server/app/main.py`: preserve hidden markers in the initial evaluation result so mobile can atomically persist the first reply.
- Modify `server/tests/test_deepseek_service.py`: assert the DeepSeek prompt contains the price/action contract.
- Modify `server/tests/test_openai_service.py`: assert the OpenAI prompt contains the same contract.
- Modify `mobile/src/lib/evaluations.ts`: route initial and continued Assistant replies through the atomic RPC.
- Modify `mobile/src/components/chat-conversation.tsx`: query, render, and confirm the message-linked card.

---

### Task 1: Add the owner-scoped resolution ledger and atomic RPCs

**Files:**
- Create: `supabase/migrations/202607240011_spending_resolutions.sql`

**Interfaces:**
- Produces: `public.spending_resolutions`.
- Produces: `public.save_evaluation_reply(uuid, text, text, numeric) returns uuid`.
- Produces: `public.confirm_spending_resolution(uuid) returns setof public.spending_resolutions`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/202607240011_spending_resolutions.sql` with this schema and these RPC boundaries:

```sql
alter table public.purchase_evaluations
  add column if not exists decision text not null default 'pending';

alter table public.purchase_evaluations
  drop constraint if exists purchase_evaluations_decision_check;

alter table public.purchase_evaluations
  add constraint purchase_evaluations_decision_check
  check (decision in ('pending', 'buy', 'skip'));

create table public.spending_resolutions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  evaluation_id uuid not null unique
    references public.purchase_evaluations(id),
  message_id uuid not null unique
    references public.evaluation_messages(id),
  amount numeric(12, 2) not null check (amount > 0),
  product_snapshot jsonb not null
    check (
      jsonb_typeof(product_snapshot) = 'object'
      and length(trim(product_snapshot->>'title')) > 0
    ),
  image_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index spending_resolutions_user_confirmed_idx
  on public.spending_resolutions (user_id, confirmed_at);

alter table public.spending_resolutions enable row level security;

create policy spending_resolutions_owner_select
  on public.spending_resolutions
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.spending_resolutions from anon, authenticated;
grant select on table public.spending_resolutions to authenticated;

create or replace function public.save_evaluation_reply(
  p_evaluation_id uuid,
  p_content text,
  p_decision text default null,
  p_amount numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation public.purchase_evaluations%rowtype;
  v_message_id uuid;
begin
  if length(trim(p_content)) = 0 or length(p_content) > 8000 then
    raise exception 'Invalid assistant message';
  end if;
  if p_decision is not null
    and p_decision not in ('buy', 'skip') then
    raise exception 'Invalid decision';
  end if;
  if p_amount is not null
    and (p_amount <= 0 or scale(p_amount) > 2) then
    raise exception 'Invalid resolution amount';
  end if;

  select *
  into v_evaluation
  from public.purchase_evaluations
  where id = p_evaluation_id
    and user_id = (select auth.uid())
  for update;

  if not found then
    raise exception 'Evaluation not found';
  end if;

  insert into public.evaluation_messages (
    evaluation_id, user_id, role, content
  )
  values (
    p_evaluation_id, (select auth.uid()), 'assistant', trim(p_content)
  )
  returning id into v_message_id;

  if p_decision is not null then
    update public.purchase_evaluations
    set decision = p_decision
    where id = p_evaluation_id;
  end if;

  if p_decision = 'buy' then
    delete from public.spending_resolutions
    where evaluation_id = p_evaluation_id
      and user_id = (select auth.uid())
      and confirmed_at is null;
  elsif p_decision = 'skip' and p_amount is not null then
    insert into public.spending_resolutions as existing (
      user_id,
      evaluation_id,
      message_id,
      amount,
      product_snapshot,
      image_paths
    )
    values (
      (select auth.uid()),
      p_evaluation_id,
      v_message_id,
      p_amount,
      jsonb_build_object(
        'url', v_evaluation.product_url,
        'title', v_evaluation.product_title,
        'price', v_evaluation.product_price,
        'category', v_evaluation.category,
        'subcategory', v_evaluation.subcategory,
        'source_type', v_evaluation.source_type,
        'source_text', v_evaluation.source_text
      ),
      v_evaluation.image_paths
    )
    on conflict (evaluation_id) do update
    set message_id = excluded.message_id,
        amount = excluded.amount,
        product_snapshot = excluded.product_snapshot,
        image_paths = excluded.image_paths,
        updated_at = now()
    where existing.confirmed_at is null;
  end if;

  return v_message_id;
end;
$$;

create or replace function public.confirm_spending_resolution(
  p_resolution_id uuid
)
returns setof public.spending_resolutions
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.spending_resolutions
  set confirmed_at = now(),
      updated_at = now()
  where id = p_resolution_id
    and user_id = (select auth.uid())
    and confirmed_at is null
  returning *;

  if not found then
    return query
    select *
    from public.spending_resolutions
    where id = p_resolution_id
      and user_id = (select auth.uid())
      and confirmed_at is not null;
  end if;
end;
$$;

revoke all on function public.save_evaluation_reply(
  uuid, text, text, numeric
) from public;
revoke all on function public.confirm_spending_resolution(uuid) from public;
grant execute on function public.save_evaluation_reply(
  uuid, text, text, numeric
) to authenticated;
grant execute on function public.confirm_spending_resolution(uuid)
  to authenticated;
```

- [ ] **Step 2: Verify the migration is syntactically deployable**

Run:

```bash
npx supabase db push \
  --db-url "$POSTGRES_URL_NON_POOLING" \
  --include-all \
  --dry-run
```

Expected: the dry run lists `202607240011_spending_resolutions.sql` and exits with code 0. Do not print the database URL.

- [ ] **Step 3: Apply and lint the migration**

Run:

```bash
npx supabase db push \
  --db-url "$POSTGRES_URL_NON_POOLING" \
  --include-all
npx supabase db lint \
  --db-url "$POSTGRES_URL_NON_POOLING"
```

Expected: the migration applies once; lint reports no new RLS or `security definer` warning.

- [ ] **Step 4: Commit the database boundary**

```bash
git add supabase/migrations/202607240011_spending_resolutions.sql
git commit -m "feat: add spending resolution ledger"
```

---

### Task 2: Define and test the Agent action protocol

**Files:**
- Create: `mobile/tests/spending-resolutions.test.mjs`
- Create: `mobile/src/lib/spending-resolution-markers.ts`
- Modify: `server/app/deepseek_service.py`
- Modify: `server/app/openai_service.py`
- Modify: `server/app/main.py`
- Modify: `server/tests/test_deepseek_service.py`
- Modify: `server/tests/test_openai_service.py`

**Interfaces:**
- Produces from `spending-resolution-markers.ts`: `parseEvaluationReply(message: string): ParsedEvaluationReply`.
- Produces from `spending-resolution-markers.ts`: `stripEvaluationMarks(message: string): string`.
- Produces: exact marker `[spending_resolution:699.00]`.
- Consumes: existing `[decision:buy]` and `[decision:skip]` markers.

- [ ] **Step 1: Write failing mobile parser tests**

Create `mobile/tests/spending-resolutions.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseEvaluationReply,
  stripEvaluationMarks,
} from '../src/lib/spending-resolution-markers.ts';

test('extracts a skip decision and positive amount', () => {
  assert.deepEqual(
    parseEvaluationReply(
      '这次更像重复消费。\\n[decision:skip]\\n[spending_resolution:699.00]',
    ),
    {
      decision: 'skip',
      resolutionAmount: 699,
      cleaned: '这次更像重复消费。',
    },
  );
});

test('does not create a resolution without a valid price', () => {
  for (const marker of [
    '[spending_resolution:]',
    '[spending_resolution:-1]',
    '[spending_resolution:1.999]',
    '[spending_resolution:abc]',
  ]) {
    assert.equal(parseEvaluationReply(`[decision:skip]\\n${marker}`).resolutionAmount, null);
  }
});

test('keeps buy and undecided replies free of a resolution', () => {
  assert.deepEqual(parseEvaluationReply('可以买。\\n[decision:buy]'), {
    decision: 'buy',
    resolutionAmount: null,
    cleaned: '可以买。',
  });
  assert.deepEqual(parseEvaluationReply('你每周会用几次？'), {
    decision: null,
    resolutionAmount: null,
    cleaned: '你每周会用几次？',
  });
});

test('strips both hidden markers from display text', () => {
  assert.equal(
    stripEvaluationMarks(
      '先不买。 [decision:skip] [spending_resolution:699.00]',
    ),
    '先不买。',
  );
});
```

- [ ] **Step 2: Run the parser tests to verify they fail**

Run:

```bash
cd mobile
node --test tests/spending-resolutions.test.mjs
```

Expected: FAIL because `src/lib/spending-resolution-markers.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure parser**

Create `mobile/src/lib/spending-resolution-markers.ts` with:

```ts
export type ReplyDecision = 'buy' | 'skip';

export type ParsedEvaluationReply = {
  decision: ReplyDecision | null;
  resolutionAmount: number | null;
  cleaned: string;
};

const decisionPattern = /\s*\[decision:(buy|skip)\]\s*/gi;
const resolutionPattern =
  /\s*\[spending_resolution:([^\]]*)\]\s*/gi;

export function parseEvaluationReply(
  message: string,
): ParsedEvaluationReply {
  let decision: ReplyDecision | null = null;
  let resolutionAmount: number | null = null;
  let cleaned = message.replace(decisionPattern, (_, value: string) => {
    decision = value.toLowerCase() as ReplyDecision;
    return '\n';
  });
  cleaned = cleaned.replace(resolutionPattern, (_, value: string) => {
    if (/^\d+(?:\.\d{1,2})?$/.test(value)) {
      const amount = Number(value);
      if (amount > 0 && amount <= 9_999_999_999.99) {
        resolutionAmount = amount;
      }
    }
    return '\n';
  });
  return {
    decision,
    resolutionAmount: decision === 'skip' ? resolutionAmount : null,
    cleaned: cleaned.trim(),
  };
}

export function stripEvaluationMarks(message: string): string {
  return parseEvaluationReply(message).cleaned;
}
```

Keep this module free of Supabase and path-alias imports so Node's built-in test runner can load it directly.

- [ ] **Step 4: Make both AI providers use the exact trigger contract**

In the active DeepSeek tool prompt in `server/app/deepseek_service.py` and the OpenAI evaluation prompt in `server/app/openai_service.py`, add these exact rules:

```text
只有在以下条件同时满足时才给最终结论：用户在考虑具体商品；已了解商品价格；
已获得至少一项与该用户有关的购买或使用依据；信息已经足够，或用户明确要求直接
给结论。价格未知时，每轮最多追问一个价格问题，不得猜测价格，也不得输出决策
标记。建议不买时，在 [decision:skip] 后再单独一行输出
[spending_resolution:金额]，金额使用正数且最多两位小数。建议买时只输出
[decision:buy]。尚需澄清时不输出任何标记。
```

Apply the same wording to DeepSeek's non-tool `_evaluation_messages` prompt so both current and fallback paths agree.

In `server/app/main.py`, remove the `re.sub(...)` cleanup around the initial `opening` reply, assign `result.narrative = opening.strip()`, and remove the now-unused `re` import. Mobile will clean and persist both markers atomically.

- [ ] **Step 5: Add prompt-contract assertions**

Extend `server/tests/test_deepseek_service.py` after `test_continues_evaluation_with_prior_messages`:

```python
def test_evaluation_prompt_requires_price_for_skip_resolution() -> None:
    service = service_with("价格是多少？")
    service.continue_evaluation(
        ParsedProduct(
            title="耳机",
            category="数码",
            subcategory="耳机",
            source_type="text",
            source_text="耳机",
        ),
        [],
        EvaluationFacts(total=0, in_use=0, idle=0, listed=0, sold=0),
        [EvaluationChatMessage(role="user", content="我想买")],
        "user",
    )
    prompt = service.client.chat.completions.create.call_args.kwargs["messages"][0]["content"]
    assert "价格未知时" in prompt
    assert "[spending_resolution:金额]" in prompt
```

Also import `_TOOLS_SYSTEM_PROMPT` from `app.deepseek_service` and add:

```python
def test_tool_prompt_uses_resolution_contract() -> None:
    assert "价格未知时" in _TOOLS_SYSTEM_PROMPT
    assert "[spending_resolution:金额]" in _TOOLS_SYSTEM_PROMPT
```

Extend `server/tests/test_openai_service.py` after the existing evaluation test:

```python
def test_openai_evaluation_prompt_uses_resolution_contract() -> None:
    service = object.__new__(OpenAIService)
    service.client = Mock()
    service.client.responses.create.return_value.output_text = "价格是多少？"
    service.model = "test-model"

    from app.models import EvaluationChatMessage, EvaluationFacts, ParsedProduct

    service.continue_evaluation(
        ParsedProduct(
            title="耳机",
            category="数码",
            subcategory="耳机",
            source_type="text",
            source_text="耳机",
        ),
        [],
        EvaluationFacts(total=0, in_use=0, idle=0, listed=0, sold=0),
        [EvaluationChatMessage(role="user", content="我想买")],
        "user",
    )
    prompt = service.client.responses.create.call_args.kwargs["input"][0]["content"]
    assert "价格未知时" in prompt
    assert "[spending_resolution:金额]" in prompt
```

- [ ] **Step 6: Run focused protocol tests**

Run:

```bash
cd mobile
node --test tests/spending-resolutions.test.mjs
cd ../server
pytest tests/test_deepseek_service.py tests/test_openai_service.py -q
```

Expected: all spending-resolution parser tests and both provider prompt-contract tests pass.

- [ ] **Step 7: Commit the protocol**

```bash
git add \
  mobile/src/lib/spending-resolution-markers.ts \
  mobile/tests/spending-resolutions.test.mjs \
  server/app/deepseek_service.py \
  server/app/openai_service.py \
  server/app/main.py \
  server/tests/test_deepseek_service.py \
  server/tests/test_openai_service.py
git commit -m "feat: add spending resolution action protocol"
```

---

### Task 3: Route Assistant replies through the atomic persistence boundary

**Files:**
- Create: `mobile/src/lib/spending-resolutions.ts`
- Modify: `mobile/src/lib/evaluations.ts`
- Modify: `mobile/src/components/chat-conversation.tsx`

**Interfaces:**
- Consumes: `save_evaluation_reply`, `SpendingResolution`, and `parseEvaluationReply` from Tasks 1–2.
- Produces: `saveEvaluationReply(evaluationId, rawMessage)`.
- Produces: `getSpendingResolution(evaluationId)`.
- Produces: `confirmSpendingResolution(resolutionId)`.

- [ ] **Step 1: Add the three minimal Supabase functions**

Create `mobile/src/lib/spending-resolutions.ts`:

```ts
import { parseEvaluationReply } from '@/lib/spending-resolution-markers';
import { supabase } from '@/lib/supabase';

export type SpendingResolution = {
  id: string;
  user_id: string;
  evaluation_id: string;
  message_id: string;
  amount: number;
  product_snapshot: {
    url: string;
    title: string;
    price: number | null;
    category: string;
    subcategory: string;
    source_type: 'url' | 'text' | 'image';
    source_text: string;
  };
  image_paths: string[];
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
};

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function saveEvaluationReply(
  evaluationId: string,
  rawMessage: string,
): Promise<string> {
  const parsed = parseEvaluationReply(rawMessage);
  const { data, error } = await supabase.rpc('save_evaluation_reply', {
    p_evaluation_id: evaluationId,
    p_content: parsed.cleaned,
    p_decision: parsed.decision,
    p_amount: parsed.resolutionAmount,
  });
  fail(error);
  return data as string;
}

export async function getSpendingResolution(
  evaluationId: string,
): Promise<SpendingResolution | null> {
  const { data, error } = await supabase
    .from('spending_resolutions')
    .select('*')
    .eq('evaluation_id', evaluationId)
    .maybeSingle();
  fail(error);
  return data as SpendingResolution | null;
}

export async function confirmSpendingResolution(
  resolutionId: string,
): Promise<SpendingResolution> {
  const { data, error } = await supabase
    .rpc('confirm_spending_resolution', {
      p_resolution_id: resolutionId,
    })
    .single();
  fail(error);
  return data as SpendingResolution;
}
```

- [ ] **Step 2: Make initial evaluation persistence atomic**

In `mobile/src/lib/evaluations.ts`:

- Import `parseEvaluationReply` and `saveEvaluationReply`.
- Parse `result.narrative` before inserting `purchase_evaluations`.
- Save `parsed.cleaned` into the evaluation's `narrative`.
- Replace the initial `createEvaluationMessage(..., 'assistant', ...)` call with `saveEvaluationReply(evaluation.id, result.narrative)`.
- Keep the existing cleanup that deletes the new evaluation if its first Assistant reply cannot be saved.
- Replace `stripDecisionMark` implementation with `stripEvaluationMarks`.
- Remove `updateEvaluationDecision` after Task 3 removes its final caller.

The core changed block must be:

```ts
const parsed = parseEvaluationReply(result.narrative);
const { data, error } = await supabase
  .from('purchase_evaluations')
  .insert({
    user_id: userId,
    product_url: product.url,
    product_title: product.title,
    product_price: product.price,
    category: product.category,
    subcategory: product.subcategory,
    matched_assets: result.matched_assets,
    facts: result.facts,
    narrative: parsed.cleaned,
    parser_snapshot: { product },
    source_type: product.source_type,
    source_text: product.source_text,
    image_paths: options.imagePaths ?? [],
  })
  .select('*')
  .single();
```

- [ ] **Step 3: Make continued Assistant replies atomic**

In `mobile/src/components/chat-conversation.tsx`:

- Replace `extractDecision`, `updateEvaluationDecision`, and direct Assistant `createEvaluationMessage` imports with `saveEvaluationReply`.
- Keep direct user-message insertion unchanged.
- After streaming completes, call only:

```ts
await saveEvaluationReply(item.id, message);
```

- Add `['spending-resolution', evaluationId]` to the existing invalidation batch.
- Continue using the cleaned display helper for both stored and streaming text.

- [ ] **Step 4: Run focused persistence regression checks**

Run:

```bash
cd mobile
node --test tests/spending-resolutions.test.mjs
npx tsc --noEmit
```

Expected: parser tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit atomic mobile persistence**

```bash
git add \
  mobile/src/lib/spending-resolutions.ts \
  mobile/src/lib/evaluations.ts \
  mobile/src/components/chat-conversation.tsx
git commit -m "feat: persist spending resolutions atomically"
```

---

### Task 4: Render and confirm the message-linked card

**Files:**
- Modify: `mobile/src/components/chat-conversation.tsx`

**Interfaces:**
- Consumes: `getSpendingResolution(evaluationId)`.
- Consumes: `confirmSpendingResolution(resolutionId)`.
- Renders the record only after the Assistant message whose ID equals `resolution.message_id`.

- [ ] **Step 1: Query the single resolution with the conversation**

Add a query beside the existing message query:

```ts
const resolutionQuery = useQuery({
  queryKey: ['spending-resolution', evaluationId],
  queryFn: () => getSpendingResolution(evaluationId),
  enabled: Boolean(evaluationId),
});
```

Add local state:

```ts
const [confirmingResolution, setConfirmingResolution] = useState(false);
const [resolutionError, setResolutionError] = useState('');
```

Reset `resolutionError` when `evaluationId` changes.

- [ ] **Step 2: Add the idempotent confirmation handler**

Inside `ChatConversation`, add:

```ts
const confirmResolution = async () => {
  const resolution = resolutionQuery.data;
  if (!resolution || resolution.confirmed_at || confirmingResolution) return;
  setConfirmingResolution(true);
  setResolutionError('');
  try {
    await confirmSpendingResolution(resolution.id);
    await queryClient.invalidateQueries({
      queryKey: ['spending-resolution', evaluationId],
    });
  } catch {
    setResolutionError('确认失败，请重试');
  } finally {
    setConfirmingResolution(false);
  }
};
```

- [ ] **Step 3: Render the card under its triggering Assistant message**

Wrap each message in a keyed `View`. Immediately after `MessageBubble`, render `SpendingResolutionCard` only when:

```ts
message.role === 'assistant' &&
resolutionQuery.data?.message_id === message.id
```

Keep the component in `chat-conversation.tsx`; it is single-use. Its props are:

```ts
{
  resolution: SpendingResolution;
  confirming: boolean;
  error: string;
  onConfirm: () => void;
}
```

Add a local formatter so cents are never silently rounded away:

```ts
const formatResolutionAmount = (amount: number) =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
```

The card copy and states are exact:

- Pending title: `这次先不买`
- Pending amount: `留下 ${formatResolutionAmount(resolution.amount)}`
- Pending button: `确认不买`
- Confirmed title: `已忍住 ${formatResolutionAmount(resolution.amount)}`
- Confirmed caption: format `confirmed_at` with the existing date formatter or `toLocaleString('zh-CN')`
- Failure caption fallback: `确认失败，请重试`

Use `colors.surface`, `colors.border`, `radius.large`, and existing spacing constants. The button must have `accessibilityRole="button"`, an amount-specific accessibility label, and `accessibilityState={{ disabled: confirming }}`. Do not copy the reference card's “心愿基金” wording or blue pill treatment.

- [ ] **Step 4: Verify interaction and history restoration**

Run:

```bash
cd mobile
node --test tests/*.test.mjs
npx tsc --noEmit
npm run lint
```

Expected: all Node tests pass, TypeScript reports no errors, and lint introduces no new error.

Then run the app and verify this exact sequence:

1. Start an evaluation without a price; Agent asks for price and no card appears.
2. Provide a price and enough personal context for a skip conclusion.
3. Confirm the card; it changes to `已忍住 ¥金额` and loses its button.
4. Tap confirm twice quickly or retry the same RPC; only one record exists and `confirmed_at` remains one timestamp.
5. Reopen the conversation; the card appears below the original Assistant message.
6. In a fresh unconfirmed conversation, continue until Agent changes to `buy`; the pending card disappears.

- [ ] **Step 5: Run full server regression**

Run:

```bash
cd server
pytest -q
```

Expected: the complete server suite passes.

- [ ] **Step 6: Commit the card**

```bash
git add mobile/src/components/chat-conversation.tsx
git commit -m "feat: confirm skipped purchases in chat"
```

---

## Final Verification

- [ ] Run `git diff --check`.
- [ ] Run `git status --short` and confirm only pre-existing unrelated user changes remain.
- [ ] Query confirmed total with `sum(amount)` filtered by the authenticated `user_id` and `confirmed_at is not null`; do not add a cached total.
- [ ] Confirm no code, copy, route, or navigation item was added for displaying the future aggregate.
