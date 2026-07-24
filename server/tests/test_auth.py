from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app import auth
from app.main import get_user_supabase


def configured_settings() -> SimpleNamespace:
    return SimpleNamespace(
        supabase_url="https://example.supabase.co",
        supabase_anon_key="anon-key",
    )


def test_require_user_returns_id_and_access_token(monkeypatch) -> None:
    monkeypatch.setattr(auth, "get_settings", configured_settings)
    response = MagicMock(status_code=200)
    response.json.return_value = {"id": "user-1"}
    get = MagicMock(return_value=response)
    monkeypatch.setattr(auth.requests, "get", get)

    result = auth.require_user("Bearer access-token")

    assert result.id == "user-1"
    assert result.access_token == "access-token"
    get.assert_called_once_with(
        "https://example.supabase.co/auth/v1/user",
        headers={
            "apikey": "anon-key",
            "Authorization": "Bearer access-token",
        },
        timeout=10,
    )


@pytest.mark.parametrize("authorization", ["", "Basic token", "Bearer   "])
def test_require_user_rejects_missing_bearer_token(
    monkeypatch,
    authorization: str,
) -> None:
    monkeypatch.setattr(auth, "get_settings", configured_settings)

    with pytest.raises(HTTPException) as caught:
        auth.require_user(authorization)

    assert caught.value.status_code == 401


def test_user_supabase_client_authenticates_postgrest(monkeypatch) -> None:
    client = MagicMock()
    create_client = MagicMock(return_value=client)
    monkeypatch.setattr("app.main.create_client", create_client)
    monkeypatch.setattr("app.main.get_settings", configured_settings)

    result = get_user_supabase("access-token")

    assert result is client
    create_client.assert_called_once_with(
        "https://example.supabase.co",
        "anon-key",
    )
    client.postgrest.auth.assert_called_once_with("access-token")
