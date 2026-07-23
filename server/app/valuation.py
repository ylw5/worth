import statistics

from .models import MarketCandidate, ValuationResult


def build_valuation(
    query: str,
    candidates: list[MarketCandidate],
    matching_ids: set[str],
) -> ValuationResult:
    samples = [item for item in candidates if item.item_id in matching_ids]
    if len(samples) < 5:
        return ValuationResult(
            estimated_price=None,
            price_low=None,
            price_high=None,
            sample_count=len(samples),
            query=query,
            sample_summary=samples,
        )

    prices = sorted(item.price for item in samples)
    quartiles = statistics.quantiles(prices, n=4, method="inclusive")
    return ValuationResult(
        estimated_price=round(statistics.median(prices), 2),
        price_low=round(quartiles[0], 2),
        price_high=round(quartiles[2], 2),
        sample_count=len(samples),
        query=query,
        sample_summary=samples,
    )
