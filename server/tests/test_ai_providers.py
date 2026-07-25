from unittest.mock import Mock

import pytest
from openai import OpenAIError
from pydantic import BaseModel

from app.ai.contracts import (
    AIMessage,
    ImageContentPart,
    ProviderRequest,
    StructuredOutputDefinition,
    TextContentPart,
    ToolDefinition,
    ToolResult,
)
from app.ai.providers.chat_completions import ChatCompletionsProvider
from app.ai.providers.base import map_openai_error
from app.ai.providers.openai_responses import OpenAIResponsesProvider
from app.ai.errors import (
    AIConfigurationError,
    ProviderIncompleteError,
    ProviderProtocolError,
    ProviderUnavailableError,
)


WEATHER_TOOL = ToolDefinition(
    name="get_weather",
    description="Get weather",
    parameters={
        "type": "object",
        "properties": {"city": {"type": "string"}},
    },
)


class StructuredAnswer(BaseModel):
    answer: str


def request() -> ProviderRequest:
    return ProviderRequest(
        model="test-model",
        messages=[AIMessage(role="user", content="北京天气")],
        tools=[WEATHER_TOOL],
        max_output_tokens=500,
        safety_identifier="hashed-user",
    )


def test_responses_adapter_preserves_output_for_tool_continuation() -> None:
    client = Mock()
    client.responses.create.side_effect = [
        {
            "id": "resp-1",
            "output_text": "",
            "output": [
                {"type": "reasoning", "id": "rs-1"},
                {
                    "type": "function_call",
                    "id": "fc-1",
                    "call_id": "call-1",
                    "name": "get_weather",
                    "arguments": '{"city":"北京"}',
                },
            ],
            "usage": {
                "input_tokens": 10,
                "output_tokens": 5,
                "total_tokens": 15,
            },
        },
        {
            "id": "resp-2",
            "output_text": "北京晴。",
            "output": [{"type": "message", "id": "msg-1"}],
            "usage": {
                "input_tokens": 20,
                "output_tokens": 4,
                "total_tokens": 24,
            },
        },
    ]
    provider = OpenAIResponsesProvider(client, name="gateway")

    first = provider.complete(request())
    second = provider.complete(
        request(),
        continuation=first.continuation,
        tool_results=[
            ToolResult(
                call_id="call-1",
                name="get_weather",
                output='{"temperature":25}',
            )
        ],
    )

    first_kwargs = client.responses.create.call_args_list[0].kwargs
    assert first_kwargs["tools"][0]["name"] == "get_weather"
    assert first_kwargs["tools"][0]["strict"] is True
    assert first.tool_calls[0].arguments == {"city": "北京"}
    second_input = client.responses.create.call_args_list[1].kwargs["input"]
    assert second_input[1]["type"] == "reasoning"
    assert second_input[2]["type"] == "function_call"
    assert second_input[3] == {
        "type": "function_call_output",
        "call_id": "call-1",
        "output": '{"temperature":25}',
    }
    assert second.text == "北京晴。"


def test_responses_adapter_maps_multimodal_structured_request() -> None:
    client = Mock()
    client.responses.create.return_value = {
        "id": "resp-vision",
        "output_text": '{"answer":"相机"}',
        "output": [{"type": "message", "id": "msg-vision"}],
    }
    provider = OpenAIResponsesProvider(client, name="gateway")
    vision_request = ProviderRequest(
        model="vision-model",
        messages=[
            AIMessage(
                role="user",
                content=[
                    TextContentPart(text="识别图片"),
                    ImageContentPart(
                        image_url="https://example.com/camera.jpg",
                        detail="auto",
                    ),
                ],
            )
        ],
        structured_output=StructuredOutputDefinition.from_model(
            name="vision_answer",
            output_model=StructuredAnswer,
        ),
        tool_choice="none",
    )

    provider.complete(vision_request)

    kwargs = client.responses.create.call_args.kwargs
    assert kwargs["input"][0]["content"] == [
        {"type": "input_text", "text": "识别图片"},
        {
            "type": "input_image",
            "image_url": "https://example.com/camera.jpg",
            "detail": "auto",
        },
    ]
    assert kwargs["text"]["format"]["type"] == "json_schema"
    assert kwargs["text"]["format"]["name"] == "vision_answer"


