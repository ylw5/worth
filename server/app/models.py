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

Condition = Literal[
    "全新未使用",
    "几乎全新",
    "轻微使用痕迹",
    "明显使用痕迹",
    "重度使用或有瑕疵",
    "无法判断",
]


class AssetRecognition(BaseModel):
    name: str
    brand: str = ""
    model: str = ""
    specs: dict[str, str] = Field(default_factory=dict)
    category: Category
    condition: Condition
    search_query: str


class AssetSpec(BaseModel):
    name: str
    value: str


class AIAssetRecognition(BaseModel):
    name: str
    brand: str
    model: str
    specs: list[AssetSpec]
    category: Category
    condition: Condition
    search_query: str


class AssetInput(AssetRecognition):
    pass


class AnalyzeRequest(BaseModel):
    image_urls: list[str] = Field(min_length=1, max_length=5)
    current_asset: Optional[AssetInput] = None


class CutoutRequest(BaseModel):
    image_url: str


class CutoutResponse(BaseModel):
    image_base64: Optional[str] = None


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
