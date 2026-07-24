"""Tests for server/app/evaluation_tools.py"""
from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from app.evaluation_tools import (
    EVALUATION_TOOLS,
    DbToolWrapper,
    MarketToolWrapper,
    ToolExecutor,
    create_production_executor,
)
from app.models import MarketCandidate


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_candidate(item_id: str, price: float, title: str = "") -> MarketCandidate:
    return MarketCandidate(
        item_id=item_id,
        title=title or f"item-{item_id}",
        price=price,
    )


def make_executor(
    query_assets: MagicMock | None = None,
    query_summary: MagicMock | None = None,
    search_market: MagicMock | None = None,
) -> ToolExecutor:
    """创建一个注入了 mock handler 的 ToolExecutor。"""
    executor = ToolExecutor()
    executor.set_asset_handlers(
        query_assets=query_assets or MagicMock(return_value=[]),
        query_summary=query_summary or MagicMock(return_value={"total": 0}),
    )
    executor.set_market_handler(
        search_market=search_market or MagicMock(return_value={"sample_count": 0}),
    )
    return executor


def make_db_chain(data: list[dict]) -> MagicMock:
    """构造一个 Supabase 链式调用 mock，使 .execute().data 返回 *data*。"""
    mock_client = MagicMock()
    chain = mock_client.table.return_value
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.order.return_value = chain
    chain.limit.return_value = chain
    chain.execute.return_value = MagicMock(data=data)
    return mock_client


# ===========================================================================
# 1. EVALUATION_TOOLS schema validation
# ===========================================================================

class TestEvaluationToolsSchema:
    def test_tools_count(self):
        assert len(EVALUATION_TOOLS) == 4

    def test_each_tool_has_function_type(self):
        for tool in EVALUATION_TOOLS:
            assert tool["type"] == "function"
            func = tool["function"]
            assert "name" in func
            assert "description" in func
            assert "parameters" in func

    def test_tool_names(self):
        names = {t["function"]["name"] for t in EVALUATION_TOOLS}
        assert names == {
            "get_user_assets",
            "get_asset_summary",
            "search_market_price",
            "clarify_with_user",
        }

    def test_required_fields_exist_in_properties(self):
        for tool in EVALUATION_TOOLS:
            params = tool["function"]["parameters"]
            props = params.get("properties", {})
            for field in params.get("required", []):
                assert field in props, (
                    f"required field '{field}' missing from properties "
                    f"of tool '{tool['function']['name']}'"
                )

    def test_parameters_have_type_object(self):
        for tool in EVALUATION_TOOLS:
            params = tool["function"]["parameters"]
            assert params["type"] == "object"


# ===========================================================================
# 2. ToolExecutor.execute dispatch
# ===========================================================================

