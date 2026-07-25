from __future__ import annotations

import json
from typing import Any

from openai import OpenAIError

from ..errors import (
    AIConfigurationError,
    AIFoundationError,
    InvalidToolArgumentsError,
    ProviderProtocolError,
    ProviderUnavailableError,
)


def read_value(value: Any, name: str, default: Any = None) -> Any:
    if isinstance(value, dict):
        return value.get(name, default)
    return getattr(value, name, default)


def parse_tool_arguments(
    value: str | dict[str, Any] | None,
    *,
    tool_name: str,
    provider: str,
) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(value or "{}")
    except (TypeError, json.JSONDecodeError) as error:
        raise InvalidToolArgumentsError(
            f"Provider returned invalid JSON arguments for tool '{tool_name}'",
            provider=provider,
        ) from error
    if not isinstance(parsed, dict):
        raise InvalidToolArgumentsError(
            f"Provider returned non-object arguments for tool '{tool_name}'",
            provider=provider,
        )
    return parsed


def map_openai_error(
    error: OpenAIError,
    *,
    provider: str,
    operation: str,
) -> AIFoundationError:
    status_code = getattr(error, "status_code", None)
    details = (
        {"status_code": status_code}
        if isinstance(status_code, int)
        else {}
    )
    if (
        isinstance(status_code, int)
        and 400 <= status_code < 500
        and status_code not in {408, 409, 429}
    ):
        if status_code in {401, 403, 404}:
            return AIConfigurationError(
                f"{operation} provider configuration was rejected",
                provider=provider,
                details=details,
            )
        return ProviderProtocolError(
            f"{operation} request was rejected by the provider",
            provider=provider,
            details=details,
        )
    return ProviderUnavailableError(
        f"{operation} provider is temporarily unavailable",
        provider=provider,
        details=details,
    )
