from collections import deque
from typing import Any, Iterator, Sequence

import pytest

from app.ai.contracts import (
    AIMessage,
    AgentRunRequest,
    ImageContentPart,
    ModelCapability,
    ModelRequirements,
    ProviderRequest,
    ProviderResponse,
    ProviderStreamEvent,
    RunContext,
    StructuredOutputDefinition,
    ToolCall,
    ToolDefinition,
    ToolResult,
)
from app.ai.errors import (
    ModelRouteNotFoundError,
    ProviderProtocolError,
    RepeatedToolCallError,
    ToolNotAllowedError,
    ToolOutputTooLargeError,
)
from app.ai.router import ModelProfile, ModelRouter
from app.ai.runner import AgentRunner


TOOL = ToolDefinition(
    name="assets_list",
    description="List assets",
    parameters={
        "type": "object",
        "properties": {"category": {"type": "string"}},
    },
)


class SequenceProvider:
    name = "provider"

    def __init__(self, responses: list[ProviderResponse]) -> None:
        self.responses = deque(responses)
        self.requests: list[ProviderRequest] = []
        self.tool_results: list[list[ToolResult]] = []

    def complete(
        self,
        request: ProviderRequest,
        *,
        continuation: Any = None,
        tool_results: Sequence[ToolResult] = (),
    ) -> ProviderResponse:
        self.requests.append(request)
        self.tool_results.append(list(tool_results))
        return self.responses.popleft()

    def stream(
        self,
        request: ProviderRequest,
        *,
        continuation: Any = None,
        tool_results: Sequence[ToolResult] = (),
    ) -> Iterator[ProviderStreamEvent]:
        self.requests.append(request)
        self.tool_results.append(list(tool_results))
        response = self.responses.popleft()
        if response.text:
            yield ProviderStreamEvent(
                type="text_delta",
                delta=response.text,
            )
        yield ProviderStreamEvent(type="completed", response=response)


class AssetExecutor:
    def __init__(self) -> None:
        self.contexts: list[RunContext] = []

    def execute(self, call: ToolCall, context: RunContext) -> ToolResult:
        self.contexts.append(context)
        return ToolResult(
            call_id=call.call_id,
            name=call.name,
            output='[{"name":"耳机"}]',
        )


def build_runner(
    provider: SequenceProvider,
    *,
    executor: AssetExecutor | None = None,
    max_repeated_call: int = 2,
    max_tool_output_chars: int = 64_000,
) -> AgentRunner:
    router = ModelRouter()
    router.register_provider(provider)
    router.register_profile(
        ModelProfile(
            name="agent",
            provider=provider.name,
            model="test-model",
            capabilities={
                ModelCapability.TEXT,
                ModelCapability.TOOLS,
                ModelCapability.STREAMING,
            },
        )
    )
    return AgentRunner(
        router,
        tool_executor=executor,
        max_repeated_call=max_repeated_call,
        max_tool_output_chars=max_tool_output_chars,
    )


def run_request() -> AgentRunRequest:
    return AgentRunRequest(
        messages=[AIMessage(role="user", content="我有哪些耳机")],
        tools=[TOOL],
        requirements=ModelRequirements(task="purchase_review"),
    )


def context() -> RunContext:
    return RunContext(user_id="user-1", request_id="req-1")


def tool_response(
    *,
    name: str = "assets_list",
    continuation: str = "state-1",
) -> ProviderResponse:
    return ProviderResponse(
        provider="provider",
        model="test-model",
        tool_calls=[
            ToolCall(
                id="fc-1",
                call_id="call-1",
                name=name,
                arguments={"category": "数码"},
            )
        ],
        continuation=continuation,
    )


def final_response() -> ProviderResponse:
    return ProviderResponse(
        provider="provider",
        model="test-model",
        text="你有一副耳机。",
        continuation="state-2",
    )


