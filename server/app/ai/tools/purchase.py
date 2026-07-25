from __future__ import annotations

import statistics
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, ConfigDict, Field

from ...models import Category, EvaluationAsset
from ..contracts import RunContext
from ..errors import ToolExecutionError
from .registry import ToolRegistry

if TYPE_CHECKING:
    from supabase import Client as SupabaseClient

    from ...market import MarketClient
    from ...models import MarketCandidate


class AssetsListInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: Category
    subcategory: str | None = Field(default=None, max_length=50)
    limit: int = Field(default=10, ge=1, le=20)


class AssetToolRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    brand: str | None = None
    model: str | None = None
    category: str
    subcategory: str
    status: str


class AssetsListOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assets: list[AssetToolRecord]


class AssetsSummaryInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: Category | None = None


class AssetsSummaryOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total: int = Field(ge=0)
    by_status: dict[str, int]
    by_category: dict[str, int]


class MarketPriceSnapshotInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    keyword: str = Field(min_length=2, max_length=120)
    category: Category | None = None


class MarketPriceSnapshotOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str
    sampled_at: str
    query: str
    median_price: float | None
    price_range: tuple[float | None, float | None]
    sample_count: int = Field(ge=0)
    is_complete_market: bool = False


class EvaluationHistoryInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: Category | None = None
    limit: int = Field(default=5, ge=1, le=10)


class EvaluationHistoryRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    evaluation_id: str = ""
    product_title: str
    category: str
    subcategory: str
    price: float | None = None
    legacy_ai_decision: str
    user_choice: str
    outcome_status: str
    linked_asset_id: str = ""
    date: str


class EvaluationHistoryOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    evaluations: list[EvaluationHistoryRecord]


def calculate_market_stats(
    candidates: list[MarketCandidate],
) -> dict[str, Any]:
    if not candidates:
        return {
            "median_price": None,
            "price_range": (None, None),
            "sample_count": 0,
        }
    prices = sorted(candidate.price for candidate in candidates)
    if len(prices) >= 4:
        quartiles = statistics.quantiles(prices, n=4)
        price_range = (
            round(quartiles[0], 2),
            round(quartiles[2], 2),
        )
    else:
        price_range = (round(prices[0], 2), round(prices[-1], 2))
    return {
        "median_price": round(statistics.median(prices), 2),
        "price_range": price_range,
        "sample_count": len(prices),
    }


