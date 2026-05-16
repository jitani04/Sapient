from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.material import Material, MaterialStatus
from app.models.material_chunk import MaterialChunk
from app.services.embedding_service import create_embedding_service
from app.services.reranker_service import create_reranker_service


@dataclass(slots=True)
class RetrievedChunk:
    chunk_id: int
    material_id: int
    material_filename: str
    subject: str | None
    content: str
    page_number: int | None
    similarity_score: float
    vector_score: float | None = None
    rerank_score: float | None = None

    @property
    def snippet(self) -> str:
        if len(self.content) <= 220:
            return self.content
        return f"{self.content[:217].rstrip()}..."


async def retrieve_context(
    *,
    session: AsyncSession,
    user_id: int,
    conversation_id: int,
    query: str,
    subject: str | None = None,
) -> list[RetrievedChunk]:
    _ = conversation_id
    settings = get_settings()
    clean_subject = subject.strip() if subject else None
    rag_candidate_k = min(settings.rag_candidate_k, 50)

    ready_material_query = (
        select(Material.id)
        .where(Material.user_id == user_id, Material.status == MaterialStatus.READY)
    )
    if clean_subject:
        ready_material_query = ready_material_query.where(func.lower(Material.subject) == clean_subject.lower())
    ready_material_query = ready_material_query.limit(1)

    ready_material = await session.execute(ready_material_query)
    if ready_material.scalar_one_or_none() is None:
        return []

    embedding_service = create_embedding_service()
    query_embedding = await embedding_service.embed_query(query)
    distance = MaterialChunk.embedding.cosine_distance(query_embedding)

    reranker = create_reranker_service()
    candidate_limit = rag_candidate_k if reranker else settings.rag_top_k * 4
    candidate_limit = max(settings.rag_top_k, candidate_limit)

    retrieval_query = (
        select(MaterialChunk, Material, distance.label("distance"))
        .join(Material, Material.id == MaterialChunk.material_id)
        .where(Material.user_id == user_id, Material.status == MaterialStatus.READY)
    )
    if clean_subject:
        retrieval_query = retrieval_query.where(func.lower(Material.subject) == clean_subject.lower())
    retrieval_query = retrieval_query.order_by(distance.asc(), MaterialChunk.chunk_index.asc()).limit(candidate_limit)

    result = await session.execute(retrieval_query)

    candidates = [
        RetrievedChunk(
            chunk_id=chunk.id,
            material_id=material.id,
            material_filename=material.filename,
            subject=material.subject,
            content=chunk.content,
            page_number=chunk.page_number,
            similarity_score=max(0.0, 1.0 - float(raw_distance)),
            vector_score=max(0.0, 1.0 - float(raw_distance)),
            rerank_score=None,
        )
        for chunk, material, raw_distance in result.all()
    ]

    ranked_candidates = candidates
    if reranker and candidates:
        rerank_results = await reranker.rerank(
            query=query,
            documents=[candidate.content for candidate in candidates],
            top_n=min(len(candidates), max(settings.rag_top_k * 4, settings.rag_top_k)),
        )
        if rerank_results:
            ranked_candidates = [
                RetrievedChunk(
                    chunk_id=candidates[result.index].chunk_id,
                    material_id=candidates[result.index].material_id,
                    material_filename=candidates[result.index].material_filename,
                    subject=candidates[result.index].subject,
                    content=candidates[result.index].content,
                    page_number=candidates[result.index].page_number,
                    similarity_score=result.relevance_score,
                    vector_score=candidates[result.index].vector_score,
                    rerank_score=result.relevance_score,
                )
                for result in rerank_results
            ]

    per_material_limit = 2
    per_material_counts: dict[int, int] = {}
    chunks: list[RetrievedChunk] = []

    for candidate in ranked_candidates:
        if per_material_counts.get(candidate.material_id, 0) >= per_material_limit:
            continue

        per_material_counts[candidate.material_id] = per_material_counts.get(candidate.material_id, 0) + 1
        chunks.append(candidate)
        if len(chunks) >= settings.rag_top_k:
            break

    return chunks
