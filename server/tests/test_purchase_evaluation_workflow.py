from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.ai.contracts import (
    AgentRunResult,
    AgentStreamEvent,
    ModelCapability,
    ModelRequirements,
    ToolDefinition,
)
from app.ai.errors import AIConfigurationError, OutputPolicyError
from app.ai.factory import _build_purchase_router
from app.ai.workflows.purchase_evaluation import (
    PURCHASE_EVALUATION_SYSTEM_PROMPT,
    PurchaseEvaluationWorkflow,
)
from app.config import Settings
from app.models import (
    EvaluationAsset,
    EvaluationChatMessage,
    EvaluationFacts,
    ParsedProduct,
)


def tool(name: str) -> ToolDefinition:
    return ToolDefinition(
        name=name,
        description=f"{name} description",
        parameters={"type": "object"},
    )


def tools() -> list[ToolDefinition]:
    return [tool(name) for name in PurchaseEvaluationWorkflow.tool_names]


def product() -> ParsedProduct:
    return ParsedProduct(
        title="New phone",
        price=5000,
        category="数码",
        subcategory="手机",
        source_type="text",
        source_text="I want a new phone",
    )


def assets() -> list[EvaluationAsset]:
    return [
        EvaluationAsset(
            id="asset-1",
            name="Old phone",
            category="数码",
            subcategory="手机",
            status="in_use",
        )
    ]


def facts() -> EvaluationFacts:
    return EvaluationFacts(
        total=1,
        in_use=1,
        idle=0,
        listed=0,
        sold=0,
    )


def messages() -> list[EvaluationChatMessage]:
    return [
        EvaluationChatMessage(
            role="user",
            content="主要想改善拍照。",
        )
    ]


def test_workflow_builds_fact_only_request_and_exact_allowlist() -> None:
    runner = MagicMock()
    workflow = PurchaseEvaluationWorkflow(runner, tools=tools())

    request = workflow.build_request(
        product(),
        assets(),
        facts(),
        messages(),
    )

    assert request.requirements.task == "purchase_review"
    assert request.requirements.capabilities == {
        ModelCapability.TEXT,
        ModelCapability.TOOLS,
    }
    assert [item.name for item in request.tools] == list(
        PurchaseEvaluationWorkflow.tool_names
    )
    assert request.store is False
    assert "不得输出“建议买/不买”" in request.messages[0].content
    assert "legacy_ai_decision" in request.messages[0].content
    assert "confirmed_matched_assets" in request.messages[1].content


def test_workflow_passes_identity_only_through_run_context() -> None:
    runner = MagicMock()
    runner.run.return_value = AgentRunResult(
        text="facts",
        provider="provider",
        model="model",
        profile="profile",
        steps=1,
    )
    workflow = PurchaseEvaluationWorkflow(runner, tools=tools())

    result = workflow.run(
        product(),
        assets(),
        facts(),
        messages(),
        user_id="user-1",
        request_id="request-1",
    )

    assert result.text == "facts"
    run_request, context = runner.run.call_args.args
    assert context.user_id == "user-1"
    assert context.request_id == "request-1"
    for definition in run_request.tools:
        assert "user_id" not in definition.parameters["properties"]


def test_workflow_rejects_decision_output() -> None:
    runner = MagicMock()
    runner.run.return_value = AgentRunResult(
        text="综合来看，建议你买。",
        provider="provider",
        model="model",
        profile="profile",
        steps=1,
    )
    workflow = PurchaseEvaluationWorkflow(runner, tools=tools())

    with pytest.raises(OutputPolicyError):
        workflow.run(
            product(),
            assets(),
            facts(),
            messages(),
            user_id="user-1",
            request_id="request-1",
        )


def test_stream_policy_blocks_decision_split_across_deltas() -> None:
    runner = MagicMock()
    runner.stream.return_value = iter(
        [
            AgentStreamEvent(type="text_delta", delta="综合来看，建议"),
            AgentStreamEvent(type="text_delta", delta="你买。"),
        ]
    )
    workflow = PurchaseEvaluationWorkflow(runner, tools=tools())

    with pytest.raises(OutputPolicyError):
        list(
            workflow.stream(
                product(),
                assets(),
                facts(),
                messages(),
                user_id="user-1",
                request_id="request-1",
            )
        )


def test_stream_policy_releases_safe_buffer_before_completion() -> None:
    safe_text = "这是已确认事实。" * 10
    runner = MagicMock()
    runner.stream.return_value = iter(
        [
            AgentStreamEvent(type="text_delta", delta=safe_text),
            AgentStreamEvent(
                type="run_completed",
                result=AgentRunResult(
                    text=safe_text,
                    provider="provider",
                    model="model",
                    profile="profile",
                    steps=1,
                ),
            ),
        ]
    )
    workflow = PurchaseEvaluationWorkflow(runner, tools=tools())

    events = list(
        workflow.stream(
            product(),
            assets(),
            facts(),
            messages(),
            user_id="user-1",
            request_id="request-1",
        )
    )

    assert "".join(
        event.delta for event in events if event.type == "text_delta"
    ) == safe_text
    assert events[-1].type == "run_completed"


def test_workflow_rejects_allowlist_drift() -> None:
    with pytest.raises(ValueError, match="allowlist"):
        PurchaseEvaluationWorkflow(MagicMock(), tools=tools()[:-1])


def test_system_prompt_freezes_neutral_product_position() -> None:
    assert "不是购买决策者" in PURCHASE_EVALUATION_SYSTEM_PROMPT
    assert "不得输出“建议买/不买”" in PURCHASE_EVALUATION_SYSTEM_PROMPT
    assert "每轮最多一个问题" in PURCHASE_EVALUATION_SYSTEM_PROMPT
    assert "不是完整实时行情" in PURCHASE_EVALUATION_SYSTEM_PROMPT


def test_router_preserves_deepseek_priority(monkeypatch) -> None:
    monkeypatch.setattr("app.ai.factory.OpenAI", MagicMock)
    router = _build_purchase_router(
        Settings(
            deepseek_api_key="deepseek-key",
            ai_gateway_api_key="gateway-key",
        )
    )

    routed = router.resolve(
        ModelRequirements(
            task="purchase_review",
            capabilities={
                ModelCapability.TEXT,
                ModelCapability.TOOLS,
            },
        )
    )

    assert routed.profile.name == "purchase-review-deepseek"


def test_router_uses_gateway_when_deepseek_is_not_configured(
    monkeypatch,
) -> None:
    monkeypatch.setattr("app.ai.factory.OpenAI", MagicMock)
    router = _build_purchase_router(
        Settings(
            deepseek_api_key="",
            ai_gateway_api_key="gateway-key",
        )
    )

    routed = router.resolve(
        ModelRequirements(
            task="purchase_review",
            capabilities={
                ModelCapability.TEXT,
                ModelCapability.TOOLS,
            },
        )
    )

    assert routed.profile.name == "purchase-review-gateway"


def test_router_requires_at_least_one_provider() -> None:
    with pytest.raises(AIConfigurationError):
        _build_purchase_router(
            Settings(
                deepseek_api_key="",
                ai_gateway_api_key="",
            )
        )