class TestToolExecutorDispatch:
    def test_get_user_assets_routes_to_handler(self):
        mock_query = MagicMock(
            return_value=[
                {
                    "id": "a1",
                    "name": "iPhone 15",
                    "brand": "Apple",
                    "model": "A3092",
                    "category": "数码",
                    "subcategory": "手机",
                    "status": "in_use",
                }
            ]
        )
        executor = make_executor(query_assets=mock_query)

        result = json.loads(
            executor.execute("get_user_assets", {"category": "数码", "limit": 5})
        )

        mock_query.assert_called_once_with("数码", "", 5)
        assert len(result) == 1
        assert result[0]["id"] == "a1"
        assert result[0]["name"] == "iPhone 15"
        assert result[0]["brand"] == "Apple"
        assert result[0]["status"] == "in_use"

    def test_get_user_assets_default_limit(self):
        mock_query = MagicMock(return_value=[])
        executor = make_executor(query_assets=mock_query)

        executor.execute("get_user_assets", {"category": "家电"})

        mock_query.assert_called_once_with("家电", "", 10)

    def test_get_user_assets_with_subcategory(self):
        mock_query = MagicMock(return_value=[])
        executor = make_executor(query_assets=mock_query)

        executor.execute(
            "get_user_assets",
            {"category": "数码", "subcategory": "手机", "limit": 3},
        )

        mock_query.assert_called_once_with("数码", "手机", 3)

    def test_get_asset_summary_routes_to_handler(self):
        mock_summary = MagicMock(
            return_value={"total": 5, "by_status": {"in_use": 3, "idle": 2}}
        )
        executor = make_executor(query_summary=mock_summary)

        result = json.loads(
            executor.execute("get_asset_summary", {"category": "数码"})
        )

        mock_summary.assert_called_once_with("数码")
        assert result["total"] == 5
        assert result["by_status"]["in_use"] == 3

    def test_get_asset_summary_no_category(self):
        mock_summary = MagicMock(return_value={"total": 0})
        executor = make_executor(query_summary=mock_summary)

        executor.execute("get_asset_summary", {})

        mock_summary.assert_called_once_with("")

    def test_search_market_price_routes_to_handler(self):
        mock_market = MagicMock(
            return_value={"median_price": 500, "sample_count": 10}
        )
        executor = make_executor(search_market=mock_market)

        result = json.loads(
            executor.execute(
                "search_market_price", {"keyword": "iPhone 15", "category": "数码"}
            )
        )

        mock_market.assert_called_once_with("iPhone 15", "数码")
        assert result["median_price"] == 500

    def test_search_market_price_no_category(self):
        mock_market = MagicMock(return_value={"sample_count": 0})
        executor = make_executor(search_market=mock_market)

        executor.execute("search_market_price", {"keyword": "test"})

        mock_market.assert_called_once_with("test", "")

    def test_clarify_with_user_returns_clarification(self):
        executor = make_executor()

        result = json.loads(
            executor.execute(
                "clarify_with_user",
                {"question": "你打算替换还是新增？", "options": ["替换", "新增"]},
            )
        )

        assert result["type"] == "clarification"
        assert result["question"] == "你打算替换还是新增？"
        assert result["choices"] == ["替换", "新增"]

    def test_clarify_without_options(self):
        executor = make_executor()

        result = json.loads(
            executor.execute("clarify_with_user", {"question": "什么时候买的？"})
        )

        assert result["type"] == "clarification"
        assert result["question"] == "什么时候买的？"
        assert "choices" not in result

    def test_unknown_tool_returns_error(self):
        executor = make_executor()

        result = json.loads(executor.execute("nonexistent", {}))

        assert "error" in result
        assert "nonexistent" in result["error"]


# ===========================================================================
# 3. Request-level cache
# ===========================================================================

class TestToolExecutorCache:
    def test_cache_hit_same_arguments(self):
        mock_query = MagicMock(return_value=[{"id": "1", "name": "x"}])
        executor = make_executor(query_assets=mock_query)

        executor.execute("get_user_assets", {"category": "数码"})
        executor.execute("get_user_assets", {"category": "数码"})

        assert mock_query.call_count == 1

    def test_cache_miss_different_arguments(self):
        mock_query = MagicMock(return_value=[])
        executor = make_executor(query_assets=mock_query)

        executor.execute("get_user_assets", {"category": "数码"})
        executor.execute("get_user_assets", {"category": "家电"})
        executor.execute("get_user_assets", {"category": "数码", "limit": 5})

        assert mock_query.call_count == 3

    def test_cache_key_respects_argument_order(self):
        """sort_keys=True ensures {a:1,b:2} and {b:2,a:1} share a cache key."""
        mock_summary = MagicMock(return_value={"total": 0})
        executor = make_executor(query_summary=mock_summary)

        executor.execute("get_asset_summary", {"category": "数码"})
        executor.execute("get_asset_summary", {"category": "数码"})

        assert mock_summary.call_count == 1

    def test_cache_returns_identical_string(self):
        mock_query = MagicMock(return_value=[{"id": "1", "name": "x"}])
        executor = make_executor(query_assets=mock_query)

        first = executor.execute("get_user_assets", {"category": "数码"})
        second = executor.execute("get_user_assets", {"category": "数码"})

        assert first == second

    def test_cache_works_for_clarify(self):
        executor = make_executor()

        first = executor.execute(
            "clarify_with_user", {"question": "Q1", "options": ["A"]}
        )
        second = executor.execute(
            "clarify_with_user", {"question": "Q1", "options": ["A"]}
        )

        assert first == second


