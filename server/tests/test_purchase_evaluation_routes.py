from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.ai.contracts import (
    AgentRunResult,
    AgentStreamEvent,
)
from app.auth import AuthenticatedUser
from app.config import Settings
from app.main import (
    chat_about_purchase,
    evaluate_purchase,
    stream_chat_about_purchase,
)
from app.models import (
    EvaluationAsset,
    EvaluationChatMessage,
    EvaluationChatRequest,
    EvaluationFacts,
    ParsedProduct,
    PurchaseEvaluationRequest,
)


def product() -> ParsedProduct:
    return ParsedProduct(
        title="New phone",
        category="数码",
        subcategory="手机",
        source_type="text",
        source_text="I want a phone",
    )


def client_asset() -> EvaluationAsset:
    return EvaluationAsset(
        id="client-asset",
        name="Untrusted asset",
        category="数码",
        subcategory="手机",
        status="sold",
    )


def user() -> AuthenticatedUser:
    return AuthenticatedUser(id="user-1", access_token="token")


def make_db() -> MagicMock:
    client = MagicMock()
    chain = client.table.return_value
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.order.return_value = chain
    chain.limit.return_value = chain
    chain.execute.return_value = MagicMock(
        data=[
            {
                "id": "server-asset",
                "name": "Confirmed phone",
                "brand": "",
                "model": "",
                "category": "数码",
                "subcategory": "手机",
                "status": "in_use",
            }
        ]
    )
    return client


def chat_request() -> EvaluationChatRequest:
    return EvaluationChatRequest(
        product=product(),
        matched_assets=[client_asset()],
        facts=EvaluationFacts(
            total=99,
            in_use=0,
            idle=0,
            listed=0,
            sold=99,
        ),
        messages=[
            EvaluationChatMessage(role="user", content="What do I own?")
        ],
    )


def test_evaluate_route_reloads_authoritative_assets(
    monkeypatch,
) -> None:
    monkeypatch.setattr("app.main.get_user_supabase", lambda token: make_db())
    monkeypatch.setattr(
        "app.main.get_settings",
        lambda: Settings(
            deepseek_api_key="",
            ai_gateway_api_key="",
        ),
    )
    request = PurchaseEvaluationRequest(
        product=product(),
        assets=[client_asset()],
    )

    result = evaluate_purchase(request, user())

    assert [asset.id for asset in result.matched_assets] == [
        "server-asset"
    ]
    assert result.facts.in_use == 1
    assert result.facts.sold == 0
    assert "不代表本次购买建议" in result.narrative


def test_chat_route_passes_rebuilt_facts_to_workflow(monkeypatch) -> None:
    workflow = MagicMock()
    workflow.run.return_value = AgentRunResult(
        text="事实回复",
        provider="provider",
        model="model",
        profile="profile",
        steps=1,
    )
    monkeypatch.setattr("app.main.get_user_supabase", lambda token: make_db())
    monkeypatch.setattr(
        "app.main.build_purchase_evaluation_workflow",
        lambda *args, **kwargs: SimpleNamespace(workflow=workflow),
    )

    response = chat_about_purchase(chat_request(), user())

    assert response.message == "事实回复"
    passed_assets = workflow.run.call_args.args[1]
    passed_facts = workflow.run.call_args.args[2]
    assert [asset.id for asset in passed_assets] == ["server-asset"]
    assert passed_facts.total == 1
    assert passed_facts.sold == 0


def test_stream_route_emits_only_text_events(monkeypatch) -> None:
    workflow = MagicMock()
    workflow.stream.return_value = iter(
        [
            AgentStreamEvent(type="tool_started"),
            AgentStreamEvent(type="text_delta", delta="事实"),
            AgentStreamEvent(type="text_delta", delta="回复"),
        ]
    )
    monkeypatch.setattr("app.main.get_user_supabase", lambda token: make_db())
    monkeypatch.setattr(
        "app.main.build_purchase_evaluation_workflow",
        lambda *args, **kwargs: SimpleNamespace(workflow=workflow),
    )

    response = stream_chat_about_purchase(chat_request(), user())

    async def collect_chunks() -> list[str]:
        return [chunk async for chunk in response.body_iterator]

    chunks = asyncio.run(collect_chunks())

    assert chunks == [
        'data: {"delta": "事实"}\n\n',
        'data: {"delta": "回复"}\n\n',
        "data: [DONE]\n\n",
    ]
