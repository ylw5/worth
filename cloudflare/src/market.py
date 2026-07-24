import hashlib
import json
import re
import time
from http.cookies import SimpleCookie

import httpx

from models import Sample

SEARCH_URL = (
    "https://h5api.m.goofish.com/h5/"
    "mtop.taobao.idlemtopsearch.pc.search/1.0/"
)
HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
    "Origin": "https://www.goofish.com",
    "Referer": "https://www.goofish.com/",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36"
    ),
}


def _cookies(value: str) -> dict[str, str]:
    parsed = SimpleCookie()
    parsed.load(value)
    return {key: morsel.value for key, morsel in parsed.items()}


def _sign(timestamp: str, token: str, data: str) -> str:
    return hashlib.md5(
        f"{token}&{timestamp}&34839810&{data}".encode(),
        usedforsecurity=False,
    ).hexdigest()


def _cookie_value(cookies: httpx.Cookies, name: str) -> str:
    values = [
        cookie.value for cookie in cookies.jar if cookie.name == name
    ]
    return values[-1] if values else ""


def _candidate(result: dict) -> Sample | None:
    main = result.get("data", {}).get("item", {}).get("main", {})
    content = main.get("exContent", {})
    price_text = content.get("detailParams", {}).get("soldPrice", "")
    if not price_text:
        price_text = "".join(
            str(part.get("text", "")) for part in content.get("price", [])
        )
    match = re.search(r"\d+(?:\.\d+)?", str(price_text).replace(",", ""))
    if not match or float(match.group()) <= 0:
        return None
    return Sample(
        item_id=content.get("itemId", ""),
        title=content.get("title", ""),
        price=float(match.group()),
        url=main.get("targetUrl", ""),
    )


async def search(cookie: str, query: str, limit: int = 30) -> list[Sample]:
    if not cookie:
        raise RuntimeError("Market data source is not configured")
    found: dict[str, Sample] = {}
    async with httpx.AsyncClient(
        cookies=_cookies(cookie),
        headers=HEADERS,
        timeout=20,
    ) as client:
        for page in range(1, max(1, (limit + 29) // 30) + 1):
            payload = {
                "pageNumber": page,
                "keyword": query,
                "fromFilter": False,
                "rowsPerPage": 30,
                "searchReqFromPage": "pcSearch",
                "propValueStr": {"searchFilter": ""},
                "extraFilterValue": "{}",
                "userPositionJson": "{}",
                "sortValue": "",
                "sortField": "",
                "customDistance": "",
                "gps": "",
                "customGps": "",
            }
            data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
            for attempt in range(2):
                timestamp = str(int(time.time() * 1000))
                token = _cookie_value(
                    client.cookies,
                    "_m_h5_tk",
                ).split("_")[0]
                response = await client.post(
                    SEARCH_URL,
                    params={
                        "jsv": "2.7.2",
                        "appKey": "34839810",
                        "t": timestamp,
                        "sign": _sign(timestamp, token, data),
                        "v": "1.0",
                        "type": "originaljson",
                        "accountSite": "xianyu",
                        "dataType": "json",
                        "timeout": "20000",
                        "api": "mtop.taobao.idlemtopsearch.pc.search",
                        "sessionOption": "AutoLoginOnly",
                        "spm_cnt": "a21ybx.search.0.0",
                    },
                    data={"data": data},
                )
                response.raise_for_status()
                body = response.json()
                ret = body.get("ret", [])
                if any(value.startswith("SUCCESS") for value in ret):
                    break
                expired = any(
                    value.startswith("FAIL_SYS_TOKEN_EXOIRED") for value in ret
                )
                if attempt or not expired:
                    raise RuntimeError(
                        "Market search is temporarily unavailable"
                    )
            for raw in body.get("data", {}).get("resultList", []):
                item = _candidate(raw)
                if item and item.item_id:
                    found[item.item_id] = item
    return list(found.values())[:limit]
