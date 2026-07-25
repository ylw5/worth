# Agent Chat Streaming + Tool Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hard-coded `agent_turn` branching with a single tool-calling conversation agent, expose `POST /agent/chat/stream` SSE (status + every tool step + text deltas), and wire the mobile chat tab to show the live process and stream the reply.

**Architecture:** Add conversation tools (recognize text/url/images, bind evaluation) plus existing purchase read-only tools into `ConversationAgentWorkflow` on `AgentRunner.stream/run`. A thin `stream_agent_turn` maps runner events to SSE. Mobile extends SSE parsing, adds `streamAgentChat`, and upgrades `ChatThread` with a process strip + temporary streaming bubble; persist assistant only on `done`.

**Tech Stack:** FastAPI `StreamingResponse`, existing AI foundation (`AgentRunner`, `ToolRegistry`, providers), Supabase user client, Expo `expo/fetch` SSE, React Native / Reanimated process UI, pytest.

## Global Constraints

- Server hard constraints only: auth, thread ownership, tool allowlist/step limits, silent DB write via `bind_purchase_evaluation`, neutral output validation.
- No user-visible「创建评估」; `purchase_evaluations` upsert only through `bind_purchase_evaluation`.
- Process steps are UI-only; never write them to `agent_messages`.
- Persist assistant only after SSE `done` (not on partial stream / error).
- Chat tab uses `/agent/chat/stream` only; keep sync `/agent/chat` compatible via same workflow `run`.
- Do not delete old purchase routes / `PurchaseEvaluationWorkflow`.
- Do not let models pass `user_id` / arbitrary image URLs; `thread_id` and `image_urls` come from `RunContext.metadata`.
- AI role unchanged: facts, gaps, one clarifying question; hidden decision markers allowed; never decide buy/skip for the user.
- Spec: `docs/superpowers/specs/2026-07-25-agent-chat-streaming-tools-design.md`.

## File Map

| File | Responsibility |
| --- | --- |
| `server/app/ai/tools/conversation.py` | Recognize + bind tools and registry builder |
| `server/app/ai/tools/__init__.py` | Export conversation tool names/builders |
| `server/app/ai/workflows/conversation.py` | `ConversationAgentWorkflow` prompt, run, stream + guard |
| `server/app/ai/workflows/__init__.py` | Export workflow |
| `server/app/ai/factory.py` | `build_conversation_agent_workflow` |
| `server/app/agent_turn.py` | Thin `run_agent_turn` / `stream_agent_turn` + SSE label map |
| `server/app/main.py` | `POST /agent/chat/stream`; sync chat → same turn |
| `server/tests/test_conversation_tools.py` | Tool handler unit tests |
| `server/tests/test_conversation_workflow.py` | Workflow stream/run + policy |
| `server/tests/test_agent_turn.py` | Replace branch tests with thin-turn tests |
| `server/tests/test_agent_chat_stream_route.py` | SSE route mapping tests |
| `mobile/src/lib/sse.ts` | Parse status/tool/done.evaluation_id |
| `mobile/src/lib/api.ts` | `streamAgentChat` |
| `mobile/src/components/chat-thread.tsx` | Process strip + streaming bubble |
| `docs/architecture/chat-module-v1.md` | Document toolized streaming chat |

---

### Task 1: Conversation tools (recognize + bind)

**Files:**
- Create: `server/app/ai/tools/conversation.py`
- Modify: `server/app/ai/tools/__init__.py`
- Create: `server/tests/test_conversation_tools.py`

**Interfaces:**
- Produces:

```python
CONVERSATION_TOOL_NAMES = (
    "recognize_product_text",
    "parse_product_url",
    "recognize_product_images",
    "assets_list",
    "assets_summary",
    "market_price_snapshot",
    "evaluation_history_list",
    "bind_purchase_evaluation",
)

def build_conversation_tool_registry(
    *,
    settings: Settings,
    supabase_client: SupabaseClient,
    market_client: MarketClient | None,
) -> ToolRegistry: ...
```

