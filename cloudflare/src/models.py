from datetime import date
from typing import Literal

from pydantic import BaseModel, Field


class Run(BaseModel):
    id: str
    asset_id: str


class Asset(BaseModel):
    id: str
    name: str
    brand: str
    model: str
    specs: dict[str, str]
    category: str
    condition: str
    search_query: str


class Sample(BaseModel):
    item_id: str
    title: str
    price: float = Field(gt=0)
    url: str


class MarketResult(BaseModel):
    estimated_price: float
    price_low: float
    price_high: float
    sample_count: int = Field(ge=5)
    query: str
    samples: list[Sample]


class ValuationProfile(BaseModel):
    category: str
    subcategory: str = ""
    brand: str = ""
    model: str = ""
    generation: str = ""
    release_date: date | None = None
    original_retail_price: float | None = Field(default=None, gt=0)
    attributes: dict[str, str] = Field(default_factory=dict)


class Evidence(BaseModel):
    query: str
    url: str
    title: str
    summary: str
    site_name: str = ""
    source_type: Literal[
        "official", "marketplace", "auction", "industry", "other"
    ] = "other"
    observed_at: date | None = None
    price_type: Literal[
        "retail",
        "listing",
        "completed_sale",
        "recycle_quote",
        "unknown",
    ] = "unknown"
    currency: str = "CNY"
    condition: str = ""
    specifications: dict[str, str] = Field(default_factory=dict)
    retrieved_at: str
    relevant: bool
    product_name: str = ""
    release_date: date | None = None
    original_retail_price: float | None = Field(default=None, gt=0)
    current_price: float | None = Field(default=None, gt=0)
    spec_match: float = Field(default=0, ge=0, le=1)


class ForecastResult(BaseModel):
    method: Literal[
        "own_history",
        "comparable_retention",
        "unavailable",
    ]
    value_6m: float | None = None
    low_6m: float | None = None
    high_6m: float | None = None
    value_12m: float | None = None
    low_12m: float | None = None
    high_12m: float | None = None
    confidence: float = Field(ge=0, le=1)
    reason: str
    profile: ValuationProfile
    evidence: list[Evidence]
