from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import dataclass

from fastapi import HTTPException
from supabase import Client as SupabaseClient

from .ai.contracts import ToolExecutionRecord
from .ai.factory import build_conversation_agent_workflow
from .ai.tools.conversation import _upsert_evaluation
from .config import Settings
from .evaluation_tools import summarize_evaluation_history
from .market import MarketClient
from .models import EvaluationChatMessage, ParsedProduct

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


def load_history_context(
    supabase_client: SupabaseClient,
    user_id: str,
    category: str = "",
    subcategory: str = "",
    *,
    current_evaluation_id: str | None = None,
    include_current: bool = False,
) -> dict:
    """读取并压缩跨对话购买历史；读取失败时降级为空上下文。"""
    try:
        response = (
            supabase_client.table("agent_memories")
            .select("facts, created_at")
            .eq("user_id", user_id)
            .eq("is_active", True)
            .order("updated_at", desc=True)
            .limit(100)
            .execute()
        )
    except Exception:
        return {}
    rows = response.data if isinstance(response.data, list) else []
    records = [
        {
            **(row.get("facts") or {}),
            "created_at": (row.get("facts") or {}).get(
                "created_at",
                row.get("created_at"),
            ),
        }
        for row in rows
        if isinstance(row, dict) and isinstance(row.get("facts"), dict)
    ]
    if not records:
        return {}
    return summarize_evaluation_history(
        records,
        category,
        subcategory,
        current_evaluation_id=current_evaluation_id,
        include_current=include_current,
    )


def _assert_thread_owner(
    supabase_client: SupabaseClient,
    user_id: str,
    thread_id: str,
) -> None:
    response = (
        supabase_client.table("agent_threads")
        .select("id")
        .eq("id", thread_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail="对话不存在")


assert_thread_owner = _assert_thread_owner


def _evaluation_id_from_bind_output(output: str) -> str | None:
    try:
        data = json.loads(output)
    except (json.JSONDecodeError, TypeError):
        return None
    evaluation_id = data.get("evaluation_id")
    return str(evaluation_id) if evaluation_id else None


def _evaluation_id_from_executions(
    tool_executions: list[ToolExecutionRecord],
) -> str | None:
    for record in tool_executions:
        if record.call.name == "bind_purchase_evaluation":
            return _evaluation_id_from_bind_output(record.result.output)
    return None


def _latest_evaluation_id(
    supabase_client: SupabaseClient,
    user_id: str,
    thread_id: str,
) -> str | None:
    try:
        response = (
            supabase_client.table("purchase_evaluations")
            .select("id")
            .eq("user_id", user_id)
            .eq("thread_id", thread_id)
            .order("updated_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception:
        return None
    rows = response.data if isinstance(response.data, list) else []
    return str(rows[0]["id"]) if rows and rows[0].get("id") else None


def _recognized_product_from_executions(
    tool_executions: list[ToolExecutionRecord],
) -> ParsedProduct | None:
    recognize_tools = {
        "recognize_product_text",
        "recognize_product_images",
        "parse_product_url",
    }
    for record in reversed(tool_executions):
        if record.call.name not in recognize_tools or record.result.is_error:
            continue
        try:
            payload = json.loads(record.result.output)
            if payload.get("is_product") and payload.get("product"):
                return ParsedProduct.model_validate(payload["product"])
        except (json.JSONDecodeError, TypeError, ValueError):
            continue
    return None


def _resolve_evaluation_id(
    supabase_client: SupabaseClient,
    user_id: str,
    thread_id: str,
    tool_executions: list[ToolExecutionRecord],
) -> str | None:
    bound_id = _evaluation_id_from_executions(tool_executions)
    if bound_id:
        return bound_id
    existing_id = _latest_evaluation_id(
        supabase_client,
        user_id,
        thread_id,
    )
    if existing_id:
        return existing_id
    product = _recognized_product_from_executions(tool_executions)
    if product is None:
        return None
    return _upsert_evaluation(
        supabase_client,
        user_id,
        thread_id,
        product,
    )


def run_agent_turn(
    *,
    settings: Settings,
    supabase_client: SupabaseClient,
    user_id: str,
    thread_id: str,
    messages: list[EvaluationChatMessage],
    image_urls: list[str],
    request_id: str,
) -> AgentTurnResult:
    assert_thread_owner(supabase_client, user_id, thread_id)
    memory = load_history_context(supabase_client, user_id)
    bundle = build_conversation_agent_workflow(
        settings=settings,
        supabase_client=supabase_client,
        market_client=(
            MarketClient(settings.xianyu_cookie)
            if settings.xianyu_cookie
            else None
        ),
    )
    result = bundle.workflow.run(
        messages,
        memory,
        user_id=user_id,
        request_id=request_id,
        thread_id=thread_id,
        image_urls=image_urls,
    )
    evaluation_id = _resolve_evaluation_id(
        supabase_client,
        user_id,
        thread_id,
        result.tool_executions,
    )
    return AgentTurnResult(message=result.text, evaluation_id=evaluation_id)


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
    assert_thread_owner(supabase_client, user_id, thread_id)
    memory = load_history_context(supabase_client, user_id)
    bundle = build_conversation_agent_workflow(
        settings=settings,
        supabase_client=supabase_client,
        market_client=(
            MarketClient(settings.xianyu_cookie)
            if settings.xianyu_cookie
            else None
        ),
    )
    yield {"status": "thinking"}
    tool_executions: list[ToolExecutionRecord] = []
    replying = False
    for event in bundle.workflow.stream(
        messages,
        memory,
        user_id=user_id,
        request_id=request_id,
        thread_id=thread_id,
        image_urls=image_urls,
    ):
        if event.type == "tool_started" and event.tool_call is not None:
            call = event.tool_call
            yield {
                "name": call.name,
                "label": TOOL_LABELS.get(call.name, call.name),
                "phase": "started",
            }
        elif event.type == "tool_completed" and event.tool_call is not None:
            call = event.tool_call
            yield {
                "name": call.name,
                "label": TOOL_LABELS.get(call.name, call.name),
                "phase": "completed",
            }
            if event.tool_result is not None:
                tool_executions.append(
                    ToolExecutionRecord(
                        step=1,
                        call=call,
                        result=event.tool_result,
                    )
                )
        elif event.type == "text_delta":
            if not replying:
                yield {"status": "replying"}
                replying = True
            yield {"delta": event.delta}
    yield {
        "evaluation_id": _resolve_evaluation_id(
            supabase_client,
            user_id,
            thread_id,
            tool_executions,
        )
    }
