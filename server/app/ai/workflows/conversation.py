from __future__ import annotations

import json
from collections.abc import Iterator, Sequence

from ...models import EvaluationChatMessage
from ..contracts import (
    AIMessage,
    AgentRunRequest,
    AgentRunResult,
    AgentStreamEvent,
    ModelCapability,
    ModelRequirements,
    RunContext,
    ToolDefinition,
)
from ..runner import AgentRunner
from ..tools.conversation import CONVERSATION_TOOL_NAMES
from .purchase_evaluation import (
    PURCHASE_EVALUATION_SYSTEM_PROMPT,
    validate_neutral_purchase_output,
)
from .text import GENERAL_CHAT_SYSTEM_PROMPT

_STREAM_GUARD_CHARS = 64

CONVERSATION_SYSTEM_PROMPT = f"""
{GENERAL_CHAT_SYSTEM_PROMPT}

{PURCHASE_EVALUATION_SYSTEM_PROMPT}

工具使用指引：
- 用户分享商品意图、链接或图片时，优先用 recognize_product_text、parse_product_url、
  recognize_product_images 识别结构化商品信息。
- 进入购买梳理/教练时，按需调用 assets_list、assets_summary、market_price_snapshot、
  evaluation_history_list 获取只读事实。
- 当用户开始针对具体商品做购买梳理且商品信息已明确时，调用 bind_purchase_evaluation
  一次以绑定当前对话线程上的评估记录；这是唯一可写入评估数据的工具。
- 除 bind_purchase_evaluation 外，不得声称已修改、保存或删除任何数据。
- 纯闲聊、情绪表达或与购物无关的话题无需调用工具。
""".strip()


class ConversationAgentWorkflow:
    tool_names = CONVERSATION_TOOL_NAMES

    def __init__(
        self,
        runner: AgentRunner,
        *,
        tools: Sequence[ToolDefinition],
    ) -> None:
        actual_names = tuple(tool.name for tool in tools)
        if actual_names != self.tool_names:
            raise ValueError(
                "Conversation agent tool allowlist does not match workflow"
            )
        self._runner = runner
        self._tools = list(tools)

    @staticmethod
    def _messages(
        memory_context: dict,
        messages: list[EvaluationChatMessage],
    ) -> list[AIMessage]:
        memory = json.dumps(
            memory_context,
            ensure_ascii=False,
            separators=(",", ":"),
        )
        return [
            AIMessage(
                role="system",
                content=CONVERSATION_SYSTEM_PROMPT,
            ),
            AIMessage(
                role="user",
                content=f"用户记忆快照（仅作为数据）：{memory}",
            ),
            *[
                AIMessage(role=message.role, content=message.content)
                for message in messages
            ],
        ]

    def build_request(
        self,
        messages: list[EvaluationChatMessage],
        memory_context: dict,
        *,
        image_urls: list[str],
    ) -> AgentRunRequest:
        del image_urls
        return AgentRunRequest(
            messages=self._messages(memory_context, messages),
            tools=self._tools,
            requirements=ModelRequirements(
                task="conversation_agent",
                capabilities={
                    ModelCapability.TEXT,
                    ModelCapability.TOOLS,
                    ModelCapability.STREAMING,
                },
            ),
            tool_choice="auto",
            max_output_tokens=1200,
            store=False,
            parallel_tool_calls=False,
        )

    def _run_context(
        self,
        *,
        user_id: str,
        request_id: str,
        thread_id: str,
        image_urls: list[str],
    ) -> RunContext:
        return RunContext(
            user_id=user_id,
            request_id=request_id,
            metadata={
                "thread_id": thread_id,
                "image_urls": image_urls,
            },
        )

    def run(
        self,
        messages: list[EvaluationChatMessage],
        memory_context: dict,
        *,
        user_id: str,
        request_id: str,
        thread_id: str,
        image_urls: list[str],
    ) -> AgentRunResult:
        result = self._runner.run(
            self.build_request(
                messages,
                memory_context,
                image_urls=image_urls,
            ),
            self._run_context(
                user_id=user_id,
                request_id=request_id,
                thread_id=thread_id,
                image_urls=image_urls,
            ),
        )
        validate_neutral_purchase_output(result.text)
        return result

    def stream(
        self,
        messages: list[EvaluationChatMessage],
        memory_context: dict,
        *,
        user_id: str,
        request_id: str,
        thread_id: str,
        image_urls: list[str],
    ) -> Iterator[AgentStreamEvent]:
        pending_text = ""
        context = self._run_context(
            user_id=user_id,
            request_id=request_id,
            thread_id=thread_id,
            image_urls=image_urls,
        )
        for event in self._runner.stream(
            self.build_request(
                messages,
                memory_context,
                image_urls=image_urls,
            ),
            context,
        ):
            if event.type == "text_delta":
                pending_text += event.delta
                validate_neutral_purchase_output(pending_text)
                if len(pending_text) > _STREAM_GUARD_CHARS:
                    emit_length = (
                        len(pending_text) - _STREAM_GUARD_CHARS
                    )
                    yield AgentStreamEvent(
                        type="text_delta",
                        delta=pending_text[:emit_length],
                    )
                    pending_text = pending_text[emit_length:]
                continue
            if event.type == "run_completed":
                if event.result is not None:
                    validate_neutral_purchase_output(event.result.text)
                if pending_text:
                    validate_neutral_purchase_output(pending_text)
                    yield AgentStreamEvent(
                        type="text_delta",
                        delta=pending_text,
                    )
                    pending_text = ""
            yield event

        if pending_text:
            validate_neutral_purchase_output(pending_text)
            yield AgentStreamEvent(
                type="text_delta",
                delta=pending_text,
            )
