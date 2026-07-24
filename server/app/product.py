from __future__ import annotations

import ipaddress
import json
import re
import socket
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import requests


MAX_PAGE_BYTES = 1_000_000
MAX_REDIRECTS = 3
MAX_TITLE_CHARS = 500


@dataclass(frozen=True)
class ProductPage:
    url: str
    title: str
    price: float | None
    metadata: dict[str, str]


def _ensure_public_address(address: str) -> None:
    ip = ipaddress.ip_address(address)
    if (
        not ip.is_global
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_private
        or ip.is_reserved
    ):
        raise ValueError("商品链接不能指向内网地址")


def validate_public_url(value: str) -> str:
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("请输入有效的 HTTP(S) 商品链接")
    if parsed.username or parsed.password:
        raise ValueError("商品链接不能包含登录凭据")

    try:
        addresses = {
            item[4][0]
            for item in socket.getaddrinfo(
                parsed.hostname,
                parsed.port or (443 if parsed.scheme == "https" else 80),
                type=socket.SOCK_STREAM,
            )
        }
    except socket.gaierror as error:
        raise ValueError("无法解析商品链接域名") from error

    if not addresses:
        raise ValueError("无法解析商品链接域名")
    for address in addresses:
        _ensure_public_address(address)
    return value.strip()


def _validate_response_peer(response: requests.Response) -> None:
    connection = getattr(response.raw, "_connection", None)
    socket_value = getattr(connection, "sock", None)
    if socket_value is None:
        return
    peer = socket_value.getpeername()
    if peer:
        _ensure_public_address(peer[0])


class _ProductHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.metadata: dict[str, str] = {}
        self.title_parts: list[str] = []
        self.json_ld_parts: list[str] = []
        self._in_title = False
        self._in_json_ld = False

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        attributes = {key.lower(): value or "" for key, value in attrs}
        if tag.lower() == "title":
            self._in_title = True
        if tag.lower() == "meta":
            key = (
                attributes.get("property")
                or attributes.get("name")
                or attributes.get("itemprop")
            ).lower()
            content = attributes.get("content", "").strip()
            if key and content:
                self.metadata[key] = content
        if (
            tag.lower() == "script"
            and attributes.get("type", "").lower() == "application/ld+json"
        ):
            self._in_json_ld = True

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self._in_title = False
        if tag.lower() == "script" and self._in_json_ld:
            self._in_json_ld = False
            self.json_ld_parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title_parts.append(data)
        if self._in_json_ld:
            self.json_ld_parts.append(data)


def _positive_price(value: object) -> float | None:
    if isinstance(value, (int, float)):
        return float(value) if value > 0 else None
    if not isinstance(value, str):
        return None
    match = re.search(r"\d+(?:,\d{3})*(?:\.\d+)?", value)
    if not match:
        return None
    number = float(match.group().replace(",", ""))
    return number if number > 0 else None


def _json_ld_price(value: object) -> float | None:
    if isinstance(value, list):
        for item in value:
            if price := _json_ld_price(item):
                return price
        return None
    if not isinstance(value, dict):
        return None
    if price := _positive_price(value.get("price")):
        return price
    for key in ("offers", "@graph", "mainEntity", "itemListElement"):
        if price := _json_ld_price(value.get(key)):
            return price
    return None


def parse_product_html(url: str, html: str) -> ProductPage:
    parser = _ProductHTMLParser()
    parser.feed(html)
    title = (
        parser.metadata.get("og:title")
        or parser.metadata.get("twitter:title")
        or " ".join(parser.title_parts)
    ).strip()
    title = re.sub(r"\s+", " ", title)
    if not title:
        raise ValueError("商品页面没有可识别的标题")
    title = title[:MAX_TITLE_CHARS]

    price = None
    for key in (
        "product:price:amount",
        "og:price:amount",
        "price",
    ):
        if price := _positive_price(parser.metadata.get(key)):
            break
    if price is None:
        raw_json_ld = "".join(parser.json_ld_parts).strip()
        if raw_json_ld:
            try:
                decoder = json.JSONDecoder()
                offset = 0
                while offset < len(raw_json_ld):
                    while (
                        offset < len(raw_json_ld)
                        and raw_json_ld[offset].isspace()
                    ):
                        offset += 1
                    if offset >= len(raw_json_ld):
                        break
                    document, offset = decoder.raw_decode(raw_json_ld, offset)
                    if price := _json_ld_price(document):
                        break
            except json.JSONDecodeError:
                price = None
    return ProductPage(
        url=url,
        title=title,
        price=price,
        metadata=parser.metadata,
    )


def fetch_product_page(
    value: str,
    session: requests.Session | None = None,
) -> ProductPage:
    client = session or requests.Session()
    current = validate_public_url(value)
    for _ in range(MAX_REDIRECTS + 1):
        response = client.get(
            current,
            headers={
                "Accept": "text/html,application/xhtml+xml",
                "User-Agent": (
                    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) "
                    "AppleWebKit/605.1.15 Mobile/15E148"
                ),
            },
            allow_redirects=False,
            stream=True,
            timeout=12,
        )
        _validate_response_peer(response)
        if response.is_redirect or response.is_permanent_redirect:
            location = response.headers.get("location")
            if not location:
                raise RuntimeError("商品链接重定向失败")
            current = validate_public_url(urljoin(current, location))
            continue
        response.raise_for_status()
        content_type = response.headers.get("content-type", "").lower()
        if content_type and "html" not in content_type:
            raise ValueError("链接不是可解析的商品页面")
        body = bytearray()
        for chunk in response.iter_content(16_384):
            body.extend(chunk)
            if len(body) > MAX_PAGE_BYTES:
                raise ValueError("商品页面内容过大")
        encoding = response.encoding or "utf-8"
        return parse_product_html(
            current,
            body.decode(encoding, errors="replace"),
        )
    raise ValueError("商品链接重定向次数过多")
