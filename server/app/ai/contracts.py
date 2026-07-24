from __future__ import annotations

import copy
import re
from enum import Enum
from typing import Any, Annotated, Iterator, Literal, Protocol, Self, Sequence

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


class ModelCapability(str, Enum):
    TEXT = "text"
    VISION = "vision"
    STRUCTURED_OUTPUT = "structured_output"
    TOOLS = "tools"
    STREAMING = "streaming"
    REASONING = "reasoning"


class TextContentPart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["text"] = "text"
    text: str


class ImageContentPart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["image"] = "image"
    image_url: str
    detail: Literal["auto", "low", "high"] = "auto"


ContentPart = Annotated[
    TextContentPart | ImageContentPart,
    Field(discriminator="type"),
]


class AIMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["system", "developer", "user", "assistant"]
    content: str | list[ContentPart]


def make_strict_json_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Return a strict-function-calling compatible schema copy."""
    result = copy.deepcopy(schema)

    def visit(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                visit(item)
            return
        if not isinstance(node, dict):
            return

        properties = node.get("properties")
        if node.get("type") == "object" or isinstance(properties, dict):
            if not isinstance(properties, dict):
                properties = {}
                node["properties"] = properties
            node["additionalProperties"] = False
            node["required"] = list(properties)
            for child in properties.values():
                visit(child)

        for key in ("$defs", "definitions"):
            definitions = node.get(key)
            if isinstance(definitions, dict):
                for child in definitions.values():
                    visit(child)

        for key in ("items", "additionalProperties", "anyOf", "oneOf", "allOf"):
            value = node.get(key)
            if isinstance(value, (dict, list)):
                visit(value)

    visit(result)
    return result


class ToolDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    description: str = Field(min_length=1)
    parameters: dict[str, Any]
    strict: bool = True

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", value):
            raise ValueError("tool name must match [A-Za-z0-9_-]{1,64}")
        return value

    @field_validator("parameters")
    @classmethod
    def normalize_schema(cls, value: dict[str, Any]) -> dict[str, Any]:
        if value.get("type") != "object":
            raise ValueError("tool parameters root must have type=object")
        return make_strict_json_schema(value)

    @classmethod
    def from_model(
        cls,
        *,
        name: str,
        description: str,
        input_model: type[BaseModel],
    ) -> "ToolDefinition":
        return cls(
            name=name,
            description=description,
            parameters=input_model.model_json_schema(),
        )


class ToolCall(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    call_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    arguments: dict[str, Any]


class ToolResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    call_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    output: str
    is_error: bool = False


class TokenUsage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    total_tokens: int = Field(default=0, ge=0)

    def plus(self, other: "TokenUsage") -> "TokenUsage":
        return TokenUsage(
            input_tokens=self.input_tokens + other.input_tokens,
            output_tokens=self.output_tokens + other.output_tokens,
            total_tokens=self.total_tokens + other.total_tokens,
        )


class ProviderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str = Field(min_length=1)
    messages: list[AIMessage] = Field(min_length=1)
    tools: list[ToolDefinition] = Field(default_factory=list)
    tool_choice: Literal["auto", "none", "required"] = "auto"
    max_output_tokens: int | None = Field(default=None, gt=0)
    temperature: float | None = Field(default=None, ge=0, le=2)
    reasoning_effort: Literal[
        "none", "minimal", "low", "medium", "high", "xhigh", "max"
    ] | None = None
    safety_identifier: str | None = None
    store: bool = False
    parallel_tool_calls: bool = False

    @model_validator(mode="after")
    def validate_tool_configuration(self) -> Self:
        names = [tool.name for tool in self.tools]
        if len(names) != len(set(names)):
            raise ValueError("tool names must be unique")
        if self.tool_choice == "required" and not self.tools:
            raise ValueError("tool_choice='required' requires at least one tool")
        return self


class ProviderResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    response_id: str = ""
    provider: str = Field(min_length=1)
    model: str = Field(min_length=1)
    text: str = ""
    tool_calls: list[ToolCall] = Field(default_factory=list)
    usage: TokenUsage = Field(default_factory=TokenUsage)
    continuation: Any = Field(default=None, exclude=True, repr=False)


class ProviderStreamEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["text_delta", "completed"]
    delta: str = ""
    response: ProviderResponse | None = None

    @model_validator(mode="after")
    def validate_payload(self) -> Self:
        if self.type == "completed" and self.response is None:
            raise ValueError("completed event requires a response")
        if self.type == "text_delta" and self.response is not None:
            raise ValueError("text_delta event cannot contain a response")
        return self


class RunContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: str = Field(min_length=1)
    request_id: str = Field(min_length=1)
    locale: str = "zh-CN"
    metadata: dict[str, Any] = Field(default_factory=dict)


class ModelRequirements(BaseModel):
    model_config = ConfigDict(extra="forbid")

    capabilities: set[ModelCapability] = Field(
        default_factory=lambda: {ModelCapability.TEXT}
    )
    task: str | None = None
    preferred_profile: str | None = None
    preferred_provider: str | None = None


class AgentRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    messages: list[AIMessage] = Field(min_length=1)
    tools: list[ToolDefinition] = Field(default_factory=list)
    requirements: ModelRequirements = Field(default_factory=ModelRequirements)
    tool_choice: Literal["auto", "none", "required"] = "auto"
    max_output_tokens: int | None = Field(default=None, gt=0)
    temperature: float | None = Field(default=None, ge=0, le=2)
    reasoning_effort: Literal[
        "none", "minimal", "low", "medium", "high", "xhigh", "max"
    ] | None = None
    store: bool = False
    parallel_tool_calls: bool = False

    @model_validator(mode="after")
    def validate_tool_configuration(self) -> Self:
        names = [tool.name for tool in self.tools]
        if len(names) != len(set(names)):
            raise ValueError("tool names must be unique")
        if self.tool_choice == "required" and not self.tools:
            raise ValueError("tool_choice='required' requires at least one tool")
        return self


class ToolExecutionRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    step: int
    call: ToolCall
    result: ToolResult


class AgentRunResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str
    provider: str
    model: str
    profile: str
    steps: int
    tool_executions: list[ToolExecutionRecord] = Field(default_factory=list)
    usage: TokenUsage = Field(default_factory=TokenUsage)


class AgentStreamEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal[
        "text_delta",
        "tool_started",
        "tool_completed",
        "run_completed",
    ]
    delta: str = ""
    tool_call: ToolCall | None = None
    tool_result: ToolResult | None = None
    result: AgentRunResult | None = None


class ProviderAdapter(Protocol):
    name: str

    def complete(
        self,
        request: ProviderRequest,
        *,
        continuation: Any = None,
        tool_results: Sequence[ToolResult] = (),
    ) -> ProviderResponse: ...

    def stream(
        self,
        request: ProviderRequest,
        *,
        continuation: Any = None,
        tool_results: Sequence[ToolResult] = (),
    ) -> Iterator[ProviderStreamEvent]: ...


class ToolExecutor(Protocol):
    def execute(self, call: ToolCall, context: RunContext) -> ToolResult: ...
