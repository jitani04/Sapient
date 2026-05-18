"""Pedagogical helpfulness evaluation for the tutor.

Scores tutor responses on six dimensions — scaffolding, engagement,
misconception handling, calibrated depth, connections, and source grounding —
using an OpenAI judge against ScaleAI TutorBench samples by default.

This eval is independent of the RAG benchmark: it measures how the tutor TEACHES,
not what it retrieves. It complements `retrieval_eval.py` (retrieval quality)
and `ragas_eval.py` (RAG faithfulness/relevance) rather than replacing either.

Run:
    python -m evals.tutoring_eval

Outputs aggregate per-dimension and per-category scores to stdout, full
per-scenario scoring to `evals/tutoring_results.csv`. Generation and judging
calls share the same pacing controls as `ragas_eval.py`.
"""

from __future__ import annotations

import asyncio
import csv
import json
import os
import re
import time
from pathlib import Path
from statistics import mean
from typing import Any

from datasets import load_dataset
from langchain_google_genai import ChatGoogleGenerativeAI
from openai import AsyncOpenAI

from app.core.config import get_settings
from app.services.llm_service import LLMService


TUTORING_DATASET = os.getenv("EVAL_TUTORING_DATASET", "ScaleAI/TutorBench")
TUTORING_SPLIT = os.getenv("EVAL_TUTORING_SPLIT", "train")
TUTORING_SAMPLE_SIZE = int(os.getenv("EVAL_TUTORING_SAMPLE_SIZE", "100"))
TUTORING_INCLUDE_MULTIMODAL = (
    os.getenv("EVAL_TUTORING_INCLUDE_MULTIMODAL", "0").strip().lower()
    in {"1", "true", "yes"}
)
TUTORING_SOURCE = os.getenv("EVAL_TUTORING_SOURCE", "tutorbench").strip().lower()
SCENARIOS_PATH = Path(os.getenv("EVAL_TUTORING_SCENARIOS_PATH", "evals/tutoring_scenarios.json"))
RESULTS_PATH = Path(os.getenv("EVAL_TUTORING_RESULTS_PATH", "evals/tutoring_results.csv"))
CHECKPOINT_PATH = Path(
    os.getenv("EVAL_TUTORING_CHECKPOINT_PATH", "evals/tutoring_responses_checkpoint.json")
)

GEN_MIN_INTERVAL_SEC = float(os.getenv("EVAL_GEN_MIN_INTERVAL_SEC", "20"))
GEN_MAX_ATTEMPTS = int(os.getenv("EVAL_GEN_MAX_ATTEMPTS", "8"))
GEN_MAX_WAIT_SEC = float(os.getenv("EVAL_GEN_MAX_WAIT_SEC", "300"))

DIMENSIONS = ["scaffolding", "engagement", "misconception", "depth", "connections", "grounding"]


JUDGE_INSTRUCTIONS = """You are evaluating a tutor's response for pedagogical quality.

Score the response on six dimensions on a 1-5 scale, where 1 is poor and 5 is excellent.
For each dimension also give a one-sentence justification.

Dimensions:
1. SCAFFOLDING — Did the tutor break the topic into steps or lead the student through reasoning, rather than dumping the full answer at once?
2. ENGAGEMENT — Did the tutor invite the student to think (a probing question, "try this", invite a guess) rather than only delivering exposition?
3. MISCONCEPTION — If the student's message contained a misconception or factual error, did the tutor identify and gently correct it? If no misconception was present, score 5 by default unless the response itself introduces a new error.
4. DEPTH — Was the level matched to the question? Not too shallow, not a textbook chapter dump, vocabulary appropriate for an undergraduate.
5. CONNECTIONS — Did the response connect the new material to analogies, prior topics, or the student's existing knowledge?
6. GROUNDING — Were factual claims tied to the cited materials/sources, when sources were available? If no sources were available for this scenario, score 5 unless the answer makes specific factual claims that should have been grounded.

You will receive: the scenario category, the student's message, optional sample-specific rubrics, and the tutor's response to evaluate.

Return JSON only, in exactly this shape — no preamble, no markdown fences, no commentary:
{
  "scaffolding":   {"score": <1-5>, "reason": "<one sentence>"},
  "engagement":    {"score": <1-5>, "reason": "<one sentence>"},
  "misconception": {"score": <1-5>, "reason": "<one sentence>"},
  "depth":         {"score": <1-5>, "reason": "<one sentence>"},
  "connections":   {"score": <1-5>, "reason": "<one sentence>"},
  "grounding":     {"score": <1-5>, "reason": "<one sentence>"}
}"""


