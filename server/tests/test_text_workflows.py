from __future__ import annotations

from collections import deque
from unittest.mock import MagicMock

import pytest

from app.ai.contracts import (
    AgentRunRequest,
    AgentRunResult,
    ModelCapability,
    ModelRequirements,
    RunContext,
)
from app.ai.errors import OutputPolicyError, StructuredOutputError
from app.ai.factory import _build_text_router
from app.ai.workflows.text import (
    CandidateMatchingWorkflow,
    GeneralChatWorkflow,
    ProductClassificationWorkflow,
    ProductInterpretationWorkflow,
)
from app.config import Settings
from app.models import (
    AssetInput,
    EvaluationChatMessage,
    MarketCandidate,
)


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


def candidates() -> list[MarketCandidate]:
    return [
        MarketCandidate(item_id="1", title="Sony XM6", price=2000),
        MarketCandidate(item_id="2", title="Sony case", price=100),
    ]


def test_product_classification_uses_structured_contract() -> None:
    runner = SequenceRunner(
        [
            (
                '{"normalized_title":"Sony WH-1000XM6",'
                '"category":"数码","subcategory":"耳机"}'
            )
        ]
    )

    result = ProductClassificationWorkflow(runner).classify(
        "Sony XM6",
        user_id="user-1",
        request_id="request-1",
    )

    assert result.subcategory == "耳机"
    request = runner.requests[0]
    assert request.structured_output is not None
    assert request.structured_output.name == "product_classification"
    assert request.requirements.capabilities == {
        ModelCapability.TEXT,
        ModelCapability.STRUCTURED_OUTPUT,
    }
    assert runner.contexts[0].user_id == "user-1"


def test_structured_workflow_retries_application_validation() -> None:
    runner = SequenceRunner(
        [
            '{"normalized_title":"","category":"数码","subcategory":""}',
            (
                '{"normalized_title":"Phone","category":"数码",'
                '"subcategory":"手机"}'
            ),
        ]
    )

    result = ProductClassificationWorkflow(runner).classify(
        "Phone",
        user_id="user-1",
        request_id="request-1",
    )

    assert result.normalized_title == "Phone"
    assert len(runner.requests) == 2
    assert "上一次输出未通过" in runner.requests[1].messages[-1].content


def test_structured_workflow_fails_after_bounded_retries() -> None:
    runner = SequenceRunner(["{}", "{}"])

    with pytest.raises(StructuredOutputError) as caught:
        ProductClassificationWorkflow(runner).classify(
            "Phone",
            user_id="user-1",
            request_id="request-1",
        )

    assert caught.value.details["attempts"] == 2


def test_product_interpretation_validates_chat_shape() -> None:
    runner = SequenceRunner(
        [
            (
                '{"intent":"chat","normalized_title":"","category":"其他",'
                '"subcategory":"","reply":"你好，可以描述想评估的商品。"}'
            )
        ]
    )

    result = ProductInterpretationWorkflow(runner).interpret(
        "你好",
        user_id="user-1",
        request_id="request-1",
    )

    assert result.intent == "chat"
    assert result.reply


def test_product_interpretation_rejects_purchase_decision_reply() -> None:
    runner = SequenceRunner(
        [
            (
                '{"intent":"chat","normalized_title":"","category":"其他",'
                '"subcategory":"","reply":"建议你买。"}'
            )
        ]
    )

    with pytest.raises(OutputPolicyError):
        ProductInterpretationWorkflow(runner).interpret(
            "要不要买",
            user_id="user-1",
            request_id="request-1",
        )


def test_candidate_matching_filters_unknown_ids() -> None:
    runner = SequenceRunner(
        [
            (
                '{"decisions":['
                '{"item_id":"1","same_product":true},'
                '{"item_id":"2","same_product":false},'
                '{"item_id":"invented","same_product":true}'
                "]}"
            )
        ]
    )

    matching = CandidateMatchingWorkflow(runner).matching_ids(
        asset(),
        candidates(),
        user_id="user-1",
        request_id="request-1",
    )

    assert matching == {"1"}


def test_candidate_matching_skips_model_for_empty_candidates() -> None:
    runner = SequenceRunner([])

    matching = CandidateMatchingWorkflow(runner).matching_ids(
        asset(),
        [],
        user_id="user-1",
        request_id="request-1",
    )

    assert matching == set()
    assert runner.requests == []


def test_general_chat_keeps_memory_as_data() -> None:
    runner = SequenceRunner(["听起来你今天挺累的。发生什么了？"])

    result = GeneralChatWorkflow(runner).chat(
        [EvaluationChatMessage(role="user", content="今天好累")],
        {"本月评估次数": 2},
        user_id="user-1",
        request_id="request-1",
    )

    assert "挺累" in result
    request = runner.requests[0]
    assert "仅作为数据" in request.messages[1].content
    assert request.requirements.task == "general_chat"


def test_general_chat_rejects_purchase_decision() -> None:
    runner = SequenceRunner(["综合来看，建议你买。"])

    with pytest.raises(OutputPolicyError):
        GeneralChatWorkflow(runner).chat(
            [EvaluationChatMessage(role="user", content="要不要买？")],
            {},
            user_id="user-1",
            request_id="request-1",
        )


def test_text_router_preserves_deepseek_priority_and_json_mode(
    monkeypatch,
) -> None:
    monkeypatch.setattr("app.ai.factory.OpenAI", MagicMock)
    router = _build_text_router(
        Settings(
            deepseek_api_key="deepseek-key",
            ai_gateway_api_key="gateway-key",
        )
    )

    routed = router.resolve(
        ModelRequirements(
            task="product_classification",
            capabilities={
                ModelCapability.TEXT,
                ModelCapability.STRUCTURED_OUTPUT,
            },
        )
    )

    assert routed.profile.name == "text-workflows-deepseek"
    assert routed.provider.structured_output_mode == "json_object"
