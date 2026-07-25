# Optimistic User Bubble Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On chat send, show the user bubble immediately, then the agent “正在思考” process strip — never the reverse.

**Architecture:** Extract tiny pure helpers for outbound user text and pending-bubble visibility. `ChatThread` keeps a local `pendingUserMessage`; set it when send starts, render it above `AgentProcessPanel` (with dedupe against the last server user message), clear it only on successful turn completion or real thread switches — not on failure.

**Tech Stack:** Expo / React Native, React Query (read-only for messages), Node `node:test` for pure helpers.

## Global Constraints

- Client-only; do not change server, SSE, or message schema.
- Spec: `docs/superpowers/specs/2026-07-25-optimistic-user-bubble-design.md`.
- Failure keeps the pending bubble; bottom `sendError` stays the only error UI.
- No “sending…” badge on the bubble; no pending photo thumbnails; no React Query `setQueryData` optimism.
- Pure-image sends use content `看看这件商品` (same as today’s `createAgentMessage` path).
- `finally` must not clear `pendingUserMessage`.

## File Map

| File | Responsibility |
| --- | --- |
| `mobile/src/lib/pending-user-message.ts` | Pure helpers: outbound content + whether to show pending |
| `mobile/tests/pending-user-message.test.mjs` | Unit tests for those helpers |
| `mobile/src/components/chat-thread.tsx` | Pending state, render order, lifecycle |

---

### Task 1: Pure helpers + tests

**Files:**
- Create: `mobile/src/lib/pending-user-message.ts`
- Create: `mobile/tests/pending-user-message.test.mjs`

**Interfaces:**
- Produces:

```ts
export function outboundUserContent(text: string): string;
export function shouldShowPendingUserMessage(
  pending: string | null,
  messages: ReadonlyArray<{ role: string; content: string }>,
): boolean;
```

- Consumes: nothing (pure).

- [ ] **Step 1: Write the failing test**

Create `mobile/tests/pending-user-message.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  outboundUserContent,
  shouldShowPendingUserMessage,
} from '../src/lib/pending-user-message.ts';

test('outboundUserContent trims text and falls back for empty', () => {
  assert.equal(outboundUserContent('  你好  '), '你好');
  assert.equal(outboundUserContent(''), '看看这件商品');
  assert.equal(outboundUserContent('   '), '看看这件商品');
});

test('shouldShowPendingUserMessage hides when null or already on server', () => {
  assert.equal(shouldShowPendingUserMessage(null, []), false);
  assert.equal(shouldShowPendingUserMessage('你好', []), true);
  assert.equal(
    shouldShowPendingUserMessage('你好', [
      { role: 'assistant', content: '之前' },
      { role: 'user', content: '你好' },
    ]),
    false,
  );
  assert.equal(
    shouldShowPendingUserMessage('你好', [
      { role: 'user', content: '别的' },
    ]),
    true,
  );
  assert.equal(
    shouldShowPendingUserMessage('你好', [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '嗯' },
    ]),
    true,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd mobile && node --test tests/pending-user-message.test.mjs
```

Expected: FAIL (module not found / export missing).

- [ ] **Step 3: Write minimal implementation**

Create `mobile/src/lib/pending-user-message.ts`:

```ts
export function outboundUserContent(text: string): string {
  const trimmed = text.trim();
  return trimmed || '看看这件商品';
}

export function shouldShowPendingUserMessage(
  pending: string | null,
  messages: ReadonlyArray<{ role: string; content: string }>,
): boolean {
  if (!pending) return false;
  const last = messages[messages.length - 1];
  if (last?.role === 'user' && last.content === pending) return false;
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd mobile && node --test tests/pending-user-message.test.mjs
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/pending-user-message.ts mobile/tests/pending-user-message.test.mjs
git commit -m "$(cat <<'EOF'
feat(mobile): add pending user message helpers

EOF
)"
```

---

### Task 2: Wire optimistic bubble into ChatThread

**Files:**
- Modify: `mobile/src/components/chat-thread.tsx`