DEFAULT_TUTOR_CONFIG = {
    "name": "Sapient",
    "tone": "warm, patient, curious",
    "style": "Socratic — asks questions before giving answers, uses concrete examples and analogies, encourages the student to try things",
    "instructions": "",
    "student_name": "the student",
    "student_use_case": "studying for an undergraduate university course",
}


def _compact_text(value: Any, *, limit: int | None = None) -> str:
    text = "" if value is None else str(value).strip()
    text = re.sub(r"\s+", " ", text)
    if limit is not None and len(text) > limit:
        return text[: limit - 1].rstrip() + "…"
    return text


def _parse_tutorbench_rubrics(value: Any) -> list[str]:
    if value is None:
        return []
    parsed: Any = value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return [_compact_text(text, limit=1200)]
    if isinstance(parsed, list):
        criteria: list[str] = []
        for item in parsed:
            if isinstance(item, dict):
                criterion = _compact_text(item.get("criteria"))
                attrs = item.get("attributes") if isinstance(item.get("attributes"), dict) else {}
                dimension = _compact_text(attrs.get("eval_dimension"))
                skill = _compact_text(attrs.get("tutoring_skill"))
                severity = _compact_text(attrs.get("severity"))
                prefix_parts = [part for part in (dimension, skill, severity) if part]
                if criterion and prefix_parts:
                    criteria.append(f"{criterion} ({'; '.join(prefix_parts)})")
                elif criterion:
                    criteria.append(criterion)
            elif item:
                criteria.append(_compact_text(item))
        return criteria
    return [_compact_text(parsed, limit=1200)]


def _row_to_tutorbench_scenario(row: dict[str, Any], index: int) -> dict[str, Any]:
    task_id = _compact_text(row.get("TASK_ID")) or f"tutorbench_{index}"
    subject = _compact_text(row.get("SUBJECT")) or "education"
    category = _compact_text(row.get("BATCH")) or "tutorbench"
    prompt = _compact_text(row.get("PROMPT"))
    initial_explanation = _compact_text(row.get("UC1_INITIAL_EXPLANATION"))
    follow_up = _compact_text(row.get("FOLLOW_UP_PROMPT"))
    image_url = _compact_text(row.get("IMAGE_URL"))

    parts: list[str] = []
    if prompt:
        parts.append(f"Original task:\n{prompt}")
    if image_url:
        parts.append(
            "The original task includes an image. If the image is necessary and unavailable, "
            "say what information you would need instead of inventing visual details."
        )
    if initial_explanation:
        parts.append(f"Earlier tutor explanation:\n{initial_explanation}")
    if follow_up:
        parts.append(f"Student follow-up:\n{follow_up}")
    student_message = "\n\n".join(parts).strip() or prompt or follow_up

    return {
        "id": task_id,
        "category": category,
        "subject": subject,
        "student_message": student_message,
        "ideal_behaviors": _parse_tutorbench_rubrics(row.get("RUBRICS")),
        "metadata": {
            "source": "ScaleAI/TutorBench",
            "batch": category,
            "bloom_taxonomy": _compact_text(row.get("bloom_taxonomy")),
            "has_image": bool(image_url),
        },
    }


def _load_tutorbench_scenarios() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    dataset = load_dataset(TUTORING_DATASET, split=TUTORING_SPLIT)
    rows: list[dict[str, Any]] = []
    for row in dataset:
        row_dict = dict(row)
        image_url = _compact_text(row_dict.get("IMAGE_URL"))
        if image_url and not TUTORING_INCLUDE_MULTIMODAL:
            continue
        rows.append(row_dict)
        if len(rows) >= TUTORING_SAMPLE_SIZE:
            break

    if not rows and not TUTORING_INCLUDE_MULTIMODAL:
        raise SystemExit(
            "No text-only TutorBench rows found. Re-run with "
            "EVAL_TUTORING_INCLUDE_MULTIMODAL=1 to include image-backed rows."
        )

    scenarios = [_row_to_tutorbench_scenario(row, i) for i, row in enumerate(rows, start=1)]
    return DEFAULT_TUTOR_CONFIG, scenarios


