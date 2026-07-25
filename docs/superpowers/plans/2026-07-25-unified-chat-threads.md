# Unified Chat Threads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `agent_threads` the only chat history unit, store all bubbles in `agent_messages`, let multiple `purchase_evaluations` grow from one thread, and show decision UI only as inline cards under assistant messages.

**Architecture:** One SQL migration rewires schema + data + `save_evaluation_reply`. Mobile talks only to threads/messages; creating a product evaluation attaches `thread_id` and writes the first assistant reply through the updated RPC. The chat tab is a single thread timeline (blank until first message); the drawer lists threads.

**Tech Stack:** Supabase Postgres/RLS/RPC, Expo Router, TanStack Query, existing `EvaluationComposer` / spending-resolution markers, TypeScript (`npx tsc --noEmit` in `mobile/`).

## Global Constraints

- Do not rename the `(evaluation)` route directory to `(chat)`.
- Do not delete the `evaluation_messages` table in this change (stop writing to it only).
- Do not change decision-marker / 忍住消费 / memory / followup business rules.
- No top-of-scroll sticky `PurchaseOutcomeControls`; decision/outcome UI is message-inline only.
- Empty「新聊天」must not create a thread until the first message.
- User-facing chrome stays「聊天 / 最近 / 新聊天 / 还没有记录」.
- Read `https://docs.expo.dev/versions/v57.0.0/` before Expo UI changes (`mobile/AGENTS.md`).

## File Map

| File | Responsibility |
| --- | --- |
| `supabase/migrations/202607250008_unified_chat_threads.sql` | Schema, data migration, RPC rewrite |
| `mobile/src/lib/agent-chat.ts` | Multi-thread CRUD + list + messages + route_result |
| `mobile/src/lib/evaluations.ts` | `thread_id` on create; drop message helpers that write `evaluation_messages` |
| `mobile/src/lib/spending-resolutions.ts` | Resolutions by thread (multi-eval) |
| `mobile/src/components/chat-thread.tsx` | Unified timeline + inline cards + send routing |
| `mobile/src/components/chat-history-drawer.tsx` | List `AgentThreadListItem` instead of evaluations |
| `mobile/src/app/(tabs)/(evaluation)/index.tsx` | `threadId` state, wire drawer + `ChatThread` |
| `mobile/src/app/(tabs)/(evaluation)/[id].tsx` | Resolve evaluation → threadId redirect |
| `mobile/src/app/(tabs)/(account)/memories.tsx` | Deep link via evaluation → thread |
| `docs/architecture/chat-module-v1.md` | Document unified thread model |

---

### Task 1: Schema migration + `save_evaluation_reply` → `agent_messages`

**Files:**
- Create: `supabase/migrations/202607250008_unified_chat_threads.sql`

**Interfaces:**
- Produces: `purchase_evaluations.thread_id` (NOT NULL after backfill)
- Produces: `spending_resolutions.message_id` FK → `agent_messages(id)`
- Produces: updated `save_evaluation_reply(...)` inserting into `agent_messages`
- Consumes: existing `evaluation_messages`, `agent_threads`, `agent_messages`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/202607250008_unified_chat_threads.sql` with the following (keep as one transactional migration):

```sql
-- 1) Allow multiple free-form threads; stop requiring thread.evaluation_id
alter table public.agent_threads
  drop constraint if exists agent_threads_kind_check;

alter table public.agent_threads
  drop constraint if exists agent_threads_check;

-- Keep kind values for readability; both kinds may have null evaluation_id
alter table public.agent_threads
  add constraint agent_threads_kind_check
  check (kind in ('general', 'purchase_evaluation'));

alter table public.agent_threads
  alter column evaluation_id drop not null;

-- Clear unused thread-level evaluation pointer (multi-eval lives on purchase_evaluations)
update public.agent_threads set evaluation_id = null;

-- 2) Evaluations belong to a thread
alter table public.purchase_evaluations
  add column if not exists thread_id uuid
    references public.agent_threads(id) on delete cascade;

create index if not exists purchase_evaluations_thread_updated_idx
  on public.purchase_evaluations (thread_id, updated_at desc);

