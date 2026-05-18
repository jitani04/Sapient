"""End-to-end RAG eval against rag-mini-bioasq, using your real retriever.

Pipeline per question:
  1. retrieve_context(...) hits pgvector (your live retriever)
  2. LLMService generates an answer grounded on those chunks
  3. OpenAI judges faithfulness, answer_relevancy, context_precision,
     context_recall, and factual_correctness through the checkpointed Ragas
     judge script

Run:
    pip install -r evals/requirements.txt
    python -m evals.ingest_dataset      # one-time: load corpus into pgvector
    python -m evals.ragas_eval
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

from datasets import load_dataset
from google.genai import _api_client as google_genai_api_client
from google.genai.errors import APIError
from langchain_google_genai import ChatGoogleGenerativeAI

from app.core.config import get_settings
from app.db.session import get_session_factory
from app.services import retriever
from app.services.prompt_builder import build_responses_input
from app.services.retriever import RetrievedChunk
from evals.ragas_judge_checkpoint import main as judge_checkpoint_main


SAMPLE_SIZE = int(os.getenv("EVAL_SAMPLE_SIZE", "100"))

# Gemini answer generation is more reliable when run slowly and with minimal thinking.
GEN_MIN_INTERVAL_SEC = float(os.getenv("EVAL_GEN_MIN_INTERVAL_SEC", "20"))
GEN_MAX_ATTEMPTS = int(os.getenv("EVAL_GEN_MAX_ATTEMPTS", "12"))
GEN_MAX_WAIT_SEC = float(os.getenv("EVAL_GEN_MAX_WAIT_SEC", "300"))
CHECKPOINT_PATH = Path(os.getenv("EVAL_CHECKPOINT_PATH", "evals/ragas_answers_checkpoint.json"))


def configure_google_genai_transport() -> None:
    # The google-genai aiohttp async path can emit
    # "coroutine 'ClientResponse.json' was never awaited" on error handling.
    # Force httpx for this eval process unless explicitly disabled.
    use_httpx = os.getenv("EVAL_FORCE_HTTPX", "1").strip().lower() not in {"0", "false", "no"}
    if use_httpx and google_genai_api_client.has_aiohttp:
        google_genai_api_client.has_aiohttp = False


def build_chat_llm(
    *,
    model: str,
    api_key: str,
    timeout_seconds: float,
    retries: int = 0,
) -> ChatGoogleGenerativeAI:
    thinking_level = os.getenv("EVAL_THINKING_LEVEL", "").strip() or None
    kwargs: dict[str, Any] = {
        "model": model,
        "google_api_key": api_key,
        "timeout": timeout_seconds,
        "retries": retries,
        "temperature": 0.0,
        "convert_system_message_to_human": True,
    }
    if thinking_level is not None:
        kwargs["thinking_level"] = thinking_level
    return ChatGoogleGenerativeAI(
        **kwargs,
    )


def extract_text_content(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str) and part:
                parts.append(part)
            elif isinstance(part, dict) and part.get("type") == "text" and part.get("text"):
                parts.append(part["text"])
        return "".join(parts).strip()
    return ""


def summarize_exception(exc: Exception) -> str:
    code = getattr(exc, "code", None)
    status = getattr(exc, "status", None)
    message = getattr(exc, "message", None)
    details: list[str] = []
    if code is not None:
        details.append(str(code))
    if status:
        details.append(str(status))
    if message:
        details.append(str(message))
    if details:
        return " ".join(details)
    return str(exc)


def is_retryable_generation_error(exc: Exception) -> bool:
    if isinstance(exc, APIError):
        if exc.code in {429, 500, 502, 503, 504}:
            return True
        if exc.status in {"RESOURCE_EXHAUSTED", "UNAVAILABLE", "INTERNAL", "DEADLINE_EXCEEDED"}:
            return True

    msg = summarize_exception(exc).lower()
    return any(
        marker in msg
        for marker in (
            "429",
            "500",
            "502",
            "503",
            "504",
            "resourceexhausted",
            "quota",
            "rate limit",
            "rate-limited",
            "too many requests",
            "unavailable",
            "high demand",
            "temporarily unavailable",
            "deadline exceeded",
            "connection reset",
            "server disconnected",
            "timed out",
            "timeout",
        )
    )


def load_checkpoint(*, sample_size: int) -> list[dict[str, Any]]:
    if not CHECKPOINT_PATH.exists():
        return []
    try:
        payload = json.loads(CHECKPOINT_PATH.read_text())
    except json.JSONDecodeError:
        print(f"warning: ignoring invalid checkpoint at {CHECKPOINT_PATH}")
        return []

    rows = payload.get("rows")
    saved_sample_size = payload.get("sample_size")
    if not isinstance(rows, list):
        print(f"warning: ignoring malformed checkpoint at {CHECKPOINT_PATH}")
        return []
    if saved_sample_size == sample_size or saved_sample_size is None:
        return rows[:sample_size]
    if isinstance(saved_sample_size, int) and saved_sample_size < sample_size:
        print(
            f"extending checkpoint from sample_size={saved_sample_size} "
            f"to current sample_size={sample_size}"
        )
        return rows[:saved_sample_size]
    if isinstance(saved_sample_size, int) and saved_sample_size > sample_size:
        print(
            f"using first {sample_size} rows from larger checkpoint "
            f"sample_size={saved_sample_size}"
        )
        return rows[:sample_size]
    if saved_sample_size != sample_size:
        print(
            f"warning: ignoring checkpoint for sample_size={saved_sample_size}; "
            f"current sample_size={sample_size}"
        )
        return []
    return rows[:sample_size]


def save_checkpoint(*, rows: list[dict[str, Any]], sample_size: int) -> None:
    CHECKPOINT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = CHECKPOINT_PATH.with_suffix(".tmp")
    tmp_path.write_text(json.dumps({"sample_size": sample_size, "rows": rows}, indent=2))
    tmp_path.replace(CHECKPOINT_PATH)


async def generate_answer(
    chat_llm, question: str, retrieved: list[RetrievedChunk]
) -> str:
    system = (
        "Answer the user's question using ONLY the provided context. "
        "If the context is insufficient, say so."
    )
    messages = build_responses_input(
        system_prompt=system,
        history=[],
        user_query=question,
        retrieved_context=retrieved,
    )
    # convert dict messages to langchain messages via the same helper as production
    from app.services.llm_service import LLMService
    lc_messages = LLMService._to_langchain_messages(messages)

    for attempt in range(GEN_MAX_ATTEMPTS):
        try:
            # Use the sync client in a worker thread to avoid aiohttp-specific
            # warning noise from the async Google SDK on transient 5xx failures.
            response = await asyncio.to_thread(chat_llm.invoke, lc_messages)
            return extract_text_content(response.content)
        except Exception as e:
            msg = summarize_exception(e)
            if is_retryable_generation_error(e) and attempt < GEN_MAX_ATTEMPTS - 1:
                wait = min(GEN_MAX_WAIT_SEC, 10 + 2 ** attempt * 5)
                print(f"    transient chat error, waiting {wait}s... ({msg[:160]})")
                await asyncio.sleep(wait)
                continue
            print(f"    generation failed (attempt {attempt + 1}): {msg[:200]}")
            raise
    raise RuntimeError("answer generation retries exhausted")


async def main() -> None:
    configure_google_genai_transport()
    settings = get_settings()
    api_key = settings.llm_api_key
    os.environ["GOOGLE_API_KEY"] = api_key
    chat_model = os.getenv("EVAL_CHAT_MODEL", settings.llm_model)

    with open("evals/eval_corpus_map.json") as f:
        corpus_map = json.load(f)
    eval_user_id = corpus_map["user_id"]
    eval_subject = corpus_map["subject"]
    ingested_sample_size = int(corpus_map.get("sample_size") or 0)
    if ingested_sample_size and SAMPLE_SIZE > ingested_sample_size:
        raise SystemExit(
            f"EVAL_SAMPLE_SIZE={SAMPLE_SIZE} but corpus was ingested for only "
            f"{ingested_sample_size} QA rows. Re-run `python -m evals.ingest_dataset` "
            "with the same or larger EVAL_SAMPLE_SIZE."
        )

    print(f"loading rag-mini-bioasq questions (first {SAMPLE_SIZE})...")
    qa_ds = load_dataset(
        "rag-datasets/rag-mini-bioasq", "question-answer-passages", split="test"
    )
    qa_ds = qa_ds.select(range(min(SAMPLE_SIZE, len(qa_ds))))
    rows = load_checkpoint(sample_size=len(qa_ds))
    completed = min(len(rows), len(qa_ds))
    if completed:
        print(f"resuming from checkpoint: {completed}/{len(qa_ds)} answers already generated")

    chat_llm = build_chat_llm(
        model=chat_model,
        api_key=api_key,
        timeout_seconds=settings.llm_timeout_seconds,
        retries=0,  # we handle retries ourselves
    )

    import time

    factory = get_session_factory()
    print(
        f"running retriever + generator "
        f"(model={chat_model}, min interval {GEN_MIN_INTERVAL_SEC}s, "
        f"ETA ~{int(len(qa_ds) * GEN_MIN_INTERVAL_SEC / 60)} min)..."
    )
    last = 0.0
    async with factory() as session:
        for i, row in enumerate(qa_ds):
            if i < completed:
                continue
            question = row["question"]
            ground_truth = row["answer"]

            retrieved = await retriever.retrieve_context(
                session=session,
                user_id=eval_user_id,
                conversation_id=0,
                query=question,
                subject=eval_subject,
            )
            contexts = [c.content for c in retrieved]
            if not contexts:
                contexts = ["(no context retrieved)"]

            elapsed = time.monotonic() - last
            if elapsed < GEN_MIN_INTERVAL_SEC:
                await asyncio.sleep(GEN_MIN_INTERVAL_SEC - elapsed)
            answer = await generate_answer(chat_llm, question, retrieved)
            last = time.monotonic()
            print(f"  [{i + 1}/{len(qa_ds)}] {question[:70]}")
            rows.append(
                {
                    "question": question,
                    "contexts": contexts,
                    "answer": answer,
                    "ground_truth": ground_truth,
                }
            )
            save_checkpoint(rows=rows, sample_size=len(qa_ds))

    print("\nanswer generation complete; running OpenAI Ragas judge from checkpoint...")
    await judge_checkpoint_main()


if __name__ == "__main__":
    asyncio.run(main())
