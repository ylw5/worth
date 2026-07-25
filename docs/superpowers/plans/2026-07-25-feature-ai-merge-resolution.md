# Feature AI Merge Resolution Implementation Plan

> **For agentic workers:** Resolve this plan inline in the current merge worktree. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the current `origin/feature/ai` into `main` conflicts without losing either the existing spending-resolution contract or the new AI foundation, memory, and persistent-chat behavior.

**Architecture:** Keep the new AI foundation as the server orchestration path and merge the stricter `main` prompt rules into both legacy provider prompts. On mobile, use the persisted general-agent thread as the single message source while retaining the existing keyboard-safe composer layout and error/reset behavior.

**Tech Stack:** FastAPI, Python, pytest, Expo Router, React Native, TypeScript, TanStack Query, Supabase.

## Global Constraints

- Modify only the seven unmerged files plus this plan.
- Do not discard already auto-merged changes.
- Do not add dependencies or speculative abstractions.
- Do not push the resulting merge commit.

---

### Task 1: Resolve server orchestration

**Files:**
- Modify: `server/app/main.py`

**Interfaces:**
- Consumes: `build_purchase_evaluation_workflow(settings, supabase_client, market_client)`
- Produces: `/purchase-evaluations/evaluate` calling `bundle.workflow.run(..., user_id=user.id, request_id=uuid4().hex).text`

- [ ] Keep all imports used by the merged file: `lru_cache`, `logging`, `datetime`, and `timezone`.
- [ ] Keep the AI foundation workflow call and `AIFoundationError` fallback in `evaluate_purchase`.
- [ ] Run `python -m py_compile server/app/main.py`.

### Task 2: Merge provider prompt contracts and tests

**Files:**
- Modify: `server/app/deepseek_service.py`
- Modify: `server/app/openai_service.py`
- Modify: `server/tests/test_deepseek_service.py`

**Interfaces:**
- Consumes: evaluation history, current conversation, product price, and user evidence.
- Produces: a natural-language response with no decision marker while clarifying; a final `[decision:buy]`, or `[decision:skip]` followed by `[spending_resolution:金额]`.

- [ ] Merge the history/persona instructions with the existing price and spending-resolution constraints in both providers.
- [ ] Keep both the price/resolution tests and the general-chat memory test.
- [ ] Run `server/.venv/bin/pytest server/tests/test_deepseek_service.py server/tests/test_openai_service.py -q`.

### Task 3: Resolve mobile persisted chat and evaluation APIs

**Files:**
- Modify: `mobile/src/app/(tabs)/(evaluation)/index.tsx`
- Modify: `mobile/src/components/chat-conversation.tsx`
- Modify: `mobile/src/lib/evaluations.ts`

**Interfaces:**
- Consumes: `generalThread`, `generalMessages`, `createAgentMessage`, and `chatFreely`.
- Produces: one persisted general-chat transcript, keyboard-safe composer behavior, and purchase outcome/decision persistence APIs.

- [ ] Remove the duplicate local `starterMessages` transcript and render persisted `generalMessages` in the existing scroll/composer layout.
- [ ] Preserve keyboard visibility handling, automatic scrolling, error display, and navigation into a created evaluation.
- [ ] Reset all conversation-local error state when the active evaluation changes, using the existing deferred-effect pattern.
- [ ] Keep the feature branch labels, `extractDecision`, `updateEvaluationDecision`, and `recordPurchaseOutcome`.
- [ ] Run the mobile TypeScript check and existing test command from `mobile/package.json`.

### Task 4: Verify and complete the merge

**Files:**
- Resolve and stage all paths already participating in the merge.

- [ ] Run `rg -n '^(<<<<<<<|=======|>>>>>>>)' mobile server` and require no output.
- [ ] Run `git diff --name-only --diff-filter=U` and require no output.
- [ ] Review `git diff --check`, staged status, and targeted test results.
- [ ] Stage the resolved merge and create the merge commit with the repository-generated merge message.
