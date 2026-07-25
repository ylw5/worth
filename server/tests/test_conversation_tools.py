from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from app.ai.contracts import RunContext
from app.ai.errors import ToolExecutionError
from app.ai.tools.conversation import (
    BindPurchaseEvaluationInput,
    RecognizeProductImagesInput,
    RecognizeProductTextInput,
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