- `recognize_product_images` reads `context.metadata["image_urls"]` (list[str]); ignores model-supplied URLs.
- `bind_purchase_evaluation` reads `context.metadata["thread_id"]` and `context.user_id`; input is product fields only.
- Consumes: existing `build_text_workflows` / `build_vision_workflows` / `fetch_product_page` / upsert helpers (move `_upsert_evaluation` / `_insert_evaluation` logic into this module or import from a small shared helper in `agent_turn` refactored later — for this task, put upsert helpers as private functions in `conversation.py`).

- [ ] **Step 1: Write failing tool tests**

Create `server/tests/test_conversation_tools.py`:

```python
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from app.ai.contracts import RunContext
from app.ai.errors import ToolExecutionError
from app.ai.tools.conversation import (
    BindPurchaseEvaluationInput,
    RecognizeProductImagesInput,
    RecognizeProductTextInput,
    build_conversation_tool_registry,
)
from app.models import ParsedProduct


def context(**metadata):
    return RunContext(
        user_id="user-1",
        request_id="req-1",
        metadata=metadata,
    )


def test_recognize_product_text_returns_product(monkeypatch):
    registry = build_conversation_tool_registry(
        settings=MagicMock(),
        supabase_client=MagicMock(),
        market_client=None,
    )
    monkeypatch.setattr(
        "app.ai.tools.conversation._interpret_text",
        lambda settings, text, user_id, request_id: SimpleNamespace(
            intent="product",
            normalized_title="索尼耳机",
            category="数码",
            subcategory="耳机",
            reply="",
        ),
    )
    result = registry.get("recognize_product_text").handler(
        RecognizeProductTextInput(text="想买索尼耳机"),
        context(),
    )
    assert result.is_product is True
    assert result.product.title == "索尼耳机"


def test_recognize_product_images_uses_metadata_urls_only(monkeypatch):
    registry = build_conversation_tool_registry(
        settings=MagicMock(),
        supabase_client=MagicMock(),
        market_client=None,
    )
    called = {}

    def fake_recognize(settings, image_urls, user_id, request_id):
        called["urls"] = image_urls
        return ParsedProduct(
            title="相机",
            category="数码",
            subcategory="相机",
            source_type="image",
        )

    monkeypatch.setattr(
        "app.ai.tools.conversation._recognize_images",
        fake_recognize,
    )
    result = registry.get("recognize_product_images").handler(
        RecognizeProductImagesInput(),
        context(image_urls=["https://signed.example/a.jpg"]),
    )
    assert called["urls"] == ["https://signed.example/a.jpg"]
    assert result.is_product is True


def test_recognize_product_images_errors_without_urls():
    registry = build_conversation_tool_registry(
        settings=MagicMock(),
        supabase_client=MagicMock(),
        market_client=None,
    )
    with pytest.raises(ToolExecutionError):
        registry.get("recognize_product_images").handler(
            RecognizeProductImagesInput(),
            context(image_urls=[]),
        )


def test_bind_purchase_evaluation_upserts_with_context_ids(monkeypatch):
    supabase = MagicMock()
    registry = build_conversation_tool_registry(
        settings=MagicMock(),
        supabase_client=supabase,
        market_client=None,
    )
    monkeypatch.setattr(
        "app.ai.tools.conversation._upsert_evaluation",
        lambda **kwargs: "eval-9",
    )
    result = registry.get("bind_purchase_evaluation").handler(
        BindPurchaseEvaluationInput(
            title="索尼耳机",
            category="数码",
            subcategory="耳机",
            price=1999,
            url="",
            source_type="text",
            source_text="想买索尼耳机",
        ),
        context(thread_id="thread-1"),
    )
    assert result.evaluation_id == "eval-9"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && .venv/bin/pytest tests/test_conversation_tools.py -v`

Expected: FAIL (module/import missing)

- [ ] **Step 3: Implement `conversation.py` tools**

Create `server/app/ai/tools/conversation.py` with:

```python
# Key models (exact names)
class RecognizeProductTextInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=8000)

class RecognizeProductOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    is_product: bool
    product: ParsedProduct | None = None
    note: str = ""

class RecognizeProductImagesInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # intentionally empty — URLs from RunContext.metadata only

class ParseProductUrlInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=8, max_length=2000)

class BindPurchaseEvaluationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=300)
    category: Category
    subcategory: str = Field(max_length=50)
    price: float | None = Field(default=None, gt=0)
    url: str = ""
    source_type: ProductSource = "text"
    source_text: str = ""

class BindPurchaseEvaluationOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    evaluation_id: str
```

