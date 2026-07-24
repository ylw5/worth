from statistics import median, quantiles

from openai import AsyncOpenAI
from pydantic import BaseModel

from .market import search
from .models import MarketResult, Sample


class MatchResult(BaseModel):
    accepted_item_ids: list[str]


def summarize(query: str, samples: list[Sample]) -> MarketResult:
    accepted = sorted(
        {sample.item_id: sample for sample in samples}.values(),
        key=lambda item: item.price,
    )
    if len(accepted) < 5:
        raise ValueError("insufficient comparable samples")
    prices = [item.price for item in accepted]
    quartiles = quantiles(prices, n=4, method="inclusive")
    return MarketResult(
        estimated_price=round(median(prices), 2),
        price_low=round(quartiles[0], 2),
        price_high=round(quartiles[2], 2),
        sample_count=len(prices),
        query=query,
        samples=accepted,
    )


async def collect_market_result(env, asset) -> MarketResult:
    query = asset["search_query"].strip() or " ".join(
        value
        for value in [asset["brand"], asset["model"], asset["name"]]
        if value
    )
    candidates = await search(env.XIANYU_COOKIE, query)
    client = AsyncOpenAI(
        api_key=env.CLOUDFLARE_AI_GATEWAY_TOKEN,
        base_url=(
            "https://api.cloudflare.com/client/v4/accounts/"
            f"{env.CLOUDFLARE_ACCOUNT_ID}/ai/v1"
        ),
    )
    response = await client.responses.parse(
        model=env.OPENAI_MODEL,
        input=[
            {
                "role": "system",
                "content": (
                    "Select only whole-product listings matching category, "
                    "brand, model, specification and condition. Reject "
                    "accessories, wanted posts, rentals, repairs, deposits, "
                    "duplicates and implausible prices."
                ),
            },
            {
                "role": "user",
                "content": str(
                    {
                        "asset": asset,
                        "candidates": [
                            item.model_dump() for item in candidates
                        ],
                    }
                ),
            },
        ],
        text_format=MatchResult,
    )
    accepted = set(response.output_parsed.accepted_item_ids)
    return summarize(
        query,
        [item for item in candidates if item.item_id in accepted],
    )
