# Conversation-First Agent Turn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every chat send a single `POST /agent/chat` turn: server orchestrates chat vs purchase coaching, degrades parse failures to free chat in-turn, and silently upserts `purchase_evaluations` when a product is identified—no client-side normalize/parse/evaluate/stream branching.

**Architecture:** Extend `AgentChatRequest`/`Response` with `thread_id`, optional `image_urls`, and optional `evaluation_id`. Add `server/app/agent_turn.py` that reuses existing text/vision/purchase workflows behind one entrypoint. Slim `ChatThread.send` to: ensure thread → upload images (URLs only) → persist user → one chat call → persist assistant (via `save_evaluation_reply` when `evaluation_id` + markers).

**Tech Stack:** FastAPI, existing AI workflows (`product_interpretation`, `general_chat`, purchase evaluation workflow, vision), Supabase user-scoped client, Expo/React Query mobile, pytest.

## Global Constraints

- Do not change the AI role: facts, gaps, one clarifying question; decision markers allowed; do not decide for the user.
- No user-visible「创建评估」or evaluation mode switch.
- Parse/product failures must return HTTP 200 with a GeneralChat reply (same turn), not「商品描述暂时无法解析」to the chat client.
- Only auth / wrong thread / GeneralChat-down / persistence failures surface as client errors.
- Keep old routes (`normalize-text`, `parse`, `analyze-images`, `evaluate`, `stream`) for compatibility; chat tab must stop calling them.
- Do not delete `purchase_evaluations` or `evaluation_messages` tables.
- Do not rename `(evaluation)` route; no streaming agent turn this iteration.
- Builds on unified threads (`thread_id` on evaluations, messages in `agent_messages`).

## File Map

| File | Responsibility |
| --- | --- |
| `server/app/models.py` | Extend agent chat request/response |
| `server/app/agent_turn.py` | Orchestrate one turn + degrade-to-chat |
| `server/app/main.py` | Wire `/agent/chat` to orchestrator |
| `server/tests/test_agent_turn.py` | Unit tests for routing + degrade |
| `server/tests/test_text_workflow_routes.py` | Update `/agent/chat` route tests |
| `mobile/src/lib/api.ts` | `chatFreely(threadId, messages, imageUrls?)` |
| `mobile/src/components/chat-thread.tsx` | Minimal send path |
| `docs/architecture/chat-module-v1.md` | Document conversation-first flow |

---

### Task 1: API models + orchestrator skeleton with degrade-to-chat

**Files:**
- Modify: `server/app/models.py`
- Create: `server/app/agent_turn.py`
- Create: `server/tests/test_agent_turn.py`

**Interfaces:**
- Produces:

```python
# models.py
class AgentChatRequest(BaseModel):
    thread_id: str
    messages: list[EvaluationChatMessage] = Field(min_length=1, max_length=100)
    image_urls: list[str] = Field(default_factory=list, max_length=8)

class AgentChatResponse(BaseModel):
    message: str
    evaluation_id: Optional[str] = None

# agent_turn.py
@dataclass
class AgentTurnResult:
    message: str
    evaluation_id: str | None = None

def run_agent_turn(
    *,
    settings: Settings,
    supabase_client: SupabaseClient,
    user_id: str,
    thread_id: str,
    messages: list[EvaluationChatMessage],
    image_urls: list[str],
    request_id: str,
) -> AgentTurnResult: ...
```

- [ ] **Step 1: Write failing tests for degrade + chat path**

Create `server/tests/test_agent_turn.py`:

