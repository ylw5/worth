from unittest.mock import Mock

from app.market import MarketClient


def test_retries_once_with_refreshed_market_token() -> None:
    client = MarketClient("cookie=value")
    assert client.session.cookies.get(
        "cookie", domain=".goofish.com"
    ) == "value"
    client.session = Mock()
    client.session.cookies.get.side_effect = ["expired", "refreshed"]
    expired = Mock()
    expired.json.return_value = {
        "ret": ["FAIL_SYS_TOKEN_EXOIRED::令牌过期"]
    }
    success = Mock()
    success.json.return_value = {"ret": ["SUCCESS::调用成功"], "data": {}}
    client.session.post.side_effect = [expired, success]

    assert client._search_page("相机", 1) == []
    assert client.session.post.call_count == 2
