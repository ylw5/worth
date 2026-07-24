from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from openai import OpenAI

from ..config import Settings
from .contracts import ModelCapability
from .errors import AIConfigurationError
from .providers import (
    ChatCompletionsProvider,
    OpenAIResponsesProvider,
)
from .router import ModelProfile, ModelRouter
from .runner import AgentRunner
from .tools import PURCHASE_TOOL_NAMES, ToolRegistry
from .tools.purchase import build_purchase_tool_registry
from .workflows import PurchaseEvaluationWorkflow

if TYPE_CHECKING:
    from supabase import Client as SupabaseClient

    from ..market import MarketClient


@dataclass(frozen=True, slots=True)
class PurchaseWorkflowBundle:
    workflow: PurchaseEvaluationWorkflow
    registry: ToolRegistry


def _build_purchase_router(settings: Settings) -> ModelRouter:
    router = ModelRouter()
    capabilities = {
        ModelCapability.TEXT,
        ModelCapability.TOOLS,
        ModelCapability.STREAMING,
    }

    if settings.deepseek_api_key:
        client = OpenAI(
            api_key=settings.deepseek_api_key,
            base_url=settings.deepseek_base_url.rstrip("/"),
            timeout=30.0,
            max_retries=1,
        )
        provider = ChatCompletionsProvider(
            client,
            name="deepseek",
            extra_body={"thinking": {"type": "disabled"}},
            strict_tools=False,
            max_tokens_parameter="max_tokens",
        )
        router.register_provider(provider)
        router.register_profile(
            ModelProfile(
                name="purchase-review-deepseek",
                provider=provider.name,
                model=settings.deepseek_model,
                capabilities=capabilities,
                tasks={"purchase_review"},
                priority=100,
            )
        )

    if settings.ai_gateway_api_key:
        client = OpenAI(
            api_key=settings.ai_gateway_api_key,
            base_url=settings.ai_gateway_base_url.rstrip("/"),
            timeout=30.0,
            max_retries=1,
        )
        provider = OpenAIResponsesProvider(
            client,
            name="ai_gateway",
        )
        router.register_provider(provider)
        router.register_profile(
            ModelProfile(
                name="purchase-review-gateway",
                provider=provider.name,
                model=settings.openai_model,
                capabilities=capabilities,
                tasks={"purchase_review"},
                priority=90,
            )
        )

    if not settings.deepseek_api_key and not settings.ai_gateway_api_key:
        raise AIConfigurationError(
            "No AI provider is configured for purchase evaluation"
        )
    return router


def build_purchase_evaluation_workflow(
    settings: Settings,
    *,
    supabase_client: SupabaseClient,
    market_client: MarketClient | None,
) -> PurchaseWorkflowBundle:
    registry = build_purchase_tool_registry(
        supabase_client,
        market_client,
    )
    definitions = registry.definitions(PURCHASE_TOOL_NAMES)
    runner = AgentRunner(
        _build_purchase_router(settings),
        tool_executor=registry.executor(PURCHASE_TOOL_NAMES),
        max_tool_steps=3,
        max_repeated_call=2,
        max_tool_output_chars=32_000,
    )
    return PurchaseWorkflowBundle(
        workflow=PurchaseEvaluationWorkflow(
            runner,
            tools=definitions,
        ),
        registry=registry,
    )