```python
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.agent_turn import run_agent_turn
from app.models import EvaluationChatMessage


def test_chat_intent_uses_general_chat_without_evaluation(monkeypatch):
    interpret = MagicMock(
        return_value=SimpleNamespace(
            intent="chat",
            reply="你好呀",
            normalized_title="",
            category="其他",
            subcategory="",
        )
    )
    general = MagicMock(return_value="慢慢说，我在。")
    monkeypatch.setattr(
        "app.agent_turn._interpret_text",
        interpret,
    )
    monkeypatch.setattr(
        "app.agent_turn._general_chat",
        general,
    )
    monkeypatch.setattr(
        "app.agent_turn._assert_thread_owner",
        lambda client, user_id, thread_id: None,
    )

    result = run_agent_turn(
        settings=MagicMock(),
        supabase_client=MagicMock(),
        user_id="u1",
        thread_id="t1",
        messages=[EvaluationChatMessage(role="user", content="你好")],
        image_urls=[],
        request_id="r1",
    )
    assert result.evaluation_id is None
    assert "慢慢说" in result.message or result.message
    general.assert_called_once()


def test_interpret_failure_degrades_to_general_chat(monkeypatch):
    monkeypatch.setattr(
        "app.agent_turn._assert_thread_owner",
        lambda client, user_id, thread_id: None,
    )
    monkeypatch.setattr(
        "app.agent_turn._interpret_text",
        MagicMock(side_effect=RuntimeError("boom")),
    )
    general = MagicMock(return_value="我在，先聊聊你在想什么。")
    monkeypatch.setattr("app.agent_turn._general_chat", general)

    result = run_agent_turn(
        settings=MagicMock(),
        supabase_client=MagicMock(),
        user_id="u1",
        thread_id="t1",
        messages=[
            EvaluationChatMessage(role="user", content="我想买一个佳明的手表")
        ],
        image_urls=[],
        request_id="r1",
    )
    assert result.evaluation_id is None
    assert result.message == "我在，先聊聊你在想什么。"
    general.assert_called_once()
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/leven/i/worth && server/.venv/bin/pytest server/tests/test_agent_turn.py -q
```

Expected: FAIL (module missing).

- [ ] **Step 3: Extend models**

In `server/app/models.py`, replace `AgentChatRequest` / `AgentChatResponse` with the interfaces above (`thread_id` required; `image_urls` default `[]`; `evaluation_id` optional on response).

- [ ] **Step 4: Implement skeleton `agent_turn.py`**

Implement at minimum:

- `_assert_thread_owner`: `supabase_client.table("agent_threads").select("id").eq("id", thread_id).eq("user_id", user_id).limit(1)` — raise `HTTPException(404)` if missing (import from fastapi).
- `_latest_user_text(messages) -> str`
- `_extract_url(text) -> str | None` (reuse URL heuristics from mobile/`product` if a shared helper exists; else simple `http`/`https` first-token scan matching `normalizeProductUrl` spirit).
- `_interpret_text` / `_general_chat` / `_recognize_images` / `_parse_url` / `_run_purchase` as thin wrappers calling existing workflows (same as `main.py` today).
- `run_agent_turn` flow for this task:
  1. assert thread
  2. if `image_urls`: try recognize → if fail → general chat return
  3. elif url in latest user text: try parse → if fail → general chat
  4. else: try interpret text → if fail → general chat; if `intent=="chat"` → general chat (prefer interpret.reply as soft prompt but still call general_chat with messages for consistency, OR return interpret.reply when non-empty—pick one and test it; prefer always `general_chat` for one code path)
  5. if product path succeeds: for Task 1 return general_chat still OR stub `evaluation_id=None` and message from a placeholder—**actually for Task 1 only implement chat + degrade**; product success path can call general_chat with a note OR raise NotImplemented—better: if product intent, call `_run_purchase` stub that Task 2 fills. For Task 1, on product intent call general_chat as temporary stand-in only if needed for green tests—**do not**: implement product branch in Task 2. Task 1 tests only cover chat + degrade.

