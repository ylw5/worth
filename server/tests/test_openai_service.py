from unittest.mock import Mock

from openai.lib._pydantic import to_strict_json_schema

from app.models import AIAssetRecognition, AssetSpec
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

    result = service.analyze("https://example.com/image.jpg", "user")

    assert service.client.responses.parse.call_args.kwargs["text_format"] is AIAssetRecognition
    assert result.specs == {"颜色": "银色"}
