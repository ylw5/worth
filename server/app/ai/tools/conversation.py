from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field

from ...config import Settings
from ...models import (
    AIProductInterpretation,
    Category,
    ParsedProduct,
    ProductSource,
)
from ...product import fetch_product_page
from ..contracts import RunContext
from ..errors import ToolExecutionError
from .purchase import build_purchase_tool_registry
from .registry import ToolRegistry

if TYPE_CHECKING:
    from supabase import Client as SupabaseClient

    from ...market import MarketClient


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


def _interpret_text(
    settings: Settings,
    text: str,
    user_id: str,
    request_id: str,
) -> AIProductInterpretation:
    from ..factory import build_text_workflows

    try:
        return build_text_workflows(settings).product_interpretation.interpret(
            text,
            user_id=user_id,
            request_id=request_id,
        )
    except Exception as error:
        raise ToolExecutionError("文字识品失败") from error


def _recognize_images(
    settings: Settings,
    image_urls: list[str],
    user_id: str,
    request_id: str,
) -> ParsedProduct:
    from ..factory import build_vision_workflows

    try:
        return build_vision_workflows(settings).product_image_recognition.recognize(
            image_urls,
            user_id=user_id,
            request_id=request_id,
        )
    except Exception as error:
        raise ToolExecutionError("图片识品失败") from error


def _parse_url(
    settings: Settings,
    url: str,
    user_id: str,
    request_id: str,
) -> ParsedProduct:
    from ..factory import build_text_workflows

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
    except Exception as error:
        raise ToolExecutionError("链接解析失败") from error


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


def _insert_evaluation(
    supabase_client: SupabaseClient,
    user_id: str,
    thread_id: str,
    product: ParsedProduct,
) -> str:
    source_type = product.source_type
    source_text = product.source_text.strip()
    image_paths: list[str] = []
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
        raise ToolExecutionError("创建评估记录失败") from error
    rows = response.data if isinstance(response.data, list) else []
    if not rows or not isinstance(rows[0], dict) or not rows[0].get("id"):
        raise ToolExecutionError("创建评估记录失败")
    return str(rows[0]["id"])


def _upsert_evaluation(
    supabase_client: SupabaseClient,
    user_id: str,
    thread_id: str,
    product: ParsedProduct,
) -> str:
    existing = _latest_evaluation_on_thread(supabase_client, thread_id)
    if existing and existing.get("id"):
        return str(existing["id"])
    return _insert_evaluation(supabase_client, user_id, thread_id, product)


class ConversationToolHandlers:
    def __init__(
        self,
        settings: Settings,
        supabase_client: SupabaseClient,
    ) -> None:
        self._settings = settings
        self._supabase = supabase_client

    def recognize_product_text(
        self,
        arguments: BaseModel,
        context: RunContext,
    ) -> RecognizeProductOutput:
        parsed = RecognizeProductTextInput.model_validate(arguments)
        interpretation = _interpret_text(
            self._settings,
            parsed.text,
            context.user_id,
            context.request_id,
        )
        if interpretation.intent != "product":
            return RecognizeProductOutput(
                is_product=False,
                note="看起来是闲聊，不是待购商品",
            )
        product = ParsedProduct(
            title=interpretation.normalized_title,
            category=interpretation.category,
            subcategory=interpretation.subcategory.strip(),
            source_type="text",
            source_text=parsed.text.strip(),
        )
        return RecognizeProductOutput(is_product=True, product=product)

    def recognize_product_images(
        self,
        arguments: BaseModel,
        context: RunContext,
    ) -> RecognizeProductOutput:
        del arguments
        image_urls = context.metadata.get("image_urls") or []
        if not image_urls:
            raise ToolExecutionError("本轮没有可识别的图片")
        product = _recognize_images(
            self._settings,
            list(image_urls),
            context.user_id,
            context.request_id,
        )
        return RecognizeProductOutput(is_product=True, product=product)

    def parse_product_url(
        self,
        arguments: BaseModel,
        context: RunContext,
    ) -> RecognizeProductOutput:
        parsed = ParseProductUrlInput.model_validate(arguments)
        product = _parse_url(
            self._settings,
            parsed.url,
            context.user_id,
            context.request_id,
        )
        return RecognizeProductOutput(is_product=True, product=product)

    def bind_purchase_evaluation(
        self,
        arguments: BaseModel,
        context: RunContext,
    ) -> BindPurchaseEvaluationOutput:
        parsed = BindPurchaseEvaluationInput.model_validate(arguments)
        thread_id = context.metadata.get("thread_id")
        if not thread_id:
            raise ToolExecutionError("缺少对话线程")
        product = ParsedProduct(
            title=parsed.title,
            category=parsed.category,
            subcategory=parsed.subcategory,
            price=parsed.price,
            url=parsed.url,
            source_type=parsed.source_type,
            source_text=parsed.source_text,
        )
        evaluation_id = _upsert_evaluation(
            supabase_client=self._supabase,
            user_id=context.user_id,
            thread_id=str(thread_id),
            product=product,
        )
        return BindPurchaseEvaluationOutput(evaluation_id=evaluation_id)


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
) -> ToolRegistry:
    registry = build_purchase_tool_registry(supabase_client, market_client)
    handlers = ConversationToolHandlers(settings, supabase_client)
    registry.register(
        name="recognize_product_text",
        description="从用户文字描述识别待购商品的结构化信息",
        input_model=RecognizeProductTextInput,
        output_model=RecognizeProductOutput,
        handler=handlers.recognize_product_text,
    )
    registry.register(
        name="parse_product_url",
        description="从商品链接解析待购商品的结构化信息",
        input_model=ParseProductUrlInput,
        output_model=RecognizeProductOutput,
        handler=handlers.parse_product_url,
    )
    registry.register(
        name="recognize_product_images",
        description="从本轮用户上传的图片识别待购商品；图片 URL 由服务端注入",
        input_model=RecognizeProductImagesInput,
        output_model=RecognizeProductOutput,
        handler=handlers.recognize_product_images,
        cacheable=False,
    )
    registry.register(
        name="bind_purchase_evaluation",
        description="静默绑定或复用当前对话线程上的购买评估记录",
        input_model=BindPurchaseEvaluationInput,
        output_model=BindPurchaseEvaluationOutput,
        handler=handlers.bind_purchase_evaluation,
        cacheable=False,
    )
    return registry
