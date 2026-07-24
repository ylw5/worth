from app.evaluation import build_purchase_evaluation
from app.models import EvaluationAsset, ParsedProduct


def asset(
    asset_id: str,
    subcategory: str,
    status: str,
) -> EvaluationAsset:
    return EvaluationAsset(
        id=asset_id,
        name=f"asset-{asset_id}",
        category="数码",
        subcategory=subcategory,
        status=status,
    )


def test_matches_exact_subcategory_and_reports_facts() -> None:
    product = ParsedProduct(
        url="https://example.com/phone",
        title="新手机",
        price=5999,
        category="数码",
        subcategory="手机",
    )

    result = build_purchase_evaluation(
        product,
        [
            asset("1", "手机", "sold"),
            asset("2", "手机", "in_use"),
            asset("3", "耳机", "idle"),
        ],
    )

    assert [item.id for item in result.matched_assets] == ["1", "2"]
    assert result.facts.total == 2
    assert result.facts.sold == 1
    assert result.facts.in_use == 1
    assert "不代表本次购买建议" in result.narrative


def test_returns_neutral_empty_history() -> None:
    product = ParsedProduct(
        url="https://example.com/camera",
        title="相机",
        category="数码",
        subcategory="相机",
    )

    result = build_purchase_evaluation(product, [asset("1", "手机", "sold")])

    assert result.matched_assets == []
    assert "暂时没有" in result.narrative


def test_matches_known_subcategory_aliases() -> None:
    product = ParsedProduct(
        url="https://example.com/phone",
        title="手机",
        category="数码",
        subcategory="手机",
    )

    result = build_purchase_evaluation(
        product,
        [asset("1", "智能手机", "sold")],
    )

    assert [item.id for item in result.matched_assets] == ["1"]