**Interfaces:**
- Consumes: `outboundUserContent`, `shouldShowPendingUserMessage` from `@/lib/pending-user-message`
- Produces: UI order `messages → pending bubble → AgentProcessPanel → streaming bubble`

- [ ] **Step 1: Import helpers and add pending state**

At the top of `chat-thread.tsx`, add:

```ts
import {
  outboundUserContent,
  shouldShowPendingUserMessage,
} from '@/lib/pending-user-message';
```

Next to the other `useState` declarations:

```ts
const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(
  null,
);
```

- [ ] **Step 2: Clear pending on real thread switches**

In the existing `threadId` reset effect (the one that clears draft/photos/errors and skips `null → id`), also clear pending:

```ts
const timer = setTimeout(() => {
  setDraft('');
  setPhotos([]);
  setSendError('');
  setResolutionError('');
  setConfirmingResolutionId(null);
  setPendingUserMessage(null);
}, 0);
```

Keep the early return for `previousThreadId === null && threadId !== null` so mid-send thread creation does not wipe the optimistic bubble.

- [ ] **Step 3: Set pending at send start; clear only on success**

At the start of `send`, after validation, compute content once and set pending with sending:

```ts
const pendingPhotos = photos;
const userContent = outboundUserContent(text);
setPendingUserMessage(userContent);
setSending(true);
setSendError('');
setDraft('');
setPhotos([]);
```

Remove the later local `const userContent = text || '看看这件商品';` and reuse `userContent` in `createAgentMessage(...)`.

At the end of the `try` block, after `await invalidateThread(currentThreadId);`, clear pending:

```ts
await invalidateThread(currentThreadId);
setPendingUserMessage(null);
```

Do **not** add `setPendingUserMessage(null)` in `catch` or `finally`. `finally` continues to only clear `sending` / `processSteps` / `streamingText`.

- [ ] **Step 4: Render pending bubble and update scroll deps**

After the `messages.map(...)` block and before `{sending || processSteps.length ? (...)`, render:

```tsx
{shouldShowPendingUserMessage(pendingUserMessage, messages) ? (
  <MessageBubble role="user" content={pendingUserMessage!} />
) : null}
```

Update the scroll-to-end effect:

```ts
useEffect(() => {
  if (
    !messages.length &&
    !sending &&
    !streamingText &&
    !pendingUserMessage
  ) {
    return;
  }
  const timer = setTimeout(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, 50);
  return () => clearTimeout(timer);
}, [
  messages.length,
  sending,
  streamingText,
  processSteps.length,
  pendingUserMessage,
  threadId,
]);
```

- [ ] **Step 5: Typecheck and unit tests**

Run:

```bash
cd mobile && npx tsc --noEmit && node --test tests/pending-user-message.test.mjs
```

Expected: no TS errors; 2 tests PASS.

- [ ] **Step 6: Manual verification**

In the running Expo app (chat tab):

1. Existing thread: send text → user bubble appears immediately, then「正在思考」below it.
2. New chat (`threadId` null): send → bubble appears before/during thread creation; no empty flash that removes the bubble.
3. After the server message lands: only one user bubble (no duplicate).
4. Force a failure (e.g. airplane mode after typing, or break API briefly): pending bubble remains; bottom error shows; process strip clears.
5. Switch to another thread via history: pending from the failed/in-flight turn is gone.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/components/chat-thread.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): show user bubble before agent thinking

EOF
)"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
| --- | --- |
| Immediate user bubble | Task 2 steps 3–4 |
| Thinking after bubble | Task 2 step 4 (render order) |
| Failure keeps bubble + `sendError` | Task 2 step 3 (`finally`/`catch` do not clear) |
| No sending badge / no photo thumbs / no RQ optimism | Global constraints; not implemented |
| Content matches persisted text / 纯图 fallback | Task 1 `outboundUserContent` + Task 2 reuse |
| Dedupe vs last server user message | Task 1 + Task 2 step 4 |
| Clear on success only in try | Task 2 step 3 |
| Clear on thread switch except null→id | Task 2 step 2 |
| Scroll includes pending | Task 2 step 4 |
