from datetime import date
from math import exp, log, sqrt

from models import Evidence, ForecastResult, ValuationProfile


def _fit(points: list[tuple[float, float]]) -> tuple[float, float]:
    xs = [point[0] for point in points]
    ys = [log(point[1]) for point in points]
    x_mean = sum(xs) / len(xs)
    y_mean = sum(ys) / len(ys)
    denominator = sum((x - x_mean) ** 2 for x in xs)
    if denominator == 0:
        raise ValueError("forecast observations have no time span")
    slope = sum(
        (x - x_mean) * (y - y_mean)
        for x, y in zip(xs, ys, strict=True)
    ) / denominator
    residuals = [
        y - (y_mean + slope * (x - x_mean))
        for x, y in zip(xs, ys, strict=True)
    ]
    error = sqrt(sum(value * value for value in residuals) / len(residuals))
    return slope, error


def _result(
    method,
    current,
    slope,
    error,
    confidence,
    reason,
    profile,
    evidence,
):
    def values(days):
        center = max(1, current * exp(slope * days))
        spread = max(
            current * 0.05,
            current
            * min(
                0.5,
                error + (1 - confidence) * 0.25 + days / 3650,
            ),
        )
        return tuple(
            round(value, 2)
            for value in (center, max(1, center - spread), center + spread)
        )

    six = values(183)
    twelve = values(365)
    return ForecastResult(
        method=method,
        value_6m=six[0],
        low_6m=six[1],
        high_6m=six[2],
        value_12m=twelve[0],
        low_12m=twelve[1],
        high_12m=twelve[2],
        confidence=round(confidence, 3),
        reason=reason,
        profile=profile,
        evidence=evidence,
    )


def forecast(
    current_value: float,
    snapshots: list[dict],
    comparables: list[Evidence],
    profile: ValuationProfile,
    evidence: list[Evidence],
) -> ForecastResult:
    ordered = sorted(snapshots, key=lambda row: row["snapshot_date"])
    if len(ordered) >= 4:
        start = date.fromisoformat(ordered[0]["snapshot_date"])
        span = (
            date.fromisoformat(ordered[-1]["snapshot_date"]) - start
        ).days
        if span >= 21:
            points = [
                (
                    (
                        date.fromisoformat(row["snapshot_date"]) - start
                    ).days,
                    float(row["estimated_price"]),
                )
                for row in ordered
            ]
            slope, error = _fit(points)
            confidence = min(
                0.95,
                min(len(points) / 12, 1) * 0.30
                + min(span / 90, 1) * 0.25
                + 0.45,
            )
            return _result(
                "own_history",
                current_value,
                slope,
                error,
                confidence,
                f"基于 {len(points)} 个历史快照，跨度 {span} 天",
                profile,
                evidence,
            )

    today = date.today()
    accepted = [
        item
        for item in comparables
        if item.relevant
        and item.release_date
        and item.original_retail_price
        and item.current_price
        and item.spec_match >= 0.7
    ]
    points = []
    valid = []
    for item in accepted:
        age = max(1, (today - item.release_date).days)
        retention = item.current_price / item.original_retail_price
        if 0.03 <= retention <= 2:
            points.append((age, retention))
            valid.append(item)
    if len(points) >= 3:
        slope, error = _fit(points)
        source_count = len({item.site_name or item.url for item in valid})
        average_match = sum(item.spec_match for item in valid) / len(valid)
        age_span = max(point[0] for point in points) - min(
            point[0] for point in points
        )
        confidence = min(
            0.85,
            min(len(points) / 8, 1) * 0.30
            + min(age_span / 730, 1) * 0.25
            + min(source_count / 3, 1) * 0.20
            + average_match * 0.15
            + 0.10,
        )
        return _result(
            "comparable_retention",
            current_value,
            slope,
            error,
            confidence,
            f"基于 {len(points)} 个同类产品公开价格样本",
            profile,
            evidence,
        )

    return ForecastResult(
        method="unavailable",
        confidence=0,
        reason="历史跨度不足 21 天，且可核验同类样本少于 3 个",
        profile=profile,
        evidence=evidence,
    )
