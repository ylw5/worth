from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict, Field

from .contracts import (
    ModelCapability,
    ModelRequirements,
    ProviderAdapter,
)
from .errors import (
    AIConfigurationError,
    ModelCapabilityError,
    ModelRouteNotFoundError,
)


class ModelProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    provider: str = Field(min_length=1)
    model: str = Field(min_length=1)
    capabilities: set[ModelCapability] = Field(min_length=1)
    tasks: set[str] = Field(default_factory=set)
    priority: int = 0
    enabled: bool = True


@dataclass(frozen=True, slots=True)
class RoutedModel:
    profile: ModelProfile
    provider: ProviderAdapter


class ModelRouter:
    def __init__(self) -> None:
        self._providers: dict[str, ProviderAdapter] = {}
        self._profiles: dict[str, ModelProfile] = {}

    def register_provider(self, provider: ProviderAdapter) -> None:
        if provider.name in self._providers:
            raise AIConfigurationError(
                f"Provider '{provider.name}' is already registered"
            )
        self._providers[provider.name] = provider

    def register_profile(self, profile: ModelProfile) -> None:
        if profile.name in self._profiles:
            raise AIConfigurationError(
                f"Model profile '{profile.name}' is already registered"
            )
        if profile.provider not in self._providers:
            raise AIConfigurationError(
                f"Provider '{profile.provider}' is not registered"
            )
        self._profiles[profile.name] = profile

    def resolve(self, requirements: ModelRequirements) -> RoutedModel:
        if requirements.preferred_profile:
            profile = self._profiles.get(requirements.preferred_profile)
            if profile is None or not profile.enabled:
                raise ModelRouteNotFoundError(
                    "Preferred model profile is unavailable",
                    details={"profile": requirements.preferred_profile},
                )
            missing = requirements.capabilities - profile.capabilities
            if missing:
                raise ModelCapabilityError(
                    "Preferred model profile lacks required capabilities",
                    provider=profile.provider,
                    details={
                        "profile": profile.name,
                        "missing": sorted(item.value for item in missing),
                    },
                )
            if (
                requirements.preferred_provider
                and profile.provider != requirements.preferred_provider
            ):
                raise ModelCapabilityError(
                    "Preferred profile does not use the preferred provider",
                    provider=profile.provider,
                )
            if (
                requirements.task
                and profile.tasks
                and requirements.task not in profile.tasks
            ):
                raise ModelCapabilityError(
                    "Preferred model profile does not support the task",
                    provider=profile.provider,
                    details={
                        "profile": profile.name,
                        "task": requirements.task,
                    },
                )
            return RoutedModel(
                profile=profile,
                provider=self._providers[profile.provider],
            )

        candidates = [
            profile
            for profile in self._profiles.values()
            if profile.enabled
            and requirements.capabilities <= profile.capabilities
            and (
                not requirements.task
                or not profile.tasks
                or requirements.task in profile.tasks
            )
            and (
                not requirements.preferred_provider
                or profile.provider == requirements.preferred_provider
            )
        ]
        if not candidates:
            raise ModelRouteNotFoundError(
                "No configured model satisfies the requested route",
                details={
                    "capabilities": sorted(
                        item.value for item in requirements.capabilities
                    ),
                    "task": requirements.task,
                    "provider": requirements.preferred_provider,
                },
            )
        profile = sorted(
            candidates,
            key=lambda item: (-item.priority, item.name),
        )[0]
        return RoutedModel(
            profile=profile,
            provider=self._providers[profile.provider],
        )
