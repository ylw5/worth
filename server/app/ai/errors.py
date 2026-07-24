from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class AIErrorCode(str, Enum):
    CONFIGURATION = "ai_configuration_error"
    ROUTE_NOT_FOUND = "ai_route_not_found"
    CAPABILITY_MISMATCH = "ai_capability_mismatch"
    PROVIDER_UNAVAILABLE = "ai_provider_unavailable"
    PROVIDER_PROTOCOL = "ai_provider_protocol_error"
    PROVIDER_INCOMPLETE = "ai_provider_incomplete"
    OUTPUT_POLICY = "ai_output_policy_violation"
    INVALID_TOOL_ARGUMENTS = "ai_invalid_tool_arguments"
    TOOL_NOT_ALLOWED = "ai_tool_not_allowed"
    TOOL_EXECUTION = "ai_tool_execution_error"
    TOOL_OUTPUT_TOO_LARGE = "ai_tool_output_too_large"
    TOOL_LOOP_LIMIT = "ai_tool_loop_limit"
    TOOL_LOOP_REPEATED = "ai_tool_loop_repeated"


class AIErrorDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: AIErrorCode
    message: str
    retryable: bool = False
    provider: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class AIFoundationError(RuntimeError):
    code = AIErrorCode.CONFIGURATION
    retryable = False

    def __init__(
        self,
        message: str,
        *,
        provider: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.provider = provider
        self.details = details or {}

    def as_detail(self) -> AIErrorDetail:
        return AIErrorDetail(
            code=self.code,
            message=str(self),
            retryable=self.retryable,
            provider=self.provider,
            details=self.details,
        )


class AIConfigurationError(AIFoundationError):
    code = AIErrorCode.CONFIGURATION


class ModelRouteNotFoundError(AIFoundationError):
    code = AIErrorCode.ROUTE_NOT_FOUND


class ModelCapabilityError(AIFoundationError):
    code = AIErrorCode.CAPABILITY_MISMATCH


class ProviderUnavailableError(AIFoundationError):
    code = AIErrorCode.PROVIDER_UNAVAILABLE
    retryable = True


class ProviderProtocolError(AIFoundationError):
    code = AIErrorCode.PROVIDER_PROTOCOL


class ProviderIncompleteError(AIFoundationError):
    code = AIErrorCode.PROVIDER_INCOMPLETE


class OutputPolicyError(AIFoundationError):
    code = AIErrorCode.OUTPUT_POLICY


class InvalidToolArgumentsError(AIFoundationError):
    code = AIErrorCode.INVALID_TOOL_ARGUMENTS


class ToolNotAllowedError(AIFoundationError):
    code = AIErrorCode.TOOL_NOT_ALLOWED


class ToolExecutionError(AIFoundationError):
    code = AIErrorCode.TOOL_EXECUTION
    retryable = True


class ToolOutputTooLargeError(AIFoundationError):
    code = AIErrorCode.TOOL_OUTPUT_TOO_LARGE


class ToolLoopLimitError(AIFoundationError):
    code = AIErrorCode.TOOL_LOOP_LIMIT


class RepeatedToolCallError(AIFoundationError):
    code = AIErrorCode.TOOL_LOOP_REPEATED
