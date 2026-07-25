from types import SimpleNamespace
from unittest.mock import MagicMock

from app.agent_turn import (
    _insert_evaluation,
    _upsert_evaluation,
    run_agent_turn,
)
from app.models import EvaluationChatMessage, ParsedProduct


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


def test_upsert_evaluation_reuses_latest_on_thread(monkeypatch):
    monkeypatch.setattr(
        "app.agent_turn._latest_evaluation_on_thread",
        lambda *_a, **_k: {"id": "existing-eval"},
    )
    insert = MagicMock(return_value="new-eval")
    monkeypatch.setattr("app.agent_turn._insert_evaluation", insert)

    product = ParsedProduct(
        title="佳明手表",
        category="数码",
        subcategory="手表",
        source_type="text",
        source_text="我想买佳明手表",
    )
    evaluation_id = _upsert_evaluation(MagicMock(), "u1", "t1", product)
    assert evaluation_id == "existing-eval"
    insert.assert_not_called()


def test_upsert_evaluation_inserts_when_thread_has_none(monkeypatch):
    monkeypatch.setattr(
        "app.agent_turn._latest_evaluation_on_thread",
        lambda *_a, **_k: None,
    )
    insert = MagicMock(return_value="new-eval")
    monkeypatch.setattr("app.agent_turn._insert_evaluation", insert)

    product = ParsedProduct(
        title="佳明手表",
        category="数码",
        subcategory="手表",
        source_type="text",
        source_text="我想买佳明手表",
    )
    evaluation_id = _upsert_evaluation(MagicMock(), "u1", "t1", product)
    assert evaluation_id == "new-eval"
    insert.assert_called_once()


def test_insert_evaluation_writes_required_columns():
    client = MagicMock()
    chain = client.table.return_value
    chain.insert.return_value = chain
    chain.select.return_value = chain
    chain.limit.return_value = chain
    chain.execute.return_value = MagicMock(data=[{"id": "eval-new"}])

    product = ParsedProduct(
        title="佳明手表",
        category="数码",
        subcategory="手表",
        source_type="text",
        source_text="我想买佳明手表",
    )
    evaluation_id = _insert_evaluation(client, "u1", "t1", product)
    assert evaluation_id == "eval-new"
    payload = chain.insert.call_args.args[0]
    assert payload["user_id"] == "u1"
    assert payload["thread_id"] == "t1"
    assert payload["product_title"] == "佳明手表"
    assert payload["source_type"] == "text"
    assert payload["source_text"] == "我想买佳明手表"
    assert payload["image_paths"] == []
    assert payload["narrative"].strip()