Handlers:

- `_interpret_text` / `_recognize_images` / `_parse_url`: copy the bodies currently in `agent_turn.py` (call text/vision workflows + `fetch_product_page`). On failure raise `ToolExecutionError` with a short Chinese message.
- `recognize_product_text`: if `intent != "product"`, return `RecognizeProductOutput(is_product=False, note="看起来是闲聊，不是待购商品")`.
- `recognize_product_images`: if `not context.metadata.get("image_urls")`, raise `ToolExecutionError("本轮没有可识别的图片")`.
- `bind_purchase_evaluation`: require `context.metadata["thread_id"]`; build `ParsedProduct` from input; call `_upsert_evaluation` (port from `agent_turn._upsert_evaluation` / `_insert_evaluation` / `_latest_evaluation_on_thread`).

`build_conversation_tool_registry`:

1. Start from `build_purchase_tool_registry(supabase, market)`.
2. Register the four new tools on the same registry (or create empty registry and register all eight — either way final names must match `CONVERSATION_TOOL_NAMES`).

Export from `server/app/ai/tools/__init__.py`:

```python
from .conversation import (
    CONVERSATION_TOOL_NAMES,
    build_conversation_tool_registry,
)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && .venv/bin/pytest tests/test_conversation_tools.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/app/ai/tools/conversation.py server/app/ai/tools/__init__.py server/tests/test_conversation_tools.py
git commit -m "feat(ai): add conversation recognize and bind tools"
```

---

### Task 2: ConversationAgentWorkflow + factory

**Files:**
- Create: `server/app/ai/workflows/conversation.py`
- Modify: `server/app/ai/workflows/__init__.py`
- Modify: `server/app/ai/factory.py`
- Create: `server/tests/test_conversation_workflow.py`

**Interfaces:**
- Consumes: `CONVERSATION_TOOL_NAMES`, tool definitions from registry
- Produces:

```python
CONVERSATION_SYSTEM_PROMPT: str  # merge general chat + purchase coaching rules

class ConversationAgentWorkflow:
    tool_names = CONVERSATION_TOOL_NAMES

    def __init__(self, runner: AgentRunner, *, tools: Sequence[ToolDefinition]) -> None: ...

    def build_request(
        self,
        messages: list[EvaluationChatMessage],
        memory_context: dict,
        *,
        image_urls: list[str],
    ) -> AgentRunRequest: ...

    def run(
        self,
        messages: list[EvaluationChatMessage],
        memory_context: dict,
        *,
        user_id: str,
        request_id: str,
        thread_id: str,
        image_urls: list[str],
    ) -> AgentRunResult: ...

    def stream(
        self,
        messages: list[EvaluationChatMessage],
        memory_context: dict,
        *,
        user_id: str,
        request_id: str,
        thread_id: str,
        image_urls: list[str],
    ) -> Iterator[AgentStreamEvent]: ...

@dataclass(frozen=True, slots=True)
class ConversationWorkflowBundle:
    workflow: ConversationAgentWorkflow
    registry: ToolRegistry

def build_conversation_agent_workflow(
    settings: Settings,
    *,
    supabase_client: SupabaseClient,
    market_client: MarketClient | None,
) -> ConversationWorkflowBundle: ...
```

- `RunContext.metadata` must include `{"thread_id": thread_id, "image_urls": image_urls}`.
- `requirements.task = "conversation_agent"` with capabilities `{TEXT, TOOLS, STREAMING}` for stream path requirements (router profiles must register this task).
- Reuse `validate_neutral_purchase_output` and the purchase stream short-window guard (`_STREAM_GUARD_CHARS = 64`) from `purchase_evaluation.py` (import the validator; duplicate the small stream buffer logic in this workflow to avoid coupling stream internals).
- `max_tool_steps=8`, `max_repeated_call=2`, `max_output_tokens=1200`, `parallel_tool_calls=False`.

- [ ] **Step 1: Write failing workflow tests**