def test_runner_executes_tool_loop_and_returns_common_result() -> None:
    provider = SequenceProvider([tool_response(), final_response()])
    executor = AssetExecutor()

    result = build_runner(provider, executor=executor).run(
        run_request(),
        context(),
    )

    assert result.text == "你有一副耳机。"
    assert result.steps == 2
    assert result.profile == "agent"
    assert result.tool_executions[0].call.name == "assets_list"
    assert provider.tool_results[1][0].output == '[{"name":"耳机"}]'
    assert executor.contexts[0].user_id == "user-1"
    assert provider.requests[0].tools == [TOOL]


def test_runner_rejects_unlisted_tool_call() -> None:
    provider = SequenceProvider([tool_response(name="admin_delete")])

    with pytest.raises(ToolNotAllowedError):
        build_runner(provider, executor=AssetExecutor()).run(
            run_request(),
            context(),
        )


def test_runner_stops_repeated_identical_tool_calls() -> None:
    provider = SequenceProvider(
        [
            tool_response(continuation="state-1"),
            tool_response(continuation="state-2"),
        ]
    )

    with pytest.raises(RepeatedToolCallError):
        build_runner(
            provider,
            executor=AssetExecutor(),
            max_repeated_call=1,
        ).run(run_request(), context())


def test_stream_runner_emits_tool_and_final_events() -> None:
    provider = SequenceProvider([tool_response(), final_response()])

    events = list(
        build_runner(provider, executor=AssetExecutor()).stream(
            run_request(),
            context(),
        )
    )

    assert [event.type for event in events] == [
        "tool_started",
        "tool_completed",
        "text_delta",
        "run_completed",
    ]
    assert events[-1].result is not None
    assert events[-1].result.text == "你有一副耳机。"


def test_runner_rejects_oversized_tool_output() -> None:
    provider = SequenceProvider([tool_response()])

    with pytest.raises(ToolOutputTooLargeError):
        build_runner(
            provider,
            executor=AssetExecutor(),
            max_tool_output_chars=5,
        ).run(run_request(), context())


def test_runner_rejects_whitespace_only_final_response() -> None:
    provider = SequenceProvider(
        [
            ProviderResponse(
                provider="provider",
                model="test-model",
                text="   ",
            )
        ]
    )

    with pytest.raises(ProviderProtocolError):
        build_runner(provider).run(run_request(), context())


def test_runner_rejects_response_from_wrong_model() -> None:
    provider = SequenceProvider(
        [
            ProviderResponse(
                provider="provider",
                model="wrong-model",
                text="done",
            )
        ]
    )

    with pytest.raises(ProviderProtocolError, match="identity"):
        build_runner(provider).run(run_request(), context())


def test_runner_rejects_duplicate_tool_call_ids() -> None:
    response = tool_response()
    response.tool_calls.append(
        ToolCall(
            id="fc-2",
            call_id="call-1",
            name="assets_list",
            arguments={"category": "other"},
        )
    )
    provider = SequenceProvider([response])

    with pytest.raises(ProviderProtocolError, match="duplicate"):
        build_runner(
            provider,
            executor=AssetExecutor(),
        ).run(run_request(), context())


def test_runner_infers_vision_capability_from_message_content() -> None:
    provider = SequenceProvider([])
    vision_request = AgentRunRequest(
        messages=[
            AIMessage(
                role="user",
                content=[
                    ImageContentPart(
                        image_url="https://example.test/image.jpg"
                    )
                ],
            )
        ]
    )

    with pytest.raises(ModelRouteNotFoundError):
        build_runner(provider).run(vision_request, context())


def test_runner_infers_reasoning_capability_from_effort() -> None:
    provider = SequenceProvider([])
    reasoning_request = AgentRunRequest(
        messages=[AIMessage(role="user", content="analyze")],
        reasoning_effort="high",
    )

    with pytest.raises(ModelRouteNotFoundError):
        build_runner(provider).run(reasoning_request, context())


def test_runner_infers_structured_output_capability() -> None:
    provider = SequenceProvider([])
    structured_request = AgentRunRequest(
        messages=[AIMessage(role="user", content="classify")],
        structured_output=StructuredOutputDefinition(
            name="result",
            json_schema={
                "type": "object",
                "properties": {"label": {"type": "string"}},
            },
        ),
    )

    with pytest.raises(ModelRouteNotFoundError):
        build_runner(provider).run(structured_request, context())
