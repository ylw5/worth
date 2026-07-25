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
