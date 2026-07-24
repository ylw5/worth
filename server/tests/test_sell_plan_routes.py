from datetime import date, datetime, timezone
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.auth import AuthenticatedUser
from app.main import prepare_sell_plan
from app.models import SellPlanPrepareRequest


def user() -> AuthenticatedUser:
    return AuthenticatedUser(id="user-1", access_token="token")


def fluent_chain(data: list[dict]) -> MagicMock:
    chain = MagicMock()
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.neq.return_value = chain
    chain.order.return_value = chain
    chain.limit.return_value = chain
    chain.upsert.return_value = chain
    chain.execute.return_value = MagicMock(data=data)
    return chain


def request() -> SellPlanPrepareRequest:
    return SellPlanPrepareRequest(
        wishlist_item_id="wishlist-1",
        plan_date=date(2026, 7, 25),
    )


def test_prepare_route_loads_authoritative_assets_and_saves_snapshot(
    monkeypatch,
) -> None:
    wishlist = fluent_chain(
        [
            {
                "id": "wishlist-1",
                "user_id": "user-1",
                "name": "Ticket",
                "target_price": 1000,
            }
        ]
    )
    assets = fluent_chain(
        [
            {
                "id": "asset-1",
                "name": "Camera",
                "status": "idle",
                "status_confirmed_at": datetime.now(
                    timezone.utc
                ).isoformat(),
                "latest_market_price": 1200,
                "latest_market_price_low": 1000,
                "latest_valuation_at": datetime.now(
                    timezone.utc
                ).isoformat(),
            }
        ]
    )
    snapshots = fluent_chain([])
    client = MagicMock()
    client.table.side_effect = lambda name: {
        "wishlist_items": wishlist,
        "assets": assets,
        "sell_plan_snapshots": snapshots,
    }[name]
    monkeypatch.setattr(
        "app.main.get_user_supabase",
        lambda token: client,
    )
    monkeypatch.setattr(
        "app.main._explain_sell_plan",
        lambda prepared, **kwargs: prepared,
    )

    result = prepare_sell_plan(request(), user())

    assert [item.id for item in result.plan.items] == ["asset-1"]
    assert result.confirmed_sellable_total == 1000
    snapshot = snapshots.upsert.call_args.args[0]
    assert snapshot["input_fingerprint"] == result.input_fingerprint
    assert snapshot["calculation_version"] == "sell-plan-v2"
    assert snapshot["readiness_counts"]["ready"] == 1


def test_prepare_route_returns_not_found_for_foreign_wishlist(
    monkeypatch,
) -> None:
    client = MagicMock()
    client.table.return_value = fluent_chain([])
    monkeypatch.setattr(
        "app.main.get_user_supabase",
        lambda token: client,
    )

    with pytest.raises(HTTPException) as caught:
        prepare_sell_plan(request(), user())

    assert caught.value.status_code == 404