```python
# server/tests/test_conversation_workflow.py
import pytest
from unittest.mock import MagicMock

from app.ai.contracts import (
    AgentRunResult,
    AgentStreamEvent,
    ToolCall,
    ToolResult,
)
from app.ai.errors import OutputPolicyError
from app.ai.tools.conversation import (
    CONVERSATION_TOOL_NAMES,
    build_conversation_tool_registry,
)
from app.ai.workflows.conversation import ConversationAgentWorkflow
from app.models import EvaluationChatMessage


class FakeRunner:
    def __init__(self, events=None, result=None):
        self._events = events or []
        self._result = result

    def stream(self, request, context):
        assert context.metadata["thread_id"] == "t1"
        assert "image_urls" in context.metadata
        yield from self._events

    def run(self, request, context):
        assert context.metadata["thread_id"] == "t1"
        return self._result


def _workflow(runner: FakeRunner) -> ConversationAgentWorkflow:
    registry = build_conversation_tool_registry(
        settings=MagicMock(),
        supabase_client=MagicMock(),
        market_client=None,
    )
    tools = registry.definitions(CONVERSATION_TOOL_NAMES)
    return ConversationAgentWorkflow(runner, tools=tools)


def test_stream_rejects_forbidden_visible_conclusion():
    runner = FakeRunner(
        events=[
            AgentStreamEvent(
                type="tool_started",
                tool_call=ToolCall(
                    id="1",
                    call_id="call-1",
                    name="assets_list",
                    arguments={},
                ),
            ),
            AgentStreamEvent(
                type="text_delta",
                delta="综合来看，建议你买。",
            ),
        ]
    )
    workflow = _workflow(runner)
    with pytest.raises(OutputPolicyError):
        list(
            workflow.stream(
                [EvaluationChatMessage(role="user", content="耳机")],
                {},
                user_id="u1",
                request_id="r1",
                thread_id="t1",
                image_urls=[],
            )
        )


def test_stream_forwards_tool_events_and_safe_text():
    runner = FakeRunner(
        events=[
            AgentStreamEvent(
                type="tool_started",
                tool_call=ToolCall(
                    id="1",
                    call_id="call-1",
                    name="assets_list",
                    arguments={},
                ),
            ),
            AgentStreamEvent(
                type="tool_completed",
                tool_call=ToolCall(
                    id="1",
                    call_id="call-1",
                    name="assets_list",
                    arguments={},
                ),
                tool_result=ToolResult(
                    call_id="call-1", name="assets_list", output="{}"
                ),
            ),
            AgentStreamEvent(type="text_delta", delta="先看你已有的耳机。"),
            AgentStreamEvent(
                type="run_completed",
                result=AgentRunResult(
                    text="先看你已有的耳机。",
                    provider="p",
                    model="m",
                    profile="c",
                    steps=1,
                ),
            ),
        ]
    )
    events = list(
        _workflow(runner).stream(
            [EvaluationChatMessage(role="user", content="耳机")],
            {"total": 1},
            user_id="u1",
            request_id="r1",
            thread_id="t1",
            image_urls=[],
        )
    )
    assert events[0].type == "tool_started"
    assert any(e.type == "text_delta" for e in events)


def test_run_returns_text():
    runner = FakeRunner(
        result=AgentRunResult(
            text="你好",
            provider="p",
            model="m",
            profile="c",
            steps=0,
        )
    )
    result = _workflow(runner).run(
        [EvaluationChatMessage(role="user", content="hi")],
        {},
        user_id="u1",
        request_id="r1",
        thread_id="t1",
        image_urls=[],
    )
    assert result.text == "你好"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && .venv/bin/pytest tests/test_conversation_workflow.py -v`

Expected: FAIL (workflow missing)

- [ ] **Step 3: Implement workflow + factory**

`CONVERSATION_SYSTEM_PROMPT` must include:

1. Friend-style general chat rules from `GENERAL_CHAT_SYSTEM_PROMPT`
2. Purchase coaching + hidden marker rules from `PURCHASE_EVALUATION_SYSTEM_PROMPT`
3. Explicit tool guidance: use recognize/parse tools when user shares product intent/link/images; use asset/market/history tools when coaching purchase; call `bind_purchase_evaluation` once when entering purchase coaching with a concrete product; do not claim DB writes except via that tool; idle chat needs no tools

In `factory.py`:

