import httpx

from market import _cookie_value


def test_cookie_value_handles_duplicate_domains():
    cookies = httpx.Cookies()
    cookies.set("_m_h5_tk", "old_token", domain=".goofish.com")
    cookies.set("_m_h5_tk", "new_token", domain=".taobao.com")

    assert _cookie_value(cookies, "_m_h5_tk") == "new_token"
