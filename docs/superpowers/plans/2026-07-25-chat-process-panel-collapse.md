# Chat Process Panel Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide「正在回复」, keep tool process steps for the current thread session above each assistant bubble, expanded while running and collapsed after the turn ends.

**Architecture:** Extract pure helpers for live-step visibility, completed-tool extraction, and summary copy. `ChatThread` keeps an in-memory `completedProcessByMessageId` map, skips `replying` status events, and renders a collapsible strip above matching assistant messages. No server or schema changes.

**Tech Stack:** Expo / React Native, React Query (messages read), Node `node:test` for pure helpers.

## Global Constraints

- Client-only; do not change server, SSE payloads, or `agent_messages` / RPC.
- Spec: `docs/superpowers/specs/2026-07-25-chat-process-panel-collapse-design.md`.
- Never show the copy「正在回复」.
- Persist process steps only in component memory for the open thread; clear on real thread switches; no DB write.
- No tools → no completed strip after the turn.
- Prefer write-API return ids (`createAgentMessage` / `saveEvaluationReply`) when attaching completed tools to a message.

## File Map

| File | Responsibility |
| --- | --- |
| `mobile/src/lib/agent-process-steps.ts` | Pure helpers: visible live steps, completed tools, summary label |
| `mobile/tests/agent-process-steps.test.mjs` | Unit tests for those helpers |
| `mobile/src/components/chat-thread.tsx` | Live filter, completed map, collapsible UI, send lifecycle |

---

### Task 1: Pure helpers + tests

**Files:**
- Create: `mobile/src/lib/agent-process-steps.ts`
- Create: `mobile/tests/agent-process-steps.test.mjs`

**Interfaces:**
- Produces:

```ts
export type AgentProcessStep =
  | { kind: 'status'; status: 'thinking' | 'replying' }
  | {
      kind: 'tool';
      id: string;
      name: string;
      label: string;
      phase: 'started' | 'completed';
    };

export type CompletedProcessStep = { name: string; label: string };

export function visibleLiveProcessSteps(
  steps: ReadonlyArray<AgentProcessStep>,
): AgentProcessStep[];

export function completedToolsFromProcessSteps(
  steps: ReadonlyArray<AgentProcessStep>,
): CompletedProcessStep[];

export function processSummaryLabel(count: number): string;
```

- Consumes: nothing (pure).

- [ ] **Step 1: Write the failing test**

Create `mobile/tests/agent-process-steps.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  completedToolsFromProcessSteps,
  processSummaryLabel,
  visibleLiveProcessSteps,
} from '../src/lib/agent-process-steps.ts';

test('visibleLiveProcessSteps drops replying and thinking after tools start', () => {
  assert.deepEqual(
    visibleLiveProcessSteps([
      { kind: 'status', status: 'thinking' },
      { kind: 'status', status: 'replying' },
    ]),
    [{ kind: 'status', status: 'thinking' }],
  );

  assert.deepEqual(
    visibleLiveProcessSteps([
      { kind: 'status', status: 'thinking' },
      {
        kind: 'tool',
        id: 't0',
        name: 'recognize_product_text',
        label: '识别商品',
        phase: 'started',
      },
      { kind: 'status', status: 'thinking' },
      { kind: 'status', status: 'replying' },
    ]),
    [
      {
        kind: 'tool',
        id: 't0',
        name: 'recognize_product_text',
        label: '识别商品',
        phase: 'started',
      },
    ],
  );
});

test('completedToolsFromProcessSteps keeps tool order and drops status', () => {
  assert.deepEqual(completedToolsFromProcessSteps([]), []);
  assert.deepEqual(
    completedToolsFromProcessSteps([
      { kind: 'status', status: 'thinking' },
      {
        kind: 'tool',
        id: 't0',
        name: 'recognize_product_text',
        label: '识别商品',
        phase: 'completed',
      },
      {
        kind: 'tool',
        id: 't1',
        name: 'assets_summary',
        label: '查看资产',
        phase: 'started',
      },
      { kind: 'status', status: 'replying' },
    ]),
    [
      { name: 'recognize_product_text', label: '识别商品' },
      { name: 'assets_summary', label: '查看资产' },
    ],
  );
});

test('processSummaryLabel formats count', () => {
  assert.equal(processSummaryLabel(1), '已调用 1 个步骤');
  assert.equal(processSummaryLabel(3), '已调用 3 个步骤');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd mobile && node --test tests/agent-process-steps.test.mjs
```

Expected: FAIL (module not found / export missing).