- Add `_build_conversation_router` mirroring purchase router but `tasks={"conversation_agent"}` and capabilities `{TEXT, TOOLS, STREAMING}` (DeepSeek + gateway, same priority pattern).
- `build_conversation_agent_workflow` builds registry via `build_conversation_tool_registry`, runner with `max_tool_steps=8`, returns bundle.

Export workflow from `workflows/__init__.py`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && .venv/bin/pytest tests/test_conversation_workflow.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/app/ai/workflows/conversation.py server/app/ai/workflows/__init__.py server/app/ai/factory.py server/tests/test_conversation_workflow.py
git commit -m "feat(ai): add ConversationAgentWorkflow"
```

---

### Task 3: Thin agent turn (run + stream event mapping)

**Files:**
- Modify: `server/app/agent_turn.py` (replace hard-coded branches)
- Rewrite: `server/tests/test_agent_turn.py`

**Interfaces:**
- Consumes: `build_conversation_agent_workflow`, `load_history_context` (keep), thread assert
- Produces:

```python
TOOL_LABELS: dict[str, str] = {
    "recognize_product_text": "识别商品",
    "parse_product_url": "识别商品",
    "recognize_product_images": "识别商品",
    "assets_list": "查看资产",
    "assets_summary": "查看资产",
    "market_price_snapshot": "查看市场样本",
    "evaluation_history_list": "查看购买经历",
    "bind_purchase_evaluation": "整理评估记录",
}

@dataclass
class AgentTurnResult:
    message: str
    evaluation_id: str | None = None

def run_agent_turn(...) -> AgentTurnResult: ...

def stream_agent_turn(
    *,
    settings: Settings,
    supabase_client: SupabaseClient,
    user_id: str,
    thread_id: str,
    messages: list[EvaluationChatMessage],
    image_urls: list[str],
    request_id: str,
) -> Iterator[dict]:
    """Yield SSE payload dicts: status | tool | text_delta | done.
    Caller serializes to `data: ...` and appends [DONE].
    Does not yield error dicts for OutputPolicyError — raise instead.
    """
```

Payload shapes (exact keys):

```python
{"status": "thinking"}
{"status": "replying"}
{"name": str, "label": str, "phase": "started"|"completed"}  # wrap as {"tool": ...} OR flat with type — use:
{"event": "status", "status": "thinking"|"replying"}
{"event": "tool", "name": str, "label": str, "phase": "started"|"completed"}
{"event": "text_delta", "delta": str}
{"event": "done", "evaluation_id": str | None}
```

Prefer the `event` discriminator above so the route can `json.dumps` each dict uniformly. Route maps `event` field into SSE JSON **without** the `event` key if the mobile parser expects top-level `status` / `delta` / etc. — **lock this contract:**

Mobile/SSE JSON (no `event` key):

- status → `{"status": "thinking"}`
- tool → `{"name","label","phase"}` plus distinguish from others by presence of `phase`
- text → `{"delta": "..."}`
- done → `{"evaluation_id": ...}`
- error → `{"error": "..."}`

So `stream_agent_turn` yields those dicts directly (as in the spec). Implementation:

```python
yield {"status": "thinking"}
# on tool_started:
yield {"name": call.name, "label": TOOL_LABELS.get(call.name, call.name), "phase": "started"}
# on first text_delta:
yield {"status": "replying"}
yield {"delta": delta}
# on run_completed:
yield {"evaluation_id": collected_id}  # done payload — route sends this then [DONE]
```

Collect `evaluation_id` from `tool_completed` where `tool_call.name == "bind_purchase_evaluation"` by parsing `tool_result.output` JSON for `evaluation_id`.

Keep `load_history_context` and `_assert_thread_owner`. Delete the old interpret/url/image branch functions from this file once tools own them (they live in `conversation.py`).

- [ ] **Step 1: Rewrite failing/updated tests**

Replace `server/tests/test_agent_turn.py` content with tests that mock `build_conversation_agent_workflow`:

```python
def test_run_agent_turn_returns_message_and_bound_evaluation(monkeypatch):
    ...


