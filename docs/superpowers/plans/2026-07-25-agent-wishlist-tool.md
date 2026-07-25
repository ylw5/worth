# Agent Wishlist Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `wishlist_list` conversation tool that lets the Agent list all, active, or fulfilled wishes for the authenticated user.

**Architecture:** Extend the existing conversation tool module rather than adding a new registry or data layer. The handler queries `wishlist_items` with the `RunContext.user_id`, applies one optional status filter, and returns validated Pydantic output; the existing workflow and SSE mapping expose it to the model and UI.

**Tech Stack:** Python 3, Pydantic, Supabase Python client, pytest

## Global Constraints

- Reuse the existing conversation tool registry and `wishlist_items` table.
- `status` is `all | active | fulfilled` and defaults to `all`.
- The tool is read-only and must take identity only from `RunContext.user_id`.
- Do not add a migration, mobile data method, keyword search, pagination, funding details, or wishlist write action.
- Preserve unrelated uncommitted changes in `mobile/src/components/chat-thread.tsx` and `docs/superpowers/plans/2026-07-25-optimistic-user-bubble.md`.

---

### Task 1: Add the read-only wishlist query tool

**Files:**
- Modify: `server/app/ai/tools/conversation.py`
- Test: `server/tests/test_conversation_tools.py`

**Interfaces:**
- Consumes: `RunContext.user_id` and the existing `wishlist_items` columns.
- Produces: `WishlistListInput(status)`, `WishlistToolRecord`, `WishlistListOutput`, `ConversationToolHandlers.list_wishlist()`, and registered tool name `wishlist_list`.

- [ ] **Step 1: Write failing handler tests**

Add `WishlistListInput` to the imports in `server/tests/test_conversation_tools.py`, then add:

```python
@pytest.mark.parametrize(
    ("status", "operator"),
    [("active", "is"), ("fulfilled", "not.is")],
)
def test_wishlist_list_filters_current_users_items(status, operator):
    supabase = MagicMock()
    query = MagicMock()
    supabase.table.return_value = query
    query.select.return_value = query
    query.eq.return_value = query
    query.filter.return_value = query
    query.order.return_value = query
    query.execute.return_value = SimpleNamespace(
        data=[
            {
                "id": "wish-1",
                "name": "去北海道旅行",
                "target_price": "12000.00",
                "notes": "冬天",
                "actual_price": None,
                "fulfilled_at": None,
                "created_at": "2026-07-25T00:00:00Z",
            }
        ]
    )
    registry = build_conversation_tool_registry(
        settings=MagicMock(),
        supabase_client=supabase,
        market_client=None,
    )

    result = registry.get("wishlist_list").handler(
        WishlistListInput(status=status),
        context(),
    )

    supabase.table.assert_called_once_with("wishlist_items")
    query.eq.assert_called_once_with("user_id", "user-1")
    query.filter.assert_called_once_with(
        "fulfilled_at",
        operator,
        "null",
    )
    query.order.assert_called_once_with("created_at", desc=True)
    assert result.items[0].name == "去北海道旅行"
    assert result.items[0].target_price == 12000


def test_wishlist_list_defaults_to_all_statuses():
    supabase = MagicMock()
    query = MagicMock()
    supabase.table.return_value = query
    query.select.return_value = query
    query.eq.return_value = query
    query.order.return_value = query
    query.execute.return_value = SimpleNamespace(data=[])
    registry = build_conversation_tool_registry(
        settings=MagicMock(),
        supabase_client=supabase,
        market_client=None,
    )

    result = registry.get("wishlist_list").handler(
        WishlistListInput(),
        context(),
    )

    query.filter.assert_not_called()
    assert result.items == []
```

- [ ] **Step 2: Run the focused tests and confirm the new contract is absent**

Run:

```bash
cd server
pytest tests/test_conversation_tools.py -q
```

Expected: collection fails because `WishlistListInput` does not exist.

- [ ] **Step 3: Add the minimal models, handler, allowlist entry, and registration**

Change the typing import in `server/app/ai/tools/conversation.py`:

```python
from typing import TYPE_CHECKING, Literal
```

Add these models after `RecognizeProductImagesInput`:

```python
class WishlistListInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["all", "active", "fulfilled"] = "all"


class WishlistToolRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    target_price: float
    notes: str
    actual_price: float | None = None
    fulfilled_at: str | None = None
    created_at: str


class WishlistListOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[WishlistToolRecord]
```

Add this method to `ConversationToolHandlers`:

