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
from app.ai.workflows.conversation import (
    CONVERSATION_SYSTEM_PROMPT,
    ConversationAgentWorkflow,
)
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


def test_purchase_decision_requires_tools_and_user_feedback():
    assert "最终决策前必须用 assets_list 或 assets_summary" in (
        CONVERSATION_SYSTEM_PROMPT
    )
    assert "必须尝试 market_price_snapshot" in CONVERSATION_SYSTEM_PROMPT
    assert "用户自己的使用反馈" in CONVERSATION_SYSTEM_PROMPT
    assert "首轮只有商品信息时继续追问" in CONVERSATION_SYSTEM_PROMPT