def test_chat_adapter_uses_nested_tool_schema_and_tool_messages() -> None:
    client = Mock()
    client.chat.completions.create.side_effect = [
        {
            "id": "chat-1",
            "choices": [
                {
                    "finish_reason": "tool_calls",
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call-1",
                                "type": "function",
                                "function": {
                                    "name": "get_weather",
                                    "arguments": '{"city":"北京"}',
                                },
                            }
                        ],
                    }
                }
            ],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 5,
                "total_tokens": 15,
            },
        },
        {
            "id": "chat-2",
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {
                        "role": "assistant",
                        "content": "北京晴。",
                    }
                }
            ],
        },
    ]
    provider = ChatCompletionsProvider(
        client,
        name="deepseek",
        extra_body={"thinking": {"type": "disabled"}},
        strict_tools=True,
    )

    first = provider.complete(request())
    second = provider.complete(
        request(),
        continuation=first.continuation,
        tool_results=[
            ToolResult(
                call_id="call-1",
                name="get_weather",
                output='{"temperature":25}',
            )
        ],
    )

    first_kwargs = client.chat.completions.create.call_args_list[0].kwargs
    function = first_kwargs["tools"][0]["function"]
    assert function["name"] == "get_weather"
    assert function["strict"] is True
    assert first_kwargs["extra_body"] == {
        "thinking": {"type": "disabled"}
    }
    second_messages = client.chat.completions.create.call_args_list[1].kwargs[
        "messages"
    ]
    assert second_messages[-1] == {
        "role": "tool",
        "tool_call_id": "call-1",
        "content": '{"temperature":25}',
    }
    assert second.text == "北京晴。"


def test_responses_stream_emits_common_events() -> None:
    client = Mock()
    client.responses.create.return_value = iter(
        [
            {
                "type": "response.output_text.delta",
                "delta": "北",
            },
            {
                "type": "response.completed",
                "response": {
                    "id": "resp-1",
                    "output_text": "北京晴。",
                    "output": [{"type": "message", "id": "msg-1"}],
                },
            },
        ]
    )
    provider = OpenAIResponsesProvider(client)

    events = list(provider.stream(request()))

    assert events[0].type == "text_delta"
    assert events[0].delta == "北"
    assert events[1].type == "completed"
    assert events[1].response is not None
    assert events[1].response.text == "北京晴。"


def test_chat_adapter_omits_strict_for_generic_provider_by_default() -> None:
    client = Mock()
    client.chat.completions.create.return_value = {
        "id": "chat-1",
        "choices": [
            {
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": "done"},
            }
        ],
    }

    ChatCompletionsProvider(client, name="deepseek").complete(request())

    function = client.chat.completions.create.call_args.kwargs["tools"][0][
        "function"
    ]
    assert "strict" not in function


def test_responses_adapter_maps_structured_output_schema() -> None:
    client = Mock()
    client.responses.create.return_value = {
        "id": "resp-1",
        "status": "completed",
        "output_text": '{"answer":"done"}',
        "output": [],
    }
    structured_request = request().model_copy(
        update={
            "structured_output": StructuredOutputDefinition.from_model(
                name="answer",
                output_model=StructuredAnswer,
            )
        }
    )

    OpenAIResponsesProvider(client).complete(structured_request)

    output_format = client.responses.create.call_args.kwargs["text"][
        "format"
    ]
    assert output_format["type"] == "json_schema"
    assert output_format["name"] == "answer"
    assert output_format["schema"]["additionalProperties"] is False


