from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ValidationError

from ..contracts import (
    RunContext,
    ToolCall,
    ToolDefinition,
    ToolResult,
)
from ..errors import (
    AIConfigurationError,
    AIFoundationError,
    InvalidToolArgumentsError,
    ToolExecutionError,
    ToolNotAllowedError,
)


ToolHandler = Callable[[BaseModel, RunContext], Any]


@dataclass(frozen=True, slots=True)
class RegisteredTool:
    definition: ToolDefinition
    input_model: type[BaseModel]
    handler: ToolHandler
    output_model: type[BaseModel] | None = None
    cacheable: bool = True


class ToolRegistry:
    """Registry of provider-neutral, application-owned atomic tools."""

    def __init__(self) -> None:
        self._tools: dict[str, RegisteredTool] = {}

    def register(
        self,
        *,
        name: str,
        description: str,
        input_model: type[BaseModel],
        handler: ToolHandler,
        output_model: type[BaseModel] | None = None,
        cacheable: bool = True,
    ) -> RegisteredTool:
        if name in self._tools:
            raise AIConfigurationError(
                f"Tool '{name}' is already registered",
                details={"tool": name},
            )
        tool = RegisteredTool(
            definition=ToolDefinition.from_model(
                name=name,
                description=description,
                input_model=input_model,
            ),
            input_model=input_model,
            handler=handler,
            output_model=output_model,
            cacheable=cacheable,
        )
        self._tools[name] = tool
        return tool

    def get(self, name: str) -> RegisteredTool:
        try:
            return self._tools[name]
        except KeyError as error:
            raise ToolNotAllowedError(
                f"Tool '{name}' is not registered",
                details={"tool": name},
            ) from error

    def definitions(
        self,
        names: Sequence[str] | None = None,
    ) -> list[ToolDefinition]:
        selected = list(names) if names is not None else list(self._tools)
        return [self.get(name).definition for name in selected]

    def executor(
        self,
        names: Sequence[str] | None = None,
    ) -> "RegistryToolExecutor":
        allowed = set(names) if names is not None else set(self._tools)
        unknown = allowed - self._tools.keys()
        if unknown:
            raise AIConfigurationError(
                "Tool executor allowlist contains unregistered tools",
                details={"tools": sorted(unknown)},
            )
        return RegistryToolExecutor(self, allowed_names=allowed)


class RegistryToolExecutor:
    """Validates and executes registered tools for one agent run."""

    def __init__(
        self,
        registry: ToolRegistry,
        *,
        allowed_names: set[str],
    ) -> None:
        self._registry = registry
        self._allowed_names = frozenset(allowed_names)
        self._cache: dict[str, str] = {}

    @staticmethod
    def _serialize_output(
        value: Any,
        output_model: type[BaseModel] | None,
    ) -> str:
        if output_model is not None:
            if isinstance(value, output_model):
                validated = value
            else:
                validated = output_model.model_validate(value)
            payload = validated.model_dump(mode="json")
        elif isinstance(value, BaseModel):
            payload = value.model_dump(mode="json")
        else:
            payload = value
        return json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
        )

    def execute(self, call: ToolCall, context: RunContext) -> ToolResult:
        if call.name not in self._allowed_names:
            raise ToolNotAllowedError(
                f"Tool '{call.name}' is not allowed in this workflow",
                details={"tool": call.name},
            )
        tool = self._registry.get(call.name)
        try:
            arguments = tool.input_model.model_validate(call.arguments)
        except ValidationError as error:
            raise InvalidToolArgumentsError(
                f"Invalid arguments for tool '{call.name}'",
                details={
                    "tool": call.name,
                    "validation_error_count": error.error_count(),
                },
            ) from error

        cache_key = json.dumps(
            {
                "tool": call.name,
                "user_id": context.user_id,
                "arguments": arguments.model_dump(mode="json"),
            },
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        if tool.cacheable and cache_key in self._cache:
            output = self._cache[cache_key]
        else:
            try:
                raw_output = tool.handler(arguments, context)
                output = self._serialize_output(
                    raw_output,
                    tool.output_model,
                )
            except AIFoundationError:
                raise
            except Exception as error:
                raise ToolExecutionError(
                    f"Tool '{call.name}' failed",
                    details={"tool": call.name},
                ) from error
            if tool.cacheable:
                self._cache[cache_key] = output

        return ToolResult(
            call_id=call.call_id,
            name=call.name,
            output=output,
        )
