from datetime import datetime, timedelta, timezone

from app.sell_plan_orchestration import (
    classify_sell_plan_assets,
    prepare_sell_plan_from_assets,
    sell_plan_input_fingerprint,
)


NOW = datetime(2026, 7, 25, 8, tzinfo=timezone.utc)


def asset(
    asset_id: str,
    *,
    status: str = "in_use",
    confirmed: bool = False,
    price: float | None = 1000,
    valued_at: datetime | None = NOW,
) -> dict:
    return {
        "id": asset_id,
        "name": f"asset-{asset_id}",
        "status": status,
        "status_confirmed_at": (
            NOW.isoformat() if confirmed else None
        ),
        "latest_market_price": price,
        "latest_market_price_low": (
            round(price * 0.8, 2) if price is not None else None
        ),
        "latest_valuation_at": (
            valued_at.isoformat() if valued_at else None
        ),
    }


def test_unconfirmed_valued_asset_is_potential_not_candidate() -> None:
    prepared = prepare_sell_plan_from_assets(
        2000,
        [asset("legacy")],
        now=NOW,
    )

    assert prepared.readiness_counts.needs_confirmation == 1
    assert prepared.unconfirmed_potential_total == 800
    assert prepared.confirmed_sellable_total == 0
    assert prepared.plan.items == []


def test_only_confirmed_fresh_sellable_assets_enter_optimizer() -> None:
    prepared = prepare_sell_plan_from_assets(
        1000,
        [
            asset("ready", status="idle", confirmed=True, price=1300),
            asset("holding", status="in_use", confirmed=True, price=9000),
            asset(
                "stale",
                status="listed",
                confirmed=True,
                price=5000,
                valued_at=NOW - timedelta(days=8),
            ),
        ],
        now=NOW,
    )

    assert [item.id for item in prepared.plan.items] == ["ready"]
    assert prepared.plan.estimated_total == 1040
    assert prepared.readiness_counts.ready == 1
    assert prepared.readiness_counts.excluded == 1
    assert prepared.readiness_counts.stale_valuation == 1


def test_confirmed_sellable_asset_without_price_needs_valuation() -> None:
    readiness = classify_sell_plan_assets(
        [
            asset(
                "missing",
                status="idle",
                confirmed=True,
                price=None,
                valued_at=None,
            )
        ],
        now=NOW,
    )

    assert readiness[0].readiness == "needs_valuation"


def test_fingerprint_changes_when_status_is_confirmed() -> None:
    before = [asset("one", status="idle", confirmed=False)]
    after = [asset("one", status="idle", confirmed=True)]

    assert sell_plan_input_fingerprint(
        1000,
        before,
    ) != sell_plan_input_fingerprint(1000, after)
