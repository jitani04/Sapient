"""Retrieval-only evaluation against rag-mini-bioasq.

Computes recall@k, precision@k, and mean reciprocal rank (MRR) for the
production retriever using the ground-truth `relevant_passage_ids` from the QA
dataset. Unlike `ragas_eval.py`, this does not require an LLM judge — the only
LLM-bound work per question is a single query embedding. The evaluation is
therefore deterministic and cheap.

Run:
    python -m evals.ingest_dataset      # one-time: load corpus into pgvector
    python -m evals.retrieval_eval

Outputs aggregate metrics to stdout and per-question scores to
`evals/retrieval_results.csv`.
"""

from __future__ import annotations

import asyncio
import csv
import json
import os
from pathlib import Path
from statistics import mean
from typing import Any

from datasets import load_dataset

from app.core.config import get_settings
from app.db.session import get_session_factory
from app.services import retriever


SAMPLE_SIZE = int(os.getenv("EVAL_SAMPLE_SIZE", "100"))
K_VALUES = [int(k) for k in os.getenv("EVAL_K_VALUES", "1,3,5,10").split(",") if k.strip()]
RESULTS_PATH = Path(os.getenv("EVAL_RESULTS_PATH", "evals/retrieval_results.csv"))


def _as_id_list(val: Any) -> list[str]:
    if isinstance(val, list):
        return [str(x) for x in val]
    if isinstance(val, str):
        stripped = val.strip().lstrip("[").rstrip("]")
        return [s.strip().strip("'\"") for s in stripped.split(",") if s.strip()]
    return [str(val)]


def _recall_at_k(retrieved: list[str], relevant: set[str], k: int) -> float:
    if not relevant:
        return 0.0
    hits = sum(1 for pid in retrieved[:k] if pid in relevant)
    return hits / len(relevant)


def _precision_at_k(retrieved: list[str], relevant: set[str], k: int) -> float:
    if k == 0 or not retrieved:
        return 0.0
    hits = sum(1 for pid in retrieved[:k] if pid in relevant)
    return hits / k


def _reciprocal_rank(retrieved: list[str], relevant: set[str]) -> float:
    for i, pid in enumerate(retrieved, start=1):
        if pid in relevant:
            return 1.0 / i
    return 0.0


async def main() -> None:
    settings = get_settings()
    os.environ["GOOGLE_API_KEY"] = settings.llm_api_key

    max_k = max(K_VALUES)
    # Bump retriever top-k for the eval so we can compute metrics at every k
    # value from a single retriever call. The cached settings instance is shared
    # across the eval process; this does not affect the running web app.
    settings.rag_top_k = max(settings.rag_top_k, max_k)

    corpus_map_path = Path("evals/eval_corpus_map.json")
    if not corpus_map_path.exists():
        raise SystemExit(
            "evals/eval_corpus_map.json not found. Run `python -m evals.ingest_dataset` first."
        )
    with corpus_map_path.open() as f:
        corpus_map = json.load(f)
    user_id = corpus_map["user_id"]
    subject = corpus_map["subject"]
    ingested_sample_size = int(corpus_map.get("sample_size") or 0)
    if ingested_sample_size and SAMPLE_SIZE > ingested_sample_size:
        raise SystemExit(
            f"EVAL_SAMPLE_SIZE={SAMPLE_SIZE} but corpus was ingested for only "
            f"{ingested_sample_size} QA rows. Re-run `python -m evals.ingest_dataset` "
            "with the same or larger EVAL_SAMPLE_SIZE."
        )
    pid_to_mid = {str(k): int(v) for k, v in corpus_map["passage_id_to_material_id"].items()}
    mid_to_pid = {v: k for k, v in pid_to_mid.items()}

    print(f"loading rag-mini-bioasq questions (first {SAMPLE_SIZE})...")
    qa_ds = load_dataset(
        "rag-datasets/rag-mini-bioasq", "question-answer-passages", split="test"
    )
    qa_ds = qa_ds.select(range(min(SAMPLE_SIZE, len(qa_ds))))
    rel_col = next(
        (c for c in qa_ds.column_names if "passage" in c.lower() and "id" in c.lower()),
        None,
    )
    if rel_col is None:
        raise SystemExit(
            f"can't find passage-id column in QA dataset: {qa_ds.column_names}"
        )

    rows: list[dict[str, Any]] = []
    factory = get_session_factory()
    print(f"running retriever (k={max_k}) on {len(qa_ds)} questions...")
    async with factory() as session:
        for i, row in enumerate(qa_ds, start=1):
            question = row["question"]
            relevant = set(_as_id_list(row[rel_col]))
            chunks = await retriever.retrieve_context(
                session=session,
                user_id=user_id,
                conversation_id=0,
                query=question,
                subject=subject,
            )
            retrieved_pids = [
                mid_to_pid[c.material_id]
                for c in chunks
                if c.material_id in mid_to_pid
            ]
            recalls = {f"recall@{k}": _recall_at_k(retrieved_pids, relevant, k) for k in K_VALUES}
            precisions = {f"precision@{k}": _precision_at_k(retrieved_pids, relevant, k) for k in K_VALUES}
            mrr = _reciprocal_rank(retrieved_pids, relevant)
            first_hit = next(
                (j for j, pid in enumerate(retrieved_pids, start=1) if pid in relevant),
                None,
            )
            row_metrics: dict[str, Any] = {
                "question": question[:200],
                **recalls,
                **precisions,
                "mrr": mrr,
                "n_relevant": len(relevant),
                "n_retrieved": len(retrieved_pids),
                "first_hit_rank": first_hit if first_hit is not None else "",
            }
            rows.append(row_metrics)
            print(
                f"  [{i}/{len(qa_ds)}] "
                f"r@1={recalls.get('recall@1', 0):.2f} "
                f"r@5={recalls.get('recall@5', 0):.2f} "
                f"mrr={mrr:.2f}"
            )

    print("\n=== aggregate ===")
    metric_columns = (
        [f"recall@{k}" for k in K_VALUES]
        + [f"precision@{k}" for k in K_VALUES]
        + ["mrr"]
    )
    for col in metric_columns:
        avg = mean(float(r[col]) for r in rows)
        print(f"  {col}: {avg:.3f}")

    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with RESULTS_PATH.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nper-question scores written to {RESULTS_PATH}")


if __name__ == "__main__":
    asyncio.run(main())
