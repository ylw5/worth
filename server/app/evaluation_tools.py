from __future__ import annotations

import json
import statistics
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from supabase import Client as SupabaseClient

    from .market import MarketClient
    from .models import MarketCandidate


EVALUATION_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "get_user_assets",
            "description": "查询用户指定分类下的资产列表，了解用户已有的同类物品",
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "description": "资产大类，如数码、家电、服饰箱包等",
                    },
                    "subcategory": {
                        "type": "string",
                        "description": "细分品类，如手机、笔记本等，可选",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "返回数量上限，默认10",
                        "default": 10,
                    },
                },
                "required": ["category"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_asset_summary",
            "description": "获取用户资产的统计概览，包括各分类数量和状态分布",
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "description": "按分类筛选，留空则统计全部",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_market_price",
            "description": "查询商品在二手市场的行情价格",
            "parameters": {
                "type": "object",
                "properties": {
                    "keyword": {
                        "type": "string",
                        "description": "搜索关键词，通常是商品名称+品牌",
                    },
                    "category": {
                        "type": "string",
                        "description": "商品分类",
                    },
                },
                "required": ["keyword"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "clarify_with_user",
            "description": (
                "当信息不足以做出分析时，向用户提出一个澄清问题。"
                "每轮对话最多使用一次。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "要问用户的问题",
                    },
                    "options": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "可选的选项列表，帮助用户快速回答",
                    },
                },
                "required": ["question"],
            },
        },
    },
]


class ToolExecutor:
    """纯工具执行器：不含 DB / Market 依赖，持有结果缓存。

    所有 I/O 通过外部注入的 handler 完成，本类只负责
    分发、缓存、格式化和纯计算逻辑。
    """

    def __init__(self) -> None:
        self._result_cache: dict[str, Any] = {}
        self._asset_query: Any = None
        self._asset_summary: Any = None
        self._market_search: Any = None

    def set_asset_handlers(
        self,
        query_assets: Any,
        query_summary: Any,
    ) -> None:
        """注入资产查询 handler。"""
        self._asset_query = query_assets
        self._asset_summary = query_summary

    def set_market_handler(self, search_market: Any) -> None:
        """注入市场搜索 handler。"""
        self._market_search = search_market

    def execute(self, tool_name: str, arguments: dict) -> str:
        """分发工具调用，返回 JSON 字符串。失败时返回 error JSON 而非抛异常。"""
        cache_key = f"{tool_name}:{json.dumps(arguments, sort_keys=True)}"
        if cache_key in self._result_cache:
            return self._result_cache[cache_key]

        try:
            if tool_name == "get_user_assets":
                raw = self._asset_query(
                    arguments.get("category", ""),
                    arguments.get("subcategory", ""),
                    arguments.get("limit", 10),
                )
                result = [self.format_asset_record(a) for a in raw]
            elif tool_name == "get_asset_summary":
                result = self._asset_summary(
                    arguments.get("category", ""),
                )
            elif tool_name == "search_market_price":
                result = self._market_search(
                    arguments.get("keyword", ""),
                    arguments.get("category", ""),
                )
            elif tool_name == "clarify_with_user":
                result = self.handle_clarify(
                    arguments.get("question", ""),
                    arguments.get("options"),
                )
            else:
                result = {"error": f"未知工具: {tool_name}"}
        except Exception as exc:
            result = {"error": f"工具执行失败: {exc}"}

        result_str = json.dumps(result, ensure_ascii=False)
        self._result_cache[cache_key] = result_str
        return result_str

    # ------------------------------------------------------------------
    # 纯逻辑方法
    # ------------------------------------------------------------------

    @staticmethod
    def calculate_market_stats(
        candidates: list[MarketCandidate],
    ) -> dict:
        """从候选列表计算市场统计（中位价、价格区间、样本数）。"""
        if not candidates:
            return {
                "median_price": None,
                "price_range": [None, None],
                "sample_count": 0,
            }

        prices = sorted(c.price for c in candidates)
        median = round(statistics.median(prices), 2)

        if len(prices) >= 4:
            q = statistics.quantiles(prices, n=4)
            price_range = [round(q[0], 2), round(q[2], 2)]
        else:
            price_range = [round(prices[0], 2), round(prices[-1], 2)]

        return {
            "median_price": median,
            "price_range": price_range,
            "sample_count": len(prices),
        }

    @staticmethod
    def handle_clarify(
        question: str, options: list[str] | None
    ) -> dict:
        """构造澄清问题结果。"""
        result: dict = {"type": "clarification", "question": question}
        if options:
            result["choices"] = options
        return result

    @staticmethod
    def format_asset_record(asset: dict) -> dict:
        """格式化单条资产记录，只保留前端需要的字段。"""
        return {
            "id": asset.get("id", ""),
            "name": asset.get("name", ""),
            "brand": asset.get("brand"),
            "model": asset.get("model"),
            "category": asset.get("category", ""),
            "subcategory": asset.get("subcategory", ""),
            "status": asset.get("status", ""),
        }


