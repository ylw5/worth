from types import SimpleNamespace

import pytest

from app.product import (
    _validate_response_peer,
    parse_product_html,
    validate_public_url,
)


def test_extracts_open_graph_title_and_price() -> None:
    page = parse_product_html(
        "https://shop.example/product/1",
        """
        <html>
          <head>
            <title>fallback</title>
            <meta property="og:title" content="Sony WH-1000XM6">
            <meta property="product:price:amount" content="3,499.00">
          </head>
        </html>
        """,
    )

    assert page.title == "Sony WH-1000XM6"
    assert page.price == 3499


def test_extracts_json_ld_price() -> None:
    page = parse_product_html(
        "https://shop.example/product/2",
        """
        <title>iPhone 17</title>
        <script type="application/ld+json">
          {"@type":"Product","offers":{"price":"5999"}}
        </script>
        """,
    )

    assert page.price == 5999


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "http://127.0.0.1/product",
        "http://localhost/product",
    ],
)
def test_rejects_non_public_urls(url: str) -> None:
    with pytest.raises(ValueError):
        validate_public_url(url)


def test_rejects_private_connected_peer_after_dns_resolution() -> None:
    sock = SimpleNamespace(getpeername=lambda: ("127.0.0.1", 443))
    response = SimpleNamespace(
        raw=SimpleNamespace(_connection=SimpleNamespace(sock=sock))
    )

    with pytest.raises(ValueError):
        _validate_response_peer(response)
