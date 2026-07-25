from types import SimpleNamespace
from unittest.mock import MagicMock
from datetime import datetime, timedelta, timezone

import pytest
from app.ai.contracts import RunContext
from app.ai.errors import ToolExecutionError
from app.ai.tools.conversation import (
    AssetDecisionContextInput,
    BindPurchaseEvaluationInput,
    FundingSummaryInput,
    RecognizeProductImagesInput,
    RecognizeProductTextInput,
    WishlistSellPlanPreviewInput,
    WishlistListInput,
    _insert_evaluation,
    build_conversation_tool_registry,
)
from app.models import ParsedProduct
from pydantic import ValidationError


def context(**metadata):
    return RunContext(
        user_id="user-1",
        request_id="req-1",
        metadata=metadata,
    )


def table_client(rows_by_table):
    client = MagicMock()
    chains = {}
    for table, rows in rows_by_table.items():
        chain = MagicMock()
        for method in (
            "select",
            "eq",
            "filter",
            "neq",
            "gte",
            "order",
            "limit",
        ):
            getattr(chain, method).return_value = chain
        chain.execute.return_value = SimpleNamespace(data=rows)
        chains[table] = chain
    client.table.side_effect = chains.__getitem__
    return client, chains


def test_recognize_product_text_returns_product(monkeypatch):
    registry = build_conversation_tool_registry(
        settings=MagicMock(),
        supabase_client=MagicMock(),
        market_client=None,
    )
    monkeypatch.setattr(
        "app.ai.tools.conversation._interpret_text",
        lambda settings, text, user_id, request_id: SimpleNamespace(
            intent="product",
            normalized_title="索尼耳机",
            category="数码",
            subcategory="耳机",
            reply="",
        ),
    )
    result = registry.get("recognize_product_text").handler(
        RecognizeProductTextInput(text="想买索尼耳机"),
        context(),
    )
    assert result.is_product is True
    assert result.product.title == "索尼耳机"


def test_recognize_product_images_uses_metadata_urls_only(monkeypatch):
    registry = build_conversation_tool_registry(
        settings=MagicMock(),
        supabase_client=MagicMock(),
        market_client=None,
    )
    called = {}

    def fake_recognize(settings, image_urls, user_id, request_id):
        called["urls"] = image_urls
        return ParsedProduct(
            title="相机",
            category="数码",
            subcategory="相机",
            source_type="image",
        )

    monkeypatch.setattr(
        "app.ai.tools.conversation._recognize_images",
        fake_recognize,
    )
    result = registry.get("recognize_product_images").handler(
        RecognizeProductImagesInput(),
        context(image_urls=["https://signed.example/a.jpg"]),
    )
    assert called["urls"] == ["https://signed.example/a.jpg"]
    assert result.is_product is True


def test_recognize_product_images_errors_without_urls():
    registry = build_conversation_tool_registry(
        settings=MagicMock(),
        supabase_client=MagicMock(),
        market_client=None,
    )
    with pytest.raises(ToolExecutionError):
        registry.get("recognize_product_images").handler(
            RecognizeProductImagesInput(),
            context(image_urls=[]),
        )


def test_bind_purchase_evaluation_upserts_with_context_ids(monkeypatch):
    supabase = MagicMock()
    registry = build_conversation_tool_registry(
        settings=MagicMock(),
        supabase_client=supabase,
        market_client=None,
    )
    monkeypatch.setattr(
        "app.ai.tools.conversation._upsert_evaluation",
        lambda **kwargs: "eval-9",
    )
    result = registry.get("bind_purchase_evaluation").handler(
        BindPurchaseEvaluationInput(
            title="索尼耳机",
            category="数码",
            subcategory="耳机",
            price=1999,
            url="",
            source_type="text",
            source_text="想买索尼耳机",
        ),
        context(thread_id="thread-1"),
    )
    assert result.evaluation_id == "eval-9"


def test_insert_evaluation_uses_supported_write_builder():
    supabase = MagicMock()
    builder = MagicMock()
    builder.execute.return_value = SimpleNamespace(data=[{"id": "eval-1"}])
    supabase.table.return_value.insert.return_value.select.return_value = (
        builder
    )

    evaluation_id = _insert_evaluation(
        supabase,
        "user-1",
        "thread-1",
        ParsedProduct(
            title="Garmin Forerunner 265",
            price=1700,
            category="数码",
            subcategory="智能手表",
            source_type="text",
            source_text="想买 Garmin Forerunner 265",
        ),
    )

    assert evaluation_id == "eval-1"
    builder.execute.assert_called_once_with()