- [ ] **Step 3: Write minimal implementation**

Create `mobile/src/lib/agent-process-steps.ts`:

```ts
export type AgentProcessStep =
  | { kind: 'status'; status: 'thinking' | 'replying' }
  | {
      kind: 'tool';
      id: string;
      name: string;
      label: string;
      phase: 'started' | 'completed';
    };

export type CompletedProcessStep = { name: string; label: string };

export function visibleLiveProcessSteps(
  steps: ReadonlyArray<AgentProcessStep>,
): AgentProcessStep[] {
  const withoutReplying = steps.filter(
    (step) => !(step.kind === 'status' && step.status === 'replying'),
  );
  const hasTool = withoutReplying.some((step) => step.kind === 'tool');
  if (hasTool) {
    return withoutReplying.filter((step) => step.kind === 'tool');
  }
  let lastThinking: AgentProcessStep | null = null;
  for (const step of withoutReplying) {
    if (step.kind === 'status' && step.status === 'thinking') {
      lastThinking = step;
    }
  }
  return lastThinking ? [lastThinking] : [];
}

export function completedToolsFromProcessSteps(
  steps: ReadonlyArray<AgentProcessStep>,
): CompletedProcessStep[] {
  return steps
    .filter((step): step is Extract<AgentProcessStep, { kind: 'tool' }> =>
      step.kind === 'tool',
    )
    .map(({ name, label }) => ({ name, label }));
}

export function processSummaryLabel(count: number): string {
  return `已调用 ${count} 个步骤`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd mobile && node --test tests/agent-process-steps.test.mjs
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/agent-process-steps.ts mobile/tests/agent-process-steps.test.mjs
git commit -m "$(cat <<'EOF'
feat(mobile): add helpers for chat process step visibility

EOF
)"
```

---

### Task 2: Wire ChatThread — filter, retain, collapse UI

**Files:**
- Modify: `mobile/src/components/chat-thread.tsx`
- Test: manual (checklist below); helpers already covered in Task 1

**Interfaces:**
- Consumes: `visibleLiveProcessSteps`, `completedToolsFromProcessSteps`, `processSummaryLabel`, `CompletedProcessStep` from `@/lib/agent-process-steps`
- Produces: in-thread UX only (no new exports)

- [ ] **Step 1: Align `ProcessStep` with helpers**

In `chat-thread.tsx`, remove the local `ProcessStep` type alias and import:

```ts
import {
  completedToolsFromProcessSteps,
  processSummaryLabel,
  visibleLiveProcessSteps,
  type AgentProcessStep,
  type CompletedProcessStep,
} from '@/lib/agent-process-steps';
```

Use `AgentProcessStep` wherever `ProcessStep` was used (`useState`, `AgentProcessPanel` props, stream callbacks).

- [ ] **Step 2: Add completed-map state and clear on thread switch**

Add:

```ts
const [completedProcessByMessageId, setCompletedProcessByMessageId] = useState<
  Record<string, CompletedProcessStep[]>
>({});
```

In the existing `threadId` effect (the one that clears draft / pending on real switches), also:

```ts
setCompletedProcessByMessageId({});
setProcessSteps([]);
setStreamingText('');
```

Keep the `null → id` early-return so creating a thread mid-send does not wipe the live process strip.

- [ ] **Step 3: Capture live steps in `send` and attach on success**

Inside `send`, after clearing process state for the new turn, keep a local mirror so `finally` cannot lose the snapshot:

```ts
setProcessSteps([]);
setStreamingText('');
let liveSteps: AgentProcessStep[] = [];

const response = await streamAgentChat(
  currentThreadId,
  history.slice(-100),
  imageUrls,
  {
    onStatus: (status) => {
      if (status === 'replying') return;
      liveSteps = [...liveSteps, { kind: 'status', status }];
      setProcessSteps(liveSteps);
    },
    onTool: (tool) => {
      if (tool.phase === 'completed') {
        liveSteps = liveSteps.map((step) =>
          step.kind === 'tool' &&
          step.name === tool.name &&
          step.phase === 'started'
            ? { ...step, phase: 'completed' }
            : step,
        );
      } else {
        liveSteps = [
          ...liveSteps,
          {
            kind: 'tool',
            id: `${tool.name}-${liveSteps.length}`,
            name: tool.name,
            label: tool.label,
            phase: 'started',
          },
        ];
      }
      setProcessSteps(liveSteps);
    },
    onDelta: (full) => setStreamingText(full),
  },
);

const tools = completedToolsFromProcessSteps(liveSteps);
let assistantMessageId: string | null = null;

if (response.evaluationId) {
  assistantMessageId = await saveEvaluationReply(
    response.evaluationId,
    response.message,
  );
  // … existing title update unchanged …
} else {
  const assistant = await createAgentMessage(
    currentThreadId,
    session.user.id,
    'assistant',
    response.message || '我在，慢慢说。',
  );
  assistantMessageId = assistant.id;
}

if (assistantMessageId && tools.length) {
  setCompletedProcessByMessageId((prev) => ({
    ...prev,
    [assistantMessageId!]: tools,
  }));
}

await invalidateThread(currentThreadId);
setPendingUserMessage(null);
```

