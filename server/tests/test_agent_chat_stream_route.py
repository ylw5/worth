from unittest.mock import MagicMock
import asyncio

from app.auth import AuthenticatedUser
from app.ai.errors import OutputPolicyError
from app.main import stream_agent_chat
from app.models import AgentChatRequest, EvaluationChatMessage


def user() -> AuthenticatedUser:
    return AuthenticatedUser(id="user-1", access_token="token")


def test_stream_route_maps_events(monkeypatch):
    monkeypatch.setattr("app.main.get_user_supabase", lambda token: MagicMock())
    monkeypatch.setattr(
        "app.main.assert_thread_owner",
        lambda *args, **kwargs: None,
    )
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

    async def collect_body() -> str:
        chunks = [chunk async for chunk in response.body_iterator]
        return "".join(chunks)

    body = asyncio.run(collect_body())
    assert '"status": "thinking"' in body or '"status":"thinking"' in body
    assert "识别商品" in body
    assert "[DONE]" in body


def test_stream_route_handles_output_policy_error(monkeypatch):
    monkeypatch.setattr("app.main.get_user_supabase", lambda token: MagicMock())
    monkeypatch.setattr(
        "app.main.assert_thread_owner",
        lambda *args, **kwargs: None,
    )

    def raise_output_policy(**kwargs):
        raise OutputPolicyError("blocked")

    monkeypatch.setattr(
        "app.main.stream_agent_turn",
        raise_output_policy,
    )
    response = stream_agent_chat(
        AgentChatRequest(
            thread_id="t1",
            messages=[EvaluationChatMessage(role="user", content="hi")],
        ),
        user(),
    )

    async def collect_body() -> str:
        chunks = [chunk async for chunk in response.body_iterator]
        return "".join(chunks)

    body = asyncio.run(collect_body())
    assert "聊天暂时不可用，请稍后重试" in body
    assert "[DONE]" not in body
