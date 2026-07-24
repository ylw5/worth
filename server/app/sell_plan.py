from __future__ import annotations

from .models import SellPlanAsset, SellPlanItem, SellPlanResult


MAX_STATES = 20_000


def _price_cents(asset: SellPlanAsset) -> int:
    return round((asset.price_low or asset.estimated_price) * 100)


def _partial_rank(
    total: int,
    indexes: tuple[int, ...],
    target: int,
) -> tuple[int, int, int]:
    if total >= target:
        return (0, len(indexes), total - target)
    return (1, target - total, len(indexes))


def recommend_sell_plan(
    target_price: float,
    assets: list[SellPlanAsset],
) -> SellPlanResult:
    candidates = [
        asset
        for asset in assets
        if asset.status in {"idle", "listed"} and _price_cents(asset) > 0
    ]
    target = round(target_price * 100)
    states: dict[int, tuple[int, ...]] = {0: ()}

    for index, asset in enumerate(candidates):
        price = _price_cents(asset)
        additions: dict[int, tuple[int, ...]] = {}
        for total, indexes in states.items():
            next_total = total + price
            next_indexes = (*indexes, index)
            existing = states.get(next_total) or additions.get(next_total)
            if existing is None or len(next_indexes) < len(existing):
                additions[next_total] = next_indexes
        states.update(additions)
        if len(states) > MAX_STATES:
            ranked = sorted(
                states.items(),
                key=lambda item: _partial_rank(item[0], item[1], target),
            )
            states = dict(ranked[:MAX_STATES])

    non_empty = [(total, indexes) for total, indexes in states.items() if indexes]
    reachable = [item for item in non_empty if item[0] >= target]
    if reachable:
        total, selected_indexes = min(
            reachable,
            key=lambda item: (len(item[1]), item[0] - target),
        )
    elif non_empty:
        total, selected_indexes = max(
            non_empty,
            key=lambda item: (item[0], -len(item[1])),
        )
    else:
        total, selected_indexes = 0, ()

    selected = [candidates[index] for index in selected_indexes]
    return SellPlanResult(
        target_price=round(target_price, 2),
        estimated_total=round(total / 100, 2),
        coverage_ratio=round(min(1, total / target), 4),
        is_reachable=total >= target,
        items=[
            SellPlanItem(
                id=asset.id,
                name=asset.name,
                status=asset.status,
                conservative_price=round(_price_cents(asset) / 100, 2),
                latest_valuation_at=asset.latest_valuation_at,
            )
            for asset in selected
        ],
    )
