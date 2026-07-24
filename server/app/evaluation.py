from __future__ import annotations

from .models import (
    EvaluationAsset,
    EvaluationFacts,
    ParsedProduct,
    PurchaseEvaluationResult,
)
from .taxonomy import canonical_subcategory


def _matches(product: ParsedProduct, asset: EvaluationAsset) -> bool:
    product_subcategory = canonical_subcategory(product.subcategory)
    asset_subcategory = canonical_subcategory(asset.subcategory)
    if product_subcategory and asset_subcategory:
        return product_subcategory == asset_subcategory
    return (
        product.category == asset.category
        and not product_subcategory
        and not asset_subcategory
    )


def build_purchase_evaluation(
    product: ParsedProduct,
    assets: list[EvaluationAsset],
) -> PurchaseEvaluationResult:
    matches = [asset for asset in assets if _matches(product, asset)]
    facts = EvaluationFacts(
        total=len(matches),
        in_use=sum(asset.status == "in_use" for asset in matches),
        idle=sum(asset.status == "idle" for asset in matches),
        listed=sum(asset.status == "listed" for asset in matches),
        sold=sum(asset.status == "sold" for asset in matches),
    )
    if not matches:
        narrative = (
            f"你的资产记录中暂时没有可明确匹配的{product.subcategory or product.category}"
            "历史。本次只能展示商品信息，无法形成个人使用倾向参考。"
        )
    else:
        outcomes = facts.idle + facts.listed + facts.sold
        narrative = (
            f"你过去记录过 {facts.total} 件"
            f"{product.subcategory or product.category}，其中 {facts.in_use} 件仍在用、"
            f"{facts.idle} 件闲置、{facts.listed} 件已上架、{facts.sold} 件已卖出。"
            f"共有 {outcomes} 件进入闲置、上架或卖出状态。"
            "以上是基于你个人资产记录的事实回顾，不代表本次购买建议。"
        )
    return PurchaseEvaluationResult(
        product=product,
        matched_assets=matches,
        facts=facts,
        narrative=narrative,
    )
