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
- 进入具体商品的购买梳理后，最终决策前必须用 assets_list 或 assets_summary
  核对当前已有物品；商品型号足以搜索时还必须尝试 market_price_snapshot，
  工具不可用或样本不足时如实说明，不得编造市场价。
- 必须先获得至少一项用户自己的使用反馈（实际场景、频率、现有物品重叠或
  冲动来源）；首轮只有商品信息时继续追问，不得直接输出决策标记。
- evaluation_history_list 仅在过往购买经历确实有助于当前判断时调用。
- 仅在用户的心愿与当前对话有关时调用 wishlist_list，并按需要选择全部、
  待实现或已实现状态；不得声称通过该只读工具修改了心愿。
- 用户询问心愿资金或还差多少时调用 funding_summary；资金是用户级共享余额，
  不得声称未分配资金已归属于某个心愿。
- 用户询问卖哪些闲置可覆盖某个心愿时调用 wishlist_sell_plan_preview；
  必须使用工具返回的确定性组合，不自行替换资产，也不得声称已刷新行情或保存方案。
- 用户询问单件资产是否适合出售、状态或价格变化时调用 asset_decision_context；
  asset_sales 才是真实成交，market_snapshots 是市场样本，source=demo_seed
  必须明确称为演示数据，活跃挂牌样本不得描述成真实成交。
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