```python
def run_agent_turn(...):
    _assert_thread_owner(supabase_client, user_id, thread_id)
    memory = load_history_context(supabase_client, user_id)
    try:
        if image_urls:
            product = _recognize_images(settings, image_urls, user_id, request_id)
            return _purchase_or_degrade(...)  # Task 2
        text = _latest_user_text(messages)
        url = _extract_url(text)
        if url:
            product = _parse_url(settings, url, user_id, request_id)
            return _purchase_or_degrade(...)  # Task 2
        interpretation = _interpret_text(settings, text, user_id, request_id)
        if interpretation.intent == "chat":
            message = _general_chat(
                settings, messages, memory, user_id, request_id
            )
            return AgentTurnResult(message=message)
        return _purchase_or_degrade(...)  # Task 2
    except Exception:
        # Only catch product-pipeline errors inside helpers; see Step 4 detail.
        message = _general_chat(settings, messages, memory, user_id, request_id)
        return AgentTurnResult(message=message)
```

Structure helpers so interpret/parse/recognize catch their own failures and return `None` / raise a dedicated `ProductPipelineError`, and `run_agent_turn` maps that to general chat. Do **not** swallow errors from `_general_chat` or `_assert_thread_owner`.

- [ ] **Step 5: Run tests**

```bash
server/.venv/bin/pytest server/tests/test_agent_turn.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/app/models.py server/app/agent_turn.py server/tests/test_agent_turn.py
git commit -m "$(cat <<'EOF'
feat(server): add agent turn skeleton with chat degrade

EOF
)"
```

---

### Task 2: Purchase path — silent evaluation upsert + coaching reply

**Files:**
- Modify: `server/app/agent_turn.py`
- Modify: `server/tests/test_agent_turn.py`

**Interfaces:**
- Consumes: `build_confirmed_purchase_evaluation`, `build_purchase_evaluation_workflow`, existing `ParsedProduct`
- Produces: `_purchase_or_degrade` → `AgentTurnResult(message, evaluation_id)`

- [ ] **Step 1: Failing test for product path**

```python
def test_product_intent_upserts_evaluation_and_returns_id(monkeypatch):
    monkeypatch.setattr(
        "app.agent_turn._assert_thread_owner",
        lambda *a, **k: None,
    )
    monkeypatch.setattr(
        "app.agent_turn._interpret_text",
        MagicMock(
            return_value=SimpleNamespace(
                intent="product",
                reply="",
                normalized_title="佳明手表",
                category="数码",
                subcategory="手表",
            )
        ),
    )
    monkeypatch.setattr(
        "app.agent_turn._upsert_evaluation",
        MagicMock(return_value="eval-1"),
    )
    monkeypatch.setattr(
        "app.agent_turn._purchase_reply",
        MagicMock(return_value="我们先把预算和使用场景说清楚。"),
    )
    monkeypatch.setattr(
        "app.agent_turn.load_history_context",
        lambda *a, **k: {},
    )

    result = run_agent_turn(
        settings=MagicMock(),
        supabase_client=MagicMock(),
        user_id="u1",
        thread_id="t1",
        messages=[
            EvaluationChatMessage(role="user", content="我想买佳明手表 2000块")
        ],
        image_urls=[],
        request_id="r1",
    )
    assert result.evaluation_id == "eval-1"
    assert "预算" in result.message
```

- [ ] **Step 2: Run to see fail / incomplete product branch**

```bash
server/.venv/bin/pytest server/tests/test_agent_turn.py::test_product_intent_upserts_evaluation_and_returns_id -q
```

- [ ] **Step 3: Implement `_upsert_evaluation` and `_purchase_reply`**

`_upsert_evaluation(supabase, user_id, thread_id, product: ParsedProduct) -> str`:

1. Look for latest evaluation on thread with same normalized title (optional) or always insert new row for v1 simplicity per spec「静默 upsert」— **v1: insert new** `purchase_evaluations` with `thread_id`, product fields, empty narrative; return `id`.
2. Use user supabase client (RLS). Include required columns matching mobile `createPurchaseEvaluation` insert (source_type/source_text/image_paths/decision defaults).

`_purchase_reply(...)`:

