import re
from html import unescape
from typing import Any

import httpx


class WebImageError(Exception):
    pass


def _metadata_value(metadata: dict[str, Any], key: str) -> str | None:
    value = metadata.get(key)
    if not isinstance(value, dict):
        return None
    raw = value.get("value")
    return str(raw).strip() if raw else None


def _strip_html(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = re.sub(r"<[^>]+>", "", value)
    cleaned = unescape(cleaned).strip()
    return re.sub(r"\s+", " ", cleaned) or None


def _first_href(value: str | None) -> str | None:
    if not value:
        return None
    match = re.search(r'href=["\']([^"\']+)["\']', value)
    if not match:
        return None
    href = unescape(match.group(1))
    if href.startswith("//"):
        return f"https:{href}"
    if href.startswith("/"):
        return f"https://commons.wikimedia.org{href}"
    return href


class WebImageService:
    """Search Wikimedia Commons for educational image artifacts."""

    def __init__(self) -> None:
        self._endpoint = "https://commons.wikimedia.org/w/api.php"

    async def search_images(self, query: str, per_page: int = 3) -> list[dict[str, str | None]]:
        cleaned = query.strip()
        if len(cleaned) < 2:
            raise WebImageError("Image query must be at least 2 characters.")

        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                self._endpoint,
                params={
                    "action": "query",
                    "format": "json",
                    "generator": "search",
                    "gsrsearch": cleaned,
                    "gsrnamespace": 6,
                    "gsrlimit": max(1, min(per_page, 10)),
                    "prop": "imageinfo",
                    "iiprop": "url|mime|extmetadata",
                    "iiurlwidth": 1000,
                },
                headers={"User-Agent": "SapientTutoring/1.0 educational image lookup"},
            )

        if response.status_code >= 400:
            raise WebImageError(f"Wikimedia image search failed with {response.status_code}.")

        pages = (response.json().get("query") or {}).get("pages") or {}
        results: list[dict[str, str | None]] = []
        for page in pages.values():
            if not isinstance(page, dict):
                continue
            image_info = (page.get("imageinfo") or [None])[0]
            if not isinstance(image_info, dict):
                continue
            mime = str(image_info.get("mime") or "")
            if not mime.startswith("image/") or mime == "image/svg+xml":
                continue

            image_url = image_info.get("thumburl") or image_info.get("url")
            source_url = image_info.get("descriptionurl")
            if not image_url or not source_url:
                continue

            metadata = image_info.get("extmetadata") or {}
            artist_html = _metadata_value(metadata, "Artist") or _metadata_value(metadata, "Credit")
            creator = _strip_html(artist_html) or "Wikimedia Commons contributor"
            creator_url = _first_href(artist_html)
            license_name = (
                _strip_html(_metadata_value(metadata, "LicenseShortName"))
                or _strip_html(_metadata_value(metadata, "UsageTerms"))
            )
            license_url = _metadata_value(metadata, "LicenseUrl")

            results.append(
                {
                    "id": str(page.get("pageid") or page.get("title") or image_url),
                    "image_url": str(image_url),
                    "thumbnail_url": str(image_info.get("thumburl") or image_url),
                    "creator": creator,
                    "creator_url": creator_url,
                    "license": license_name,
                    "license_url": str(license_url) if license_url else None,
                    "source_url": str(source_url),
                    "source": "Wikimedia Commons",
                }
            )

        return results
