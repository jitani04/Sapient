"""Judge-only Ragas eval over an existing answers checkpoint.

Reads `evals/ragas_answers_checkpoint.json` (produced by `ragas_eval.py`'s
generation phase) and scores each row independently with Ragas 0.4+ metrics:
faithfulness, answer_relevancy, context_precision, context_recall, and
factual_correctness.

Why a separate script:
  - The legacy `ragas_eval.py` calls `ragas.evaluate()` once over all rows.
    A failure mid-run loses every row that hasn't been written yet.
  - This variant judges one row at a time, persists scores to a per-row
    checkpoint, and writes incrementally to CSV. A 429 or process kill
    costs at most one row of progress.
  - It uses the Ragas 0.4 `collections` API and the `instructor`-based LLM
    factory directly, which is what newer Ragas versions actually expect.

Run:
    python -m evals.ragas_judge_checkpoint
"""

from __future__ import annotations

import asyncio
import csv
import json
import os
import time
from pathlib import Path
from statistics import mean
from typing import Any

from ragas.embeddings import OpenAIEmbeddings
from ragas.llms import llm_factory
from ragas.metrics.collections import (
    AnswerRelevancy,
    ContextPrecision,
    ContextRecall,
    FactualCorrectness,
    Faithfulness,
)

from app.core.config import get_settings


CHECKPOINT_IN = Path(os.getenv("EVAL_CHECKPOINT_PATH", "evals/ragas_answers_checkpoint.json"))
SCORES_OUT = Path(os.getenv("EVAL_RAGAS_SCORES_PATH", "evals/ragas_scores_checkpoint.json"))
CSV_OUT = Path(os.getenv("EVAL_RAGAS_CSV_PATH", "evals/ragas_results.csv"))

JUDGE_MIN_INTERVAL_SEC = float(os.getenv("EVAL_JUDGE_MIN_INTERVAL_SEC", "20"))
JUDGE_MAX_ATTEMPTS = int(os.getenv("EVAL_JUDGE_MAX_ATTEMPTS", "8"))
JUDGE_MAX_WAIT_SEC = float(os.getenv("EVAL_JUDGE_MAX_WAIT_SEC", "300"))

METRICS = [
    "faithfulness",
    "answer_relevancy",
    "context_precision",
    "context_recall",
    "factual_correctness",
]


def _is_quota_or_transient(exc: Exception) -> bool:
    msg = str(exc).lower()
    markers = (
        "429", "500", "502", "503", "504", "resource_exhausted", "resourceexhausted",
        "quota", "rate limit", "rate-limited", "too many requests", "unavailable",
        "deadline exceeded", "connection reset", "server disconnected",
        "timed out", "timeout", "connection error", "apiconnectionerror",
        "remote end closed", "broken pipe", "eof occurred",
    )
    return any(m in msg for m in markers)


def _is_daily_quota(exc: Exception) -> bool:
    msg = str(exc).lower()
    # Some providers expose daily quota errors differently from ordinary
    # short-window rate limits. Either way: stop now and resume from checkpoint.
    return "perday" in msg or "per day" in msg or "requests per day" in msg


async def _retry(coro_fn, *, label: str) -> Any:
    for attempt in range(JUDGE_MAX_ATTEMPTS):
        try:
            return await coro_fn()
        except Exception as exc:
            if _is_daily_quota(exc):
                raise SystemExit(
                    f"Hit judge provider daily quota during {label}. "
                    "Stop now and re-run tomorrow — the per-row checkpoint at "
                    f"{SCORES_OUT} preserves everything scored so far."
                )
            if _is_quota_or_transient(exc) and attempt < JUDGE_MAX_ATTEMPTS - 1:
                wait = min(JUDGE_MAX_WAIT_SEC, 10 + 2 ** attempt * 5)
                print(f"    {label}: transient error, waiting {wait}s... ({str(exc)[:160]})")
                await asyncio.sleep(wait)
                continue
            raise


def _load_scores() -> dict[str, dict[str, float | None]]:
    if not SCORES_OUT.exists():
        return {}
    try:
        return json.loads(SCORES_OUT.read_text())
    except json.JSONDecodeError:
        return {}


def _save_scores(state: dict[str, dict[str, float | None]]) -> None:
    SCORES_OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = SCORES_OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2))
    tmp.replace(SCORES_OUT)