1. `confirmed = build_confirmed_purchase_evaluation(supabase, user_id, product)`
2. Run purchase evaluation workflow with `messages` (same as `evaluate_purchase` / `chat_about_purchase` in `main.py`).
3. On workflow failure → raise `ProductPipelineError` so outer degrade runs.
4. Return narrative text (may include decision markers).

Wire `_purchase_or_degrade` to call these and return `AgentTurnResult`.

Also: if thread already has an evaluation and interpret says product follow-up with same product, v1 may still insert another evaluation—acceptable for this iteration; optional improvement: reuse latest evaluation on thread when titles fuzzy-match. Document choice in code comment: **reuse latest evaluation on thread when `intent==product` and thread has evaluations**, else insert. Prefer reuse to avoid spam:

```python
existing = _latest_evaluation_on_thread(supabase, thread_id)
if existing:
    evaluation_id = existing["id"]
    # optionally refresh product fields
else:
    evaluation_id = _insert_evaluation(...)
```

- [ ] **Step 4: Tests pass**

```bash
server/.venv/bin/pytest server/tests/test_agent_turn.py -q
```

- [ ] **Step 5: Commit**

```bash
git add server/app/agent_turn.py server/tests/test_agent_turn.py
git commit -m "$(cat <<'EOF'
feat(server): silent evaluation upsert in agent turn

EOF
)"
```

---

### Task 3: Wire `/agent/chat` route

**Files:**
- Modify: `server/app/main.py`
- Modify: `server/tests/test_text_workflow_routes.py`

**Interfaces:**
- Consumes: `run_agent_turn`, new `AgentChatRequest`

- [ ] **Step 1: Update route test**

Replace `test_general_chat_route_uses_workflow_and_memory` to pass `thread_id` and monkeypatch `run_agent_turn` (or keep workflow mocks by patching `run_agent_turn` to call general chat). Simplest:

```python
def test_agent_chat_route_uses_agent_turn(monkeypatch):
    monkeypatch.setattr(
        "app.main.get_user_supabase",
        lambda token: MagicMock(),
    )
    monkeypatch.setattr(
        "app.main.run_agent_turn",
        lambda **kwargs: SimpleNamespace(
            message="ok", evaluation_id=None
        ),
    )
    result = chat_freely(
        AgentChatRequest(
            thread_id="t1",
            messages=[EvaluationChatMessage(role="user", content="hi")],
        ),
        user(),
    )
    assert result.message == "ok"
    assert result.evaluation_id is None
```

- [ ] **Step 2: Implement route**

```python
@app.post("/agent/chat", response_model=AgentChatResponse)
def chat_freely(
    request: AgentChatRequest,
    user: AuthenticatedUser = Depends(require_user),
) -> AgentChatResponse:
    try:
        supabase_client = get_user_supabase(user.access_token)
        result = run_agent_turn(
            settings=get_settings(),
            supabase_client=supabase_client,
            user_id=user.id,
            thread_id=request.thread_id,
            messages=list(request.messages),
            image_urls=list(request.image_urls),
            request_id=uuid4().hex,
        )
        return AgentChatResponse(
            message=result.message,
            evaluation_id=result.evaluation_id,
        )
    except HTTPException:
        raise
    except (AIFoundationError, RuntimeError, OpenAIError) as error:
        raise HTTPException(
            status_code=503,
            detail="聊天暂时不可用，请稍后重试",
        ) from error
```

Note: product-pipeline errors must be handled inside `run_agent_turn` (degrade). Only general-chat failures bubble as 503.

- [ ] **Step 3: Run route + agent_turn tests**

```bash
server/.venv/bin/pytest server/tests/test_agent_turn.py server/tests/test_text_workflow_routes.py -q
```

Expected: PASS (fix any other tests that construct `AgentChatRequest` without `thread_id`).

- [ ] **Step 4: Commit**

