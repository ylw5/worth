from __future__ import annotations

import re
from dataclasses import dataclass

from fastapi import HTTPException
from supabase import Client as SupabaseClient

from .ai.factory import (
    build_purchase_evaluation_workflow,
    build_text_workflows,
    build_vision_workflows,
)
from .ai.tools import load_confirmed_evaluation_assets
from .config import Settings
from .evaluation import build_purchase_evaluation
from .evaluation_tools import summarize_evaluation_history
from .market import MarketClient
from .models import (
    AIProductInterpretation,
    Category,
    EvaluationChatMessage,
    ParsedProduct,
    PurchaseEvaluationResult,
)

_VALID_CATEGORIES: set[str] = {
    "数码",
    "家电",
    "家具",
    "服饰箱包",
    "珠宝腕表",
    "收藏",
    "交通工具",
    "其他",
}
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


def _build_confirmed_purchase_evaluation(
    supabase_client: SupabaseClient,
    user_id: str,
    product: ParsedProduct,
) -> PurchaseEvaluationResult:
    """Same facts rebuild as main.build_confirmed_purchase_evaluation."""
    try:
        assets = load_confirmed_evaluation_assets(
            supabase_client,
            user_id=user_id,
            category=product.category,
        )
    except Exception as error:
        raise ProductPipelineError(str(error)) from error
    return build_purchase_evaluation(product, assets)