def test_stream_agent_turn_emits_status_tool_delta_done(monkeypatch):
    # Fake workflow.stream yields tool_started, tool_completed(bind), text_delta, run_completed
    events = list(stream_agent_turn(...))
    assert events[0] == {"status": "thinking"}
    assert any(e.get("phase") == "started" for e in events)
    assert {"status": "replying"} in events
    assert events[-1]["evaluation_id"] == "eval-1"
```

Remove obsolete tests that assert interpret → general_chat branching.

- [ ] **Step 2: Run tests to verify failures against old implementation**

Run: `cd server && .venv/bin/pytest tests/test_agent_turn.py -v`

Expected: FAIL until rewrite lands

- [ ] **Step 3: Implement thin `agent_turn.py`**

- [ ] **Step 4: Run tests**

Run: `cd server && .venv/bin/pytest tests/test_agent_turn.py tests/test_conversation_tools.py tests/test_conversation_workflow.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/app/agent_turn.py server/tests/test_agent_turn.py
git commit -m "refactor(server): toolized agent turn with stream mapping"
```

---

### Task 4: Wire `/agent/chat/stream` + sync chat

**Files:**
- Modify: `server/app/main.py`
- Create: `server/tests/test_agent_chat_stream_route.py`
- Modify: `server/tests/test_text_workflow_routes.py` (sync path still calls `run_agent_turn`)

**Interfaces:**
- Route yields:

```text
data: {"status":"thinking"}\n\n
data: {"name":"assets_list","label":"查看资产","phase":"started"}\n\n
data: {"delta":"..."}\n\n
data: {"evaluation_id":null}\n\n
data: [DONE]\n\n
```

On `OutputPolicyError` / `AIFoundationError` / `OpenAIError` / `RuntimeError` inside generator: yield `data: {"error":"聊天暂时不可用，请稍后重试"}\n\n` (no `[DONE]` required; client treats error as terminal).

HTTPException from thread check must raise **before** returning `StreamingResponse`.

- [ ] **Step 1: Write route test**

```python
# server/tests/test_agent_chat_stream_route.py
from unittest.mock import MagicMock
from app.main import stream_agent_chat
from app.models import AgentChatRequest, EvaluationChatMessage


def test_stream_route_maps_events(monkeypatch):
    monkeypatch.setattr("app.main.get_user_supabase", lambda token: MagicMock())
    monkeypatch.setattr(
        "app.main.stream_agent_turn",
        lambda **kwargs: iter(
            [
                {"status": "thinking"},
                {
                    "name": "recognize_product_text",
                    "label": "识别商品",
                    "phase": "started",
                },
                {"delta": "好"},
                {"evaluation_id": None},
            ]
        ),
    )
    response = stream_agent_chat(
        AgentChatRequest(
            thread_id="t1",
            messages=[EvaluationChatMessage(role="user", content="hi")],
        ),
        user(),
    )
    body = b"".join(response.body_iterator).decode()
    assert '"status": "thinking"' in body or '"status":"thinking"' in body
    assert "识别商品" in body
    assert "[DONE]" in body
```

(Use the same `user()` helper as other route tests.)

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd server && .venv/bin/pytest tests/test_agent_chat_stream_route.py -v`

- [ ] **Step 3: Implement route in `main.py`**

