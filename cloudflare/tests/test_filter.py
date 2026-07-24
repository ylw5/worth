from filter import summarize
from models import Sample


def test_summarize_deduplicates_and_uses_quartile_range():
    samples = [
        Sample(
            item_id=str(i),
            title=f"item {i}",
            price=price,
            url=f"https://x/{i}",
        )
        for i, price in enumerate([80, 90, 100, 110, 120, 999])
    ]
    result = summarize("camera", samples + [samples[2]])
    assert result.estimated_price == 105
    assert result.price_low == 92.5
    assert result.price_high == 117.5
    assert result.sample_count == 6
