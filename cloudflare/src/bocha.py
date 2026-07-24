import httpx
from workers.workflows import NonRetryableError


async def web_search(api_key: str, query: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            "https://api.bochaai.com/v1/web-search",
            headers={
                "authorization": f"Bearer {api_key}",
                "content-type": "application/json",
            },
            json={
                "query": query,
                "freshness": "oneYear",
                "summary": True,
                "count": 10,
            },
        )
    if response.status_code in (401, 403):
        raise NonRetryableError("bocha_auth_failed")
    if response.status_code == 429:
        raise NonRetryableError("bocha_quota_exhausted")
    response.raise_for_status()
    return (
        response.json()
        .get("data", {})
        .get("webPages", {})
        .get("value", [])
    )
