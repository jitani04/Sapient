import json

import httpx
import pytest

from app.services.reranker_service import LangSearchReranker


@pytest.mark.asyncio
async def test_langsearch_reranker_parses_ordered_scores(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("Authorization")
        captured["json"] = request.content.decode()
        return httpx.Response(
            200,
            json={
                "code": 200,
                "results": [
                    {"index": 1, "relevance_score": 0.91},
                    {"index": 0, "relevance_score": 0.42},
                ]
            },
        )

    transport = httpx.MockTransport(handler)
    original_async_client = httpx.AsyncClient

    class MockAsyncClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            self.client = original_async_client(transport=transport)

        async def __aenter__(self) -> httpx.AsyncClient:
            return self.client

        async def __aexit__(self, *args: object) -> None:
            await self.client.aclose()

    monkeypatch.setattr(httpx, "AsyncClient", MockAsyncClient)

    reranker = LangSearchReranker(
        api_key="test-key",
        model="langsearch-reranker-v1",
        endpoint="https://api.langsearch.com",
        timeout_seconds=1,
    )

    result = await reranker.rerank(query="capital city", documents=["Carson City", "Washington DC"], top_n=2)

    assert [item.index for item in result] == [1, 0]
    assert result[0].relevance_score == 0.91
    assert captured["url"] == "https://api.langsearch.com/v1/rerank"
    assert captured["auth"] == "Bearer test-key"
    assert "langsearch-reranker-v1" in str(captured["json"])


@pytest.mark.asyncio
async def test_langsearch_reranker_caps_request_at_fifty_documents(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode())
        captured["document_count"] = len(body["documents"])
        captured["top_n"] = body["top_n"]
        return httpx.Response(
            200,
            json={
                "code": 200,
                "results": [
                    {"index": 49, "relevance_score": 0.87},
                    {"index": 50, "relevance_score": 0.99},
                ],
            },
        )

    transport = httpx.MockTransport(handler)
    original_async_client = httpx.AsyncClient

    class MockAsyncClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            self.client = original_async_client(transport=transport)

        async def __aenter__(self) -> httpx.AsyncClient:
            return self.client

        async def __aexit__(self, *args: object) -> None:
            await self.client.aclose()

    monkeypatch.setattr(httpx, "AsyncClient", MockAsyncClient)

    reranker = LangSearchReranker(
        api_key="test-key",
        model="langsearch-reranker-v1",
        endpoint="https://api.langsearch.com",
        timeout_seconds=1,
    )

    result = await reranker.rerank(query="capital city", documents=[f"doc {i}" for i in range(60)], top_n=55)

    assert captured["document_count"] == 50
    assert captured["top_n"] == 50
    assert [item.index for item in result] == [49]