async def main() -> None:
    if not CHECKPOINT_IN.exists():
        raise SystemExit(
            f"answers checkpoint not found: {CHECKPOINT_IN}. Run `python -m evals.ragas_eval` "
            "to generate the answers first (it will skip judging when it hits quota)."
        )
    payload = json.loads(CHECKPOINT_IN.read_text())
    rows = payload.get("rows", [])
    if not rows:
        raise SystemExit(f"no rows in {CHECKPOINT_IN}")
    print(f"loaded {len(rows)} answers from {CHECKPOINT_IN}")

    # Judge is OpenAI (not Gemini) to reduce self-preferential bias when the
    # answer generator is Gemini-backed.
    openai_key = (
        os.getenv("EVAL_OPENAI_API_KEY")
        or os.getenv("OPENAI_API_KEY")
        or os.getenv("OPENAI_TTS_API_KEY")
    )
    if not openai_key:
        raise SystemExit(
            "OpenAI eval judge key not set. Set EVAL_OPENAI_API_KEY or OPENAI_API_KEY "
            "with chat-completions and embeddings access."
        )
    judge_model = os.getenv("EVAL_JUDGE_MODEL", "gpt-4o")
    embedding_model = os.getenv("EVAL_JUDGE_EMBEDDING_MODEL", "text-embedding-3-small")

    from openai import AsyncOpenAI

    judge_client = AsyncOpenAI(api_key=openai_key)
    # max_tokens=1024 (Ragas default) truncates the statement-extractor JSON for
    # longer answers — bump it so Faithfulness/ContextRecall don't fail mid-row.
    judge_llm = llm_factory(
        model=judge_model, provider="openai", client=judge_client, max_tokens=4096
    )
    embeddings = OpenAIEmbeddings(client=judge_client, model=embedding_model)

    faithfulness = Faithfulness(llm=judge_llm)
    answer_relevancy = AnswerRelevancy(llm=judge_llm, embeddings=embeddings)
    context_precision = ContextPrecision(llm=judge_llm)
    context_recall = ContextRecall(llm=judge_llm)
    factual_correctness = FactualCorrectness(llm=judge_llm)

    scores_state = _load_scores()
    completed_keys = set(scores_state.keys())
    print(f"already-scored rows: {len(completed_keys)} / {len(rows)}")
    print(
        f"judging with {judge_model}, min interval {JUDGE_MIN_INTERVAL_SEC}s, "
        f"ETA ~{int((len(rows) - len(completed_keys)) * len(METRICS) * JUDGE_MIN_INTERVAL_SEC / 60)} min"
    )

    last_call = 0.0
    for i, row in enumerate(rows, start=1):
        key = str(i - 1)  # stable per-row key (index in checkpoint)
        existing = scores_state.get(key, {})
        question = row["question"]
        answer = row["answer"]
        contexts = list(row.get("contexts") or [])
        ground_truth = row.get("ground_truth", "")

        async def call_metric(metric_name: str, coro_fn):
            nonlocal last_call
            elapsed = time.monotonic() - last_call
            if elapsed < JUDGE_MIN_INTERVAL_SEC:
                await asyncio.sleep(JUDGE_MIN_INTERVAL_SEC - elapsed)
            result = await _retry(coro_fn, label=f"row {i} {metric_name}")
            last_call = time.monotonic()
            try:
                return float(result.value)
            except (TypeError, AttributeError, ValueError):
                return None

        if existing.get("faithfulness") is None:
            print(f"  [{i}/{len(rows)}] faithfulness...")
            scores_state.setdefault(key, {})["faithfulness"] = await call_metric(
                "faithfulness",
                lambda: faithfulness.ascore(
                    user_input=question, response=answer, retrieved_contexts=contexts
                ),
            )
            _save_scores(scores_state)

        if existing.get("answer_relevancy") is None and scores_state[key].get("answer_relevancy") is None:
            print(f"  [{i}/{len(rows)}] answer_relevancy...")
            scores_state[key]["answer_relevancy"] = await call_metric(
                "answer_relevancy",
                lambda: answer_relevancy.ascore(user_input=question, response=answer),
            )
            _save_scores(scores_state)

        if scores_state[key].get("context_precision") is None:
            print(f"  [{i}/{len(rows)}] context_precision...")
            scores_state[key]["context_precision"] = await call_metric(
                "context_precision",
                lambda: context_precision.ascore(
                    user_input=question,
                    reference=ground_truth,
                    retrieved_contexts=contexts,
                ),
            )
            _save_scores(scores_state)

        if scores_state[key].get("context_recall") is None:
            print(f"  [{i}/{len(rows)}] context_recall...")
            scores_state[key]["context_recall"] = await call_metric(
                "context_recall",
                lambda: context_recall.ascore(
                    user_input=question,
                    retrieved_contexts=contexts,
                    reference=ground_truth,
                ),
            )
            _save_scores(scores_state)

        if scores_state[key].get("factual_correctness") is None:
            print(f"  [{i}/{len(rows)}] factual_correctness...")
            scores_state[key]["factual_correctness"] = await call_metric(
                "factual_correctness",
                lambda: factual_correctness.ascore(response=answer, reference=ground_truth),
            )
            _save_scores(scores_state)

        s = scores_state[key]
        print(
            f"    row {i}: faith={s.get('faithfulness')} "
            f"rel={s.get('answer_relevancy')} "
            f"cp={s.get('context_precision')} "
            f"cr={s.get('context_recall')} "
            f"fact={s.get('factual_correctness')}"
        )

    # Aggregates + CSV
    print("\n=== aggregate ===")
    for m in METRICS:
        col = [v[m] for v in scores_state.values() if v.get(m) is not None]
        if col:
            print(f"  {m:20s} {mean(col):.3f}  (n={len(col)})")
        else:
            print(f"  {m:20s} (no valid scores)")

    CSV_OUT.parent.mkdir(parents=True, exist_ok=True)
    with CSV_OUT.open("w", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["row", "question", "ground_truth", "answer_preview", *METRICS],
        )
        writer.writeheader()
        for i, row in enumerate(rows):
            scores = scores_state.get(str(i), {})
            writer.writerow(
                {
                    "row": i,
                    "question": row["question"][:200],
                    "ground_truth": (row.get("ground_truth") or "")[:200],
                    "answer_preview": (row.get("answer") or "")[:200],
                    **{m: scores.get(m) for m in METRICS},
                }
            )
    print(f"\nper-row scores written to {CSV_OUT}")
    print(f"per-row checkpoint at {SCORES_OUT} (delete to re-judge from scratch)")


if __name__ == "__main__":
    asyncio.run(main())