-- 3) Detach spending_resolutions.message_id from evaluation_messages
alter table public.spending_resolutions
  drop constraint if exists spending_resolutions_message_id_fkey;

-- 4) Backfill: one thread per existing evaluation + migrate messages
do $$
declare
  r record;
  m record;
  v_thread_id uuid;
  v_new_msg_id uuid;
  v_key text;
begin
  for r in
    select *
    from public.purchase_evaluations
    where thread_id is null
    order by created_at
  loop
    v_key := 'eval:' || r.id::text;

    insert into public.agent_threads (
      user_id, thread_key, kind, title, created_at, updated_at
    )
    values (
      r.user_id,
      v_key,
      'general',
      coalesce(nullif(trim(r.product_title), ''), '聊天'),
      r.created_at,
      coalesce(r.updated_at, r.created_at)
    )
    on conflict (user_id, thread_key) do nothing;

    select id into v_thread_id
    from public.agent_threads
    where user_id = r.user_id and thread_key = v_key;

    update public.purchase_evaluations
    set thread_id = v_thread_id
    where id = r.id;

    for m in
      select *
      from public.evaluation_messages
      where evaluation_id = r.id
      order by created_at
    loop
      insert into public.agent_messages (
        thread_id, user_id, role, content, route_result, created_at
      )
      values (
        v_thread_id,
        m.user_id,
        m.role,
        m.content,
        jsonb_build_object(
          'evaluation_id', r.id,
          'migrated_from_evaluation_message_id', m.id
        ),
        m.created_at
      )
      returning id into v_new_msg_id;

      update public.spending_resolutions
      set message_id = v_new_msg_id
      where evaluation_id = r.id
        and message_id = m.id;
    end loop;
  end loop;
end $$;

-- Evaluations with no messages still need a thread (loop above covers all null thread_id)
-- Enforce NOT NULL for new rows
alter table public.purchase_evaluations
  alter column thread_id set not null;

-- 5) Point message_id FK at agent_messages
alter table public.spending_resolutions
  add constraint spending_resolutions_message_id_fkey
  foreign key (message_id) references public.agent_messages(id);

-- 6) Rewrite save_evaluation_reply to write agent_messages
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
  if p_content is null
    or length(trim(p_content)) = 0
    or length(p_content) > 8000 then
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

  if v_evaluation.thread_id is null then
    raise exception 'Evaluation has no thread';
  end if;

  insert into public.agent_messages (
    thread_id, user_id, role, content, route_result
  )
  values (
    v_evaluation.thread_id,
    (select auth.uid()),
    'assistant',
    trim(p_content),
    jsonb_build_object('evaluation_id', p_evaluation_id)
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
```

Evaluations with zero messages still receive a `thread_id` (outer loop). Existing `thread_key = 'general'` rows are left as-is (one historical free-chat thread).

- [ ] **Step 2: Apply migration locally**

Run your usual Supabase migrate command for this repo (e.g. `supabase db push` or linked remote SQL). Expected: succeeds with no FK violations on `spending_resolutions`.

Verify:

```sql
select count(*) from purchase_evaluations where thread_id is null; -- 0
select count(*) from spending_resolutions sr
left join agent_messages am on am.id = sr.message_id
where am.id is null; -- 0
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/202607250008_unified_chat_threads.sql
git commit -m "$(cat <<'EOF'
feat(db): unify chat messages onto agent threads

EOF
)"
```

---

### Task 2: Mobile thread library

**Files:**
- Modify: `mobile/src/lib/agent-chat.ts`
- Modify: `mobile/src/lib/evaluations.ts` (types + create with `threadId`)
- Modify: `mobile/src/lib/spending-resolutions.ts` (`listSpendingResolutionsForThread`)

**Interfaces:**
- Produces:

```ts
// agent-chat.ts
export type AgentThread = {
  id: string;
  user_id: string;
  thread_key: string;
  kind: 'general' | 'purchase_evaluation';
  evaluation_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
};

export type AgentThreadListItem = AgentThread & {
  latest_decision: 'pending' | 'buy' | 'skip' | null;
};

