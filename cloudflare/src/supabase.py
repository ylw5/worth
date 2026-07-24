import httpx


class Supabase:
    def __init__(self, url: str, service_key: str):
        self.base = f"{url.rstrip('/')}/rest/v1"
        self.headers = {
            "apikey": service_key,
            "authorization": f"Bearer {service_key}",
            "content-type": "application/json",
        }

    async def rpc(self, name: str, payload: dict | None = None):
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{self.base}/rpc/{name}",
                headers=self.headers,
                json=payload or {},
            )
        response.raise_for_status()
        return response.json() if response.content else None

    async def asset(self, asset_id: str):
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                f"{self.base}/assets",
                headers={
                    **self.headers,
                    "accept": "application/vnd.pgrst.object+json",
                },
                params={"id": f"eq.{asset_id}", "select": "*"},
            )
        response.raise_for_status()
        return response.json()

    async def rows(self, table: str, params: dict):
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                f"{self.base}/{table}",
                headers=self.headers,
                params=params,
            )
        response.raise_for_status()
        return response.json()
