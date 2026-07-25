import pytest
from pydantic import BaseModel, ValidationError

from app.ai.contracts import (
    AIMessage,
    AgentRunRequest,
    ProviderRequest,
    StructuredOutputDefinition,
    ToolDefinition,
    make_strict_json_schema,
)
from app.ai.errors import AIErrorCode, ProviderUnavailableError


class NestedFilter(BaseModel):
    category: str
    note: str | None = None


class SearchInput(BaseModel):
    query: str
    limit: int = 10
    filters: NestedFilter


class ClassificationOutput(BaseModel):
    label: str
    confidence: float | None = None


def test_tool_definition_builds_recursive_strict_schema() -> None:
    definition = ToolDefinition.from_model(
        name="market_search",
        description="Search market listings",
        input_model=SearchInput,
    )

    assert definition.strict is True
    assert definition.parameters["additionalProperties"] is False
    assert definition.parameters["required"] == [
        "query",
        "limit",
        "filters",
    ]
    nested = definition.parameters["$defs"]["NestedFilter"]
    assert nested["required"] == ["category", "note"]
    assert nested["additionalProperties"] is False


def test_strict_schema_does_not_mutate_the_caller() -> None:
    schema = {
        "type": "object",
        "properties": {"query": {"type": "string"}},
    }

    strict = make_strict_json_schema(schema)

    assert "required" not in schema
    assert strict["required"] == ["query"]
    assert strict["additionalProperties"] is False


def test_strict_schema_normalizes_empty_object() -> None:
    strict = make_strict_json_schema({"type": "object"})

    assert strict["properties"] == {}
    assert strict["required"] == []
    assert strict["additionalProperties"] is False


def test_structured_output_builds_strict_schema_from_model() -> None:
    output = StructuredOutputDefinition.from_model(
        name="classification",
        output_model=ClassificationOutput,
    )

    assert output.json_schema["additionalProperties"] is False
    assert output.json_schema["required"] == ["label", "confidence"]


@pytest.mark.parametrize("request_type", [ProviderRequest, AgentRunRequest])
def test_run_requests_reject_duplicate_tool_names(request_type: type) -> None:
    tool = ToolDefinition(
        name="duplicate",
        description="First",
        parameters={"type": "object"},
    )
    kwargs = {
        "messages": [AIMessage(role="user", content="test")],
        "tools": [tool, tool.model_copy(update={"description": "Second"})],
    }
    if request_type is ProviderRequest:
        kwargs["model"] = "test-model"

    with pytest.raises(ValidationError, match="tool names must be unique"):
        request_type(**kwargs)


@pytest.mark.parametrize("request_type", [ProviderRequest, AgentRunRequest])
def test_required_tool_choice_requires_tools(request_type: type) -> None:
    kwargs = {
        "messages": [AIMessage(role="user", content="test")],
        "tool_choice": "required",
    }
    if request_type is ProviderRequest:
        kwargs["model"] = "test-model"

    with pytest.raises(ValidationError, match="requires at least one tool"):
        request_type(**kwargs)


def test_ai_error_exposes_stable_detail() -> None:
    error = ProviderUnavailableError(
        "provider down",
        provider="gateway",
        details={"request_id": "req-1"},
    )

    detail = error.as_detail()

    assert detail.code is AIErrorCode.PROVIDER_UNAVAILABLE
    assert detail.retryable is True
    assert detail.provider == "gateway"
    assert detail.details == {"request_id": "req-1"}
