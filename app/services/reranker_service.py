import logging
from dataclasses import dataclass

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class RerankResult:
    index: int
    relevance_score: float


class LangSearchReranker:
    """Second-stage reranker for vector-search candidates."""

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        endpoint: str,
        timeout_seconds: float,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.endpoint = endpoint.rstrip("/")
        self.timeout_seconds = timeout_seconds

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key.strip())

    async def rerank(self, *, query: str, documents: list[str], top_n: int) -> list[RerankResult]:
        if not self.is_configured or not query.strip() or not documents:
            return []

        request_documents = documents[:50]
        payload = {
            "model": self.model,
            "query": query,
            "documents": request_documents,
            "top_n": max(1, min(top_n, len(request_documents))),
            "return_documents": False,
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.post(f"{self.endpoint}/v1/rerank", json=payload, headers=headers)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            logger.warning("LangSearch rerank request failed; falling back to vector order: %s", exc)
            return []

        data = response.json()
        if data.get("code") not in (None, 200):
            logger.warning("LangSearch rerank response returned code %s; falling back to vector order.", data.get("code"))
            return []
        results = data.get("results", [])
        if not isinstance(results, list):
            logger.warning("LangSearch rerank response missing results; falling back to vector order.")
            return []

        parsed: list[RerankResult] = []
        for item in results:
            if not isinstance(item, dict):
                continue
            try:
                index = int(item["index"])
                score = float(item["relevance_score"])
            except (KeyError, TypeError, ValueError):
                continue
            if 0 <= index < len(request_documents):
                parsed.append(RerankResult(index=index, relevance_score=max(0.0, min(score, 1.0))))
        return parsed


def create_reranker_service() -> LangSearchReranker | None:
    settings = get_settings()
    if not settings.rag_reranker_enabled:
        return None
    if not settings.langsearch_api_key.strip():
        logger.warning("RAG reranker is enabled but LANGSEARCH_API_KEY is not set; using vector order.")
        return None
    return LangSearchReranker(
        api_key=settings.langsearch_api_key,
        model=settings.langsearch_rerank_model,
        endpoint=settings.langsearch_api_base_url,
        timeout_seconds=settings.rag_reranker_timeout_seconds,
    )