# ===========================================================================
# 4. Error degradation
# ===========================================================================

class TestToolExecutorErrorHandling:
    def test_handler_exception_returns_error_json(self):
        mock_query = MagicMock(side_effect=RuntimeError("DB connection lost"))
        executor = make_executor(query_assets=mock_query)

        result = json.loads(
            executor.execute("get_user_assets", {"category": "数码"})
        )

        assert "error" in result
        assert "DB connection lost" in result["error"]

    def test_summary_handler_exception_returns_error_json(self):
        mock_summary = MagicMock(side_effect=ValueError("boom"))
        executor = make_executor(query_summary=mock_summary)

        result = json.loads(executor.execute("get_asset_summary", {}))

        assert "error" in result
        assert "boom" in result["error"]

    def test_market_handler_exception_returns_error_json(self):
        mock_market = MagicMock(side_effect=RuntimeError("timeout"))
        executor = make_executor(search_market=mock_market)

        result = json.loads(
            executor.execute("search_market_price", {"keyword": "test"})
        )

        assert "error" in result
        assert "timeout" in result["error"]

    def test_market_none_returns_error_via_factory(self):
        """create_production_executor with market_client=None
        wires a lambda that returns an error dict."""
        mock_db = MagicMock()
        executor = create_production_executor("user-1", mock_db, None)

        result = json.loads(
            executor.execute("search_market_price", {"keyword": "test"})
        )

        assert "error" in result

    def test_error_result_is_cached(self):
        """Errors are also cached — second call returns the same cached string
        without re-invoking the (failing) handler."""
        mock_query = MagicMock(side_effect=RuntimeError("fail"))
        executor = make_executor(query_assets=mock_query)

        first = executor.execute("get_user_assets", {"category": "数码"})
        second = executor.execute("get_user_assets", {"category": "数码"})

        assert first == second
        assert mock_query.call_count == 1


# ===========================================================================
# 5. Market statistics calculation
# ===========================================================================

class TestCalculateMarketStats:
    def test_empty_candidates(self):
        result = ToolExecutor.calculate_market_stats([])

        assert result == {
            "median_price": None,
            "price_range": [None, None],
            "sample_count": 0,
        }

    def test_two_items_uses_min_max(self):
        """Fewer than 4 samples: price_range = [min, max]."""
        candidates = [make_candidate("1", 100), make_candidate("2", 200)]

        result = ToolExecutor.calculate_market_stats(candidates)

        assert result["median_price"] == 150.0
        assert result["price_range"] == [100.0, 200.0]
        assert result["sample_count"] == 2

    def test_three_items_uses_min_max(self):
        candidates = [
            make_candidate("1", 100),
            make_candidate("2", 200),
            make_candidate("3", 300),
        ]

        result = ToolExecutor.calculate_market_stats(candidates)

        assert result["median_price"] == 200.0
        assert result["price_range"] == [100.0, 300.0]
        assert result["sample_count"] == 3

    def test_five_items_uses_quartiles(self):
        """>= 4 samples: price_range = [Q1, Q3]."""
        candidates = [
            make_candidate(str(i), p)
            for i, p in enumerate([100, 200, 300, 400, 500])
        ]

        result = ToolExecutor.calculate_market_stats(candidates)

        assert result["median_price"] == 300.0
        assert result["price_range"] == [150.0, 450.0]
        assert result["sample_count"] == 5

    def test_four_items_uses_quartiles(self):
        candidates = [
            make_candidate(str(i), p)
            for i, p in enumerate([100, 200, 300, 400])
        ]

        result = ToolExecutor.calculate_market_stats(candidates)

        assert result["median_price"] == 250.0
        assert result["price_range"] == [125.0, 375.0]
        assert result["sample_count"] == 4

    def test_unsorted_input_is_sorted_internally(self):
        candidates = [
            make_candidate("c", 500),
            make_candidate("a", 100),
            make_candidate("b", 300),
        ]

        result = ToolExecutor.calculate_market_stats(candidates)

        assert result["median_price"] == 300.0
        assert result["price_range"] == [100.0, 500.0]

    def test_prices_rounded_to_two_decimals(self):
        candidates = [make_candidate("1", 100.126), make_candidate("2", 200.451)]

        result = ToolExecutor.calculate_market_stats(candidates)

        assert result["median_price"] == 150.29
        assert result["price_range"][0] == 100.13
        assert result["price_range"][1] == 200.45


