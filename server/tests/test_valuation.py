from app.models import MarketCandidate
from app.valuation import build_valuation


def candidates(*prices: float) -> list[MarketCandidate]:
    return [
        MarketCandidate(item_id=str(index), title=f"item {index}", price=price)
        for index, price in enumerate(prices)
    ]


def test_builds_median_and_quartile_range() -> None:
    items = candidates(100, 200, 300, 400, 500)

    result = build_valuation(
        "camera",
        items,
        {item.item_id for item in items},
    )

    assert result.estimated_price == 300
    assert result.price_low == 200
    assert result.price_high == 400
    assert result.sample_count == 5


def test_refuses_too_few_samples() -> None:
    items = candidates(100, 200, 300, 400, 500)

    result = build_valuation("camera", items, {"0", "1", "2", "3"})

    assert result.estimated_price is None
    assert result.sample_count == 4
