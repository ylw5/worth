from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from ...config import Settings
from ...models import (
    AIProductInterpretation,
    Category,
    ParsedProduct,
    ProductSource,
    SellPlanReadinessCounts,
)
from ...product import fetch_product_page
from ...sell_plan_orchestration import prepare_sell_plan_from_assets
from ..contracts import RunContext
from ..errors import ToolExecutionError
from .purchase import AssetToolRecord, build_purchase_tool_registry
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


class WishlistListInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["all", "active", "fulfilled"] = "all"


class WishlistToolRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    target_price: float
    notes: str
    actual_price: float | None = None
    fulfilled_at: str | None = None
    created_at: str


class WishlistListOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[WishlistToolRecord]


class FundingSummaryInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ActiveWishFunding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    target_price: float
    remaining_gap: float


class FundingSummaryOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    available_spending: float = Field(ge=0)
    available_sales: float = Field(ge=0)
    available_total: float = Field(ge=0)
    allocated_total: float = Field(ge=0)
    active_wishes: list[ActiveWishFunding]


class WishlistSellPlanPreviewInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    wishlist_item_id: str = Field(min_length=1, max_length=100)


class SellPlanPreviewAsset(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    status: str
    conservative_price: float
    latest_valuation_at: str | None = None


class WishlistSellPlanPreviewOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    wishlist_item_id: str
    wishlist_name: str
    target_price: float
    available_funding: float = Field(ge=0)
    remaining_gap: float = Field(ge=0)
    readiness_counts: SellPlanReadinessCounts
    selected_assets: list[SellPlanPreviewAsset]
    conservative_total: float = Field(ge=0)
    coverage_ratio: float = Field(ge=0, le=1)
    is_reachable: bool
    evidence_gaps: list[str]


class AssetDecisionContextInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_id: str = Field(min_length=1, max_length=100)
    days: int = Field(default=30, ge=1, le=90)


class AssetStatusEventRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    from_status: str | None = None
    to_status: str
    created_at: str


class AssetSaleRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sold_at: str
    sale_price: float


class MarketSnapshotRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    snapshot_date: str
    estimated_price: float
    price_low: float
    price_high: float
    sample_count: int
    query: str
    source: str
    is_demo: bool = False
    created_at: str


class AnalysisRunRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: str
    status: str
    run_date: str
    attempt_count: int
    error_message: str | None = None
    started_at: str | None = None
    finished_at: str | None = None


class AssetDecisionContextOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset: AssetToolRecord
    status_events: list[AssetStatusEventRecord]
    sale: AssetSaleRecord | None = None
    market_snapshots: list[MarketSnapshotRecord]
    analysis_runs: list[AnalysisRunRecord]
    valuation_is_stale: bool | None = None


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


def _cents(value: Any) -> int:
    try:
        return max(round(float(value) * 100), 0)
    except (TypeError, ValueError):
        return 0


def _funding_summary(
    supabase_client: SupabaseClient,
    user_id: str,
) -> FundingSummaryOutput:
    resolutions = (
        supabase_client.table("spending_resolutions")
        .select("id,amount")
        .eq("user_id", user_id)
        .filter("confirmed_at", "not.is", "null")
        .execute()
        .data
        or []
    )
    sales = (
        supabase_client.table("asset_sales")
        .select("id,sale_price")
        .eq("user_id", user_id)
        .execute()
        .data
        or []
    )
    allocations = (
        supabase_client.table("wishlist_funding_allocations")
        .select("spending_resolution_id,asset_sale_id,amount")
        .eq("user_id", user_id)
        .execute()
        .data
        or []
    )
    wishes = (
        supabase_client.table("wishlist_items")
        .select("id,name,target_price")
        .eq("user_id", user_id)
        .filter("fulfilled_at", "is", "null")
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    resolution_allocations: dict[str, int] = {}
    sale_allocations: dict[str, int] = {}
    for allocation in allocations:
        amount = _cents(allocation.get("amount"))
        if allocation.get("spending_resolution_id"):
            source_id = str(allocation["spending_resolution_id"])
            resolution_allocations[source_id] = (
                resolution_allocations.get(source_id, 0) + amount
            )
        elif allocation.get("asset_sale_id"):
            source_id = str(allocation["asset_sale_id"])
            sale_allocations[source_id] = (
                sale_allocations.get(source_id, 0) + amount
            )
    spending_cents = sum(
        max(
            _cents(source.get("amount"))
            - resolution_allocations.get(str(source.get("id")), 0),
            0,
        )
        for source in resolutions
    )
    sales_cents = sum(
        max(
            _cents(source.get("sale_price"))
            - sale_allocations.get(str(source.get("id")), 0),
            0,
        )
        for source in sales
    )
    available_cents = spending_cents + sales_cents
    return FundingSummaryOutput(
        available_spending=spending_cents / 100,
        available_sales=sales_cents / 100,
        available_total=available_cents / 100,
        allocated_total=sum(
            _cents(allocation.get("amount")) for allocation in allocations
        )
        / 100,
        active_wishes=[
            ActiveWishFunding(
                id=str(wish["id"]),
                name=str(wish["name"]),
                target_price=_cents(wish.get("target_price")) / 100,
                remaining_gap=max(
                    _cents(wish.get("target_price")) - available_cents,
                    0,
                )
                / 100,
            )
            for wish in wishes
        ],
    )


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

    def list_wishlist(
        self,
        arguments: BaseModel,
        context: RunContext,
    ) -> WishlistListOutput:
        parsed = WishlistListInput.model_validate(arguments)
        query = (
            self._supabase.table("wishlist_items")
            .select(
                "id, name, target_price, notes, actual_price, "
                "fulfilled_at, created_at"
            )
            .eq("user_id", context.user_id)
        )
        if parsed.status == "active":
            query = query.filter("fulfilled_at", "is", "null")
        elif parsed.status == "fulfilled":
            query = query.filter("fulfilled_at", "not.is", "null")
        response = query.order("created_at", desc=True).execute()
        return WishlistListOutput(
            items=[
                WishlistToolRecord.model_validate(record)
                for record in (response.data or [])
            ]
        )

    def funding_summary(
        self,
        arguments: BaseModel,
        context: RunContext,
    ) -> FundingSummaryOutput:
        del arguments
        return _funding_summary(self._supabase, context.user_id)

    def wishlist_sell_plan_preview(
        self,
        arguments: BaseModel,
        context: RunContext,
    ) -> WishlistSellPlanPreviewOutput:
        parsed = WishlistSellPlanPreviewInput.model_validate(arguments)
        funding = _funding_summary(self._supabase, context.user_id)
        wish = next(
            (
                item
                for item in funding.active_wishes
                if item.id == parsed.wishlist_item_id
            ),
            None,
        )
        if wish is None:
            raise ToolExecutionError("心愿不存在或已实现")
        zero_counts = SellPlanReadinessCounts(
            needs_confirmation=0,
            needs_valuation=0,
            stale_valuation=0,
            ready=0,
            excluded=0,
        )
        if wish.remaining_gap <= 0:
            return WishlistSellPlanPreviewOutput(
                wishlist_item_id=wish.id,
                wishlist_name=wish.name,
                target_price=wish.target_price,
                available_funding=funding.available_total,
                remaining_gap=0,
                readiness_counts=zero_counts,
                selected_assets=[],
                conservative_total=0,
                coverage_ratio=1,
                is_reachable=True,
                evidence_gaps=[],
            )
        assets = (
            self._supabase.table("assets")
            .select(
                "id,name,status,status_confirmed_at,status_source,"
                "latest_market_price,latest_market_price_low,"
                "latest_market_price_high,latest_valuation_at"
            )
            .eq("user_id", context.user_id)
            .neq("status", "sold")
            .order("updated_at", desc=True)
            .execute()
            .data
            or []
        )
        prepared = prepare_sell_plan_from_assets(
            wish.remaining_gap,
            list(assets),
        )
        evidence_gaps = list(prepared.explanation.evidence_gaps)
        if not prepared.plan.is_reachable and not evidence_gaps:
            evidence_gaps.append("已确认可卖资产的保守估价不足以覆盖缺口")
        return WishlistSellPlanPreviewOutput(
            wishlist_item_id=wish.id,
            wishlist_name=wish.name,
            target_price=wish.target_price,
            available_funding=funding.available_total,
            remaining_gap=wish.remaining_gap,
            readiness_counts=prepared.readiness_counts,
            selected_assets=[
                SellPlanPreviewAsset.model_validate(
                    item.model_dump(mode="json")
                )
                for item in prepared.plan.items
            ],
            conservative_total=prepared.plan.estimated_total,
            coverage_ratio=prepared.plan.coverage_ratio,
            is_reachable=prepared.plan.is_reachable,
            evidence_gaps=evidence_gaps,
        )

    def asset_decision_context(
        self,
        arguments: BaseModel,
        context: RunContext,
    ) -> AssetDecisionContextOutput:
        parsed = AssetDecisionContextInput.model_validate(arguments)
        asset_response = (
            self._supabase.table("assets")
            .select(
                "id,name,brand,model,category,subcategory,status,"
                "purchase_date,purchase_price,latest_market_price,"
                "latest_market_price_low,latest_market_price_high,"
                "latest_valuation_at,status_confirmed_at,status_source,"
                "market_key"
            )
            .eq("id", parsed.asset_id)
            .eq("user_id", context.user_id)
            .limit(1)
            .execute()
        )
        asset_rows = asset_response.data or []
        if not asset_rows:
            raise ToolExecutionError("资产不存在")
        asset_data = dict(asset_rows[0])
        market_key = asset_data.pop("market_key", None)
        asset = AssetToolRecord.model_validate(asset_data)
        cutoff = datetime.now(timezone.utc) - timedelta(days=parsed.days)
        events = (
            self._supabase.table("asset_status_events")
            .select("from_status,to_status,created_at")
            .eq("asset_id", parsed.asset_id)
            .eq("user_id", context.user_id)
            .gte("created_at", cutoff.isoformat())
            .order("created_at", desc=True)
            .execute()
            .data
            or []
        )
        sale_rows = (
            self._supabase.table("asset_sales")
            .select("sold_at,sale_price")
            .eq("asset_id", parsed.asset_id)
            .eq("user_id", context.user_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        snapshots = (
            self._supabase.table("market_snapshots")
            .select(
                "snapshot_date,estimated_price,price_low,price_high,"
                "sample_count,query,source,created_at"
            )
            .eq("asset_id", parsed.asset_id)
            .eq("user_id", context.user_id)
            .gte("snapshot_date", cutoff.date().isoformat())
            .order("snapshot_date", desc=True)
            .limit(parsed.days)
            .execute()
            .data
            or []
        )
        runs_query = (
            self._supabase.table("analysis_runs")
            .select(
                "kind,status,run_date,attempt_count,error_message,"
                "started_at,finished_at"
            )
            .eq("user_id", context.user_id)
            .gte("run_date", cutoff.date().isoformat())
        )
        runs_query = (
            runs_query.eq("market_key", market_key)
            if market_key
            else runs_query.eq("asset_id", parsed.asset_id)
        )
        runs = (
            runs_query.order("run_date", desc=True)
            .limit(parsed.days)
            .execute()
            .data
            or []
        )
        valuation_is_stale = None
        if asset.latest_valuation_at:
            try:
                valued_at = datetime.fromisoformat(
                    asset.latest_valuation_at.replace("Z", "+00:00")
                )
                if valued_at.tzinfo is None:
                    valued_at = valued_at.replace(tzinfo=timezone.utc)
                valuation_is_stale = (
                    datetime.now(timezone.utc)
                    - valued_at.astimezone(timezone.utc)
                    > timedelta(days=7)
                )
            except ValueError:
                valuation_is_stale = None
        return AssetDecisionContextOutput(
            asset=asset,
            status_events=[
                AssetStatusEventRecord.model_validate(event)
                for event in events
            ],
            sale=(
                AssetSaleRecord.model_validate(sale_rows[0])
                if sale_rows
                else None
            ),
            market_snapshots=[
                MarketSnapshotRecord.model_validate(
                    {
                        **snapshot,
                        "is_demo": snapshot.get("source") == "demo_seed",
                    }
                )
                for snapshot in snapshots
            ],
            analysis_runs=[
                AnalysisRunRecord.model_validate(run) for run in runs
            ],
            valuation_is_stale=valuation_is_stale,
        )

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
    "wishlist_list",
    "funding_summary",
    "wishlist_sell_plan_preview",
    "asset_decision_context",
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
        name="wishlist_list",
        description="按需查看当前用户全部、待实现或已实现的心愿",
        input_model=WishlistListInput,
        output_model=WishlistListOutput,
        handler=handlers.list_wishlist,
    )
    registry.register(
        name="funding_summary",
        description=(
            "汇总当前用户已确认的忍住消费、真实闲置成交款、已分配金额"
            "和待实现心愿缺口"
        ),
        input_model=FundingSummaryInput,
        output_model=FundingSummaryOutput,
        handler=handlers.funding_summary,
    )
    registry.register(
        name="wishlist_sell_plan_preview",
        description=(
            "只读预览指定心愿的确定性闲置卖出组合；不刷新行情、不保存方案"
        ),
        input_model=WishlistSellPlanPreviewInput,
        output_model=WishlistSellPlanPreviewOutput,
        handler=handlers.wishlist_sell_plan_preview,
    )
    registry.register(
        name="asset_decision_context",
        description=(
            "读取单件资产的状态时间线、真实成交、市场快照和分析任务证据"
        ),
        input_model=AssetDecisionContextInput,
        output_model=AssetDecisionContextOutput,
        handler=handlers.asset_decision_context,
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
