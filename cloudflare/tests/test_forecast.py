from datetime import date, timedelta

from src.forecast import forecast
from src.models import Evidence, ValuationProfile

PROFILE = ValuationProfile(category="数码", brand="A", model="B")


def test_uses_own_history_after_four_points_and_21_days():
    start = date(2026, 1, 1)
    snapshots = [
        {
            "snapshot_date": (start + timedelta(days=i * 10)).isoformat(),
            "estimated_price": 1000 - i * 50,
        }
        for i in range(4)
    ]
    result = forecast(850, snapshots, [], PROFILE, [])
    assert result.method == "own_history"
    assert result.value_6m < 850
    assert result.value_12m < result.value_6m


def test_falls_back_to_comparable_retention():
    evidence = [
        Evidence(
            query="q",
            url=f"https://example.com/{i}",
            title="x",
            summary="x",
            retrieved_at="2026-07-24T00:00:00Z",
            relevant=True,
            release_date=date(2025 - i, 1, 1),
            original_retail_price=1000,
            current_price=800 - i * 100,
            spec_match=0.9,
        )
        for i in range(3)
    ]
    result = forecast(800, [], evidence, PROFILE, evidence)
    assert result.method == "comparable_retention"
    assert result.value_12m is not None


def test_withholds_number_when_evidence_is_insufficient():
    result = forecast(800, [], [], PROFILE, [])
    assert result.method == "unavailable"
    assert result.value_6m is None
    assert result.confidence == 0