def _latest_evaluation_on_thread(
    supabase_client: SupabaseClient,
    thread_id: str,
) -> dict | None:
    response = (
        supabase_client.table("purchase_evaluations")
        .select(
            "id, product_url, product_title, product_price, category, "
            "subcategory, source_type, source_text"
        )
        .eq("thread_id", thread_id)
        .order("updated_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = response.data if isinstance(response.data, list) else []
    if not rows or not isinstance(rows[0], dict):
        return None
    return rows[0]


def _product_from_evaluation_row(row: dict) -> ParsedProduct:
    source_type = row.get("source_type") or "text"
    if source_type not in ("url", "text", "image"):
        source_type = "text"
    price = row.get("product_price")
    try:
        price_value = float(price) if price is not None else None
    except (TypeError, ValueError):
        price_value = None
    if price_value is not None and price_value <= 0:
        price_value = None
    category_raw = str(row.get("category") or "其他")
    category: Category = (
        category_raw if category_raw in _VALID_CATEGORIES else "其他"  # type: ignore[assignment]
    )
    return ParsedProduct(
        url=str(row.get("product_url") or ""),
        title=str(row.get("product_title") or "商品").strip() or "商品",
        price=price_value,
        category=category,
        subcategory=str(row.get("subcategory") or ""),
        source_type=source_type,
        source_text=str(row.get("source_text") or ""),
    )


_PRICE_RE = re.compile(
    r"(?:¥|￥|人民币|RMB|元)?\s*(\d{2,6}(?:\.\d{1,2})?)\s*(?:元|块|刀)?",
    re.IGNORECASE,
)


def _fill_price_from_messages(
    product: ParsedProduct,
    messages: list[EvaluationChatMessage],
) -> ParsedProduct:
    """If evaluation has no price, recover a positive amount mentioned in chat."""
    if product.price is not None:
        return product
    for message in reversed(messages):
        if message.role != "user":
            continue
        match = _PRICE_RE.search(message.content)
        if not match:
            continue
        try:
            amount = float(match.group(1))
        except ValueError:
            continue
        if amount > 0:
            return product.model_copy(update={"price": amount})
    return product


def _insert_evaluation(
    supabase_client: SupabaseClient,
    user_id: str,
    thread_id: str,
    product: ParsedProduct,
) -> str:
    source_type = product.source_type
    source_text = product.source_text.strip()
    image_paths: list[str] = []
    # Agent turn has signed URLs, not storage paths; coerce image → text
    # so purchase_evaluations source_payload_check still passes.
    if source_type == "image" and not image_paths:
        source_type = "text"
        source_text = source_text or product.title
    if source_type == "text" and not source_text:
        source_text = product.title

    payload = {
        "user_id": user_id,
        "thread_id": thread_id,
        "product_url": product.url or "",
        "product_title": product.title,
        "product_price": product.price,
        "category": product.category,
        "subcategory": product.subcategory,
        "matched_assets": [],
        "facts": {},
        # narrative is NOT NULL + non-empty; coaching reply is returned separately.
        "narrative": f"正在梳理「{product.title}」。",
        "parser_snapshot": {"product": product.model_dump(mode="json")},
        "source_type": source_type,
        "source_text": source_text,
        "image_paths": image_paths,
    }
    try:
        response = (
            supabase_client.table("purchase_evaluations")
            .insert(payload)
            .select("id")
            .limit(1)
            .execute()
        )
    except Exception as error:
        raise ProductPipelineError(str(error)) from error
    rows = response.data if isinstance(response.data, list) else []
    if not rows or not isinstance(rows[0], dict) or not rows[0].get("id"):
        raise ProductPipelineError("failed to insert purchase evaluation")
    return str(rows[0]["id"])


def _upsert_evaluation(
    supabase_client: SupabaseClient,
    user_id: str,
    thread_id: str,
    product: ParsedProduct,
) -> str:
    # Prefer reuse of the latest evaluation on this thread to avoid spam;
    # otherwise insert a new purchase_evaluations row (silent upsert).
    existing = _latest_evaluation_on_thread(supabase_client, thread_id)
    if existing and existing.get("id"):
        return str(existing["id"])
    return _insert_evaluation(supabase_client, user_id, thread_id, product)


def _purchase_reply(
    *,
    settings: Settings,
    supabase_client: SupabaseClient,
    user_id: str,
    messages: list[EvaluationChatMessage],
    product: ParsedProduct,
    request_id: str,
) -> str:
    try:
        confirmed = _build_confirmed_purchase_evaluation(
            supabase_client,
            user_id,
            product,
        )
        bundle = build_purchase_evaluation_workflow(
            settings,
            supabase_client=supabase_client,
            market_client=(
                MarketClient(settings.xianyu_cookie)
                if settings.xianyu_cookie
                else None
            ),
        )
        message = bundle.workflow.run(
            product,
            confirmed.matched_assets,
            confirmed.facts,
            list(messages),
            user_id=user_id,
            request_id=request_id,
        ).text
        if not message or not str(message).strip():
            raise ProductPipelineError("empty purchase reply")
        return str(message)
    except ProductPipelineError:
        raise
    except Exception as error:
        raise ProductPipelineError(str(error)) from error


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
    del memory  # history already folded into purchase workflow tools when needed
    try:
        evaluation_id = _upsert_evaluation(
            supabase_client,
            user_id,
            thread_id,
            product,
        )
        message = _purchase_reply(
            settings=settings,
            supabase_client=supabase_client,
            user_id=user_id,
            messages=messages,
            product=product,
            request_id=request_id,
        )
        return AgentTurnResult(message=message, evaluation_id=evaluation_id)
    except ProductPipelineError:
        raise
    except Exception as error:
        raise ProductPipelineError(str(error)) from error


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

        # Follow-ups like「不会」often classify as chat. If this thread already
        # has a purchase evaluation, stay on the coaching path so decision /
        # spending-resolution markers can still be emitted.
        existing = _latest_evaluation_on_thread(supabase_client, thread_id)
        if existing:
            product = _fill_price_from_messages(
                _product_from_evaluation_row(existing),
                messages,
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
        product = _fill_price_from_messages(
            _product_from_interpretation(interpretation, text),
            messages,
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
    except HTTPException:
        raise
    except (ProductPipelineError, Exception):
        return _degrade_to_chat(
            settings, messages, memory, user_id, request_id
        )
