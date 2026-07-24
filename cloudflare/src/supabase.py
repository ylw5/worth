import json
from urllib.parse import urlencode

from js import Object, fetch
from pyodide.ffi import to_js


class Supabase:
    def __init__(self, url: str, service_key: str):
        self.base = f"{url.rstrip('/')}/rest/v1"
        self.headers = {
            "apikey": service_key,
            "authorization": f"Bearer {service_key}",
            "content-type": "application/json",
        }

    async def rpc(self, name: str, payload: dict | None = None):
        return await self._request(
            f"{self.base}/rpc/{name}",
            method="POST",
            body=json.dumps(payload or {}),
        )

    async def asset(self, asset_id: str):
        return await self._request(
            f"{self.base}/assets?{urlencode({
                'id': f'eq.{asset_id}',
                'select': '*',
            })}",
            headers={"accept": "application/vnd.pgrst.object+json"},
        )

    async def rows(self, table: str, params: dict):
        return await self._request(
            f"{self.base}/{table}?{urlencode(params)}",
        )

    async def _request(
        self,
        url: str,
        method: str = "GET",
        body: str | None = None,
        headers: dict | None = None,
    ):
        options = {
            "method": method,
            "headers": {**self.headers, **(headers or {})},
        }
        if body is not None:
            options["body"] = body
        response = await fetch(
            url,
            to_js(options, dict_converter=Object.fromEntries),
        )
        text = await response.text()
        if not response.ok:
            raise RuntimeError(f"Supabase request failed: {response.status}")
        return json.loads(text) if text else None