```python
@app.post("/agent/chat/stream")
def stream_agent_chat(
    request: AgentChatRequest,
    user: AuthenticatedUser = Depends(require_user),
) -> StreamingResponse:
    settings = get_settings()
    supabase_client = get_user_supabase(user.access_token)
    # Fail fast on thread ownership by calling a small precheck or first line of stream_agent_turn
    def event_stream() -> Iterator[str]:
        try:
            for payload in stream_agent_turn(
                settings=settings,
                supabase_client=supabase_client,
                user_id=user.id,
                thread_id=request.thread_id,
                messages=list(request.messages),
                image_urls=list(request.image_urls),
                request_id=uuid4().hex,
            ):
                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        except HTTPException:
            raise
        except (AIFoundationError, RuntimeError, OpenAIError, OutputPolicyError):
            payload = json.dumps(
                {"error": "聊天暂时不可用，请稍后重试"},
                ensure_ascii=False,
            )
            yield f"data: {payload}\n\n"

    # Important: validate thread before StreamingResponse so 404 is not buried in the stream.
    # Prefer extracting assert into a callable invoked here:
    from .agent_turn import assert_thread_owner  # rename _assert_thread_owner to public
    assert_thread_owner(supabase_client, user.id, request.thread_id)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

Keep `chat_freely` on `run_agent_turn` (already wired).

Export `OutputPolicyError` import from `app.ai.errors` if needed.

- [ ] **Step 4: Run route + agent turn tests**

Run: `cd server && .venv/bin/pytest tests/test_agent_chat_stream_route.py tests/test_text_workflow_routes.py::test_agent_chat_route_uses_agent_turn tests/test_agent_turn.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/app/main.py server/app/agent_turn.py server/tests/test_agent_chat_stream_route.py
git commit -m "feat(server): add /agent/chat/stream SSE endpoint"
```

---

### Task 5: Mobile SSE parser + `streamAgentChat`

**Files:**
- Modify: `mobile/src/lib/sse.ts`
- Modify: `mobile/src/lib/api.ts`
- Optional test: if the repo has Jest for `sse.ts`, update; otherwise manual verification notes in step 4

**Interfaces:**
- Produces:

```typescript
export type AgentChatStreamEvent =
  | { type: 'status'; status: 'thinking' | 'replying' }
  | {
      type: 'tool';
      name: string;
      label: string;
      phase: 'started' | 'completed';
    }
  | { type: 'delta'; text: string }
  | { type: 'done'; evaluationId: string | null }
  | { type: 'error'; message: string };

export function parseSseEvent(raw: string): AgentChatStreamEvent | null

export async function streamAgentChat(
  threadId: string,
  messages: EvaluationChatMessage[],
  imageUrls: string[],
  handlers: {
    onStatus?: (status: 'thinking' | 'replying') => void;
    onTool?: (tool: {
      name: string;
      label: string;
      phase: 'started' | 'completed';
    }) => void;
    onDelta: (fullText: string) => void;
  },
): Promise<{ message: string; evaluationId: string | null }>
```

`parseSseEvent` must remain backward compatible with purchase stream: `{delta}`, `{error}`, `[DONE]` → `{type:'done', evaluationId:null}`. If JSON has `evaluation_id` key (including null) and no delta/error/status/phase, treat as done payload.

Discrimination order:

1. `[DONE]` → done (evaluationId null) — note: route also sends JSON done before `[DONE]`; client should accept JSON done as terminal success and treat subsequent `[DONE]` as no-op.
2. `error` string
3. `status` thinking|replying
4. `phase` + `name` + `label` → tool
5. `evaluation_id` key present → done
6. `delta` string → delta

- [ ] **Step 1: Update `sse.ts` types + parser**

Implement discrimination as above. Keep exporting `splitSseBuffer`.

- [ ] **Step 2: Update `streamPurchaseEvaluation` call sites if types break**

In `api.ts`, `streamPurchaseEvaluation` should ignore `status`/`tool` events if any; on `done` return fullText (evaluationId unused).

- [ ] **Step 3: Implement `streamAgentChat`**

Mirror `streamPurchaseEvaluation` fetch headers (`Accept: text/event-stream`, bearer token) posting to `/agent/chat/stream` with `{ thread_id, messages, image_urls }`.

Accumulate `fullText` on deltas; track `evaluationId` from done event; call handlers; return `{ message: fullText.trim(), evaluationId }`. If stream ends with error event, throw. If no text and no clean done, throw `'聊天暂时不可用，请稍后重试'`.

- [ ] **Step 4: Typecheck**

Run: `cd mobile && npx tsc --noEmit`

Expected: no errors related to sse/api

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/sse.ts mobile/src/lib/api.ts
git commit -m "feat(mobile): streamAgentChat SSE client"
```

---

### Task 6: ChatThread process strip + streaming bubble

**Files:**
- Modify: `mobile/src/components/chat-thread.tsx`

**Interfaces:**
- Consumes: `streamAgentChat`
- Local state:

```typescript
type ProcessStep =
  | { kind: 'status'; status: 'thinking' | 'replying' }
  | {
      kind: 'tool';
      id: string; // `${name}-${index}` or tool call order index
      name: string;
      label: string;
      phase: 'started' | 'completed';
    };

const [processSteps, setProcessSteps] = useState<ProcessStep[]>([]);
const [streamingText, setStreamingText] = useState('');
```

