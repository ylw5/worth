from pydantic import BaseModel, Field


class Sample(BaseModel):
    item_id: str
    title: str
    price: float = Field(gt=0)
    url: str


class MarketResult(BaseModel):
    estimated_price: float = Field(gt=0)
    price_low: float = Field(gt=0)
    price_high: float = Field(gt=0)
    sample_count: int = Field(ge=5)
    query: str
    samples: list[Sample]
