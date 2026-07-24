from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterator, Sequence

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
    ProviderIncompleteError,
    ProviderProtocolError,
    ProviderUnavailableError,
)
from .base import map_openai_error, parse_tool_arguments, read_value


@dataclass(slots=True)
class ResponsesContinuation:
    input_items: list[Any]


class OpenAIResponsesProvider:
    """Adapter for OpenAI Responses-compatible clients and gateways."""

    def __init__(self, client: Any, *, name: str = "openai_responses") -> None:
        self.client = client
        self.name = name

    @staticmethod
    def _message(message: AIMessage) -> dict[str, Any]:
        if isinstance(message.content, str):
            return {"role": message.role, "content": message.content}
        content: list[dict[str, Any]] = []
        for part in message.content:
            if isinstance(part, TextContentPart):
                content.append({"type": "input_text", "text": part.text})
            elif isinstance(part, ImageContentPart):
                content.append(
                    {
                        "type": "input_image",
                        "image_url": part.image_url,
                        "detail": part.detail,
                    }
                )
        return {"role": message.role, "content": content}

    @staticmethod
    def _tool(tool: ToolDefinition) -> dict[str, Any]:
        return {
            "type": "function",
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.parameters,
            "strict": tool.strict,
        }

    def _input_items(
        self,
        request: ProviderRequest,
        continuation: Any,
        tool_results: Sequence[ToolResult],
    ) -> list[Any]:
        if continuation is None:
            if tool_results:
                raise ProviderProtocolError(
                    "Tool results require a Responses continuation",
                    provider=self.name,
                )
            return [self._message(message) for message in request.messages]
        if not isinstance(continuation, ResponsesContinuation):
            raise ProviderProtocolError(
                "Invalid Responses continuation state",
                provider=self.name,
            )
        items = list(continuation.input_items)
        items.extend(
            {
                "type": "function_call_output",
                "call_id": result.call_id,
                "output": result.output,
            }
            for result in tool_results
        )
        return items

    def _kwargs(
        self,
        request: ProviderRequest,
        input_items: list[Any],
        *,
        stream: bool = False,
    ) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "model": request.model,
            "input": input_items,
            "store": request.store,
        }
        if request.tools:
            kwargs.update(
                tools=[self._tool(tool) for tool in request.tools],
                tool_choice=request.tool_choice,
                parallel_tool_calls=request.parallel_tool_calls,
            )
        if request.structured_output is not None:
            output = request.structured_output
            output_format: dict[str, Any] = {
                "type": "json_schema",
                "name": output.name,
                "schema": output.json_schema,
                "strict": output.strict,
            }
            if output.description:
                output_format["description"] = output.description
            kwargs["text"] = {"format": output_format}
        if request.max_output_tokens is not None:
            kwargs["max_output_tokens"] = request.max_output_tokens
        if request.temperature is not None:
            kwargs["temperature"] = request.temperature
        if request.reasoning_effort is not None:
            kwargs["reasoning"] = {"effort": request.reasoning_effort}
        if request.safety_identifier:
            kwargs["safety_identifier"] = request.safety_identifier
        if stream:
            kwargs["stream"] = True
        return kwargs

    def _adapt_response(
        self,
        response: Any,
        *,
        model: str,
        input_items: list[Any],
    ) -> ProviderResponse:
        self._validate_terminal_response(response)
        raw_output = list(read_value(response, "output", []) or [])
        tool_calls: list[ToolCall] = []
        for item in raw_output:
            if read_value(item, "type") != "function_call":
                continue
            item_id = str(read_value(item, "id", "") or "")
            call_id = str(read_value(item, "call_id", "") or "")
            name = str(read_value(item, "name", "") or "")
            if not item_id or not call_id or not name:
                raise ProviderProtocolError(
                    "Responses function call is missing id, call_id, or name",
                    provider=self.name,
                )
            tool_calls.append(
                ToolCall(
                    id=item_id,
                    call_id=call_id,
                    name=name,
                    arguments=parse_tool_arguments(
                        read_value(item, "arguments"),
                        tool_name=name,
                        provider=self.name,
                    ),
                )
            )

        usage = read_value(response, "usage")
        input_tokens = int(read_value(usage, "input_tokens", 0) or 0)
        output_tokens = int(read_value(usage, "output_tokens", 0) or 0)
        total_tokens = int(
            read_value(usage, "total_tokens", input_tokens + output_tokens)
            or input_tokens + output_tokens
        )
        return ProviderResponse(
            response_id=str(read_value(response, "id", "")),
            provider=self.name,
            model=model,
            text=str(read_value(response, "output_text", "") or "").strip(),
            tool_calls=tool_calls,
            usage=TokenUsage(
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
            ),
            continuation=ResponsesContinuation(
                input_items=[*input_items, *raw_output]
            ),
        )

    def _validate_terminal_response(self, response: Any) -> None:
        status = str(read_value(response, "status", "") or "")
        if status == "failed":
            error = read_value(response, "error")
            code = str(read_value(error, "code", "") or "")
            raise ProviderUnavailableError(
                "Responses provider returned a failed response",
                provider=self.name,
                details={"provider_code": code} if code else {},
            )
        if status == "incomplete":
            incomplete = read_value(response, "incomplete_details")
            reason = str(read_value(incomplete, "reason", "") or "")
            raise ProviderIncompleteError(
                "Responses provider returned an incomplete response",
                provider=self.name,
                details={"reason": reason} if reason else {},
            )

    def complete(
        self,
        request: ProviderRequest,
        *,
        continuation: Any = None,
        tool_results: Sequence[ToolResult] = (),
    ) -> ProviderResponse:
        input_items = self._input_items(request, continuation, tool_results)
        try:
            response = self.client.responses.create(
                **self._kwargs(request, input_items)
            )
        except OpenAIError as error:
            raise map_openai_error(
                error,
                provider=self.name,
                operation="Responses",
            ) from error
        try:
            return self._adapt_response(
                response,
                model=request.model,
                input_items=input_items,
            )
        except (TypeError, ValueError) as error:
            raise ProviderProtocolError(
                "Responses provider returned a malformed response",
                provider=self.name,
            ) from error

    def stream(
        self,
        request: ProviderRequest,
        *,
        continuation: Any = None,
        tool_results: Sequence[ToolResult] = (),
    ) -> Iterator[ProviderStreamEvent]:
        input_items = self._input_items(request, continuation, tool_results)
        try:
            stream = self.client.responses.create(
                **self._kwargs(request, input_items, stream=True)
            )
            completed = False
            for event in stream:
                event_type = read_value(event, "type", "")
                if event_type == "response.output_text.delta":
                    delta = str(read_value(event, "delta", "") or "")
                    if delta:
                        yield ProviderStreamEvent(
                            type="text_delta",
                            delta=delta,
                        )
                elif event_type == "response.completed":
                    response = read_value(event, "response")
                    if response is None:
                        raise ProviderProtocolError(
                            "Responses completed event has no response",
                            provider=self.name,
                        )
                    completed = True
                    yield ProviderStreamEvent(
                        type="completed",
                        response=self._adapt_response(
                            response,
                            model=request.model,
                            input_items=input_items,
                        ),
                    )
                elif event_type == "response.failed":
                    response = read_value(event, "response")
                    if response is not None:
                        self._validate_terminal_response(response)
                    raise ProviderUnavailableError(
                        "Responses stream returned a failed response",
                        provider=self.name,
                    )
                elif event_type == "response.incomplete":
                    response = read_value(event, "response")
                    if response is not None:
                        self._validate_terminal_response(response)
                    raise ProviderIncompleteError(
                        "Responses stream returned an incomplete response",
                        provider=self.name,
                    )
                elif event_type == "error":
                    raise ProviderUnavailableError(
                        "Responses stream returned an error",
                        provider=self.name,
                    )
            if not completed:
                raise ProviderProtocolError(
                    "Responses stream ended without response.completed",
                    provider=self.name,
                )
        except OpenAIError as error:
            raise map_openai_error(
                error,
                provider=self.name,
                operation="Responses",
            ) from error
        except (TypeError, ValueError) as error:
            raise ProviderProtocolError(
                "Responses provider returned a malformed stream event",
                provider=self.name,
            ) from error