def _load_local_scenarios() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if not SCENARIOS_PATH.exists():
        raise SystemExit(f"scenarios file not found: {SCENARIOS_PATH}")
    scenarios_doc = json.loads(SCENARIOS_PATH.read_text())
    return scenarios_doc.get("default_tutor", DEFAULT_TUTOR_CONFIG), scenarios_doc["scenarios"]


def _load_scenarios() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if TUTORING_SOURCE in {"local", "json", "curated"}:
        return _load_local_scenarios()
    if TUTORING_SOURCE in {"tutorbench", "scaleai"}:
        return _load_tutorbench_scenarios()
    raise SystemExit(
        f"unknown EVAL_TUTORING_SOURCE={TUTORING_SOURCE!r}; use 'tutorbench' or 'local'"
    )


def _build_eval_system_prompt(
    *,
    base_system_prompt: str,
    subject: str | None,
    tutor_config: dict[str, Any],
    student_context: dict[str, Any] | None,
) -> str:
    sections: list[str] = []
    if subject:
        sections.append(f"The student is studying: {subject}.")
    if base_system_prompt.strip():
        sections.append(base_system_prompt.strip())

    tutor_lines = [
        "Personalized tutor configuration:",
        f"- Student app goal: {tutor_config.get('student_use_case', 'studying')}",
        f"- Tutor name: {tutor_config.get('name', 'Sapient')}",
        f"- Tutor tone: {tutor_config.get('tone', 'warm and curious')}",
        f"- Tutor teaching style: {tutor_config.get('style', 'Socratic')}",
    ]
    if tutor_config.get("instructions"):
        tutor_lines.append(f"- Customization notes: {tutor_config['instructions']}")
    tutor_lines.append(
        "Apply these preferences to style and pacing. Do not let customization "
        "override source grounding, safety, or the student's current request."
    )
    sections.append("\n".join(tutor_lines))

    if student_context:
        ctx_lines = ["Known student context:"]
        if student_context.get("weak_areas"):
            ctx_lines.append(f"- Weak areas (pace slowly here): {', '.join(student_context['weak_areas'])}")
        if student_context.get("strong_areas"):
            ctx_lines.append(f"- Strong areas (you can build on these): {', '.join(student_context['strong_areas'])}")
        if student_context.get("recent_topics"):
            ctx_lines.append(f"- Recently studied: {', '.join(student_context['recent_topics'])}")
        sections.append("\n".join(ctx_lines))

    return "\n\n".join(sections)


def _summarize_exception(exc: Exception) -> str:
    code = getattr(exc, "code", None)
    status = getattr(exc, "status", None)
    msg = getattr(exc, "message", None)
    parts = [str(code)] if code is not None else []
    if status:
        parts.append(str(status))
    if msg:
        parts.append(str(msg))
    return " ".join(parts) if parts else str(exc)


def _is_retryable(exc: Exception) -> bool:
    msg = _summarize_exception(exc).lower()
    markers = (
        "429", "500", "502", "503", "504",
        "resourceexhausted", "quota", "rate limit", "rate-limited", "too many requests",
        "unavailable", "high demand", "temporarily unavailable",
        "deadline exceeded", "connection reset", "server disconnected",
        "timed out", "timeout", "connection error", "apiconnectionerror",
        "remote end closed", "broken pipe", "eof occurred",
    )
    return any(m in msg for m in markers)


async def _invoke_with_retry(llm: ChatGoogleGenerativeAI, lc_messages: list[Any]) -> str:
    for attempt in range(GEN_MAX_ATTEMPTS):
        try:
            response = await asyncio.to_thread(llm.invoke, lc_messages)
            content = response.content
            if isinstance(content, str):
                return content.strip()
            if isinstance(content, list):
                parts: list[str] = []
                for p in content:
                    if isinstance(p, str):
                        parts.append(p)
                    elif isinstance(p, dict) and p.get("type") == "text":
                        parts.append(p.get("text", ""))
                return "".join(parts).strip()
            return ""
        except Exception as exc:
            if _is_retryable(exc) and attempt < GEN_MAX_ATTEMPTS - 1:
                wait = min(GEN_MAX_WAIT_SEC, 10 + 2 ** attempt * 5)
                print(f"    transient error, waiting {wait}s... ({_summarize_exception(exc)[:160]})")
                await asyncio.sleep(wait)
                continue
            raise
    raise RuntimeError("retries exhausted")


