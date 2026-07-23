from fastapi import Header, HTTPException
import requests

from .config import get_settings


def require_user(authorization: str = Header(default="")) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")

    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise HTTPException(status_code=503, detail="Authentication is not configured")

    response = requests.get(
        f"{settings.supabase_url.rstrip('/')}/auth/v1/user",
        headers={
            "apikey": settings.supabase_anon_key,
            "Authorization": authorization,
        },
        timeout=10,
    )
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session")
    return response.json()["id"]