UI:

- Replace lone `{sending ? <ThinkingShimmer /> : null}` with a process panel:
  - Show status label: thinking → `正在思考`, replying → `正在回复` (can keep shimmer animation on the active row).
  - List tool steps with label + phase (`…` / `完成`).
- While `streamingText` non-empty, render a temporary assistant `MessageBubble` with `stripDecisionMark(streamingText)` below the process panel (not in `messages` query data).
- `send`: call `streamAgentChat` instead of `chatFreely`; wire handlers to update process/streaming state; on success clear process + streaming, then persist via existing `saveEvaluationReply` / `createAgentMessage` using returned message + evaluationId; on error clear streaming/process and set `sendError` (user message already saved).

- [ ] **Step 1: Replace `chatFreely` import/usage with `streamAgentChat`**

- [ ] **Step 2: Add process panel component in-file**

```tsx
function AgentProcessPanel({
  steps,
}: {
  steps: ProcessStep[];
}) {
  // map status + tools to Chinese rows; reuse ThinkingShimmer styles sparingly
}
```

- [ ] **Step 3: Wire send() handlers**

```typescript
const response = await streamAgentChat(
  currentThreadId,
  history.slice(-100),
  imageUrls,
  {
    onStatus: (status) => {
      setProcessSteps((prev) => [...prev, { kind: 'status', status }]);
    },
    onTool: (tool) => {
      setProcessSteps((prev) => {
        if (tool.phase === 'completed') {
          return prev.map((step) =>
            step.kind === 'tool' &&
            step.name === tool.name &&
            step.phase === 'started'
              ? { ...step, phase: 'completed' }
              : step,
          );
        }
        return [
          ...prev,
          {
            kind: 'tool',
            id: `${tool.name}-${prev.length}`,
            name: tool.name,
            label: tool.label,
            phase: 'started',
          },
        ];
      });
    },
    onDelta: (full) => setStreamingText(full),
  },
);
```

Then existing persist logic with `response.message` / `response.evaluationId`.

Always `finally`: `setSending(false); setProcessSteps([]); setStreamingText('');` — but only clear streaming after persist succeeds; on error clear both.

- [ ] **Step 4: Manual smoke**

With local server + app: send “你好” → see 正在思考 → streaming reply → persisted bubble. Send a product sentence → see 识别商品 (+ maybe 查看资产) → reply. Kill server mid-stream → error, no half assistant message.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/chat-thread.tsx
git commit -m "feat(mobile): show agent tool process and stream reply"
```

---

### Task 7: Architecture doc sync

**Files:**
- Modify: `docs/architecture/chat-module-v1.md`

- [ ] **Step 1: Update flow diagram and boundaries**

Replace conversation-first hard-coded orchestration section with:

- Chat tab → `POST /agent/chat/stream`
- Single `ConversationAgentWorkflow` + tools
- Process UI not persisted
- Sync `/agent/chat` compatibility only
- Point to `docs/superpowers/specs/2026-07-25-agent-chat-streaming-tools-design.md`

Remove “本迭代无流式 agent turn”.

- [ ] **Step 2: Commit**

```bash
git add docs/architecture/chat-module-v1.md
git commit -m "docs: sync chat module to toolized streaming agent"
```

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| Single conversation agent + tools | 1–2 |
| Recognize text/url/images tools | 1 |
| Bind silent upsert tool | 1 |
| Purchase read-only tools reused | 1–2 |
| Memory injected read-only | 2–3 |
| image_urls only from context | 1 |
| `/agent/chat/stream` SSE events | 3–4 |
| Tool labels in Chinese | 3 |
| Neutral validation on stream | 2 |
| Sync `/agent/chat` kept | 3–4 |
| Mobile process strip all tools | 5–6 |
| Persist only on done | 6 |
| Chat module docs | 7 |

## Execution notes

- Prefer running server tests inside `server/` with `.venv/bin/pytest`.
- After Task 3, old degrade-to-GeneralChat unit tests are obsolete; do not reintroduce hard-coded intent branching.
- If `ToolResult.output` is a stringified Pydantic dump, parse with `json.loads` when collecting `evaluation_id`.
