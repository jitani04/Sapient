"""Ingest a public RAG benchmark corpus directly into pgvector.

Dataset: rag-datasets/rag-mini-bioasq
  - `text-corpus` config: ~4.7k biomedical passages (id, passage)
  - `question-answer-passages` config: questions + answers + relevant_passage_ids

Run:
    python -m evals.ingest_dataset

This creates an eval user (email: ragas-eval@local) and ingests every
passage as its own Material+MaterialChunk so the existing retriever
treats them as ready content. Re-running wipes the prior eval data first.
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from datasets import load_dataset
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session_factory
from app.models.material import Material, MaterialStatus
from app.models.material_chunk import MaterialChunk
from app.models.user import User
from app.services.embedding_service import create_embedding_service


EVAL_USER_EMAIL = "ragas-eval@local"
EVAL_SUBJECT = "ragas-eval"
QA_SAMPLE_SIZE = int(os.getenv("EVAL_SAMPLE_SIZE", "100"))
DISTRACTOR_PASSAGES = int(os.getenv("EVAL_DISTRACTOR_PASSAGES", "500"))
# Gemini free tier text-embedding-004 ≈ 100 RPM. Run serially with pacing.
EMBED_MIN_INTERVAL_SEC = float(os.getenv("EVAL_EMBED_MIN_INTERVAL_SEC", "0.7"))  # ~85 RPM by default
EMBED_CACHE_PATH = Path(os.getenv("EVAL_EMBED_CACHE_PATH", "evals/eval_embedding_cache.json"))
EMBED_MAX_ATTEMPTS = int(os.getenv("EVAL_EMBED_MAX_ATTEMPTS", "10"))


async def get_or_create_eval_user(session: AsyncSession) -> User:
    result = await session.execute(select(User).where(User.email == EVAL_USER_EMAIL))
    user = result.scalar_one_or_none()
    if user is not None:
        return user
    user = User(
        email=EVAL_USER_EMAIL,
        name="Ragas Eval",
        onboarding_complete=True,
    )
    session.add(user)
    await session.flush()
    return user


async def wipe_prior(session: AsyncSession, user_id: int) -> None:
    await session.execute(
        delete(Material).where(Material.user_id == user_id, Material.subject == EVAL_SUBJECT)
    )
    await session.flush()


async def _embed_with_retry(embedder, text: str) -> list[float]:
    import httpx

    for attempt in range(EMBED_MAX_ATTEMPTS):
        try:
            return await embedder.embed_query(text)
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (429, 503) and attempt < EMBED_MAX_ATTEMPTS - 1:
                wait = min(300, 2 ** attempt)
                print(f"    rate limited, waiting {wait}s...")
                await asyncio.sleep(wait)
                continue
            raise
    raise RuntimeError("embedding retries exhausted")


def _load_embedding_cache() -> dict[str, list[float]]:
    if not EMBED_CACHE_PATH.exists():
        return {}
    try:
        payload = json.loads(EMBED_CACHE_PATH.read_text())
    except json.JSONDecodeError:
        print(f"warning: ignoring invalid embedding cache at {EMBED_CACHE_PATH}")
        return {}
    vectors = payload.get("vectors", payload)
    if not isinstance(vectors, dict):
        return {}
    return {str(k): v for k, v in vectors.items() if isinstance(v, list)}


def _save_embedding_cache(cache: dict[str, list[float]]) -> None:
    EMBED_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = EMBED_CACHE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps({"vectors": cache}, indent=2))
    tmp.replace(EMBED_CACHE_PATH)


async def ingest_passages(
    session: AsyncSession, user_id: int, passages: list[tuple[str, str]]
) -> dict[str, int]:
    """passages: list of (passage_id, text). Returns map passage_id -> material_id."""
    embedder = create_embedding_service()
    pid_to_mid: dict[str, int] = {}
    embedding_cache = _load_embedding_cache()

    print(
        f"  embedding {len(passages)} passages serially "
        f"(min interval {EMBED_MIN_INTERVAL_SEC}s, ETA ~{int(len(passages) * EMBED_MIN_INTERVAL_SEC / 60)} min)..."
    )
    vectors: list[list[float]] = []
    import time

    last = 0.0
    for i, (passage_id, text) in enumerate(passages, start=1):
        vector = embedding_cache.get(str(passage_id))
        if vector is None:
            elapsed = time.monotonic() - last
            if elapsed < EMBED_MIN_INTERVAL_SEC:
                await asyncio.sleep(EMBED_MIN_INTERVAL_SEC - elapsed)
            vector = await _embed_with_retry(embedder, text)
            embedding_cache[str(passage_id)] = vector
            _save_embedding_cache(embedding_cache)
            last = time.monotonic()
        vectors.append(vector)
        if i % 25 == 0 or i == len(passages):
            cached = sum(1 for pid, _ in passages[:i] if str(pid) in embedding_cache)
            print(f"    {i}/{len(passages)} embedded ({cached} cached)")

    for (passage_id, text), vector in zip(passages, vectors, strict=True):
        material = Material(
            user_id=user_id,
            filename=f"bioasq-{passage_id}.txt",
            storage_path=f"eval://bioasq/{passage_id}",
            mime_type="text/plain",
            subject=EVAL_SUBJECT,
            status=MaterialStatus.READY,
            processed_at=datetime.now(timezone.utc),
        )
        session.add(material)
        await session.flush()
        chunk = MaterialChunk(
            material_id=material.id,
            chunk_index=0,
            content=text,
            embedding=vector,
            char_start=0,
            char_end=len(text),
            page_number=None,
        )
        session.add(chunk)
        pid_to_mid[str(passage_id)] = material.id
    await session.commit()

    return pid_to_mid


async def main() -> None:
    print("loading rag-mini-bioasq...")
    qa_ds = load_dataset(
        "rag-datasets/rag-mini-bioasq", "question-answer-passages", split="test"
    )
    corpus_ds = load_dataset(
        "rag-datasets/rag-mini-bioasq", "text-corpus", split="passages"
    )
    print(f"  qa columns: {qa_ds.column_names}")
    print(f"  corpus columns: {corpus_ds.column_names}")
    print(f"  qa sample: {qa_ds[0]}")
    print(f"  corpus sample id={corpus_ds[0].get('id')!r}")

    qa_id_col = "id" if "id" in qa_ds.column_names else qa_ds.column_names[0]
    corpus_id_col = "id" if "id" in corpus_ds.column_names else corpus_ds.column_names[0]
    corpus_text_col = (
        "passage" if "passage" in corpus_ds.column_names else "text"
    )
    rel_col = (
        "relevant_passage_ids"
        if "relevant_passage_ids" in qa_ds.column_names
        else next((c for c in qa_ds.column_names if "passage" in c.lower() and "id" in c.lower()), None)
    )
    if rel_col is None:
        raise RuntimeError(f"can't find passage-id column in QA: {qa_ds.column_names}")

    def _as_id_list(val) -> list[str]:
        if isinstance(val, list):
            return [str(x) for x in val]
        if isinstance(val, str):
            stripped = val.strip().lstrip("[").rstrip("]")
            return [s.strip().strip("'\"") for s in stripped.split(",") if s.strip()]
        return [str(val)]

    qa_sample = qa_ds.select(range(min(QA_SAMPLE_SIZE, len(qa_ds))))
    referenced: set[str] = set()
    for row in qa_sample:
        for pid in _as_id_list(row[rel_col]):
            referenced.add(pid)
    print(
        f"  referenced passage ids in {len(qa_sample)}-row QA sample: {len(referenced)}"
    )

    referenced_passages: list[tuple[str, str]] = []
    other_passages: list[tuple[str, str]] = []
    for row in corpus_ds:
        pid = str(row[corpus_id_col])
        text = row[corpus_text_col]
        if pid in referenced:
            referenced_passages.append((pid, text))
        else:
            other_passages.append((pid, text))

    passages = referenced_passages + other_passages[:DISTRACTOR_PASSAGES]
    print(
        f"ingesting {len(passages)} passages "
        f"({len(referenced_passages)} referenced + {min(DISTRACTOR_PASSAGES, len(other_passages))} distractors)"
    )

    factory = get_session_factory()
    async with factory() as session:
        user = await get_or_create_eval_user(session)
        await wipe_prior(session, user.id)
        await session.commit()
        pid_to_mid = await ingest_passages(session, user.id, passages)

    # save the mapping + qa rows for the eval script
    with open("evals/eval_corpus_map.json", "w") as f:
        json.dump(
            {
                "user_id": user.id,
                "subject": EVAL_SUBJECT,
                "dataset": "rag-datasets/rag-mini-bioasq",
                "sample_size": len(qa_sample),
                "distractor_passages": min(DISTRACTOR_PASSAGES, len(other_passages)),
                "passage_id_to_material_id": pid_to_mid,
            },
            f,
        )
    print(f"\ningested {len(pid_to_mid)} passages under user_id={user.id}")
    print("wrote evals/eval_corpus_map.json")


if __name__ == "__main__":
    asyncio.run(main())
