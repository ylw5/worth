from __future__ import annotations

import hashlib
import json
from collections import Counter
from typing import Iterator

from .contracts import (
    AgentRunRequest,
    AgentRunResult,
    AgentStreamEvent,
    ImageContentPart,
    ModelCapability,
    ProviderRequest,
    ProviderResponse,
    RunContext,
    TokenUsage,
    ToolCall,
    ToolExecutionRecord,
    ToolExecutor,
    ToolResult,
)
from .errors import (
    InvalidToolArgumentsError,
    ProviderProtocolError,
    RepeatedToolCallError,
    ToolExecutionError,
    ToolLoopLimitError,
    ToolNotAllowedError,
    ToolOutputTooLargeError,
)
from .router import ModelRouter, RoutedModel


class AgentRunner:
    def __init__(
        self,
        router: ModelRouter,
        *,
        tool_executor: ToolExecutor | None = None,
        max_tool_steps: int = 4,
        max_repeated_call: int = 2,
        max_tool_output_chars: int = 64_000,
    ) -> None:
        if max_tool_steps < 1:
            raise ValueError("max_tool_steps must be at least 1")
        if max_repeated_call < 1:
            raise ValueError("max_repeated_call must be at least 1")
        if max_tool_output_chars < 1:
            raise ValueError("max_tool_output_chars must be at least 1")
        self.router = router
        self.tool_executor = tool_executor
        self.max_tool_steps = max_tool_steps
        self.max_repeated_call = max_repeated_call
        self.max_tool_output_chars = max_tool_output_chars

    def _route(
        self,
        request: AgentRunRequest,
        *,
        streaming: bool,
    ) -> RoutedModel:
        capabilities = set(request.requirements.capabilities)
        if request.tools:
            capabilities.add(ModelCapability.TOOLS)
        if any(
            isinstance(part, ImageContentPart)
            for message in request.messages
            if not isinstance(message.content, str)
            for part in message.content
        ):
            capabilities.add(ModelCapability.VISION)
        if request.reasoning_effort is not None:
            capabilities.add(ModelCapability.REASONING)
        if request.structured_output is not None:
            capabilities.add(ModelCapability.STRUCTURED_OUTPUT)
        if streaming:
            capabilities.add(ModelCapability.STREAMING)
        requirements = request.requirements.model_copy(
            update={"capabilities": capabilities}
        )
        return self.router.resolve(requirements)

    @staticmethod
    def _provider_request(
        request: AgentRunRequest,
        routed: RoutedModel,
        context: RunContext,
        *,
        first_turn: bool,
    ) -> ProviderRequest:
        return ProviderRequest(
            model=routed.profile.model,
            messages=request.messages,
            tools=request.tools,
            structured_output=request.structured_output,
            tool_choice=request.tool_choice if first_turn else "auto",
            max_output_tokens=request.max_output_tokens,
            temperature=request.temperature,
            reasoning_effort=request.reasoning_effort,
            safety_identifier=hashlib.sha256(
                context.user_id.encode()
            ).hexdigest(),
            store=request.store,
            parallel_tool_calls=request.parallel_tool_calls,
        )

    @staticmethod
    def _signature(name: str, arguments: dict) -> str:
        return f"{name}:{json.dumps(arguments, sort_keys=True, ensure_ascii=False)}"

    def _execute_calls(
        self,
        *,
        calls: list[ToolCall],
        definitions: set[str],
        context: RunContext,
        step: int,
        seen: Counter[str],
    ) -> tuple[list[ToolResult], list[ToolExecutionRecord]]:
        if self.tool_executor is None:
            raise ToolExecutionError(
                "Provider requested tools but no ToolExecutor is configured"
            )
        results: list[ToolResult] = []
        records: list[ToolExecutionRecord] = []
        batch_ids: set[str] = set()
        batch_call_ids: set[str] = set()
        for call in calls:
            if call.id in batch_ids or call.call_id in batch_call_ids:
                raise ProviderProtocolError(
                    "Provider returned duplicate tool call identity",
                    details={"id": call.id, "call_id": call.call_id},
                )
            batch_ids.add(call.id)
            batch_call_ids.add(call.call_id)
            if call.name not in definitions:
                raise ToolNotAllowedError(
                    f"Provider requested unlisted tool '{call.name}'",
                    details={"tool": call.name},
                )
            signature = self._signature(call.name, call.arguments)
            seen[signature] += 1
            if seen[signature] > self.max_repeated_call:
                raise RepeatedToolCallError(
                    f"Repeated tool call limit reached for '{call.name}'",
                    details={"tool": call.name, "step": step},
                )
            try:
                result = self.tool_executor.execute(call, context)
            except (
                InvalidToolArgumentsError,
                ToolExecutionError,
            ) as error:
                result = ToolResult(
                    call_id=call.call_id,
                    name=call.name,
                    output=error.as_detail().model_dump_json(),
                    is_error=True,
                )
            except Exception as error:
                raise ToolExecutionError(
                    f"Tool '{call.name}' raised an unexpected error",
                    details={"tool": call.name},
                ) from error
            if result.call_id != call.call_id or result.name != call.name:
                raise ProviderProtocolError(
                    "ToolExecutor returned a result for a different call",
                    details={
                        "expected_call_id": call.call_id,
                        "actual_call_id": result.call_id,
                    },
                )
            if len(result.output) > self.max_tool_output_chars:
                raise ToolOutputTooLargeError(
                    f"Tool '{call.name}' output exceeds the configured limit",
                    details={
                        "tool": call.name,
                        "output_chars": len(result.output),
                        "max_tool_output_chars": self.max_tool_output_chars,
                    },
                )
            results.append(result)
            records.append(
                ToolExecutionRecord(
                    step=step,
                    call=call,
                    result=result,
                )
            )
        return results, records

    @staticmethod
    def _validate_response_identity(
        response: ProviderResponse,
        routed: RoutedModel,
    ) -> None:
        if (
            response.provider != routed.provider.name
            or response.model != routed.profile.model
        ):
            raise ProviderProtocolError(
                "Provider response identity does not match the selected route",
                provider=routed.provider.name,
                details={
                    "expected_provider": routed.provider.name,
                    "actual_provider": response.provider,
                    "expected_model": routed.profile.model,
                    "actual_model": response.model,
                },
            )

    @staticmethod
    def _result(
        *,
        text: str,
        routed: RoutedModel,
        turns: int,
        executions: list[ToolExecutionRecord],
        usage: TokenUsage,
    ) -> AgentRunResult:
        return AgentRunResult(
            text=text.strip(),
            provider=routed.provider.name,
            model=routed.profile.model,
            profile=routed.profile.name,
            steps=turns,
            tool_executions=executions,
            usage=usage,
        )

    def run(
        self,
        request: AgentRunRequest,
        context: RunContext,
    ) -> AgentRunResult:
        routed = self._route(request, streaming=False)
        allowed_tools = {tool.name for tool in request.tools}
        continuation = None
        pending_results: list[ToolResult] = []
        executions: list[ToolExecutionRecord] = []
        usage = TokenUsage()
        seen: Counter[str] = Counter()

        for turn in range(1, self.max_tool_steps + 2):
            provider_request = self._provider_request(
                request,
                routed,
                context,
                first_turn=turn == 1,
            )
            response = routed.provider.complete(
                provider_request,
                continuation=continuation,
                tool_results=pending_results,
            )
            self._validate_response_identity(response, routed)
            usage = usage.plus(response.usage)
            continuation = response.continuation
            pending_results = []
            if not response.tool_calls:
                if not response.text.strip():
                    raise ProviderProtocolError(
                        "Provider returned neither text nor tool calls",
                        provider=routed.provider.name,
                    )
                return self._result(
                    text=response.text.strip(),
                    routed=routed,
                    turns=turn,
                    executions=executions,
                    usage=usage,
                )
            if turn > self.max_tool_steps:
                raise ToolLoopLimitError(
                    "Agent exceeded the configured tool step limit",
                    provider=routed.provider.name,
                    details={"max_tool_steps": self.max_tool_steps},
                )
            pending_results, records = self._execute_calls(
                calls=response.tool_calls,
                definitions=allowed_tools,
                context=context,
                step=turn,
                seen=seen,
            )
            executions.extend(records)

        raise AssertionError("unreachable")

    def stream(
        self,
        request: AgentRunRequest,
        context: RunContext,
    ) -> Iterator[AgentStreamEvent]:
        routed = self._route(request, streaming=True)
        allowed_tools = {tool.name for tool in request.tools}
        continuation = None
        pending_results: list[ToolResult] = []
        executions: list[ToolExecutionRecord] = []
        usage = TokenUsage()
        seen: Counter[str] = Counter()

        for turn in range(1, self.max_tool_steps + 2):
            provider_request = self._provider_request(
                request,
                routed,
                context,
                first_turn=turn == 1,
            )
            completed_response = None
            for event in routed.provider.stream(
                provider_request,
                continuation=continuation,
                tool_results=pending_results,
            ):
                if event.type == "text_delta":
                    yield AgentStreamEvent(
                        type="text_delta",
                        delta=event.delta,
                    )
                elif event.type == "completed":
                    completed_response = event.response
            if completed_response is None:
                raise ProviderProtocolError(
                    "Provider stream ended without a completed response",
                    provider=routed.provider.name,
                )
            self._validate_response_identity(completed_response, routed)

            usage = usage.plus(completed_response.usage)
            continuation = completed_response.continuation
            pending_results = []
            if not completed_response.tool_calls:
                if not completed_response.text.strip():
                    raise ProviderProtocolError(
                        "Provider returned neither text nor tool calls",
                        provider=routed.provider.name,
                    )
                result = self._result(
                    text=completed_response.text.strip(),
                    routed=routed,
                    turns=turn,
                    executions=executions,
                    usage=usage,
                )
                yield AgentStreamEvent(
                    type="run_completed",
                    result=result,
                )
                return
            if turn > self.max_tool_steps:
                raise ToolLoopLimitError(
                    "Agent exceeded the configured tool step limit",
                    provider=routed.provider.name,
                    details={"max_tool_steps": self.max_tool_steps},
                )
            for call in completed_response.tool_calls:
                yield AgentStreamEvent(
                    type="tool_started",
                    tool_call=call,
                )
            pending_results, records = self._execute_calls(
                calls=completed_response.tool_calls,
                definitions=allowed_tools,
                context=context,
                step=turn,
                seen=seen,
            )
            executions.extend(records)
            for record in records:
                yield AgentStreamEvent(
                    type="tool_completed",
                    tool_call=record.call,
                    tool_result=record.result,
                )

        raise AssertionError("unreachable")