export type AgentMessage = {
  id: string;
  thread_id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  route_result: Record<string, unknown>;
  created_at: string;
};

export async function createAgentThread(
  userId: string,
  title: string,
): Promise<AgentThread>;

export async function listAgentThreads(): Promise<AgentThreadListItem[]>;

export async function updateAgentThreadTitle(
  threadId: string,
  title: string,
): Promise<void>;

export async function getThreadIdForEvaluation(
  evaluationId: string,
): Promise<string | null>;

export async function listAgentMessages(threadId: string): Promise<AgentMessage[]>;

export async function createAgentMessage(
  threadId: string,
  userId: string,
  role: 'user' | 'assistant',
  content: string,
  routeResult?: Record<string, unknown>,
): Promise<AgentMessage>;

// Remove or stop calling getOrCreateGeneralThread from UI (may delete function).
```

```ts
// evaluations.ts — createPurchaseEvaluation gains required threadId
export async function createPurchaseEvaluation(
  userId: string,
  threadId: string,
  result: PurchaseEvaluationResult,
  options?: { imagePaths?: string[] },
): Promise<PurchaseEvaluation>;

export async function listEvaluationsForThread(
  threadId: string,
): Promise<PurchaseEvaluation[]>;

// Delete or stop exporting listEvaluationMessages / createEvaluationMessage
// (no callers after Task 4).
```

```ts
// spending-resolutions.ts
export async function listSpendingResolutionsForThread(
  threadId: string,
): Promise<SpendingResolution[]>;
```

- [ ] **Step 1: Replace `agent-chat.ts` implementations**

```ts
export async function createAgentThread(
  userId: string,
  title: string,
): Promise<AgentThread> {
  const threadKey = crypto.randomUUID();
  const trimmed = title.trim().slice(0, 40) || '聊天';
  const { data, error } = await supabase
    .from('agent_threads')
    .insert({
      user_id: userId,
      thread_key: threadKey,
      kind: 'general',
      title: trimmed,
    })
    .select('*')
    .single();
  fail(error);
  return data as AgentThread;
}

export async function listAgentThreads(): Promise<AgentThreadListItem[]> {
  const { data: threads, error } = await supabase
    .from('agent_threads')
    .select('*')
    .order('updated_at', { ascending: false });
  fail(error);
  const list = (threads ?? []) as AgentThread[];
  if (!list.length) return [];

  const ids = list.map((t) => t.id);
  const { data: evaluations, error: evalError } = await supabase
    .from('purchase_evaluations')
    .select('thread_id, decision, updated_at')
    .in('thread_id', ids)
    .order('updated_at', { ascending: false });
  fail(evalError);

  const latestDecision = new Map<string, 'pending' | 'buy' | 'skip'>();
  for (const row of evaluations ?? []) {
    if (!latestDecision.has(row.thread_id)) {
      latestDecision.set(row.thread_id, row.decision ?? 'pending');
    }
  }

  return list.map((thread) => ({
    ...thread,
    latest_decision: latestDecision.get(thread.id) ?? null,
  }));
}