```python
    def list_wishlist(
        self,
        arguments: BaseModel,
        context: RunContext,
    ) -> WishlistListOutput:
        parsed = WishlistListInput.model_validate(arguments)
        query = (
            self._supabase.table("wishlist_items")
            .select(
                "id, name, target_price, notes, actual_price, "
                "fulfilled_at, created_at"
            )
            .eq("user_id", context.user_id)
        )
        if parsed.status == "active":
            query = query.filter("fulfilled_at", "is", "null")
        elif parsed.status == "fulfilled":
            query = query.filter("fulfilled_at", "not.is", "null")
        response = query.order("created_at", desc=True).execute()
        return WishlistListOutput(
            items=[
                WishlistToolRecord.model_validate(record)
                for record in (response.data or [])
            ]
        )
```

Add `"wishlist_list"` to `CONVERSATION_TOOL_NAMES` before `bind_purchase_evaluation`, then register it before the bind tool:

```python
    registry.register(
        name="wishlist_list",
        description="按需查看当前用户全部、待实现或已实现的心愿",
        input_model=WishlistListInput,
        output_model=WishlistListOutput,
        handler=handlers.list_wishlist,
    )
```

- [ ] **Step 4: Run the tool tests**

Run:

```bash
cd server
pytest tests/test_conversation_tools.py -q
```

Expected: all tests pass.

- [ ] **Step 5: Commit the tool**

```bash
git add server/app/ai/tools/conversation.py server/tests/test_conversation_tools.py
git commit -m "feat(server): add wishlist list tool"
```

---

### Task 2: Expose the tool through Agent guidance and SSE labels

**Files:**
- Modify: `server/app/ai/workflows/conversation.py`
- Modify: `server/app/agent_turn.py`
- Test: `server/tests/test_conversation_workflow.py`
- Test: `server/tests/test_agent_turn.py`

**Interfaces:**
- Consumes: registered `wishlist_list` tool from Task 1.
- Produces: model guidance for selecting `all`, `active`, or `fulfilled`, plus the visible SSE label `查看心愿`.

- [ ] **Step 1: Write failing prompt and label assertions**

Append to `test_purchase_decision_requires_tools_and_user_feedback()` in `server/tests/test_conversation_workflow.py`:

```python
    assert "wishlist_list" in CONVERSATION_SYSTEM_PROMPT
    assert "心愿与当前对话有关" in CONVERSATION_SYSTEM_PROMPT
```

Change the import in `server/tests/test_agent_turn.py` and add a focused test:

```python
from app.agent_turn import TOOL_LABELS, run_agent_turn, stream_agent_turn


def test_wishlist_tool_has_visible_label():
    assert TOOL_LABELS["wishlist_list"] == "查看心愿"
```

- [ ] **Step 2: Run the focused integration tests and verify failure**

Run:

```bash
cd server
pytest \
  tests/test_conversation_workflow.py::test_purchase_decision_requires_tools_and_user_feedback \
  tests/test_agent_turn.py::test_wishlist_tool_has_visible_label \
  -q
```

Expected: both assertions fail because the prompt and label do not yet mention `wishlist_list`.

- [ ] **Step 3: Add one prompt rule and one label**

Add this bullet after the evaluation history rule in `CONVERSATION_SYSTEM_PROMPT`:

```python
- 仅在用户的心愿与当前对话有关时调用 wishlist_list，并按需要选择全部、
  待实现或已实现状态；不得声称通过该只读工具修改了心愿。
```

Add this entry to `TOOL_LABELS` in `server/app/agent_turn.py`:

```python
    "wishlist_list": "查看心愿",
```

- [ ] **Step 4: Run focused and server regression checks**

Run:

```bash
cd server
pytest \
  tests/test_conversation_tools.py \
  tests/test_conversation_workflow.py \
  tests/test_agent_turn.py \
  -q
```

Expected: all selected tests pass.

Run:

```bash
cd server
python -m compileall -q app
```

Expected: exit code 0 with no output.

Run:

```bash
git diff --check
```

Expected: exit code 0. If it reports whitespace only in the user's pre-existing dirty files, report that boundary and do not edit those files.

- [ ] **Step 5: Commit the Agent integration**

```bash
git add \
  server/app/ai/workflows/conversation.py \
  server/app/agent_turn.py \
  server/tests/test_conversation_workflow.py \
  server/tests/test_agent_turn.py
git commit -m "feat(server): expose wishlist tool to agent"
```

---

## Final Verification

- [ ] Review the final diff against `docs/superpowers/specs/2026-07-25-agent-wishlist-tool-design.md`.
- [ ] Confirm no migration, mobile source file, keyword search, pagination, funding detail, or wishlist mutation was added.
- [ ] Confirm `git status --short` still contains the user's pre-existing unrelated changes without modifications from this plan.
