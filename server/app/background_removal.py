import base64
import logging
from functools import lru_cache
from io import BytesIO
from urllib.parse import urlparse

import requests
from PIL import Image, ImageOps
from rembg import new_session, remove


logger = logging.getLogger(__name__)
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_COVER_EDGE = 1024


@lru_cache
def _session():
    return new_session()


def _download_image(image_url: str, supabase_url: str) -> bytes:
    image_origin = urlparse(image_url)
    allowed_origin = urlparse(supabase_url)
    if (
        image_origin.scheme not in {"http", "https"}
        or image_origin.scheme != allowed_origin.scheme
        or image_origin.netloc != allowed_origin.netloc
    ):
        raise ValueError("Image must use the configured Supabase origin")

    with requests.get(
        image_url,
        stream=True,
        timeout=20,
        allow_redirects=False,
    ) as response:
        response.raise_for_status()
        if not response.headers.get("content-type", "").startswith("image/"):
            raise ValueError("Source is not an image")
        chunks: list[bytes] = []
        size = 0
        for chunk in response.iter_content(64 * 1024):
            size += len(chunk)
            if size > MAX_IMAGE_BYTES:
                raise ValueError("Source image is too large")
            chunks.append(chunk)
    return b"".join(chunks)


def _remove_background(image_url: str, supabase_url: str) -> str:
    with Image.open(BytesIO(_download_image(image_url, supabase_url))) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        image.thumbnail(
            (MAX_COVER_EDGE, MAX_COVER_EDGE),
            Image.Resampling.LANCZOS,
        )
        cutout = remove(image, session=_session()).convert("RGBA")
    if cutout.getchannel("A").getbbox() is None:
        raise ValueError("Background removal returned no subject")
    output = BytesIO()
    cutout.save(output, "PNG", optimize=True)
    return base64.b64encode(output.getvalue()).decode("ascii")


def try_remove_background(
    image_url: str,
    supabase_url: str,
) -> str | None:
    try:
        return _remove_background(image_url, supabase_url)
    except Exception as error:
        logger.warning(
            "Background removal failed: %s",
            type(error).__name__,
        )
        return None
