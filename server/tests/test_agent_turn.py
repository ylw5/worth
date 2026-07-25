import json
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.agent_turn import TOOL_LABELS, run_agent_turn, stream_agent_turn
from app.ai.contracts import (
    AgentRunResult,
    AgentStreamEvent,
    ToolCall,
    ToolExecutionRecord,
    ToolResult,
)
from app.models import EvaluationChatMessage


def _messages():
    return [EvaluationChatMessage(role="user", content="hi")]


def test_wishlist_tool_has_visible_label():
    assert TOOL_LABELS["wishlist_list"] == "查看心愿"


def test_run_agent_turn_returns_message_and_bound_evaluation(monkeypatch):
    monkeypatch.setattr(
        "app.agent_turn.assert_thread_owner",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "app.agent_turn.load_history_context",
        lambda *args, **kwargs: {},
    )
    bind_output = json.dumps({"evaluation_id": "eval-9"})
    result = AgentRunResult(
        text="梳理一下",
        provider="p",
        model="m",
        profile="c",
        steps=1,
        tool_executions=[
            ToolExecutionRecord(
                step=1,
                call=ToolCall(
                    id="1",
                    call_id="c1",
                    name="bind_purchase_evaluation",
                    arguments={},
                ),
                result=ToolResult(
                    call_id="c1",
                    name="bind_purchase_evaluation",
                    output=bind_output,
                ),
            )
        ],
    )
    workflow = MagicMock()
    workflow.run.return_value = result
    monkeypatch.setattr(
        "app.agent_turn.build_conversation_agent_workflow",
        lambda **kwargs: SimpleNamespace(workflow=workflow),
    )
    out = run_agent_turn(
        settings=MagicMock(xianyu_cookie=""),
        supabase_client=MagicMock(),
        user_id="u1",
        thread_id="t1",
        messages=_messages(),
        image_urls=[],
        request_id="r1",
    )
    assert out.message == "梳理一下"
    assert out.evaluation_id == "eval-9"


def test_stream_agent_turn_emits_status_tool_delta_done(monkeypatch):
    monkeypatch.setattr(
        "app.agent_turn.assert_thread_owner",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "app.agent_turn.load_history_context",
        lambda *args, **kwargs: {},
    )
    bind_output = json.dumps({"evaluation_id": "eval-1"})
    events = [
        AgentStreamEvent(
            type="tool_started",
            tool_call=ToolCall(
                id="1",
                call_id="c1",
                name="recognize_product_text",
                arguments={},
            ),
        ),
        AgentStreamEvent(
            type="tool_completed",
            tool_call=ToolCall(
                id="1",
                call_id="c1",
                name="recognize_product_text",
                arguments={},
            ),
            tool_result=ToolResult(
                call_id="c1",
                name="recognize_product_text",
                output="{}",
            ),
        ),
        AgentStreamEvent(
            type="tool_started",
            tool_call=ToolCall(
                id="2",
                call_id="c2",
                name="bind_purchase_evaluation",
                arguments={},
            ),
        ),
        AgentStreamEvent(
            type="tool_completed",
            tool_call=ToolCall(
                id="2",
                call_id="c2",
                name="bind_purchase_evaluation",
                arguments={},
            ),
            tool_result=ToolResult(
                call_id="c2",
                name="bind_purchase_evaluation",
                output=bind_output,
            ),
        ),
        AgentStreamEvent(type="text_delta", delta="你好"),
        AgentStreamEvent(
            type="run_completed",
            result=AgentRunResult(
                text="你好",
                provider="p",
                model="m",
                profile="c",
                steps=2,
            ),
        ),
    ]
    workflow = MagicMock()
    workflow.stream.return_value = iter(events)
    monkeypatch.setattr(
        "app.agent_turn.build_conversation_agent_workflow",
        lambda **kwargs: SimpleNamespace(workflow=workflow),
    )
    payloads = list(
        stream_agent_turn(
            settings=MagicMock(xianyu_cookie=""),
            supabase_client=MagicMock(),
            user_id="u1",
            thread_id="t1",
            messages=_messages(),
            image_urls=[],
            request_id="r1",
        )
    )
    assert payloads[0] == {"status": "thinking"}
    assert any(e.get("phase") == "started" for e in payloads)
    assert {"status": "replying"} in payloads
    assert {"delta": "你好"} in payloads
    assert payloads[-1]["evaluation_id"] == "eval-1"


def test_run_agent_turn_keeps_latest_thread_evaluation(monkeypatch):
    monkeypatch.setattr(
        "app.agent_turn.assert_thread_owner",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "app.agent_turn.load_history_context",
        lambda *args, **kwargs: {},
    )
    monkeypatch.setattr(
        "app.agent_turn._latest_evaluation_id",
        lambda *args, **kwargs: "eval-existing",
    )
    workflow = MagicMock()
    workflow.run.return_value = AgentRunResult(
        text="不着急，可以再想想。",
        provider="p",
        model="m",
        profile="c",
        steps=1,
    )
    monkeypatch.setattr(
        "app.agent_turn.build_conversation_agent_workflow",
        lambda **kwargs: SimpleNamespace(workflow=workflow),
    )

    out = run_agent_turn(
        settings=MagicMock(xianyu_cookie=""),
        supabase_client=MagicMock(),
        user_id="u1",
        thread_id="t1",
        messages=_messages(),
        image_urls=[],
        request_id="r1",
    )

    assert out.evaluation_id == "eval-existing"


def test_run_agent_turn_binds_successfully_recognized_product(monkeypatch):
    monkeypatch.setattr(
        "app.agent_turn.assert_thread_owner",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "app.agent_turn.load_history_context",
        lambda *args, **kwargs: {},
    )
    monkeypatch.setattr(
        "app.agent_turn._latest_evaluation_id",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "app.agent_turn._upsert_evaluation",
        lambda *args, **kwargs: "eval-new",
    )
    recognized = json.dumps(
        {
            "is_product": True,
            "product": {
                "title": "Garmin Forerunner 265",
                "price": 1700,
                "category": "数码",
                "subcategory": "运动手表",
                "source_type": "text",
                "source_text": "想买 Garmin Forerunner 265",
            },
            "note": "",
        }
    )
    workflow = MagicMock()
    workflow.run.return_value = AgentRunResult(
        text="先看看使用频率。",
        provider="p",
        model="m",
        profile="c",
        steps=1,
        tool_executions=[
            ToolExecutionRecord(
                step=1,
                call=ToolCall(
                    id="1",
                    call_id="c1",
                    name="recognize_product_text",
                    arguments={},
                ),
                result=ToolResult(
                    call_id="c1",
                    name="recognize_product_text",
                    output=recognized,
                ),
            )
        ],
    )
    monkeypatch.setattr(
        "app.agent_turn.build_conversation_agent_workflow",
        lambda **kwargs: SimpleNamespace(workflow=workflow),
    )

    out = run_agent_turn(
        settings=MagicMock(xianyu_cookie=""),
        supabase_client=MagicMock(),
        user_id="u1",
        thread_id="t1",
        messages=_messages(),
        image_urls=[],
        request_id="r1",
    )

    assert out.evaluation_id == "eval-new"
