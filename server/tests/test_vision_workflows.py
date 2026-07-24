from __future__ import annotations

from collections import deque
from unittest.mock import MagicMock

import pytest

from app.ai.contracts import (
    AgentRunRequest,
    AgentRunResult,
    ImageContentPart,
    ModelCapability,
    ModelRequirements,
    RunContext,
    TextContentPart,
)
from app.ai.errors import AIConfigurationError
from app.ai.factory import _build_vision_router
from app.ai.workflows.vision import (
    AssetRecognitionWorkflow,
    ProductImageRecognitionWorkflow,
)
from app.config import Settings
from app.models import AssetInput


class SequenceRunner:
    def __init__(self, texts: list[str]) -> None:
        self._texts = deque(texts)
        self.requests: list[AgentRunRequest] = []
        self.contexts: list[RunContext] = []

    def run(
        self,
        request: AgentRunRequest,
        context: RunContext,
    ) -> AgentRunResult:
        self.requests.append(request)
        self.contexts.append(context)
        return AgentRunResult(
            text=self._texts.popleft(),
            provider="provider",
            model="model",
            profile="profile",
            steps=1,
        )


ASSET_JSON = (
    '{"name":"相机","brand":"富士","model":"X100VI",'
    '"specs":[{"name":"颜色","value":"银色"}],'
    '"category":"数码","subcategory":"相机",'
    '"condition":"轻微使用痕迹",'
    '"search_query":"富士 X100VI 银色"}'
)


def current_asset() -> AssetInput:
    return AssetInput(
        name="相机",
        brand="富士",
        category="数码",
        subcategory="相机",
        condition="无法判断",
        search_query="富士相机",
    )


def test_asset_recognition_uses_multimodal_structured_contract() -> None:
    runner = SequenceRunner([ASSET_JSON])

    result = AssetRecognitionWorkflow(runner).recognize(
        [
            "https://example.com/front.jpg",
            "https://example.com/label.jpg",
        ],
        user_id="user-1",
        request_id="request-1",
    )

    assert result.specs == {"颜色": "银色"}
    request = runner.requests[0]
    assert request.structured_output is not None
    assert request.structured_output.name == "asset_recognition"
    assert request.requirements.capabilities == {
        ModelCapability.TEXT,
        ModelCapability.VISION,
        ModelCapability.STRUCTURED_OUTPUT,
        ModelCapability.REASONING,
    }
    assert request.reasoning_effort == "low"
    user_content = request.messages[1].content
    assert isinstance(user_content, list)
    assert isinstance(user_content[0], TextContentPart)
    images = [
        part for part in user_content if isinstance(part, ImageContentPart)
    ]
    assert [part.image_url for part in images] == [
        "https://example.com/front.jpg",
        "https://example.com/label.jpg",
    ]


def test_asset_recognition_keeps_current_asset_as_data() -> None:
    runner = SequenceRunner([ASSET_JSON])

    AssetRecognitionWorkflow(runner).recognize(
        ["https://example.com/back.jpg"],
        current_asset=current_asset(),
        user_id="user-1",
        request_id="request-1",
    )

    user_content = runner.requests[0].messages[1].content
    assert isinstance(user_content, list)
    assert isinstance(user_content[0], TextContentPart)
    assert '"current_asset":{"name":"相机"' in user_content[0].text
    assert "照片没有提供新证据的字段保留当前值" in user_content[0].text


def test_asset_recognition_retries_duplicate_specs() -> None:
    duplicate_specs = ASSET_JSON.replace(
        '{"name":"颜色","value":"银色"}',
        (
            '{"name":"颜色","value":"银色"},'
            '{"name":"颜色","value":"黑色"}'
        ),
    )
    runner = SequenceRunner([duplicate_specs, ASSET_JSON])

    result = AssetRecognitionWorkflow(runner).recognize(
        ["https://example.com/front.jpg"],
        user_id="user-1",
        request_id="request-1",
    )

    assert result.specs == {"颜色": "银色"}
    assert len(runner.requests) == 2
    assert "上一次输出未通过" in runner.requests[1].messages[-1].content


def test_product_image_recognition_preserves_public_shape() -> None:
    runner = SequenceRunner(
        [
            (
                '{"title":"Sony WH-1000XM6","price":2999,'
                '"category":"数码","subcategory":"耳机"}'
            )
        ]
    )

    result = ProductImageRecognitionWorkflow(runner).recognize(
        ["https://example.com/product.jpg"],
        user_id="user-1",
        request_id="request-1",
    )

    assert result.title == "Sony WH-1000XM6"
    assert result.source_type == "image"
    assert result.source_text == ""
    assert runner.requests[0].structured_output is not None
    assert (
        runner.requests[0].structured_output.name
        == "product_image_recognition"
    )


def test_vision_router_uses_gateway_profile(monkeypatch) -> None:
    monkeypatch.setattr("app.ai.factory.OpenAI", MagicMock)
    router = _build_vision_router(
        Settings(ai_gateway_api_key="gateway-key")
    )

    routed = router.resolve(
        ModelRequirements(
            task="asset_recognition",
            capabilities={
                ModelCapability.TEXT,
                ModelCapability.VISION,
                ModelCapability.STRUCTURED_OUTPUT,
                ModelCapability.REASONING,
            },
        )
    )

    assert routed.profile.name == "vision-workflows-gateway"
    assert routed.provider.name == "ai_gateway"


def test_vision_router_rejects_deepseek_only_configuration() -> None:
    with pytest.raises(AIConfigurationError):
        _build_vision_router(
            Settings(
                deepseek_api_key="deepseek-key",
                ai_gateway_api_key="",
            )
        )
