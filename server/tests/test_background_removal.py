import base64
from io import BytesIO
from unittest.mock import Mock

from app import background_removal
from PIL import Image


def jpeg_bytes(size: tuple[int, int] = (1600, 800)) -> bytes:
    output = BytesIO()
    Image.new("RGB", size, "white").save(output, "JPEG")
    return output.getvalue()


def test_rejects_non_supabase_origin(monkeypatch) -> None:
    get = Mock()
    monkeypatch.setattr(background_removal.requests, "get", get)

    result = background_removal.try_remove_background(
        "https://attacker.example/a.jpg",
        "https://project.supabase.co",
    )

    assert result is None
    get.assert_not_called()


def test_resizes_and_returns_png(monkeypatch) -> None:
    monkeypatch.setattr(
        background_removal,
        "_download_image",
        lambda *_: jpeg_bytes(),
    )
    monkeypatch.setattr(background_removal, "_session", lambda: object())
    seen: dict[str, tuple[int, int]] = {}

    def fake_remove(image, session):
        seen["size"] = image.size
        result = image.convert("RGBA")
        result.putalpha(128)
        return result

    monkeypatch.setattr(background_removal, "remove", fake_remove)

    encoded = background_removal.try_remove_background(
        "https://project.supabase.co/storage/a.jpg",
        "https://project.supabase.co",
    )

    assert seen["size"] == (1024, 512)
    assert encoded is not None
    assert base64.b64decode(encoded).startswith(b"\x89PNG\r\n\x1a\n")


def test_failure_returns_none(monkeypatch) -> None:
    monkeypatch.setattr(
        background_removal,
        "_download_image",
        lambda *_: jpeg_bytes((10, 10)),
    )
    monkeypatch.setattr(
        background_removal,
        "_session",
        Mock(side_effect=RuntimeError("model unavailable")),
    )

    assert (
        background_removal.try_remove_background(
            "https://project.supabase.co/storage/a.jpg",
            "https://project.supabase.co",
        )
        is None
    )
