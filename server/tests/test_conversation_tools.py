from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from app.ai.contracts import RunContext
from app.ai.errors import ToolExecutionError
from app.ai.tools.conversation import (
    BindPurchaseEvaluationInput,
    RecognizeProductImagesInput,
    RecognizeProductTextInput,
    WishlistListInput,
    _insert_evaluation,
    build_conversation_tool_registry,
)
from app.models import ParsedProduct


def context(**metadata):
    return RunContext(
        user_id="user-1",
        request_id="req-1",
        metadata=metadata,
    )


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
