from __future__ import annotations

import re
from dataclasses import dataclass

from fastapi import HTTPException
from supabase import Client as SupabaseClient

from .ai.factory import build_text_workflows, build_vision_workflows
from .config import Settings
from .evaluation_tools import summarize_evaluation_history
from .models import (
    AIProductInterpretation,
    EvaluationChatMessage,
    ParsedProduct,
)
from .product import fetch_product_page


class ProductPipelineError(Exception):
    """Product parse/recognize/purchase failed; degrade to general chat."""


@dataclass
class AgentTurnResult:
    message: str
    evaluation_id: str | None = None


_URL_RE = re.compile(r"https?://[^\s]+", re.IGNORECASE)
_TRAILING_PUNCT_RE = re.compile(r"[),.;!?\]}，。；！？）】》]+$")


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


def _latest_user_text(messages: list[EvaluationChatMessage]) -> str:
    for message in reversed(messages):
        if message.role == "user":
            return message.content.strip()
    return ""


def _extract_url(text: str) -> str | None:
    match = _URL_RE.search(text.strip())
    if not match:
        return None
    candidate = _TRAILING_PUNCT_RE.sub("", match.group(0))
    if not candidate.lower().startswith(("http://", "https://")):
        return None
    return candidate


def _interpret_text(
    settings: Settings,
    text: str,
    user_id: str,
    request_id: str,
) -> AIProductInterpretation:
    try:
        return build_text_workflows(settings).product_interpretation.interpret(
            text,
            user_id=user_id,
            request_id=request_id,
        )
    except ProductPipelineError:
        raise
    except Exception as error:
        raise ProductPipelineError(str(error)) from error


def _general_chat(
    settings: Settings,
    messages: list[EvaluationChatMessage],
    memory: dict,
    user_id: str,
    request_id: str,
) -> str:
    return build_text_workflows(settings).general_chat.chat(
        messages,
        memory,
        user_id=user_id,
        request_id=request_id,
    )


def _recognize_images(
    settings: Settings,
    image_urls: list[str],
    user_id: str,
    request_id: str,
) -> ParsedProduct:
    try:
        return build_vision_workflows(settings).product_image_recognition.recognize(
            image_urls,
            user_id=user_id,
            request_id=request_id,
        )
    except ProductPipelineError:
        raise
    except Exception as error:
        raise ProductPipelineError(str(error)) from error


def _parse_url(
    settings: Settings,
    url: str,
    user_id: str,
    request_id: str,
) -> ParsedProduct:
    try:
        page = fetch_product_page(url)
        classification = build_text_workflows(
            settings
        ).product_classification.classify(
            page.title,
            user_id=user_id,
            request_id=request_id,
        )
        return ParsedProduct(
            url=page.url,
            title=classification.normalized_title,
            price=page.price,
            category=classification.category,
            subcategory=classification.subcategory.strip(),
            source_type="url",
            source_text="",
        )
    except ProductPipelineError:
        raise
    except Exception as error:
        raise ProductPipelineError(str(error)) from error


def _run_purchase(*_args, **_kwargs) -> AgentTurnResult:
    """Task 2 will implement purchase coaching + silent evaluation upsert."""
    raise ProductPipelineError("purchase path not implemented")


def _purchase_or_degrade(
    *,
    settings: Settings,
    supabase_client: SupabaseClient,
    user_id: str,
    thread_id: str,
    messages: list[EvaluationChatMessage],
    memory: dict,
    product: ParsedProduct,
    request_id: str,
) -> AgentTurnResult:
    # Task 2 fills this in; Task 1 stub always degrades via ProductPipelineError.
    del settings, supabase_client, user_id, thread_id, messages, memory, product
    del request_id
    raise ProductPipelineError("purchase path not implemented")


def _product_from_interpretation(
    interpretation: AIProductInterpretation,
    source_text: str,
) -> ParsedProduct:
    return ParsedProduct(
        title=interpretation.normalized_title,
        category=interpretation.category,
        subcategory=interpretation.subcategory.strip(),
        source_type="text",
        source_text=source_text.strip(),
    )


def _degrade_to_chat(
    settings: Settings,
    messages: list[EvaluationChatMessage],
    memory: dict,
    user_id: str,
    request_id: str,
) -> AgentTurnResult:
    return AgentTurnResult(
        message=_general_chat(
            settings, messages, memory, user_id, request_id
        )
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
    _assert_thread_owner(supabase_client, user_id, thread_id)
    memory = load_history_context(supabase_client, user_id)

    try:
        if image_urls:
            product = _recognize_images(
                settings, image_urls, user_id, request_id
            )
            return _purchase_or_degrade(
                settings=settings,
                supabase_client=supabase_client,
                user_id=user_id,
                thread_id=thread_id,
                messages=messages,
                memory=memory,
                product=product,
                request_id=request_id,
            )

        text = _latest_user_text(messages)
        url = _extract_url(text)
        if url:
            product = _parse_url(settings, url, user_id, request_id)
            return _purchase_or_degrade(
                settings=settings,
                supabase_client=supabase_client,
                user_id=user_id,
                thread_id=thread_id,
                messages=messages,
                memory=memory,
                product=product,
                request_id=request_id,
            )

        interpretation = _interpret_text(
            settings, text, user_id, request_id
        )
    except HTTPException:
        raise
    except ProductPipelineError:
        return _degrade_to_chat(
            settings, messages, memory, user_id, request_id
        )
    except Exception:
        # Mocked helpers (and unexpected pipeline failures) degrade in-turn.
        return _degrade_to_chat(
            settings, messages, memory, user_id, request_id
        )

    if interpretation.intent == "chat":
        # GeneralChat failures must bubble (not swallowed as pipeline degrade).
        return AgentTurnResult(
            message=_general_chat(
                settings, messages, memory, user_id, request_id
            )
        )

    try:
        product = _product_from_interpretation(interpretation, text)
        return _purchase_or_degrade(
            settings=settings,
            supabase_client=supabase_client,
            user_id=user_id,
            thread_id=thread_id,
            messages=messages,
            memory=memory,
            product=product,
            request_id=request_id,
        )
    except HTTPException:
        raise
    except (ProductPipelineError, Exception):
        return _degrade_to_chat(
            settings, messages, memory, user_id, request_id
        )