`catch` / `finally` stay as today for clearing live `processSteps` / `streamingText` / `sending` — they must **not** clear `completedProcessByMessageId`.

- [ ] **Step 4: Render completed strip above assistant bubbles; filter live panel**

In the `messages.map` block, for assistant messages with completed tools, render the strip **above** the bubble:

```tsx
{messages.map((message) => {
  const resolution = resolutionsByMessageId.get(message.id);
  const completed =
    message.role === 'assistant'
      ? completedProcessByMessageId[message.id]
      : undefined;

  return (
    <View key={message.id} style={{ gap: spacing.sm }}>
      {completed?.length ? (
        <CompletedProcessPanel steps={completed} />
      ) : null}
      <MessageBubble
        role={message.role}
        content={stripDecisionMark(message.content)}
      />
      {/* existing resolution card unchanged */}
    </View>
  );
})}
```

Update the live panel call site:

```tsx
{sending || processSteps.length ? (
  <AgentProcessPanel steps={visibleLiveProcessSteps(processSteps)} />
) : null}
```

Rewrite `AgentProcessPanel` to assume steps are already filtered (no `replying` branch / no「正在回复」string anywhere in the file). Keep thinking shimmer + tool rows as today.

Add `CompletedProcessPanel`:

```tsx
function CompletedProcessPanel({ steps }: { steps: CompletedProcessStep[] }) {
  const [expanded, setExpanded] = useState(false);
  const summary = processSummaryLabel(steps.length);

  return (
    <View style={{ gap: spacing.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? `收起，${summary}` : `展开，${summary}`}
        onPress={() => setExpanded((value) => !value)}
        style={{ alignSelf: 'flex-start', paddingVertical: spacing.xs }}>
        <Text
          style={{
            color: colors.textTertiary,
            fontSize: 16,
            lineHeight: 24,
          }}>
          {expanded ? `收起 · ${summary}` : summary}
        </Text>
      </Pressable>
      {expanded
        ? steps.map((step, index) => (
            <Text
              key={`${step.name}-${index}`}
              style={{
                color: colors.textTertiary,
                fontSize: 16,
                lineHeight: 24,
              }}>
              {step.label}
            </Text>
          ))
        : null}
    </View>
  );
}
```

Default is collapsed (`useState(false)`). Expanding is per-mount local state; thread switch remounts/clears via map clear.

- [ ] **Step 5: Manual verification**

With app + local API:

1. Idle chat「你好」→ only「正在思考」then reply; after done, **no** process strip; **no**「正在回复」.
2. Product turn that triggers tools → live expanded tool rows; after done → collapsed「已调用 N 个步骤」above that assistant bubble; tap expands labels, tap again collapses.
3. Second tool turn in same thread → both assistant bubbles keep their own strips.
4. Switch to another thread and back → strips gone; messages remain.
5. Kill stream / force error mid-turn → no completed strip; live strip clears; `sendError` shows.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/components/chat-thread.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): collapse chat tool process after turn completes

EOF
)"
```

---

## Spec coverage

| Spec requirement | Task |
| --- | --- |
| Never show「正在回复」 | Task 1 `visibleLiveProcessSteps` + Task 2 skip `replying` / remove copy |
| Thinking shimmer before tools | Task 2 live panel + helpers keep thinking when no tools |
| Tools expanded live, collapsed after | Task 2 `CompletedProcessPanel` default collapsed |
| No tools → no completed strip | Task 1 + Task 2 `tools.length` guard |
| Hang above matching assistant bubble | Task 2 render in `messages.map` |
| Session-only; clear on thread switch | Task 2 state + thread effect |
| No DB / SSE schema change | Global Constraints; both tasks client-only |
| Prefer write-API message ids | Task 2 `saveEvaluationReply` / `createAgentMessage` returns |