```bash
git add server/app/main.py server/tests/test_text_workflow_routes.py
git commit -m "$(cat <<'EOF'
feat(server): route /agent/chat through agent turn

EOF
)"
```

---

### Task 4: Mobile API + slim `ChatThread.send`

**Files:**
- Modify: `mobile/src/lib/api.ts`
- Modify: `mobile/src/components/chat-thread.tsx`

**Interfaces:**
- Produces:

```ts
export type AgentChatResult = {
  message: string;
  evaluation_id?: string | null;
};

export const chatFreely = (
  threadId: string,
  messages: EvaluationChatMessage[],
  imageUrls: string[] = [],
) =>
  request<AgentChatResult>('/agent/chat', {
    thread_id: threadId,
    messages,
    image_urls: imageUrls,
  });
```

- [ ] **Step 1: Update `chatFreely` signature** (break callers—only `chat-thread.tsx`).

- [ ] **Step 2: Rewrite `send` in `chat-thread.tsx`**

Target structure:

```ts
// 1) ensure thread + title
// 2) optional uploadPhotos → signedUrls (no analyzeProductPhotos)
// 3) createAgentMessage user (route_result optional {})
// 4) const history = await listAgentMessages → map role/content
// 5) const response = await chatFreely(threadId, history.slice(-100), signedUrls)
// 6) if response.evaluation_id:
//      await saveEvaluationReply(response.evaluation_id, response.message)
//      // saveEvaluationReply writes agent_messages assistant + spending resolution
//    else:
//      await createAgentMessage(threadId, userId, 'assistant', response.message)
// 7) invalidate thread queries; update title if evaluation product title available via listEvaluationsForThread
```

Remove: `normalizeProductText`, `parseProduct`, `analyzeProductPhotos`, `evaluatePurchase`, `streamPurchaseEvaluation`, `createNewEvaluation`, `streamFollowUp`, client-side catch fallback to freeChat (server handles degrade).

Keep: inline resolution/outcome UI, keyboard/scroll behavior.

Import cleanup accordingly.

- [ ] **Step 3: Typecheck**

```bash
cd mobile && npx tsc --noEmit
```

Expected: clean for chat files (ignore pre-existing `market-trend.ts` if still broken).

- [ ] **Step 4: Commit**

```bash
git add mobile/src/lib/api.ts mobile/src/components/chat-thread.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): single /agent/chat send path

EOF
)"
```

---

### Task 5: Architecture doc + verification

**Files:**
- Modify: `docs/architecture/chat-module-v1.md`

- [ ] **Step 1: Update flow section** to conversation-first:

```text
用户输入 → POST /agent/chat（服务端编排）
  ├─ 闲聊 → GeneralChat
  ├─ 购买梳理 → 静默评估落库 + 梳理回复
  └─ 解析/评估失败 → 同回合降级 GeneralChat
```

Note client no longer calls normalize/parse/evaluate/stream for the chat tab.

- [ ] **Step 2: Manual smoke checklist**

- [ ] 「你好」→ 闲聊；Charles/logs 无 `normalize-text`
- [ ] 「我想买佳明手表」with forced interpret failure (or bad AI key path) → still assistant reply, no red parse error
- [ ] Valid product URL → continuous thread; row in `purchase_evaluations`; no mode switch
- [ ] Decision/skip markers → inline 忍住卡 works once
- [ ] New chat blank; first message appears in drawer

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/chat-module-v1.md
git commit -m "$(cat <<'EOF'
docs: document conversation-first agent turn

EOF
)"
```

---

## Spec coverage

| Spec item | Task |
| --- | --- |
| Single `/agent/chat` client path | 4 |
| `thread_id` + `image_urls` + `evaluation_id` | 1, 3, 4 |
| Server orchestration | 1, 2 |
| Same-turn degrade to chat | 1 |
| Silent evaluation upsert | 2 |
| Keep old routes, unused by chat tab | 4 (stop calling) |
| No streaming / no route rename | Global |
| Architecture doc | 5 |