export async function createAgentMessage(
  threadId: string,
  userId: string,
  role: AgentMessage['role'],
  content: string,
  routeResult: Record<string, unknown> = {},
): Promise<AgentMessage> {
  const { data, error } = await supabase
    .from('agent_messages')
    .insert({
      thread_id: threadId,
      user_id: userId,
      role,
      content: content.trim(),
      route_result: routeResult,
    })
    .select('*')
    .single();
  fail(error);
  return data as AgentMessage;
}
```

Implement `updateAgentThreadTitle`, `getThreadIdForEvaluation` (`select thread_id from purchase_evaluations where id = ?`), and keep `listAgentMessages` as today (by `thread_id`). Remove `getOrCreateGeneralThread`.

For `thread_key`, use:
```ts
import * as Crypto from 'expo-crypto';
// ...
const threadKey = Crypto.randomUUID();
```
If `expo-crypto` is not already a dependency, run `npx expo install expo-crypto` in the same task before importing.

- [ ] **Step 2: Update `createPurchaseEvaluation` and helpers**

Insert must include `thread_id: threadId`. Add `listEvaluationsForThread`. Leave `PurchaseEvaluation` type with optional/required `thread_id: string`.

- [ ] **Step 3: Add `listSpendingResolutionsForThread`**

```ts
export async function listSpendingResolutionsForThread(
  threadId: string,
): Promise<SpendingResolution[]> {
  const { data: evaluations, error: evalError } = await supabase
    .from('purchase_evaluations')
    .select('id')
    .eq('thread_id', threadId);
  fail(evalError);
  const ids = (evaluations ?? []).map((row) => row.id);
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('spending_resolutions')
    .select('*')
    .in('evaluation_id', ids);
  fail(error);
  return (data ?? []) as SpendingResolution[];
}
```

- [ ] **Step 4: Typecheck**

```bash
cd mobile && npx tsc --noEmit
```

Expected: errors only in callers still using old APIs (fixed in later tasks). If `tsc` is not configured, run `npm run lint` and fix library files until clean.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/agent-chat.ts mobile/src/lib/evaluations.ts mobile/src/lib/spending-resolutions.ts
git commit -m "$(cat <<'EOF'
feat(mobile): add multi-thread agent chat APIs

EOF
)"
```

---

### Task 3: History drawer lists threads

**Files:**
- Modify: `mobile/src/components/chat-history-drawer.tsx`

**Interfaces:**
- Consumes: `AgentThreadListItem`, `evaluationDecisionLabels`, `formatDate`
- Produces:

```ts
export function ChatHistoryDrawer(props: {
  items: AgentThreadListItem[];
  loading: boolean;
  errorMessage?: string;
  selectedId?: string | null;
  onSelect: (threadId: string) => void;
  onNewChat: () => void;
  onClose: () => void;
}): JSX.Element;
```

- [ ] **Step 1: Switch list rendering to threads**

Replace `PurchaseEvaluation` usage:

- `key={item.id}` / `onSelect(item.id)` stay (now thread ids)
- Title: `item.title || '聊天'`
- Subtitle: if `item.latest_decision` then `${evaluationDecisionLabels[item.latest_decision]} · ${formatDate(item.updated_at)}`, else `formatDate(item.updated_at)` only
- Accessibility label: thread title

Keep layout, empty copy「还没有记录」, and「新聊天」CTA unchanged.

- [ ] **Step 2: Commit**

```bash
git add mobile/src/components/chat-history-drawer.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): show agent threads in chat history drawer

EOF
)"
```

---

### Task 4: Unified `ChatThread` timeline component

**Files:**
- Create: `mobile/src/components/chat-thread.tsx`
- Modify or slim: `mobile/src/components/chat-conversation.tsx` (delete after callers move, or re-export temporarily)

**Interfaces:**
- Consumes: `listAgentMessages`, `createAgentMessage`, `createAgentThread`, `updateAgentThreadTitle`, `createPurchaseEvaluation`, `listEvaluationsForThread`, `listSpendingResolutionsForThread`, `saveEvaluationReply`, `confirmSpendingResolution`, `chatFreely`, `evaluatePurchase`, `streamPurchaseEvaluation`, `normalizeProductText`, `parseProduct`, `analyzeProductPhotos`, upload helpers, `PurchaseOutcomeControls` (inline only), `EvaluationComposer`
- Produces:

```ts
export function ChatThread(props: {
  threadId: string | null;
  onThreadIdChange: (threadId: string) => void;
  onTitleChange?: (title: string) => void;
}): JSX.Element;
```

- [ ] **Step 1: Scaffold queries + message list**

When `threadId` is null: render empty `ScrollView` + composer only (no loading spinner for missing history).

When `threadId` set:

```ts
const messagesQuery = useQuery({
  queryKey: ['agent-messages', threadId],
  queryFn: () => listAgentMessages(threadId!),
  enabled: Boolean(threadId),
});
const evaluationsQuery = useQuery({
  queryKey: ['thread-evaluations', threadId],
  queryFn: () => listEvaluationsForThread(threadId!),
  enabled: Boolean(threadId),
});
const resolutionsQuery = useQuery({
  queryKey: ['thread-resolutions', threadId],
  queryFn: () => listSpendingResolutionsForThread(threadId!),
  enabled: Boolean(threadId),
});
```

