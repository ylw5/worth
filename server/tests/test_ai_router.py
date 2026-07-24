from typing import Any, Iterator, Sequence

import pytest

from app.ai.contracts import (
    ModelCapability,
    ModelRequirements,
    ProviderRequest,
    ProviderResponse,
    ProviderStreamEvent,
    ToolResult,
)
from app.ai.errors import ModelCapabilityError, ModelRouteNotFoundError
from app.ai.router import ModelProfile, ModelRouter


class StubProvider:
    def __init__(self, name: str) -> None:
        self.name = name

    def complete(
        self,
        request: ProviderRequest,
        *,
        continuation: Any = None,
        tool_results: Sequence[ToolResult] = (),
    ) -> ProviderResponse:
        raise NotImplementedError

    def stream(
        self,
        request: ProviderRequest,
        *,
        continuation: Any = None,
        tool_results: Sequence[ToolResult] = (),
    ) -> Iterator[ProviderStreamEvent]:
        raise NotImplementedError


def build_router() -> ModelRouter:
    router = ModelRouter()
    router.register_provider(StubProvider("gateway"))
    router.register_provider(StubProvider("deepseek"))
    router.register_profile(
        ModelProfile(
            name="vision-primary",
            provider="gateway",
            model="openai/model",
            capabilities={
                ModelCapability.TEXT,
                ModelCapability.VISION,
                ModelCapability.STRUCTURED_OUTPUT,
                ModelCapability.STREAMING,
            },
            tasks={"asset_recognition"},
            priority=100,
        )
    )
    router.register_profile(
        ModelProfile(
            name="text-tools",
            provider="deepseek",
            model="deepseek/model",
            capabilities={
                ModelCapability.TEXT,
                ModelCapability.TOOLS,
                ModelCapability.STREAMING,
            },
            tasks={"purchase_review"},
            priority=50,
        )
    )
    return router


def test_router_selects_by_task_and_capabilities() -> None:
    routed = build_router().resolve(
        ModelRequirements(
            task="purchase_review",
            capabilities={
                ModelCapability.TEXT,
                ModelCapability.TOOLS,
            },
        )
    )

    assert routed.profile.name == "text-tools"
    assert routed.provider.name == "deepseek"


def test_explicit_profile_fails_on_capability_mismatch() -> None:
    with pytest.raises(ModelCapabilityError):
        build_router().resolve(
            ModelRequirements(
                preferred_profile="text-tools",
                capabilities={ModelCapability.VISION},
            )
        )


def test_explicit_profile_fails_on_task_mismatch() -> None:
    with pytest.raises(ModelCapabilityError):
        build_router().resolve(
            ModelRequirements(
                preferred_profile="text-tools",
                task="asset_recognition",
            )
        )


def test_router_fails_when_no_model_matches() -> None:
    with pytest.raises(ModelRouteNotFoundError):
        build_router().resolve(
            ModelRequirements(
                capabilities={
                    ModelCapability.VISION,
                    ModelCapability.TOOLS,
                }
            )
        )