@pytest.mark.parametrize(
    ("status", "operator"),
    [("active", "is"), ("fulfilled", "not.is")],
)
def test_wishlist_list_filters_current_users_items(status, operator):
    supabase = MagicMock()
    query = MagicMock()
    supabase.table.return_value = query
    query.select.return_value = query
    query.eq.return_value = query
    query.filter.return_value = query
    query.order.return_value = query
    query.execute.return_value = SimpleNamespace(
        data=[
            {
                "id": "wish-1",
                "name": "去北海道旅行",
                "target_price": "12000.00",
                "notes": "冬天",
                "actual_price": None,
                "fulfilled_at": None,
                "created_at": "2026-07-25T00:00:00Z",
            }
        ]
    )
    registry = build_conversation_tool_registry(
        settings=MagicMock(),
        supabase_client=supabase,
        market_client=None,
    )

    result = registry.get("wishlist_list").handler(
        WishlistListInput(status=status),
        context(),
    )

    supabase.table.assert_called_once_with("wishlist_items")
    query.eq.assert_called_once_with("user_id", "user-1")
    query.filter.assert_called_once_with(
        "fulfilled_at",
        operator,
        "null",
    )
    query.order.assert_called_once_with("created_at", desc=True)
    assert result.items[0].name == "去北海道旅行"
    assert result.items[0].target_price == 12000


def test_wishlist_list_defaults_to_all_statuses():
    supabase = MagicMock()
    query = MagicMock()
    supabase.table.return_value = query
    query.select.return_value = query
    query.eq.return_value = query
    query.order.return_value = query
    query.execute.return_value = SimpleNamespace(data=[])
    registry = build_conversation_tool_registry(
        settings=MagicMock(),
        supabase_client=supabase,
        market_client=None,
    )

    result = registry.get("wishlist_list").handler(
        WishlistListInput(),
        context(),
    )

    query.filter.assert_not_called()
    assert result.items == []


def test_funding_summary_deducts_allocations_from_each_source():
    client, chains = table_client(
        {
            "spending_resolutions": [
                {"id": "resolution-1", "amount": "1200.00"},
            ],
            "asset_sales": [
                {"id": "sale-1", "sale_price": "800.00"},
            ],
            "wishlist_funding_allocations": [
                {
                    "spending_resolution_id": "resolution-1",
                    "asset_sale_id": None,
                    "amount": "300.00",
                },
                {
                    "spending_resolution_id": None,
                    "asset_sale_id": "sale-1",
                    "amount": "200.00",
                },
            ],
            "wishlist_items": [
                {
                    "id": "wish-1",
                    "name": "北海道旅行",
                    "target_price": "8000.00",
                }
            ],
        }
    )
    registry = build_conversation_tool_registry(
        settings=MagicMock(),
        supabase_client=client,
        market_client=None,
    )

    result = registry.get("funding_summary").handler(
        FundingSummaryInput(),
        context(),
    )

    assert result.available_spending == 900
    assert result.available_sales == 600
    assert result.available_total == 1500
    assert result.allocated_total == 500
    assert result.active_wishes[0].remaining_gap == 6500
    for chain in chains.values():
        assert ("user_id", "user-1") in [
            call.args for call in chain.eq.call_args_list
        ]


@pytest.mark.parametrize(
    ("resolutions", "allocations", "expected"),
    [
        ([], [], 0),
        (
            [{"id": "resolution-1", "amount": 500}],
            [
                {
                    "spending_resolution_id": "resolution-1",
                    "asset_sale_id": None,
                    "amount": 500,
                }
            ],
            0,
        ),
    ],
)
def test_funding_summary_handles_empty_and_fully_allocated_sources(
    resolutions,
    allocations,
    expected,
):
    client, _ = table_client(
        {
            "spending_resolutions": resolutions,
            "asset_sales": [],
            "wishlist_funding_allocations": allocations,
            "wishlist_items": [],
        }
    )
    registry = build_conversation_tool_registry(
        settings=MagicMock(),
        supabase_client=client,
        market_client=None,
    )

    result = registry.get("funding_summary").handler(
        FundingSummaryInput(),
        context(),
    )

    assert result.available_total == expected