@pytest.mark.parametrize(
    ("mode", "expected_type"),
    [("json_object", "json_object"), ("json_schema", "json_schema")],
)
def test_chat_adapter_maps_structured_output_mode(
    mode: str,
    expected_type: str,
) -> None:
    client = Mock()
    client.chat.completions.create.return_value = {
        "choices": [
            {
                "finish_reason": "stop",
                "message": {
                    "role": "assistant",
                    "content": '{"answer":"done"}',
                },
            }
        ]
    }
    structured_request = request().model_copy(
        update={
            "structured_output": StructuredOutputDefinition.from_model(
                name="answer",
                output_model=StructuredAnswer,
            )
        }
    )

    ChatCompletionsProvider(
        client,
        structured_output_mode=mode,
    ).complete(structured_request)

    response_format = client.chat.completions.create.call_args.kwargs[
        "response_format"
    ]
    assert response_format["type"] == expected_type


def test_chat_adapter_rejects_unconfigured_structured_output() -> None:
    client = Mock()
    structured_request = request().model_copy(
        update={
            "structured_output": StructuredOutputDefinition.from_model(
                name="answer",
                output_model=StructuredAnswer,
            )
        }
    )

    with pytest.raises(AIConfigurationError, match="structured"):
        ChatCompletionsProvider(client).complete(structured_request)


def test_chat_continuation_is_sanitized_and_preserves_reasoning() -> None:
    client = Mock()
    client.chat.completions.create.return_value = {
        "id": "chat-1",
        "choices": [
            {
                "finish_reason": "tool_calls",
                "message": {
                    "role": "assistant",
                    "content": None,
                    "reasoning_content": "internal trace",
                    "annotations": [{"output_only": True}],
                    "tool_calls": [
                        {
                            "id": "call-1",
                            "type": "function",
                            "function": {
                                "name": "get_weather",
                                "arguments": '{"city":"Beijing"}',
                            },
                        }
                    ],
                },
            }
        ],
    }

    response = ChatCompletionsProvider(client).complete(request())
    assistant = response.continuation.messages[-1]

    assert assistant["reasoning_content"] == "internal trace"
    assert "annotations" not in assistant
    assert assistant["tool_calls"][0]["id"] == "call-1"


def test_chat_adapter_rejects_truncated_completion() -> None:
    client = Mock()
    client.chat.completions.create.return_value = {
        "choices": [
            {
                "finish_reason": "length",
                "message": {"role": "assistant", "content": "partial"},
            }
        ]
    }

    with pytest.raises(ProviderIncompleteError):
        ChatCompletionsProvider(client).complete(request())


def test_chat_adapter_requires_finish_reason() -> None:
    client = Mock()
    client.chat.completions.create.return_value = {
        "choices": [
            {
                "message": {"role": "assistant", "content": "maybe done"},
            }
        ]
    }

    with pytest.raises(ProviderProtocolError, match="finish reason"):
        ChatCompletionsProvider(client).complete(request())


def test_chat_adapter_requires_explicit_reasoning_mapping() -> None:
    client = Mock()
    reasoning_request = request().model_copy(
        update={"reasoning_effort": "low"}
    )

    with pytest.raises(AIConfigurationError, match="mapping"):
        ChatCompletionsProvider(client).complete(reasoning_request)

    client.chat.completions.create.assert_not_called()


def test_chat_adapter_maps_configured_reasoning_effort() -> None:
    client = Mock()
    client.chat.completions.create.return_value = {
        "choices": [
            {
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": "done"},
            }
        ]
    }
    reasoning_request = request().model_copy(
        update={"reasoning_effort": "high"}
    )

    ChatCompletionsProvider(
        client,
        reasoning_effort_parameter="reasoning_effort",
    ).complete(reasoning_request)

    assert (
        client.chat.completions.create.call_args.kwargs["reasoning_effort"]
        == "high"
    )


