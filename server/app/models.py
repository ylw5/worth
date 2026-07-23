from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


Category = Literal[
    "数码",
    "家电",
    "家具",
    "服饰箱包",
    "珠宝腕表",
    "收藏",
    "交通工具",
    "其他",
]


class AssetRecognition(BaseModel):
    name: str
    brand: str = ""
    model: str = ""
    specs: dict[str, str] = Field(default_factory=dict)
    category: Category
    condition: str
    search_query: str


class AnalyzeRequest(BaseModel):
    image_url: str


class AssetInput(AssetRecognition):
    pass


class MarketCandidate(BaseModel):
    item_id: str
    title: str
    price: float
    url: str = ""


class CandidateDecision(BaseModel):
    item_id: str
    same_product: bool


class CandidateMatches(BaseModel):
    decisions: list[CandidateDecision]


class ValuationResult(BaseModel):
    estimated_price: Optional[float]
    price_low: Optional[float]
    price_high: Optional[float]
    sample_count: int
    query: str
    sample_summary: list[MarketCandidate]