def test_sell_plan_preview_uses_remaining_gap_without_writes():
    now = datetime.now(timezone.utc)
    client, _ = table_client(
        {
            "spending_resolutions": [
                {"id": "resolution-1", "amount": 100},
            ],
            "asset_sales": [],
            "wishlist_funding_allocations": [],
            "wishlist_items": [
                {"id": "wish-1", "name": "旅行", "target_price": 1000},
            ],
            "assets": [
                {
                    "id": "ready",
                    "name": "相机",
                    "status": "idle",
                    "status_confirmed_at": now.isoformat(),
                    "latest_market_price": 350,
                    "latest_market_price_low": 300,
                    "latest_valuation_at": now.isoformat(),
                },
                {
                    "id": "unconfirmed",
                    "name": "平板",
                    "status": "idle",
                    "status_confirmed_at": None,
                    "latest_market_price": 500,
                    "latest_market_price_low": 450,
                    "latest_valuation_at": now.isoformat(),
                },
                {
                    "id": "stale",
                    "name": "耳机",
                    "status": "listed",
                    "status_confirmed_at": now.isoformat(),
                    "latest_market_price": 500,
                    "latest_market_price_low": 400,
                    "latest_valuation_at": (
                        now - timedelta(days=8)
                    ).isoformat(),
                },
            ],
        }
    )
    registry = build_conversation_tool_registry(
        settings=MagicMock(),
        supabase_client=client,
        market_client=None,
    )

    result = registry.get("wishlist_sell_plan_preview").handler(
        WishlistSellPlanPreviewInput(wishlist_item_id="wish-1"),
        context(),
    )

    assert result.remaining_gap == 900
    assert [asset.id for asset in result.selected_assets] == ["ready"]
    assert result.conservative_total == 300
    assert result.readiness_counts.needs_confirmation == 1
    assert result.readiness_counts.stale_valuation == 1
    assert result.is_reachable is False
    assert "sell_plan_snapshots" not in [
        call.args[0] for call in client.table.call_args_list
    ]


def test_sell_plan_preview_skips_assets_when_funding_covers_wish():
    client, _ = table_client(
        {
            "spending_resolutions": [
                {"id": "resolution-1", "amount": 500},
            ],
            "asset_sales": [],
            "wishlist_funding_allocations": [],
            "wishlist_items": [
                {"id": "wish-1", "name": "旅行", "target_price": 500},
            ],
        }
    )
    registry = build_conversation_tool_registry(
        settings=MagicMock(),
        supabase_client=client,
        market_client=None,
    )

    result = registry.get("wishlist_sell_plan_preview").handler(
        WishlistSellPlanPreviewInput(wishlist_item_id="wish-1"),
        context(),
    )

    assert result.remaining_gap == 0
    assert result.selected_assets == []
    assert result.is_reachable is True
    assert "assets" not in [
        call.args[0] for call in client.table.call_args_list
    ]


def test_asset_decision_context_separates_sale_and_demo_market_evidence():
    client, chains = table_client(
        {
            "assets": [
                {
                    "id": "asset-1",
                    "name": "手机",
                    "brand": "Apple",
                    "model": "15",
                    "category": "数码",
                    "subcategory": "手机",
                    "status": "sold",
                    "purchase_date": "2024-01-01",
                    "purchase_price": 6000,
                    "latest_market_price": 3500,
                    "latest_market_price_low": 3200,
                    "latest_market_price_high": 3800,
                    "latest_valuation_at": "2026-01-01T00:00:00Z",
                    "status_confirmed_at": "2026-07-20T00:00:00Z",
                    "status_source": "user",
                    "market_key": "shared-market-key",
                }
            ],
            "asset_status_events": [
                {
                    "from_status": "listed",
                    "to_status": "sold",
                    "created_at": "2026-07-20T00:00:00Z",
                }
            ],
            "asset_sales": [
                {"sold_at": "2026-07-20", "sale_price": 3300},
            ],
            "market_snapshots": [
                {
                    "snapshot_date": "2026-07-19",
                    "estimated_price": 3500,
                    "price_low": 3200,
                    "price_high": 3800,
                    "sample_count": 8,
                    "query": "iPhone 15",
                    "source": "demo_seed",
                    "created_at": "2026-07-19T00:00:00Z",
                }
            ],
            "analysis_runs": [
                {
                    "kind": "market",
                    "status": "failed",
                    "run_date": "2026-07-19",
                    "attempt_count": 2,
                    "error_message": "upstream blocked",
                    "started_at": "2026-07-19T00:00:00Z",
                    "finished_at": "2026-07-19T00:01:00Z",
                }
            ],
        }
    )
    registry = build_conversation_tool_registry(
        settings=MagicMock(),
        supabase_client=client,
        market_client=None,
    )

    result = registry.get("asset_decision_context").handler(
        AssetDecisionContextInput(asset_id="asset-1", days=30),
        context(),
    )

    assert result.sale.sale_price == 3300
    assert result.market_snapshots[0].source == "demo_seed"
    assert result.market_snapshots[0].is_demo is True
    assert result.analysis_runs[0].status == "failed"
    assert result.valuation_is_stale is True
    assert ("market_key", "shared-market-key") in [
        call.args for call in chains["analysis_runs"].eq.call_args_list
    ]
    for chain in chains.values():
        assert ("user_id", "user-1") in [
            call.args for call in chain.eq.call_args_list
        ]


def test_asset_decision_context_limits_history_to_90_days():
    with pytest.raises(ValidationError):
        AssetDecisionContextInput(asset_id="asset-1", days=91)