def test_chat_stream_preserves_reasoning_and_tool_continuation() -> None:
    client = Mock()
    client.chat.completions.create.return_value = iter(
        [
            {
                "id": "chat-1",
                "choices": [
                    {"delta": {"reasoning_content": "reason "}}
                ],
            },
            {
                "id": "chat-1",
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "call-1",
                                    "function": {
                                        "name": "get_weather",
                                        "arguments": '{"city":',
                                    },
                                }
                            ]
                        }
                    }
                ],
            },
            {
                "id": "chat-1",
                "choices": [
                    {
                        "finish_reason": "tool_calls",
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "function": {
                                        "arguments": '"Beijing"}',
                                    },
                                }
                            ]
                        },
                    }
                ],
            },
        ]
    )

    events = list(ChatCompletionsProvider(client).stream(request()))
    response = events[-1].response

    assert response is not None
    assert response.tool_calls[0].arguments == {"city": "Beijing"}
    assistant = response.continuation.messages[-1]
    assert assistant["reasoning_content"] == "reason "
    assert assistant["tool_calls"][0]["id"] == "call-1"


def test_responses_adapter_rejects_incomplete_response() -> None:
    client = Mock()
    client.responses.create.return_value = {
        "id": "resp-1",
        "status": "incomplete",
        "incomplete_details": {"reason": "max_output_tokens"},
        "output": [],
    }

    with pytest.raises(ProviderIncompleteError) as caught:
        OpenAIResponsesProvider(client).complete(request())

    assert caught.value.details == {"reason": "max_output_tokens"}


def test_responses_stream_rejects_failed_event() -> None:
    client = Mock()
    client.responses.create.return_value = iter(
        [
            {
                "type": "response.failed",
                "response": {
                    "status": "failed",
                    "error": {"code": "server_error"},
                },
            }
        ]
    )

    with pytest.raises(ProviderUnavailableError):
        list(OpenAIResponsesProvider(client).stream(request()))


def test_responses_adapter_rejects_missing_tool_call_identity() -> None:
    client = Mock()
    client.responses.create.return_value = {
        "id": "resp-1",
        "status": "completed",
        "output": [
            {
                "type": "function_call",
                "id": "fc-1",
                "name": "get_weather",
                "arguments": "{}",
            }
        ],
    }

    with pytest.raises(ProviderProtocolError):
        OpenAIResponsesProvider(client).complete(request())


@pytest.mark.parametrize("adapter_name", ["responses", "chat"])
def test_adapters_map_malformed_usage_to_protocol_error(
    adapter_name: str,
) -> None:
    client = Mock()
    if adapter_name == "responses":
        client.responses.create.return_value = {
            "id": "resp-1",
            "status": "completed",
            "output_text": "done",
            "output": [],
            "usage": {"input_tokens": "not-a-number"},
        }
        provider = OpenAIResponsesProvider(client)
    else:
        client.chat.completions.create.return_value = {
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {
                        "role": "assistant",
                        "content": "done",
                    },
                }
            ],
            "usage": {"prompt_tokens": "not-a-number"},
        }
        provider = ChatCompletionsProvider(client)

    with pytest.raises(ProviderProtocolError, match="malformed"):
        provider.complete(request())


def test_openai_error_mapping_distinguishes_4xx_from_retryable_errors() -> None:
    bad_request = OpenAIError("bad request")
    bad_request.status_code = 400
    unauthorized = OpenAIError("unauthorized")
    unauthorized.status_code = 401
    rate_limit = OpenAIError("rate limit")
    rate_limit.status_code = 429

    rejected = map_openai_error(
        bad_request,
        provider="gateway",
        operation="Responses",
    )
    retryable = map_openai_error(
        rate_limit,
        provider="gateway",
        operation="Responses",
    )
    configuration = map_openai_error(
        unauthorized,
        provider="gateway",
        operation="Responses",
    )

    assert isinstance(rejected, ProviderProtocolError)
    assert rejected.retryable is False
    assert isinstance(configuration, AIConfigurationError)
    assert configuration.retryable is False
    assert isinstance(retryable, ProviderUnavailableError)
    assert retryable.retryable is True
