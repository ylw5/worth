from app.models import SellPlanAsset
from app.sell_plan import recommend_sell_plan


def asset(
    asset_id: str,
    price: float,
    status: str = "idle",
    low: float | None = None,
) -> SellPlanAsset:
    return SellPlanAsset(
        id=asset_id,
        name=f"asset-{asset_id}",
        status=status,
        estimated_price=price,
        price_low=low,
    )


def test_reaches_target_with_fewest_items_then_lowest_overage() -> None:
    result = recommend_sell_plan(
        5000,
        [
            asset("one", 5200),
            asset("two", 5100),
            asset("three", 3000),
            asset("four", 2000),
        ],
    )

    assert result.is_reachable is True
    assert [item.id for item in result.items] == ["two"]
    assert result.estimated_total == 5100


def test_uses_conservative_price_and_excludes_in_use_assets() -> None:
    result = recommend_sell_plan(
        4000,
        [
            asset("idle", 5000, low=3800),
            asset("used", 9000, status="in_use"),
        ],
    )

    assert result.is_reachable is False
    assert result.estimated_total == 3800
    assert [item.id for item in result.items] == ["idle"]


def test_returns_empty_plan_without_sellable_assets() -> None:
    result = recommend_sell_plan(
        1000,
        [asset("sold", 2000, status="sold")],
    )

    assert result.items == []
    assert result.coverage_ratio == 0


def test_pruning_preserves_fewest_item_objective() -> None:
    assets = [asset("single", 10000)]
    assets.extend(
        asset(str(index), 260 + index)
        for index in range(18)
    )

    result = recommend_sell_plan(5000, assets)

    assert [item.id for item in result.items] == ["single"]