Render each message bubble. Under an assistant message:

1. If a `SpendingResolution` has `message_id === message.id`, render `SpendingResolutionCard` (move the existing card helper from `chat-conversation.tsx`).
2. If that message’s `route_result.evaluation_id` points to an evaluation whose `decision` is `buy` or `skip` (or always when evaluation exists and `user_choice === 'pending'`), render **inline** `PurchaseOutcomeControls` for that evaluation — never above the list.

Do **not** render sticky header `PurchaseOutcomeControls`.

- [ ] **Step 2: Implement `send` routing**

Mirror current `analyze` + evaluation follow-up logic in one function:

1. Ensure thread: if `!threadId`, `createAgentThread(userId, text.slice(0, 40) || '聊天')`, call `onThreadIdChange`, invalidate `['agent-threads']`.
2. Persist user `createAgentMessage(thread.id, userId, 'user', text)`.
3. Branch:
   - photos / URL / product intent → `evaluatePurchase` → `createPurchaseEvaluation(userId, thread.id, result, { imagePaths })` (RPC writes assistant narrative) → `updateAgentThreadTitle(thread.id, product.title)` → invalidate messages/evaluations/resolutions/threads.
   - chat intent → `chatFreely` with last 100 thread messages → `createAgentMessage(..., 'assistant', reply)`.
4. If `threadId` already bound to an evaluation follow-up (composer send while continuing product chat): when the latest user intent is still about the active evaluation, use `streamPurchaseEvaluation` + `saveEvaluationReply` like today’s `ChatConversation.send`. Practical rule for v1:
   - If photos/URL/new product text → new evaluation on this thread.
   - Else if thread has evaluations and `normalizeProductText` returns `chat` → free chat.
   - Else if thread has a “active” evaluation id from the last message with `route_result.evaluation_id` and input looks like follow-up (no new product) → stream against that evaluation.
   - Else product → new evaluation.

Keep keyboard avoid / scroll-to-end behavior from `chat-conversation.tsx`.

- [ ] **Step 3: Port streaming + resolution confirm**

Copy `send` streaming path and `SpendingResolutionCard` confirm handlers from `chat-conversation.tsx`, keyed by thread query invalidations (`['agent-messages', threadId]`, `['thread-resolutions', threadId]`, etc.).

- [ ] **Step 4: Remove old conversation mount path**

After `index.tsx` uses `ChatThread`, delete `chat-conversation.tsx` or leave a thin deprecated re-export for one commit then delete.

- [ ] **Step 5: Typecheck + commit**

```bash
cd mobile && npx tsc --noEmit
git add mobile/src/components/chat-thread.tsx mobile/src/components/chat-conversation.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): add unified chat thread timeline

EOF
)"
```

---

### Task 5: Wire chat index to `threadId`

**Files:**
- Modify: `mobile/src/app/(tabs)/(evaluation)/index.tsx`

**Interfaces:**
- Consumes: `listAgentThreads`, `ChatThread`, `ChatHistoryDrawer`
- Route params: prefer `threadId`; accept legacy `evaluationId` and resolve once

- [ ] **Step 1: Replace evaluation-centric state**

```ts
const params = useLocalSearchParams<{
  threadId?: string;
  evaluationId?: string;
}>();
const [activeThreadId, setActiveThreadId] = useState<string | null>(
  typeof params.threadId === 'string' ? params.threadId : null,
);
const threads = useQuery({
  queryKey: ['agent-threads'],
  queryFn: listAgentThreads,
});
```

Remove `generalThread` / `generalMessages` / `generalVisibleSince` / local `analyze` product pipeline (owned by `ChatThread`).

- [ ] **Step 2: Resolve legacy `evaluationId`**

