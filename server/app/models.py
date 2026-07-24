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
AssetStatus = Literal["in_use", "idle", "listed", "sold"]
ProductSource = Literal["url", "text", "image"]


class AssetRecognition(BaseModel):
    name: str
    brand: str = ""
    model: str = ""
    specs: dict[str, str] = Field(default_factory=dict)
    category: Category
    subcategory: str = ""
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
    subcategory: str
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


class ProductParseRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2048)


class ProductTextRequest(BaseModel):
    text: str = Field(min_length=2, max_length=4000)
    price: Optional[float] = Field(default=None, gt=0)


class ProductImagesRequest(BaseModel):
    image_urls: list[str] = Field(min_length=1, max_length=5)


class AIProductClassification(BaseModel):
    normalized_title: str
    category: Category
    subcategory: str


class AIProductInterpretation(BaseModel):
    intent: Literal["product", "chat"]
    normalized_title: str
    category: Category
    subcategory: str
    reply: str


class AIProductRecognition(BaseModel):
    title: str
    price: Optional[float] = Field(gt=0)
    category: Category
    subcategory: str


class ParsedProduct(BaseModel):
    url: str = ""
    title: str
    price: Optional[float] = Field(default=None, gt=0)
    category: Category
    subcategory: str
    source_type: ProductSource = "url"
    source_text: str = ""


class ProductTextResponse(BaseModel):
    intent: Literal["product", "chat"]
    product: Optional[ParsedProduct] = None
    reply: str = ""


class EvaluationAsset(BaseModel):
    id: str
    name: str
    brand: str = ""
    model: str = ""
    category: Category
    subcategory: str = ""
    status: AssetStatus


class PurchaseEvaluationRequest(BaseModel):
    product: ParsedProduct
    assets: list[EvaluationAsset] = Field(max_length=500)


class EvaluationFacts(BaseModel):
    total: int
    in_use: int
    idle: int
    listed: int
    sold: int


class PurchaseEvaluationResult(BaseModel):
    product: ParsedProduct
    matched_assets: list[EvaluationAsset]
    facts: EvaluationFacts
    narrative: str


class EvaluationChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)


class EvaluationChatRequest(BaseModel):
    product: ParsedProduct
    matched_assets: list[EvaluationAsset] = Field(max_length=500)
    facts: EvaluationFacts
    messages: list[EvaluationChatMessage] = Field(min_length=1, max_length=100)


class EvaluationChatResponse(BaseModel):
    message: str


class SellPlanAsset(BaseModel):
    id: str
    name: str
    status: AssetStatus
    estimated_price: float = Field(gt=0)
    price_low: Optional[float] = Field(default=None, gt=0)
    latest_valuation_at: Optional[str] = None


class SellPlanRequest(BaseModel):
    target_price: float = Field(gt=0)
    assets: list[SellPlanAsset] = Field(max_length=500)


class SellPlanItem(BaseModel):
    id: str
    name: str
    status: AssetStatus
    conservative_price: float
    latest_valuation_at: Optional[str] = None


class SellPlanResult(BaseModel):
    target_price: float
    estimated_total: float
    coverage_ratio: float
    is_reachable: bool
    items: list[SellPlanItem]
