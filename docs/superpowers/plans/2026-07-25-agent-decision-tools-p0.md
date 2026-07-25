# Agent Decision Tools P0 Implementation Plan

> **For agentic workers:** Implement inline in this task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the conversation Agent read-only access to funding, deterministic sell-plan previews, and per-asset decision evidence.

**Architecture:** Extend the existing tool registries and reuse the current Supabase tables plus `prepare_sell_plan_from_assets()`. Keep user identity server-owned through `RunContext.user_id`; add no schema, dependency, cache, refresh, snapshot write, or new Agent write path.

**Tech Stack:** FastAPI, Pydantic, Supabase Python client, pytest.

## Global Constraints

- Only P0 tools are in scope; `followups_due_list` remains P1.
- `asset_sales.sale_price` is the only sale funding amount.
- Allocation amounts are deducted from shared user funding.
- Market snapshots preserve `source`; `demo_seed` is never presented as live evidence.
- `wishlist_sell_plan_preview` neither refreshes valuations nor writes `sell_plan_snapshots`.

---

### Task 1: Extend `assets_list`

**Files:**
- Modify: `server/app/ai/tools/purchase.py`
- Test: `server/tests/test_ai_tool_registry.py`

- [ ] Add purchase, valuation, and status-confirmation fields to `AssetToolRecord`.
- [ ] Select and serialize those fields while keeping `user_id` sourced only from `RunContext`.
- [ ] Run `pytest -q server/tests/test_ai_tool_registry.py`.

### Task 2: Add funding summary

**Files:**
- Modify: `server/app/ai/tools/conversation.py`
- Test: `server/tests/test_conversation_tools.py`

- [ ] Query confirmed `spending_resolutions`, real `asset_sales`, allocations, and active wishes for the current user.
- [ ] Calculate available amounts in cents after allocations and return the shared funding gap for each active wish.
- [ ] Test partial allocation, fully allocated funding, and no funding.

### Task 3: Add deterministic wishlist sell-plan preview

**Files:**
- Modify: `server/app/ai/tools/conversation.py`
- Test: `server/tests/test_conversation_tools.py`

- [ ] Resolve the current user's active wish and remaining gap from `funding_summary`.
- [ ] Load unsold assets and call `prepare_sell_plan_from_assets()` only when the gap is positive.
- [ ] Return readiness counts, selected assets, conservative total, coverage, and evidence gaps without refresh or writes.
- [ ] Test funded, stale, unconfirmed, and insufficient cases.

### Task 4: Add per-asset decision context

**Files:**
- Modify: `server/app/ai/tools/conversation.py`
- Test: `server/tests/test_conversation_tools.py`

- [ ] Load one current-user asset plus bounded status events, sale, snapshots, and analysis runs.
- [ ] Return real sale facts separately from market evidence, preserve snapshot sources, and mark valuation staleness.
- [ ] Test `demo_seed`, failed runs, ownership filtering, and the 90-day input cap.

### Task 5: Connect and regress

**Files:**
- Modify: `server/app/ai/tools/conversation.py`
- Modify: `server/app/ai/workflows/conversation.py`
- Modify: `server/app/agent_turn.py`
- Test: `server/tests/test_conversation_workflow.py`
- Test: `server/tests/test_agent_turn.py`

- [ ] Add the three new read tools to the allowlist, prompt guidance, and visible tool labels.
- [ ] Keep `parallel_tool_calls=False` and `bind_purchase_evaluation` as the only write tool.
- [ ] Run the focused tests, then the complete server test suite.