# ===========================================================================
# 6. Pure-logic helpers: format_asset_record & handle_clarify
# ===========================================================================

class TestFormatAssetRecord:
    def test_full_record(self):
        asset = {
            "id": "a1",
            "name": "iPhone",
            "brand": "Apple",
            "model": "15",
            "category": "数码",
            "subcategory": "手机",
            "status": "in_use",
            "extra_field": "ignored",
        }

        result = ToolExecutor.format_asset_record(asset)

        assert result == {
            "id": "a1",
            "name": "iPhone",
            "brand": "Apple",
            "model": "15",
            "category": "数码",
            "subcategory": "手机",
            "status": "in_use",
        }

    def test_missing_fields_get_defaults(self):
        result = ToolExecutor.format_asset_record({"id": "x"})

        assert result["id"] == "x"
        assert result["name"] == ""
        assert result["brand"] is None
        assert result["model"] is None
        assert result["category"] == ""
        assert result["subcategory"] == ""
        assert result["status"] == ""


class TestHandleClarify:
    def test_with_options(self):
        result = ToolExecutor.handle_clarify("哪个？", ["A", "B"])

        assert result == {
            "type": "clarification",
            "question": "哪个？",
            "choices": ["A", "B"],
        }

    def test_without_options(self):
        result = ToolExecutor.handle_clarify("为什么？", None)

        assert result == {"type": "clarification", "question": "为什么？"}
        assert "choices" not in result

    def test_empty_options_omitted(self):
        result = ToolExecutor.handle_clarify("Q", [])

        assert "choices" not in result


# ===========================================================================
# 7. DbToolWrapper — Supabase chain integration
# ===========================================================================

class TestDbToolWrapper:
    def test_handle_get_user_assets_basic(self):
        mock_client = make_db_chain([
            {"id": "1", "name": "Phone", "category": "数码", "status": "in_use"}
        ])
        wrapper = DbToolWrapper(ToolExecutor(), "user-1", mock_client)

        result = wrapper.handle_get_user_assets("数码")

        mock_client.table.assert_called_once_with("assets")
        assert len(result) == 1
        assert result[0]["id"] == "1"

    def test_handle_get_user_assets_with_subcategory(self):
        mock_client = make_db_chain([])
        wrapper = DbToolWrapper(ToolExecutor(), "user-1", mock_client)

        wrapper.handle_get_user_assets("数码", "手机", 5)

        chain = mock_client.table.return_value
        # eq is called for user_id, category, and subcategory
        assert chain.eq.call_count == 3
        chain.limit.assert_called_once_with(5)

    def test_handle_get_user_assets_empty_response(self):
        mock_client = make_db_chain([])
        wrapper = DbToolWrapper(ToolExecutor(), "user-1", mock_client)

        result = wrapper.handle_get_user_assets("数码")

        assert result == []

    def test_handle_get_user_assets_none_response(self):
        """response.data is None → return []."""
        mock_client = MagicMock()
        chain = mock_client.table.return_value
        chain.select.return_value = chain
        chain.eq.return_value = chain
        chain.order.return_value = chain
        chain.limit.return_value = chain
        chain.execute.return_value = MagicMock(data=None)
        wrapper = DbToolWrapper(ToolExecutor(), "user-1", mock_client)

        result = wrapper.handle_get_user_assets("数码")

        assert result == []

    def test_handle_get_asset_summary_all(self):
        mock_client = make_db_chain([
            {"category": "数码", "subcategory": "手机", "status": "in_use"},
            {"category": "数码", "subcategory": "耳机", "status": "idle"},
            {"category": "家电", "subcategory": "", "status": "in_use"},
        ])
        wrapper = DbToolWrapper(ToolExecutor(), "user-1", mock_client)

        result = wrapper.handle_get_asset_summary()

        assert result["total"] == 3
        assert result["by_status"]["in_use"] == 2
        assert result["by_status"]["idle"] == 1
        assert result["by_category"]["数码"] == 2
        assert result["by_category"]["家电"] == 1

    def test_handle_get_asset_summary_filtered(self):
        mock_client = make_db_chain([
            {"category": "数码", "subcategory": "手机", "status": "in_use"},
        ])
        wrapper = DbToolWrapper(ToolExecutor(), "user-1", mock_client)

        result = wrapper.handle_get_asset_summary("数码")

        chain = mock_client.table.return_value
        # eq called for user_id and category
        assert chain.eq.call_count == 2
        assert result["total"] == 1


