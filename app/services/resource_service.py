"""Find and persist external learning resources recommended by the tutor.

Two providers:
  - YouTube Data API v3 for `kind="video"` (search.list + videos.list for duration)
  - LangSearch web search for `kind="article"` (reuses the existing client)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class ResourceHit:
    kind: str  # "video" | "article"
    source: str  # "youtube" | "web"
    title: str
    url: str
    snippet: str | None
    thumbnail_url: str | None


class YouTubeResourceProvider:
    def __init__(self, *, api_key: str, timeout_seconds: float = 8.0) -> None:
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds
        self._base = "https://www.googleapis.com/youtube/v3"

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key.strip())

    async def search(self, *, query: str, max_results: int = 1) -> list[ResourceHit]:
        clean = query.strip()
        if not self.is_configured or not clean:
            return []
        params = {
            "part": "snippet",
            "q": clean,
            "type": "video",
            "maxResults": max(1, min(max_results, 5)),
            "safeSearch": "strict",
            "relevanceLanguage": "en",
            "videoEmbeddable": "true",
            "key": self.api_key,
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.get(f"{self._base}/search", params=params)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            logger.warning("YouTube search request failed: %s", exc)
            return []

        data = response.json()
        items = data.get("items") or []
        hits: list[ResourceHit] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            video_id = (item.get("id") or {}).get("videoId")
            snippet = item.get("snippet") or {}
            title = str(snippet.get("title") or "").strip()
            if not video_id or not title:
                continue
            thumbnails = snippet.get("thumbnails") or {}
            thumb = (
                thumbnails.get("high")
                or thumbnails.get("medium")
                or thumbnails.get("default")
                or {}
            )
            hits.append(
                ResourceHit(
                    kind="video",
                    source="youtube",
                    title=title[:512],
                    url=f"https://www.youtube.com/watch?v={video_id}",
                    snippet=str(snippet.get("description") or "").strip()[:1200] or None,
                    thumbnail_url=str(thumb.get("url") or "").strip() or None,
                )
            )
        return hits


def create_youtube_resource_provider() -> YouTubeResourceProvider | None:
    settings = get_settings()
    if not settings.youtube_api_key.strip():
        return None
    return YouTubeResourceProvider(api_key=settings.youtube_api_key)