class DbToolWrapper:
    """数据库工具实现：查询 Supabase 获取用户资产数据。"""

    def __init__(
        self, executor: ToolExecutor, user_id: str, client: SupabaseClient
    ) -> None:
        self._executor = executor
        self._user_id = user_id
        self._client = client

    def handle_get_user_assets(
        self,
        category: str,
        subcategory: str = "",
        limit: int = 10,
    ) -> list[dict]:
        """查询用户指定分类的资产。"""
        query = (
            self._client.table("assets")
            .select(
                "id, name, brand, model, category, subcategory, status"
            )
            .eq("user_id", self._user_id)
            .eq("category", category)
        )
        if subcategory:
            query = query.eq("subcategory", subcategory)
        response = (
            query.order("created_at", desc=True).limit(limit).execute()
        )
        return response.data if response.data else []

    def handle_get_asset_summary(self, category: str = "") -> dict:
        """获取用户资产统计概览。"""
        query = (
            self._client.table("assets")
            .select("category, subcategory, status")
            .eq("user_id", self._user_id)
        )
        if category:
            query = query.eq("category", category)
        response = query.execute()
        assets = response.data or []

        by_status: dict[str, int] = {}
        by_category: dict[str, int] = {}
        for a in assets:
            s = a.get("status", "unknown")
            by_status[s] = by_status.get(s, 0) + 1
            c = a.get("category", "unknown")
            by_category[c] = by_category.get(c, 0) + 1

        return {
            "total": len(assets),
            "by_status": by_status,
            "by_category": by_category,
        }


class MarketToolWrapper:
    """市场搜索工具实现：调用闲鱼 API 获取行情数据。"""

    def __init__(
        self, executor: ToolExecutor, client: MarketClient
    ) -> None:
        self._executor = executor
        self._client = client

    def handle_market_search(
        self, keyword: str, category: str = ""
    ) -> dict:
        """搜索市场行情并计算统计值。"""
        try:
            candidates = self._client.search(keyword, pages=2)
        except RuntimeError:
            return {"error": "市场搜索暂时不可用"}
        return self._executor.calculate_market_stats(candidates)


def create_production_executor(
    user_id: str,
    supabase_client: SupabaseClient,
    market_client: MarketClient | None,
) -> ToolExecutor:
    """生产环境工厂：组装带 DB + Market 能力的 ToolExecutor。"""
    executor = ToolExecutor()

    db = DbToolWrapper(executor, user_id, supabase_client)
    executor.set_asset_handlers(
        query_assets=db.handle_get_user_assets,
        query_summary=db.handle_get_asset_summary,
    )

    if market_client:
        market = MarketToolWrapper(executor, market_client)
        executor.set_market_handler(market.handle_market_search)
    else:
        executor.set_market_handler(
            lambda keyword, category="": {"error": "市场数据源未配置"}
        )

    return executor
