from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from openai.lib._pydantic import to_strict_json_schema
from pydantic import ValidationError

from app.auth import require_user
from app.main import app
from app.models import (
    AIAssetRecognition,
    AnalyzeRequest,
    AssetRecognition,
    AssetSpec,
)
from app.openai_service import OpenAIService


def test_analyze_uses_strict_specs_and_preserves_public_shape() -> None:
    schema = to_strict_json_schema(AIAssetRecognition)
    spec_schema = schema["$defs"]["AssetSpec"]

    assert schema["required"] == list(schema["properties"])
    assert schema["additionalProperties"] is False
    assert spec_schema["required"] == ["name", "value"]
    assert spec_schema["additionalProperties"] is False

    parsed = AIAssetRecognition(
        name="相机",
        brand="富士",
        model="X100VI",
        specs=[AssetSpec(name="颜色", value="银色")],
        category="数码",
        condition="轻微使用痕迹",
        search_query="富士 X100VI 银色",
    )
    service = object.__new__(OpenAIService)
    service.client = Mock()
    service.client.responses.parse.return_value.output_parsed = parsed
    service.model = "test-model"

    image_urls = [
        "https://example.com/front.jpg",
        "https://example.com/label.jpg",
    ]
    result = service.analyze(image_urls, "user")

    request = service.client.responses.parse.call_args.kwargs
    assert request["text_format"] is AIAssetRecognition
    assert [
        item["image_url"] for item in request["input"][1]["content"][1:]
    ] == image_urls
    assert result.specs == {"颜色": "银色"}


@pytest.mark.parametrize("count", [0, 6])
def test_analyze_request_rejects_invalid_image_count(count: int) -> None:
    with pytest.raises(ValidationError):
        AnalyzeRequest(image_urls=["https://example.com/image.jpg"] * count)


@pytest.mark.parametrize("count", [1, 5])
def test_analyze_request_accepts_one_to_five_images(count: int) -> None:
    request = AnalyzeRequest(
        image_urls=["https://example.com/image.jpg"] * count
    )
    assert len(request.image_urls) == count


def test_condition_rejects_free_text() -> None:
    with pytest.raises(ValidationError):
        AssetRecognition(
            name="相机",
            category="数码",
            condition="有一点旧",
            search_query="相机",
        )


def test_analyze_includes_current_asset_context() -> None:
    parsed = AIAssetRecognition(
        name="相机",
        brand="富士",
        model="X100VI",
        specs=[],
        category="数码",
        condition="轻微使用痕迹",
        search_query="富士 X100VI",
    )
    current = AssetRecognition(
        name="相机",
        category="数码",
        condition="无法判断",
        search_query="相机",
    )
    service = object.__new__(OpenAIService)
    service.client = Mock()
    service.client.responses.parse.return_value.output_parsed = parsed
    service.model = "test-model"

    service.analyze(["https://example.com/back.jpg"], "user", current)

    text = service.client.responses.parse.call_args.kwargs[
        "input"
    ][1]["content"][0]["text"]
    assert '"name": "相机"' in text
    assert "根据这些新增照片补充或修正" in text


def test_cutout_returns_optional_png(monkeypatch) -> None:
    cutout = Mock(return_value="png-base64")
    monkeypatch.setattr("app.main.try_remove_background", cutout)
    monkeypatch.setattr(
        "app.main.get_settings",
        lambda: Mock(supabase_url="https://project.supabase.co"),
    )
    app.dependency_overrides[require_user] = lambda: "user"
    try:
        response = TestClient(app).post(
            "/cutout",
            json={"image_url": "https://project.supabase.co/a.jpg"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"image_base64": "png-base64"}