class PurchaseToolHandlers:
    def __init__(
        self,
        supabase_client: SupabaseClient,
        market_client: MarketClient | None,
    ) -> None:
        self._supabase = supabase_client
        self._market = market_client

    def list_assets(
        self,
        arguments: BaseModel,
        context: RunContext,
    ) -> AssetsListOutput:
        parsed = AssetsListInput.model_validate(arguments)
        query = (
            self._supabase.table("assets")
            .select(
                "id, name, brand, model, category, subcategory, status"
            )
            .eq("user_id", context.user_id)
            .eq("category", parsed.category)
        )
        if parsed.subcategory:
            query = query.eq("subcategory", parsed.subcategory)
        response = (
            query.order("created_at", desc=True)
            .limit(parsed.limit)
            .execute()
        )
        return AssetsListOutput(
            assets=[
                AssetToolRecord.model_validate(record)
                for record in (response.data or [])
            ]
        )

    def summarize_assets(
        self,
        arguments: BaseModel,
        context: RunContext,
    ) -> AssetsSummaryOutput:
        parsed = AssetsSummaryInput.model_validate(arguments)
        query = (
            self._supabase.table("assets")
            .select("category, subcategory, status")
            .eq("user_id", context.user_id)
        )
        if parsed.category:
            query = query.eq("category", parsed.category)
        response = query.execute()
        assets = response.data or []
        by_status: dict[str, int] = {}
        by_category: dict[str, int] = {}
        for asset in assets:
            status = str(asset.get("status", "unknown"))
            category = str(asset.get("category", "unknown"))
            by_status[status] = by_status.get(status, 0) + 1
            by_category[category] = by_category.get(category, 0) + 1
        return AssetsSummaryOutput(
            total=len(assets),
            by_status=by_status,
            by_category=by_category,
        )

    def market_price_snapshot(
        self,
        arguments: BaseModel,
        context: RunContext,
    ) -> MarketPriceSnapshotOutput:
        del context
        parsed = MarketPriceSnapshotInput.model_validate(arguments)
        if self._market is None:
            raise ToolExecutionError("Market data source is not configured")
        try:
            candidates = self._market.search(parsed.keyword, pages=2)
        except RuntimeError as error:
            raise ToolExecutionError(
                "Market data source is temporarily unavailable"
            ) from error
        stats = calculate_market_stats(candidates)
        return MarketPriceSnapshotOutput(
            source="xianyu_market_sample",
            sampled_at=datetime.now(timezone.utc).isoformat(),
            query=parsed.keyword,
            **stats,
        )

    def list_evaluation_history(
        self,
        arguments: BaseModel,
        context: RunContext,
    ) -> EvaluationHistoryOutput:
        parsed = EvaluationHistoryInput.model_validate(arguments)
        query = (
            self._supabase.table("purchase_evaluations")
            .select(
                "id, product_title, category, subcategory, product_price,"
                " decision, user_choice, outcome_status, linked_asset_id,"
                " created_at"
            )
            .eq("user_id", context.user_id)
        )
        if parsed.category:
            query = query.eq("category", parsed.category)
        response = (
            query.order("created_at", desc=True)
            .limit(parsed.limit)
            .execute()
        )
        evaluations = []
        for record in response.data or []:
            created_at = str(record.get("created_at", ""))
            evaluations.append(
                EvaluationHistoryRecord(
                    evaluation_id=str(record.get("id", "")),
                    product_title=str(record.get("product_title", "")),
                    category=str(record.get("category", "")),
                    subcategory=str(record.get("subcategory", "")),
                    price=record.get("product_price"),
                    legacy_ai_decision=str(
                        record.get("decision", "pending")
                    ),
                    user_choice=str(
                        record.get("user_choice", "pending")
                    ),
                    outcome_status=str(
                        record.get("outcome_status", "unknown")
                    ),
                    linked_asset_id=str(
                        record.get("linked_asset_id", "") or ""
                    ),
                    date=created_at[:10],
                )
            )
        return EvaluationHistoryOutput(evaluations=evaluations)


PURCHASE_TOOL_NAMES = (
    "assets_list",
    "assets_summary",
    "market_price_snapshot",
    "evaluation_history_list",
)


def load_confirmed_evaluation_assets(
    supabase_client: SupabaseClient,
    *,
    user_id: str,
    category: Category,
    limit: int = 500,
) -> list[EvaluationAsset]:
    """Load authoritative assets for deterministic purchase evaluation."""
    response = (
        supabase_client.table("assets")
        .select(
            "id, name, brand, model, category, subcategory, status"
        )
        .eq("user_id", user_id)
        .eq("category", category)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return [
        EvaluationAsset.model_validate(record)
        for record in (response.data or [])
    ]


def build_purchase_tool_registry(
    supabase_client: SupabaseClient,
    market_client: MarketClient | None,
) -> ToolRegistry:
    handlers = PurchaseToolHandlers(supabase_client, market_client)
    registry = ToolRegistry()
    registry.register(
        name="assets_list",
        description=(
            "读取当前用户指定分类下的已确认资产，用于核对同类或功能重叠物品"
        ),
        input_model=AssetsListInput,
        output_model=AssetsListOutput,
        handler=handlers.list_assets,
    )
    registry.register(
        name="assets_summary",
        description="统计当前用户已确认资产的分类和状态分布",
        input_model=AssetsSummaryInput,
        output_model=AssetsSummaryOutput,
        handler=handlers.summarize_assets,
    )
    registry.register(
        name="market_price_snapshot",
        description=(
            "获取二手市场有限样本的价格快照；结果不是完整实时市场行情"
        ),
        input_model=MarketPriceSnapshotInput,
        output_model=MarketPriceSnapshotOutput,
        handler=handlers.market_price_snapshot,
    )
    registry.register(
        name="evaluation_history_list",
        description=(
            "读取当前用户过往购物评估、用户选择和已确认后续结果；三者不得混淆"
        ),
        input_model=EvaluationHistoryInput,
        output_model=EvaluationHistoryOutput,
        handler=handlers.list_evaluation_history,
    )
    return registry
