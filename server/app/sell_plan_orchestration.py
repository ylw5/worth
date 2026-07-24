from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Any

from .models import (
    SellPlanAsset,
    SellPlanExplanation,
    SellPlanItemReason,
    SellPlanPreparedResult,
    SellPlanReadinessCounts,
    SellPlanReadinessItem,
)
from .sell_plan import recommend_sell_plan


CALCULATION_VERSION = "sell-plan-v2"
VALUATION_MAX_AGE = timedelta(days=7)


def _parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _positive_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _conservative_price(asset: dict[str, Any]) -> float | None:
    return _positive_number(
        asset.get("latest_market_price_low")
        or asset.get("latest_market_price")
    )


def classify_sell_plan_assets(
    assets: list[dict[str, Any]],
    *,
    now: datetime | None = None,
) -> list[SellPlanReadinessItem]:
    current_time = now or datetime.now(timezone.utc)
    result: list[SellPlanReadinessItem] = []

    for asset in assets:
        status = asset.get("status")
        if status == "sold":
            continue
        confirmed_at = _parse_timestamp(asset.get("status_confirmed_at"))
        valuation_at = _parse_timestamp(asset.get("latest_valuation_at"))
        price = _conservative_price(asset)

        if confirmed_at is None:
            readiness = "needs_confirmation"
        elif status == "in_use":
            readiness = "excluded"
        elif price is None or valuation_at is None:
            readiness = "needs_valuation"
        elif current_time - valuation_at > VALUATION_MAX_AGE:
            readiness = "stale_valuation"
        else:
            readiness = "ready"

        result.append(
            SellPlanReadinessItem(
                id=str(asset["id"]),
                name=str(asset["name"]),
                status=status,
                readiness=readiness,
                conservative_price=price,
                latest_valuation_at=asset.get("latest_valuation_at"),
                status_confirmed_at=asset.get("status_confirmed_at"),
            )
        )
    return result


def readiness_counts(
    readiness: list[SellPlanReadinessItem],
) -> SellPlanReadinessCounts:
    counts = {
        "needs_confirmation": 0,
        "needs_valuation": 0,
        "stale_valuation": 0,
        "ready": 0,
        "excluded": 0,
    }
    for item in readiness:
        counts[item.readiness] += 1
    return SellPlanReadinessCounts(**counts)


def sell_plan_input_fingerprint(
    target_price: float,
    assets: list[dict[str, Any]],
) -> str:
    normalized = [
        {
            "id": str(asset.get("id", "")),
            "status": asset.get("status"),
            "status_confirmed_at": asset.get("status_confirmed_at"),
            "latest_market_price": asset.get("latest_market_price"),
            "latest_market_price_low": asset.get(
                "latest_market_price_low"
            ),
            "latest_valuation_at": asset.get("latest_valuation_at"),
        }
        for asset in sorted(assets, key=lambda item: str(item.get("id", "")))
        if asset.get("status") != "sold"
    ]
    payload = json.dumps(
        {
            "calculation_version": CALCULATION_VERSION,
            "target_price": round(target_price, 2),
            "assets": normalized,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def fallback_sell_plan_explanation(
    *,
    target_price: float,
    estimated_total: float,
    is_reachable: bool,
    selected_items: list[dict[str, Any]],
    counts: SellPlanReadinessCounts,
) -> SellPlanExplanation:
    if selected_items:
        coverage = min(100, round(estimated_total / target_price * 100))
        summary = (
            f"已按保守估价选出 {len(selected_items)} 件资产，"
            f"预计 ¥{estimated_total:.2f}，"
            + (
                "可以覆盖当前目标。"
                if is_reachable
                else f"约覆盖目标的 {coverage}%。"
            )
        )
    elif counts.needs_confirmation:
        summary = (
            f"先确认 {counts.needs_confirmation} 件资产的当前状态，"
            "确认闲置或出售中后才能进入组合。"
        )
    elif counts.needs_valuation or counts.stale_valuation:
        waiting = counts.needs_valuation + counts.stale_valuation
        summary = f"有 {waiting} 件已确认可卖资产等待有效估价。"
    else:
        summary = "目前没有已确认且估价有效的可卖资产。"

    gaps = []
    if counts.needs_confirmation:
        gaps.append(f"{counts.needs_confirmation} 件资产尚未确认状态")
    if counts.needs_valuation:
        gaps.append(f"{counts.needs_valuation} 件资产尚未估价")
    if counts.stale_valuation:
        gaps.append(f"{counts.stale_valuation} 件资产估价已过期")

    return SellPlanExplanation(
        summary=summary,
        item_reasons=[
            SellPlanItemReason(
                item_id=str(item["id"]),
                reason=(
                    f"已确认可卖，按保守估价 ¥"
                    f"{float(item['conservative_price']):.2f} 计入。"
                ),
            )
            for item in selected_items
        ],
        evidence_gaps=gaps,
        question="",
    )


def prepare_sell_plan_from_assets(
    target_price: float,
    assets: list[dict[str, Any]],
    *,
    now: datetime | None = None,
    refresh_failures: int = 0,
    explanation: SellPlanExplanation | None = None,
) -> SellPlanPreparedResult:
    readiness = classify_sell_plan_assets(assets, now=now)
    counts = readiness_counts(readiness)
    ready_ids = {
        item.id for item in readiness if item.readiness == "ready"
    }
    candidates = [
        SellPlanAsset(
            id=str(asset["id"]),
            name=str(asset["name"]),
            status=asset["status"],
            estimated_price=(
                _positive_number(asset.get("latest_market_price"))
                or _conservative_price(asset)
                or 0
            ),
            price_low=_positive_number(
                asset.get("latest_market_price_low")
            ),
            latest_valuation_at=asset.get("latest_valuation_at"),
        )
        for asset in assets
        if str(asset.get("id")) in ready_ids
        and _conservative_price(asset)
    ]
    plan = recommend_sell_plan(target_price, candidates)
    confirmed_sellable_total = round(
        sum(
            item.conservative_price or 0
            for item in readiness
            if item.readiness == "ready"
        ),
        2,
    )
    unconfirmed_potential_total = round(
        sum(
            item.conservative_price or 0
            for item in readiness
            if item.readiness == "needs_confirmation"
        ),
        2,
    )
    valuation_dates = [
        item.latest_valuation_at
        for item in readiness
        if item.readiness == "ready" and item.latest_valuation_at
    ]
    fallback = fallback_sell_plan_explanation(
        target_price=target_price,
        estimated_total=plan.estimated_total,
        is_reachable=plan.is_reachable,
        selected_items=[
            item.model_dump(mode="json") for item in plan.items
        ],
        counts=counts,
    )
    return SellPlanPreparedResult(
        plan=plan,
        readiness=readiness,
        readiness_counts=counts,
        confirmed_sellable_total=confirmed_sellable_total,
        unconfirmed_potential_total=unconfirmed_potential_total,
        refresh_failures=refresh_failures,
        input_fingerprint=sell_plan_input_fingerprint(
            target_price,
            assets,
        ),
        calculation_version=CALCULATION_VERSION,
        valuation_as_of=max(valuation_dates) if valuation_dates else None,
        explanation=explanation or fallback,
    )
