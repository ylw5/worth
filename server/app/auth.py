from dataclasses import dataclass

from fastapi import Header, HTTPException
import requests

from .config import get_settings


@dataclass(frozen=True)
class AuthenticatedUser:
    id: str
    access_token: str


def require_user(
    authorization: str = Header(default=""),
) -> AuthenticatedUser:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")

    access_token = authorization.removeprefix("Bearer ").strip()
    if not access_token:
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
    return AuthenticatedUser(
        id=response.json()["id"],
        access_token=access_token,
    )
