from unittest.mock import Mock

import pytest

from app.config import Settings
from app.deepseek_service import DeepSeekService
from app.models import (
    AssetInput,
    EvaluationChatMessage,
    EvaluationFacts,
    MarketCandidate,
    ParsedProduct,
)
from app.text_ai import build_text_ai


def response(content: str | None) -> Mock:
    return Mock(choices=[Mock(message=Mock(content=content))])


def service_with(content: str | None) -> DeepSeekService:
    service = object.__new__(DeepSeekService)
    service.client = Mock()
    service.client.chat.completions.create.return_value = response(content)
    service.model = "deepseek-v4-flash"
    return service


def test_classifies_product_with_json_mode_and_non_thinking() -> None:
    service = service_with(
        '{"normalized_title":"Sony WH-1000XM6",'
        '"category":"数码","subcategory":"耳机"}'
    )

    result = service.classify_product("Sony WH-1000XM6", "user")

    assert result.subcategory == "耳机"
    request = service.client.chat.completions.create.call_args.kwargs
    assert request["model"] == "deepseek-v4-flash"
    assert request["response_format"] == {"type": "json_object"}
    assert request["extra_body"] == {"thinking": {"type": "disabled"}}
    assert request["temperature"] == 0


def test_retries_once_when_json_content_is_empty() -> None:
    service = service_with(None)
    service.client.chat.completions.create.side_effect = [
        response(None),
        response(
            '{"normalized_title":"iPhone 17",'
            '"category":"数码","subcategory":"手机"}'
        ),
    ]

    result = service.classify_product("iPhone 17", "user")

    assert result.subcategory == "手机"
    assert service.client.chat.completions.create.call_count == 2


def test_filters_unknown_candidate_ids() -> None:
    service = service_with(
        '{"decisions":['
        '{"item_id":"known","same_product":true},'
        '{"item_id":"invented","same_product":true}]}'
    )
    asset = AssetInput(
        name="手机",
        category="数码",
        subcategory="手机",
        status="idle",
        condition="无法判断",
        search_query="iPhone",
    )

    result = service.matching_ids(
        asset,
        [MarketCandidate(item_id="known", title="iPhone", price=1000)],
        "user",
    )

    assert result == {"known"}


def test_rejects_invalid_structured_result() -> None:
    service = service_with('{"category":"数码"}')

    with pytest.raises(RuntimeError, match="invalid result"):
        service.classify_product("iPhone", "user")


def test_interprets_greeting_as_chat_intent() -> None:
    service = service_with(
        '{"intent":"chat","normalized_title":"","category":"其他",'
        '"subcategory":"","reply":"你好！想评估商品可以直接描述它。"}'
    )

    result = service.interpret_product_text("hello", "user")

    assert result.intent == "chat"
    assert result.reply == "你好！想评估商品可以直接描述它。"
    request = service.client.chat.completions.create.call_args.kwargs
    assert request["response_format"] == {"type": "json_object"}
    assert request["temperature"] == 0


def test_interprets_product_description_as_product_intent() -> None:
    service = service_with(
        '{"intent":"product","normalized_title":"Sony WH-1000XM6",'
        '"category":"数码","subcategory":"耳机","reply":""}'
    )

    result = service.interpret_product_text("索尼降噪耳机 XM6", "user")

    assert result.intent == "product"
    assert result.normalized_title == "Sony WH-1000XM6"
    assert result.subcategory == "耳机"


def test_text_ai_prefers_deepseek_when_configured() -> None:
    service = build_text_ai(
        Settings(
            deepseek_api_key="configured",
            _env_file=None,
        )
    )

    assert isinstance(service, DeepSeekService)


def test_continues_evaluation_with_prior_messages() -> None:
    service = service_with("先看看现在这副耳机的使用频率。")

    result = service.continue_evaluation(
        ParsedProduct(
            title="新耳机",
            category="数码",
            subcategory="耳机",
            source_type="text",
            source_text="新耳机",
        ),
        [],
        EvaluationFacts(total=0, in_use=0, idle=0, listed=0, sold=0),
        [EvaluationChatMessage(role="user", content="我需要降噪")],
        "user",
    )

    request = service.client.chat.completions.create.call_args.kwargs
    assert request["messages"][-1] == {
        "role": "user",
        "content": "我需要降噪",
    }
    assert result == "先看看现在这副耳机的使用频率。"


def test_general_chat_includes_memory_and_free_text() -> None:
    service = service_with("听起来今天确实挺累的，先别急着逼自己做决定。")

    result = service.continue_general_chat(
        [
            EvaluationChatMessage(
                role="user",
                content="烦死了，今天就想买点什么开心一下",
            )
        ],
        {
            "本月评估次数": 3,
            "已有后续结果": [
                {
                    "product_title": "耳机",
                    "outcome": "购买后已经闲置",
                }
            ],
        },
        "user",
    )

    request = service.client.chat.completions.create.call_args.kwargs
    assert request["messages"][-1]["content"] == (
        "烦死了，今天就想买点什么开心一下"
    )
    assert "本月评估次数" in request["messages"][0]["content"]
    assert "不必每句话都拉回购物" in request["messages"][0]["content"]
    assert result.startswith("听起来")


def stream_chunk(content: str | None) -> Mock:
    return Mock(choices=[Mock(delta=Mock(content=content))])


def test_streams_evaluation_deltas() -> None:
    service = object.__new__(DeepSeekService)
    service.client = Mock()
    service.model = "deepseek-v4-flash"
    service.client.chat.completions.create.return_value = iter(
        [
            stream_chunk("先看"),
            stream_chunk(None),
            stream_chunk("使用频率。"),
        ]
    )

    deltas = list(
        service.continue_evaluation_stream(
            ParsedProduct(
                title="新耳机",
                category="数码",
                subcategory="耳机",
                source_type="text",
                source_text="新耳机",
            ),
            [],
            EvaluationFacts(total=0, in_use=0, idle=0, listed=0, sold=0),
            [EvaluationChatMessage(role="user", content="我需要降噪")],
            "user",
        )
    )

    assert deltas == ["先看", "使用频率。"]
    request = service.client.chat.completions.create.call_args.kwargs
    assert request["stream"] is True
    assert request["messages"][-1] == {
        "role": "user",
        "content": "我需要降噪",
    }