# ===========================================================================
# 8. MarketToolWrapper — MarketClient integration
# ===========================================================================

class TestMarketToolWrapper:
    def test_successful_search_returns_stats(self):
        mock_market = MagicMock()
        mock_market.search.return_value = [
            make_candidate("1", 100),
            make_candidate("2", 200),
            make_candidate("3", 300),
            make_candidate("4", 400),
            make_candidate("5", 500),
        ]
        wrapper = MarketToolWrapper(ToolExecutor(), mock_market)

        result = wrapper.handle_market_search("iPhone 15")

        mock_market.search.assert_called_once_with("iPhone 15", pages=2)
        assert result["median_price"] == 300.0
        assert result["sample_count"] == 5

    def test_runtime_error_returns_error_dict(self):
        mock_market = MagicMock()
        mock_market.search.side_effect = RuntimeError("unavailable")
        wrapper = MarketToolWrapper(ToolExecutor(), mock_market)

        result = wrapper.handle_market_search("test")

        assert result == {"error": "市场搜索暂时不可用"}

    def test_empty_results_return_null_stats(self):
        mock_market = MagicMock()
        mock_market.search.return_value = []
        wrapper = MarketToolWrapper(ToolExecutor(), mock_market)

        result = wrapper.handle_market_search("nothing")

        assert result["sample_count"] == 0
        assert result["median_price"] is None


# ===========================================================================
# 9. create_production_executor — factory wiring
# ===========================================================================

class TestCreateProductionExecutor:
    def test_factory_with_market_client(self):
        mock_db = make_db_chain([])
        mock_market = MagicMock()
        mock_market.search.return_value = [
            make_candidate("1", 100),
            make_candidate("2", 200),
        ]
        executor = create_production_executor("u1", mock_db, mock_market)

        # get_user_assets should work via DbToolWrapper
        result = json.loads(
            executor.execute("get_user_assets", {"category": "数码"})
        )
        assert isinstance(result, list)

        # search_market_price should work via MarketToolWrapper
        result = json.loads(
            executor.execute("search_market_price", {"keyword": "test"})
        )
        assert "sample_count" in result

    def test_factory_without_market_client(self):
        mock_db = make_db_chain([])
        executor = create_production_executor("u1", mock_db, None)

        result = json.loads(
            executor.execute("search_market_price", {"keyword": "test"})
        )
        assert "error" in result

    def test_factory_db_summary_works(self):
        mock_db = make_db_chain([
            {"category": "数码", "subcategory": "", "status": "in_use"},
        ])
        executor = create_production_executor("u1", mock_db, None)

        result = json.loads(executor.execute("get_asset_summary", {}))

        assert result["total"] == 1
        assert result["by_status"]["in_use"] == 1
