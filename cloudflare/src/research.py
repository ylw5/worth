from datetime import datetime, timezone

from openai import AsyncOpenAI
from pydantic import BaseModel

from bocha import web_search
from models import Evidence, ValuationProfile


class NormalizedResearch(BaseModel):
    profile: ValuationProfile
    facts: list[Evidence]


def queries(asset: dict) -> list[str]:
    identity = " ".join(
        filter(
            None,
            [
                asset["brand"],
                asset["model"],
                asset["name"],
                " ".join(
                    f"{key}{value}"
                    for key, value in asset["specs"].items()
                ),
            ],
        )
    )
    return [
        f"{identity} 官方首发价 上市时间",
        f"{identity} 二手价格 2026",
        (
            f"{asset['category']} {asset.get('subcategory', '')} "
            "同代 产品 保值率 二手价格"
        ),
    ]


async def research(env, asset: dict):
    raw = []
    retrieved_at = datetime.now(timezone.utc).isoformat()
    for query in queries(asset):
        for page in await web_search(env.BOCHA_API_KEY, query):
            raw.append(
                {
                    "query": query,
                    "url": page.get("url", ""),
                    "title": page.get("name", ""),
                    "summary": page.get("summary")
                    or page.get("snippet", ""),
                    "site_name": page.get("siteName", ""),
                    "retrieved_at": retrieved_at,
                }
            )
    client = AsyncOpenAI(
        api_key=env.AI_GATEWAY_API_KEY,
        base_url="https://ai-gateway.vercel.sh/v1",
    )
    response = await client.responses.parse(
        model=env.OPENAI_MODEL,
        input=[
            {
                "role": "system",
                "content": (
                    "Normalize only facts explicitly supported by the supplied "
                    "search records. Preserve each query and URL. Mark "
                    "irrelevant facts false. Do not infer a price, date, or "
                    "specification absent from the record. Use source_type "
                    "official only when the URL is the matching brand or "
                    "institution domain. Keep listing, completed-sale and "
                    "recycle prices as different price_type values."
                ),
            },
            {
                "role": "user",
                "content": str({"asset": asset, "records": raw}),
            },
        ],
        text_format=NormalizedResearch,
    )
    return response.output_parsed.profile, response.output_parsed.facts
