from unittest.mock import Mock

import pytest
from openai.lib._pydantic import to_strict_json_schema
from pydantic import ValidationError

from app.models import AIAssetRecognition, AnalyzeRequest, AssetSpec
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
