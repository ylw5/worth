from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest
from pydantic import BaseModel, ConfigDict

from app.ai.contracts import RunContext, ToolCall
from app.ai.errors import (
    AIConfigurationError,
    InvalidToolArgumentsError,
    ToolNotAllowedError,
)
from app.ai.tools.purchase import (
    PURCHASE_TOOL_NAMES,
    build_purchase_tool_registry,
)
from app.ai.tools.registry import ToolRegistry


class EchoInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: str


class EchoOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: str
    user_id: str


def call(name: str, arguments: dict) -> ToolCall:
    return ToolCall(
        id=f"id-{name}",
        call_id=f"call-{name}",
        name=name,
        arguments=arguments,
    )


def context() -> RunContext:
    return RunContext(user_id="user-1", request_id="request-1")


def make_db_chain(data: list[dict]) -> MagicMock:
    client = MagicMock()
    chain = client.table.return_value
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.order.return_value = chain
    chain.limit.return_value = chain
    chain.execute.return_value = MagicMock(data=data)
    return client


def test_registry_validates_executes_serializes_and_caches() -> None:
    handler = MagicMock(
        side_effect=lambda arguments, run_context: EchoOutput(
            value=arguments.value,
            user_id=run_context.user_id,
        )
    )
    registry = ToolRegistry()
    registry.register(
        name="echo",
        description="Echo a value",
        input_model=EchoInput,
        output_model=EchoOutput,
        handler=handler,
    )
    executor = registry.executor(["echo"])

    first = executor.execute(call("echo", {"value": "hello"}), context())
    second = executor.execute(call("echo", {"value": "hello"}), context())

    assert json.loads(first.output) == {
        "value": "hello",
        "user_id": "user-1",
    }
    assert second.output == first.output
    assert handler.call_count == 1


def test_registry_rejects_duplicate_and_unlisted_tools() -> None:
    registry = ToolRegistry()
    registry.register(
        name="echo",
        description="Echo a value",
        input_model=EchoInput,
        handler=lambda arguments, run_context: {},
    )

    with pytest.raises(AIConfigurationError):
        registry.register(
            name="echo",
            description="Duplicate",
            input_model=EchoInput,
            handler=lambda arguments, run_context: {},
        )
    with pytest.raises(ToolNotAllowedError):
        registry.executor([]).execute(
            call("echo", {"value": "hello"}),
            context(),
        )


def test_registry_maps_input_validation_to_ai_error() -> None:
    registry = ToolRegistry()
    registry.register(
        name="echo",
        description="Echo a value",
        input_model=EchoInput,
        handler=lambda arguments, run_context: {},
    )

    with pytest.raises(InvalidToolArgumentsError) as caught:
        registry.executor().execute(call("echo", {}), context())

    assert caught.value.details["validation_error_count"] == 1


def test_purchase_registry_exposes_only_atomic_read_tools() -> None:
    registry = build_purchase_tool_registry(make_db_chain([]), None)

    definitions = registry.definitions(PURCHASE_TOOL_NAMES)

    assert [definition.name for definition in definitions] == list(
        PURCHASE_TOOL_NAMES
    )
    assert "clarify_with_user" not in {
        definition.name for definition in definitions
    }
    for definition in definitions:
        assert definition.strict is True
        assert definition.parameters["additionalProperties"] is False


def test_assets_tool_uses_server_context_user_id() -> None:
    client = make_db_chain(
        [
            {
                "id": "asset-1",
                "name": "Phone",
                "brand": "Brand",
                "model": "Model",
                "category": "数码",
                "subcategory": "手机",
                "status": "in_use",
            }
        ]
    )
    registry = build_purchase_tool_registry(client, None)

    result = registry.executor(["assets_list"]).execute(
        call(
            "assets_list",
            {
                "category": "数码",
                "subcategory": "手机",
                "limit": 5,
            },
        ),
        context(),
    )

    assert json.loads(result.output)["assets"][0]["id"] == "asset-1"
    eq_calls = client.table.return_value.eq.call_args_list
    assert eq_calls[0].args == ("user_id", "user-1")
    schema = registry.definitions(["assets_list"])[0].parameters
    assert "user_id" not in schema["properties"]


def test_history_tool_keeps_ai_choice_and_outcome_separate() -> None:
    client = make_db_chain(
        [
            {
                "id": "evaluation-1",
                "product_title": "Headphones",
                "category": "数码",
                "subcategory": "耳机",
                "product_price": 1000,
                "decision": "skip",
                "user_choice": "buy",
                "outcome_status": "idle",
                "linked_asset_id": "asset-1",
                "created_at": "2026-07-20T00:00:00+00:00",
            }
        ]
    )
    registry = build_purchase_tool_registry(client, None)

    result = registry.executor(["evaluation_history_list"]).execute(
        call(
            "evaluation_history_list",
            {"category": "数码", "limit": 5},
        ),
        context(),
    )
    record = json.loads(result.output)["evaluations"][0]

    assert record["legacy_ai_decision"] == "skip"
    assert record["user_choice"] == "buy"
    assert record["outcome_status"] == "idle"
