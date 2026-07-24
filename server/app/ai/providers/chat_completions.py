from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterator, Literal, Sequence

from openai import OpenAIError

from ..contracts import (
    AIMessage,
    ImageContentPart,
    ProviderRequest,
    ProviderResponse,
    ProviderStreamEvent,
    TextContentPart,
    TokenUsage,
    ToolCall,
    ToolDefinition,
    ToolResult,
)
from ..errors import (
    AIConfigurationError,
    ProviderIncompleteError,
    ProviderProtocolError,
)
from .base import map_openai_error, parse_tool_arguments, read_value


@dataclass(slots=True)
class ChatContinuation:
    messages: list[dict[str, Any]]


class ChatCompletionsProvider:
    """Adapter for OpenAI-compatible Chat Completions providers."""

    def __init__(
        self,
        client: Any,
        *,
        name: str = "chat_completions",
        extra_body: dict[str, Any] | None = None,
        strict_tools: bool = False,
        max_tokens_parameter: Literal[
            "max_tokens", "max_completion_tokens"
        ] = "max_tokens",
        reasoning_effort_parameter: str | None = None,
    ) -> None:
        if max_tokens_parameter not in {
            "max_tokens",
            "max_completion_tokens",
        }:
            raise ValueError("unsupported max token parameter")
        self.client = client
        self.name = name
        self.extra_body = extra_body
        self.strict_tools = strict_tools
        self.max_tokens_parameter = max_tokens_parameter
        self.reasoning_effort_parameter = reasoning_effort_parameter

    @staticmethod
    def _message(message: AIMessage) -> dict[str, Any]:
        role = "system" if message.role == "developer" else message.role
        if isinstance(message.content, str):
            return {"role": role, "content": message.content}
        content: list[dict[str, Any]] = []
        for part in message.content:
            if isinstance(part, TextContentPart):
                content.append({"type": "text", "text": part.text})
            elif isinstance(part, ImageContentPart):
                content.append(
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": part.image_url,
                            "detail": part.detail,
                        },
                    }
                )
        return {"role": role, "content": content}

    def _tool(self, tool: ToolDefinition) -> dict[str, Any]:
        function: dict[str, Any] = {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.parameters,
        }
        if self.strict_tools:
            function["strict"] = tool.strict
        return {
            "type": "function",
            "function": function,
        }

    def _messages(
        self,
        request: ProviderRequest,
        continuation: Any,
        tool_results: Sequence[ToolResult],
    ) -> list[dict[str, Any]]:
        if continuation is None:
            if tool_results:
                raise ProviderProtocolError(
                    "Tool results require a Chat Completions continuation",
                    provider=self.name,
                )
            return [self._message(message) for message in request.messages]
        if not isinstance(continuation, ChatContinuation):
            raise ProviderProtocolError(
                "Invalid Chat Completions continuation state",
                provider=self.name,
            )
        messages = list(continuation.messages)
        messages.extend(
            {
                "role": "tool",
                "tool_call_id": result.call_id,
                "content": result.output,
            }
            for result in tool_results
        )
        return messages

    def _kwargs(
        self,
        request: ProviderRequest,
        messages: list[dict[str, Any]],
        *,
        stream: bool = False,
    ) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "model": request.model,
            "messages": messages,
        }
        if request.tools:
            kwargs.update(
                tools=[self._tool(tool) for tool in request.tools],
                tool_choice=request.tool_choice,
                parallel_tool_calls=request.parallel_tool_calls,
            )
        if request.max_output_tokens is not None:
            kwargs[self.max_tokens_parameter] = request.max_output_tokens
        if request.temperature is not None:
            kwargs["temperature"] = request.temperature
        if request.reasoning_effort is not None:
            if self.reasoning_effort_parameter is None:
                raise AIConfigurationError(
                    "Chat Completions reasoning effort mapping is not configured",
                    provider=self.name,
                )
            kwargs[self.reasoning_effort_parameter] = request.reasoning_effort
        if request.safety_identifier:
            kwargs["user"] = request.safety_identifier
        if self.extra_body is not None:
            kwargs["extra_body"] = self.extra_body
        if stream:
            kwargs["stream"] = True
        return kwargs

    def _tool_call(self, raw: Any) -> ToolCall:
        function = read_value(raw, "function")
        name = str(read_value(function, "name", "") or "")
        call_id = str(read_value(raw, "id", "") or "")
        if not call_id or not name:
            raise ProviderProtocolError(
                "Chat Completions tool call is missing id or name",
                provider=self.name,
            )
        return ToolCall(
            id=call_id,
            call_id=call_id,
            name=name,
            arguments=parse_tool_arguments(
                read_value(function, "arguments"),
                tool_name=name,
                provider=self.name,
            ),
        )

    def _assistant_message(
        self,
        message: Any,
        raw_tool_calls: Sequence[Any],
    ) -> dict[str, Any]:
        assistant_message: dict[str, Any] = {
            "role": "assistant",
            "content": read_value(message, "content"),
        }
        reasoning_content = read_value(message, "reasoning_content")
        if reasoning_content is not None:
            assistant_message["reasoning_content"] = reasoning_content
        if raw_tool_calls:
            assistant_message["tool_calls"] = [
                {
                    "id": str(read_value(call, "id", "") or ""),
                    "type": "function",
                    "function": {
                        "name": str(
                            read_value(
                                read_value(call, "function"),
                                "name",
                                "",
                            )
                            or ""
                        ),
                        "arguments": str(
                            read_value(
                                read_value(call, "function"),
                                "arguments",
                                "",
                            )
                            or ""
                        ),
                    },
                }
                for call in raw_tool_calls
            ]
        return assistant_message

    def _validate_finish_reason(
        self,
        finish_reason: Any,
        *,
        has_tool_calls: bool,
    ) -> None:
        reason = str(finish_reason or "")
        if not reason:
            raise ProviderProtocolError(
                "Chat Completions response has no finish reason",
                provider=self.name,
            )
        if reason in {"length", "content_filter"}:
            raise ProviderIncompleteError(
                "Chat Completions provider returned an incomplete response",
                provider=self.name,
                details={"reason": reason},
            )
        if reason == "tool_calls" and not has_tool_calls:
            raise ProviderProtocolError(
                "Chat Completions reported tool_calls without any calls",
                provider=self.name,
            )

    @staticmethod
    def _usage(raw: Any) -> TokenUsage:
        input_tokens = int(read_value(raw, "prompt_tokens", 0) or 0)
        output_tokens = int(read_value(raw, "completion_tokens", 0) or 0)
        return TokenUsage(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=int(
                read_value(
                    raw,
                    "total_tokens",
                    input_tokens + output_tokens,
                )
                or input_tokens + output_tokens
            ),
        )

    def complete(
        self,
        request: ProviderRequest,
        *,
        continuation: Any = None,
        tool_results: Sequence[ToolResult] = (),
    ) -> ProviderResponse:
        messages = self._messages(request, continuation, tool_results)
        try:
            response = self.client.chat.completions.create(
                **self._kwargs(request, messages)
            )
        except OpenAIError as error:
            raise map_openai_error(
                error,
                provider=self.name,
                operation="Chat Completions",
            ) from error

        try:
            choices = read_value(response, "choices", []) or []
            if not choices:
                raise ProviderProtocolError(
                    "Chat Completions response has no choices",
                    provider=self.name,
                )
            choice = choices[0]
            message = read_value(choice, "message")
            if message is None:
                raise ProviderProtocolError(
                    "Chat Completions choice has no message",
                    provider=self.name,
                )
            raw_tool_calls = read_value(message, "tool_calls", []) or []
            tool_calls = [self._tool_call(call) for call in raw_tool_calls]
            self._validate_finish_reason(
                read_value(choice, "finish_reason"),
                has_tool_calls=bool(tool_calls),
            )
            assistant_message = self._assistant_message(
                message,
                raw_tool_calls,
            )
            return ProviderResponse(
                response_id=str(read_value(response, "id", "")),
                provider=self.name,
                model=request.model,
                text=str(read_value(message, "content", "") or "").strip(),
                tool_calls=tool_calls,
                usage=self._usage(read_value(response, "usage")),
                continuation=ChatContinuation(
                    messages=[*messages, assistant_message]
                ),
            )
        except (TypeError, ValueError) as error:
            raise ProviderProtocolError(
                "Chat Completions provider returned a malformed response",
                provider=self.name,
            ) from error

    def stream(
        self,
        request: ProviderRequest,
        *,
        continuation: Any = None,
        tool_results: Sequence[ToolResult] = (),
    ) -> Iterator[ProviderStreamEvent]:
        messages = self._messages(request, continuation, tool_results)
        text_parts: list[str] = []
        tool_parts: dict[int, dict[str, str]] = {}
        reasoning_parts: list[str] = []
        response_id = ""
        usage = TokenUsage()
        finish_reason: Any = None
        try:
            stream = self.client.chat.completions.create(
                **self._kwargs(request, messages, stream=True)
            )
            for chunk in stream:
                response_id = str(read_value(chunk, "id", response_id))
                chunk_usage = read_value(chunk, "usage")
                if chunk_usage is not None:
                    usage = self._usage(chunk_usage)
                choices = read_value(chunk, "choices", []) or []
                if not choices:
                    continue
                choice = choices[0]
                finish_reason = (
                    read_value(choice, "finish_reason") or finish_reason
                )
                delta = read_value(choice, "delta")
                content = str(read_value(delta, "content", "") or "")
                if content:
                    text_parts.append(content)
                    yield ProviderStreamEvent(
                        type="text_delta",
                        delta=content,
                    )
                reasoning_content = str(
                    read_value(delta, "reasoning_content", "") or ""
                )
                if reasoning_content:
                    reasoning_parts.append(reasoning_content)
                for raw_call in read_value(delta, "tool_calls", []) or []:
                    index = int(read_value(raw_call, "index", 0) or 0)
                    part = tool_parts.setdefault(
                        index,
                        {"id": "", "name": "", "arguments": ""},
                    )
                    part["id"] += str(read_value(raw_call, "id", "") or "")
                    function = read_value(raw_call, "function")
                    part["name"] += str(
                        read_value(function, "name", "") or ""
                    )
                    part["arguments"] += str(
                        read_value(function, "arguments", "") or ""
                    )
        except OpenAIError as error:
            raise map_openai_error(
                error,
                provider=self.name,
                operation="Chat Completions",
            ) from error
        except (TypeError, ValueError) as error:
            raise ProviderProtocolError(
                "Chat Completions provider returned a malformed stream event",
                provider=self.name,
            ) from error

        assembled_tool_calls = [
            {
                "id": part["id"],
                "type": "function",
                "function": {
                    "name": part["name"],
                    "arguments": part["arguments"],
                },
            }
            for _, part in sorted(tool_parts.items())
        ]
        tool_calls = [
            self._tool_call(call) for call in assembled_tool_calls
        ]
        self._validate_finish_reason(
            finish_reason,
            has_tool_calls=bool(tool_calls),
        )
        assistant_message: dict[str, Any] = {
            "role": "assistant",
            "content": "".join(text_parts) or None,
        }
        if reasoning_parts:
            assistant_message["reasoning_content"] = "".join(
                reasoning_parts
            )
        if tool_calls:
            assistant_message["tool_calls"] = assembled_tool_calls
        yield ProviderStreamEvent(
            type="completed",
            response=ProviderResponse(
                response_id=response_id,
                provider=self.name,
                model=request.model,
                text="".join(text_parts).strip(),
                tool_calls=tool_calls,
                usage=usage,
                continuation=ChatContinuation(
                    messages=[*messages, assistant_message]
                ),
            ),
        )
