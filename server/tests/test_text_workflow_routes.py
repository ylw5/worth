from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from app.auth import AuthenticatedUser
from app.main import (
    analyze,
    analyze_product_images,
    chat_freely,
    estimate,
    normalize_product_text,
    parse_product,
)
from app.models import (
    AIProductClassification,
    AIProductInterpretation,
    AgentChatRequest,
    AnalyzeRequest,
    AssetInput,
    AssetRecognition,
    EvaluationChatMessage,
    MarketCandidate,
    ParsedProduct,
    ProductImagesRequest,
    ProductParseRequest,
    ProductTextRequest,
)


def user() -> AuthenticatedUser:
    return AuthenticatedUser(id="user-1", access_token="token")


def asset() -> AssetInput:
    return AssetInput(
        name="Sony headphones",
        brand="Sony",
        model="WH-1000XM6",
        category="数码",
        subcategory="耳机",
        condition="轻微使用痕迹",
        search_query="Sony WH-1000XM6",
    )


def test_estimate_route_uses_candidate_workflow(monkeypatch) -> None:
    candidate_workflow = MagicMock()
    candidate_workflow.matching_ids.return_value = {"item-1"}
    market = MagicMock()
    market.search.return_value = [
        MarketCandidate(
            item_id="item-1",
            title="Sony XM6",
            price=2000,
        )
    ]
    monkeypatch.setattr("app.main.MarketClient", lambda cookie: market)
    monkeypatch.setattr(
        "app.main.build_text_workflows",
        lambda settings: SimpleNamespace(
            candidate_matching=candidate_workflow
        ),
    )

    result = estimate(asset(), user())

    assert result.sample_count == 1
    candidate_workflow.matching_ids.assert_called_once()
    assert candidate_workflow.matching_ids.call_args.kwargs[
        "user_id"
    ] == "user-1"


def test_parse_product_route_uses_classification_workflow(
    monkeypatch,
) -> None:
    workflow = MagicMock()
    workflow.classify.return_value = AIProductClassification(
        normalized_title="Sony WH-1000XM6",
        category="数码",
        subcategory="耳机",
    )
    monkeypatch.setattr(
        "app.main.fetch_product_page",
        lambda url: SimpleNamespace(
            url=url,
            title="Sony XM6 listing",
            price=2999,
        ),
    )
    monkeypatch.setattr(
        "app.main.build_text_workflows",
        lambda settings: SimpleNamespace(
            product_classification=workflow
        ),
    )

    result = parse_product(
        ProductParseRequest(url="https://example.com/item"),
        user(),
    )

    assert result.title == "Sony WH-1000XM6"
    assert result.subcategory == "耳机"


def test_normalize_text_route_uses_interpretation_workflow(
    monkeypatch,
) -> None:
    workflow = MagicMock()
    workflow.interpret.return_value = AIProductInterpretation(
        intent="chat",
        normalized_title="",
        category="其他",
        subcategory="",
        reply="你好，可以描述想评估的商品。",
    )
    monkeypatch.setattr(
        "app.main.build_text_workflows",
        lambda settings: SimpleNamespace(
            product_interpretation=workflow
        ),
    )

    result = normalize_product_text(
        ProductTextRequest(text="你好"),
        user(),
    )

    assert result.intent == "chat"
    assert result.reply.startswith("你好")


def test_general_chat_route_uses_workflow_and_memory(monkeypatch) -> None:
    workflow = MagicMock()
    workflow.chat.return_value = "听起来你今天挺累的。"
    memory = {"本月评估次数": 2}
    monkeypatch.setattr(
        "app.main.get_user_supabase",
        lambda token: MagicMock(),
    )
    monkeypatch.setattr(
        "app.main.load_history_context",
        lambda client, user_id: memory,
    )
    monkeypatch.setattr(
        "app.main.build_text_workflows",
        lambda settings: SimpleNamespace(general_chat=workflow),
    )

    result = chat_freely(
        AgentChatRequest(
            messages=[
                EvaluationChatMessage(
                    role="user",
                    content="今天好累",
                )
            ]
        ),
        user(),
    )

    assert result.message == "听起来你今天挺累的。"
    assert workflow.chat.call_args.args[1] == memory


def test_analyze_route_uses_asset_recognition_workflow(monkeypatch) -> None:
    workflow = MagicMock()
    workflow.recognize.return_value = AssetRecognition(
        name="相机",
        brand="富士",
        model="X100VI",
        category="数码",
        subcategory="相机",
        condition="轻微使用痕迹",
        search_query="富士 X100VI",
    )
    monkeypatch.setattr(
        "app.main.build_vision_workflows",
        lambda settings: SimpleNamespace(asset_recognition=workflow),
    )

    result = analyze(
        AnalyzeRequest(
            image_urls=["https://example.com/front.jpg"],
            current_asset=asset(),
        ),
        user(),
    )

    assert result.model == "X100VI"
    assert workflow.recognize.call_args.kwargs["user_id"] == "user-1"
    assert workflow.recognize.call_args.kwargs["current_asset"] == asset()


def test_analyze_product_images_route_uses_vision_workflow(
    monkeypatch,
) -> None:
    workflow = MagicMock()
    workflow.recognize.return_value = ParsedProduct(
        title="Sony WH-1000XM6",
        price=2999,
        category="数码",
        subcategory="耳机",
        source_type="image",
    )
    monkeypatch.setattr(
        "app.main.build_vision_workflows",
        lambda settings: SimpleNamespace(
            product_image_recognition=workflow
        ),
    )

    result = analyze_product_images(
        ProductImagesRequest(
            image_urls=["https://example.com/product.jpg"]
        ),
        user(),
    )

    assert result.source_type == "image"
    assert workflow.recognize.call_args.kwargs["user_id"] == "user-1"
