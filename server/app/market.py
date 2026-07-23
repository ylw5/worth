from __future__ import annotations

import hashlib
import json
import re
import time
from http.cookies import SimpleCookie

import requests

from .models import MarketCandidate


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


def _parse_cookie(value: str) -> dict[str, str]:
    cookie = SimpleCookie()
    cookie.load(value)
    return {key: morsel.value for key, morsel in cookie.items()}


def _sign(timestamp: str, token: str, data: str) -> str:
    value = f"{token}&{timestamp}&34839810&{data}"
    return hashlib.md5(value.encode()).hexdigest()


class MarketClient:
    def __init__(self, cookie: str):
        if not cookie:
            raise RuntimeError("Market data source is not configured")
        self.session = requests.Session()
        self.session.cookies.update(_parse_cookie(cookie))

    def search(self, keyword: str, pages: int = 3) -> list[MarketCandidate]:
        items: dict[str, MarketCandidate] = {}
        for page in range(1, pages + 1):
            for item in self._search_page(keyword, page):
                if item.item_id:
                    items[item.item_id] = item
        return list(items.values())

    def _search_page(self, keyword: str, page: int) -> list[MarketCandidate]:
        payload = {
            "pageNumber": page,
            "keyword": keyword,
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
        timestamp = str(int(time.time() * 1000))
        token = self.session.cookies.get("_m_h5_tk", "").split("_")[0]
        params = {
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
        }
        response = self.session.post(
            SEARCH_URL,
            params=params,
            headers=HEADERS,
            data={"data": data},
            timeout=20,
        )
        response.raise_for_status()
        body = response.json()
        if not any(value.startswith("SUCCESS") for value in body.get("ret", [])):
            raise RuntimeError("Market search is temporarily unavailable")
        return [
            item
            for result in body.get("data", {}).get("resultList", [])
            if (item := _candidate(result))
        ]


def _candidate(result: dict) -> MarketCandidate | None:
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
    return MarketCandidate(
        item_id=content.get("itemId", ""),
        title=content.get("title", ""),
        price=float(match.group()),
        url=main.get("targetUrl", ""),
    )