```ts
useEffect(() => {
  if (typeof params.threadId === 'string' && params.threadId) {
    setActiveThreadId(params.threadId);
    return;
  }
  if (typeof params.evaluationId !== 'string' || !params.evaluationId) return;
  let cancelled = false;
  getThreadIdForEvaluation(params.evaluationId).then((threadId) => {
    if (cancelled || !threadId) return;
    setActiveThreadId(threadId);
    router.setParams({ threadId, evaluationId: undefined });
  });
  return () => {
    cancelled = true;
  };
}, [params.threadId, params.evaluationId]);
```

- [ ] **Step 3: Wire drawer + main body**

```tsx
<ChatHistoryDrawer
  items={threads.data ?? []}
  loading={threads.isLoading}
  errorMessage={threads.error?.message}
  selectedId={activeThreadId}
  onClose={() => setOpen(false)}
  onSelect={(id) => {
    setActiveThreadId(id);
    setOpen(false);
    router.setParams({ threadId: id });
  }}
  onNewChat={() => {
    setActiveThreadId(null);
    setConversationTitle('聊天');
    setOpen(false);
    router.replace('/(tabs)/(evaluation)');
  }}
/>

<ChatThread
  threadId={activeThreadId}
  onThreadIdChange={(id) => {
    setActiveThreadId(id);
    router.setParams({ threadId: id });
  }}
  onTitleChange={setConversationTitle}
/>
```

Header title: `activeThreadId ? conversationTitle : '聊天'`.

- [ ] **Step 4: Manual smoke + commit**

Smoke: open chat → blank; send「hello」→ thread in drawer; new chat → blank again; old hello still in drawer.

```bash
git add mobile/src/app/\(tabs\)/\(evaluation\)/index.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): drive chat tab by agent thread id

EOF
)"
```

---

### Task 6: Deep links + architecture doc

**Files:**
- Modify: `mobile/src/app/(tabs)/(evaluation)/[id].tsx`
- Modify: `mobile/src/app/(tabs)/(account)/memories.tsx`
- Modify: `docs/architecture/chat-module-v1.md`

- [ ] **Step 1: Legacy `[id]` redirect**

Keep redirect to chat tab with `evaluationId` (index resolves to `threadId`), or resolve in the redirect:

```tsx
// Prefer passing evaluationId; index effect maps to threadId.
params: { evaluationId: id }
```

- [ ] **Step 2: Memories navigation**

Where memories navigate with `params: { id: item.evaluation_id }` to evaluation `[id]`, keep that path (redirect chain works) **or** navigate to `/(tabs)/(evaluation)` with `evaluationId`. Do not leave dead links.

- [ ] **Step 3: Update architecture doc**

In `docs/architecture/chat-module-v1.md`:

- Table row: 自由聊天 + 购物评估对话 both use `agent_threads` / `agent_messages`; `purchase_evaluations` is structured result hanging off `thread_id` (1:N).
- Remove / rewrite §5 bullet「尚未统一为单一线程模型」→ implemented; note `evaluation_messages` retained but unused for writes.

- [ ] **Step 4: Final verification checklist**

- [ ] New chat blank; first message creates drawer row
- [ ] Same thread: chat then product → one history row, continuous timeline
- [ ] Second product in same thread → still one history row; two evaluations; inline cards per message
- [ ] No sticky「你后来怎么选的？」at top
- [ ] 忍住消费 confirm still once
- [ ] Memory/followup link opens correct thread
- [ ] `cd mobile && npx tsc --noEmit` clean

- [ ] **Step 5: Commit**

```bash
git add mobile/src/app/\(tabs\)/\(evaluation\)/\[id\].tsx mobile/src/app/\(tabs\)/\(account\)/memories.tsx docs/architecture/chat-module-v1.md
git commit -m "$(cat <<'EOF'
docs: mark chat module as unified thread model

EOF
)"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
| --- | --- |
| History = threads only | 3, 5 |
| New chat blank; first message creates thread | 4, 5 |
| One thread, many evaluations | 1, 4 |
| All bubbles in `agent_messages` | 1, 2, 4 |
| Inline decision cards only; no sticky header | 4 |
| Migrate old messages + resolutions | 1 |
| `save_evaluation_reply` → agent_messages | 1 |
| Deep link evaluation → thread | 5, 6 |
| No route rename / no vector search / no delete chat | Global constraints |
| Architecture doc update | 6 |