def _get_openai_eval_key() -> str | None:
    return (
        os.getenv("EVAL_OPENAI_API_KEY")
        or os.getenv("OPENAI_API_KEY")
        or os.getenv("OPENAI_TTS_API_KEY")
    )


async def _invoke_openai_judge_with_retry(
    *,
    client: AsyncOpenAI,
    model: str,
    prompt: str,
) -> str:
    for attempt in range(GEN_MAX_ATTEMPTS):
        try:
            response = await client.chat.completions.create(
                model=model,
                temperature=0,
                response_format={"type": "json_object"},
                max_tokens=1400,
                messages=[
                    {
                        "role": "system",
                        "content": "You are a strict educational evaluation judge. Return valid JSON only.",
                    },
                    {"role": "user", "content": prompt},
                ],
            )
            return (response.choices[0].message.content or "").strip()
        except Exception as exc:
            if _is_retryable(exc) and attempt < GEN_MAX_ATTEMPTS - 1:
                wait = min(GEN_MAX_WAIT_SEC, 10 + 2 ** attempt * 5)
                print(f"    transient judge error, waiting {wait}s... ({_summarize_exception(exc)[:160]})")
                await asyncio.sleep(wait)
                continue
            raise
    raise RuntimeError("judge retries exhausted")


def _parse_scores(raw: str) -> dict[str, dict[str, Any]] | None:
    """Parse the judge's JSON output, tolerating markdown fences and prose."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.MULTILINE).strip()
    # Find the first {...} block.
    match = re.search(r"\{.*\}", raw, flags=re.DOTALL)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    out: dict[str, dict[str, Any]] = {}
    for dim in DIMENSIONS:
        entry = parsed.get(dim)
        if not isinstance(entry, dict):
            return None
        score = entry.get("score")
        try:
            score = int(score)
        except (TypeError, ValueError):
            return None
        if not (1 <= score <= 5):
            return None
        out[dim] = {"score": score, "reason": str(entry.get("reason", ""))[:300]}
    return out


def _load_checkpoint() -> dict[str, dict[str, Any]]:
    if not CHECKPOINT_PATH.exists():
        return {}
    try:
        return json.loads(CHECKPOINT_PATH.read_text())
    except json.JSONDecodeError:
        return {}


def _save_checkpoint(state: dict[str, dict[str, Any]]) -> None:
    CHECKPOINT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = CHECKPOINT_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2))
    tmp.replace(CHECKPOINT_PATH)


async def main() -> None:
    settings = get_settings()
    api_key = settings.llm_api_key
    os.environ["GOOGLE_API_KEY"] = api_key

    chat_model_name = os.getenv("EVAL_CHAT_MODEL", settings.llm_model)
    judge_model_name = os.getenv("EVAL_TUTORING_JUDGE_MODEL", os.getenv("EVAL_JUDGE_MODEL", "gpt-4o"))
    openai_key = _get_openai_eval_key()
    if not openai_key:
        raise SystemExit(
            "OpenAI eval judge key not set. Set EVAL_OPENAI_API_KEY or OPENAI_API_KEY "
            "(OPENAI_TTS_API_KEY is also accepted for local convenience)."
        )

    default_tutor, scenarios = _load_scenarios()

    chat_llm = ChatGoogleGenerativeAI(
        model=chat_model_name,
        google_api_key=api_key,
        timeout=settings.llm_timeout_seconds,
        temperature=0.7,
        convert_system_message_to_human=True,
    )
    judge_client = AsyncOpenAI(api_key=openai_key)

    state = _load_checkpoint()
    print(f"loaded {len(state)} cached results from checkpoint")
    print(
        f"scoring {len(scenarios)} {TUTORING_SOURCE} scenarios with "
        f"chat={chat_model_name}, OpenAI judge={judge_model_name}, "
        f"min interval {GEN_MIN_INTERVAL_SEC}s, ETA ~{int(2 * len(scenarios) * GEN_MIN_INTERVAL_SEC / 60)} min"
    )

    last_call = 0.0
    rows: list[dict[str, Any]] = []
    for i, scenario in enumerate(scenarios, start=1):
        sid = scenario["id"]
        cached = state.get(sid)

        # 1) Generate tutor response (skipped if cached)
        if cached and cached.get("response"):
            response = cached["response"]
            print(f"  [{i}/{len(scenarios)}] {sid}: using cached response")
        else:
            tutor_config = {**default_tutor, **(scenario.get("tutor_overrides") or {})}
            sys_prompt = _build_eval_system_prompt(
                base_system_prompt=settings.system_prompt,
                subject=scenario.get("subject"),
                tutor_config=tutor_config,
                student_context=scenario.get("student_context"),
            )
            messages = [
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": scenario["student_message"]},
            ]
            lc_messages = LLMService._to_langchain_messages(messages)

            elapsed = time.monotonic() - last_call
            if elapsed < GEN_MIN_INTERVAL_SEC:
                await asyncio.sleep(GEN_MIN_INTERVAL_SEC - elapsed)
            print(f"  [{i}/{len(scenarios)}] {sid}: generating tutor response...")
            response = await _invoke_with_retry(chat_llm, lc_messages)
            last_call = time.monotonic()
            cached = {"response": response}
            state[sid] = cached
            _save_checkpoint(state)

        # 2) Judge (skipped if cached)
        if cached and cached.get("scores"):
            scores = cached["scores"]
            print(f"  [{i}/{len(scenarios)}] {sid}: using cached scores")
        else:
            judge_prompt = (
                f"{JUDGE_INSTRUCTIONS}\n\n"
                f"Scenario category: {scenario.get('category', '(unspecified)')}\n"
                f"Subject: {scenario.get('subject', '(unspecified)')}\n\n"
                f"Student message:\n{scenario['student_message']}\n\n"
                f"Sample-specific rubrics / expected tutor behaviors:\n- "
                + "\n- ".join(scenario.get("ideal_behaviors", []))
                + f"\n\nTutor response to evaluate:\n{response}\n"
            )
            elapsed = time.monotonic() - last_call
            if elapsed < GEN_MIN_INTERVAL_SEC:
                await asyncio.sleep(GEN_MIN_INTERVAL_SEC - elapsed)
            print(f"  [{i}/{len(scenarios)}] {sid}: judging...")
            raw = await _invoke_openai_judge_with_retry(
                client=judge_client,
                model=judge_model_name,
                prompt=judge_prompt,
            )
            last_call = time.monotonic()
            scores = _parse_scores(raw)
            if scores is None:
                print(f"    WARN: judge output was not valid JSON; raw start: {raw[:200]}")
                scores = {dim: {"score": None, "reason": "(unparseable judge output)"} for dim in DIMENSIONS}
            cached["scores"] = scores
            state[sid] = cached
            _save_checkpoint(state)

        row: dict[str, Any] = {
            "id": sid,
            "category": scenario.get("category", ""),
            "subject": scenario.get("subject", ""),
            "source": scenario.get("metadata", {}).get("source", TUTORING_SOURCE),
            "student_message": scenario["student_message"][:200],
        }
        for dim in DIMENSIONS:
            entry = scores.get(dim, {})
            row[f"{dim}_score"] = entry.get("score")
            row[f"{dim}_reason"] = entry.get("reason", "")
        valid_scores = [int(scores[d]["score"]) for d in DIMENSIONS if scores[d].get("score") is not None]
        row["overall"] = round(mean(valid_scores), 2) if valid_scores else None
        rows.append(row)

    # Aggregates
    print("\n=== aggregate (per dimension, mean over scenarios) ===")
    for dim in DIMENSIONS:
        col = [r[f"{dim}_score"] for r in rows if r[f"{dim}_score"] is not None]
        if col:
            print(f"  {dim:14s} {mean(col):.2f}  (n={len(col)})")
        else:
            print(f"  {dim:14s} (no valid scores)")
    overalls = [r["overall"] for r in rows if r["overall"] is not None]
    if overalls:
        print(f"\n  overall mean: {mean(overalls):.2f}")

    print("\n=== aggregate (per category, mean overall) ===")
    by_cat: dict[str, list[float]] = {}
    for r in rows:
        if r["overall"] is None:
            continue
        by_cat.setdefault(r["category"], []).append(r["overall"])
    for cat, vals in sorted(by_cat.items()):
        print(f"  {cat:18s} {mean(vals):.2f}  (n={len(vals)})")

    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with RESULTS_PATH.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nper-scenario scores written to {RESULTS_PATH}")
    print(f"checkpoint at {CHECKPOINT_PATH} (delete to re-run from scratch)")


if __name__ == "__main__":
    asyncio.run(main())
