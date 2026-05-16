"""Bayesian Knowledge Tracing for per-concept mastery estimates."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project_profile import ProjectProfile
from app.models.quiz import Quiz

BKT_DEFAULT_PARAMS = {
    "prior": 0.25,
    "learn": 0.12,
    "guess": 0.20,
    "slip": 0.10,
}

MASTERY_THRESHOLD = 0.85
REVIEW_THRESHOLD = 0.45


@dataclass(frozen=True)
class KnowledgeTraceResult:
    concept_id: str
    concept: str
    mastery: float
    status: str


def update_bkt_mastery(
    prior_mastery: float,
    is_correct: bool,
    *,
    learn: float = BKT_DEFAULT_PARAMS["learn"],
    guess: float = BKT_DEFAULT_PARAMS["guess"],
    slip: float = BKT_DEFAULT_PARAMS["slip"],
) -> float:
    """Apply one Bayesian Knowledge Tracing observation update."""
    prior_mastery = _clamp_probability(prior_mastery)
    learn = _clamp_probability(learn)
    guess = _clamp_probability(guess)
    slip = _clamp_probability(slip)

    if is_correct:
        numerator = prior_mastery * (1 - slip)
        denominator = numerator + ((1 - prior_mastery) * guess)
    else:
        numerator = prior_mastery * slip
        denominator = numerator + ((1 - prior_mastery) * (1 - guess))

    posterior = numerator / denominator if denominator else prior_mastery
    after_learning = posterior + ((1 - posterior) * learn)
    return round(_clamp_probability(after_learning), 4)


def mastery_to_learning_status(mastery: float, attempts: int) -> str:
    if attempts <= 0:
        return "not_started"
    if mastery >= MASTERY_THRESHOLD:
        return "mastered"
    if mastery <= REVIEW_THRESHOLD:
        return "needs_review"
    return "in_progress"


async def update_knowledge_state_for_quiz(
    *,
    session: AsyncSession,
    user_id: int,
    subject: str | None,
    quiz: Quiz,
    is_correct: bool,
) -> KnowledgeTraceResult | None:
    if not subject:
        return None

    profile = await _get_or_create_project_profile(session=session, user_id=user_id, subject=subject)
    concept_id, concept, is_learning_map_node = resolve_quiz_concept(profile=profile, quiz=quiz)

    state = dict(profile.knowledge_state or {})
    current = _coerce_state_entry(state.get(concept_id), concept_id=concept_id, concept=concept)
    params = _coerce_params(current.get("params"))
    previous_mastery = float(current.get("mastery", params["prior"]))
    attempts = int(current.get("attempts", 0)) + 1
    correct = int(current.get("correct", 0)) + (1 if is_correct else 0)

    mastery = update_bkt_mastery(
        previous_mastery,
        is_correct,
        learn=params["learn"],
        guess=params["guess"],
        slip=params["slip"],
    )
    status = mastery_to_learning_status(mastery, attempts)

    state[concept_id] = {
        "concept_id": concept_id,
        "concept": concept,
        "mastery": mastery,
        "attempts": attempts,
        "correct": correct,
        "last_observed_at": datetime.now(timezone.utc).isoformat(),
        "params": params,
    }
    profile.knowledge_state = state

    if is_learning_map_node:
        progress = dict(profile.learning_map_progress or {})
        progress[concept_id] = status
        profile.learning_map_progress = progress

    return KnowledgeTraceResult(
        concept_id=concept_id,
        concept=concept,
        mastery=mastery,
        status=status,
    )


def resolve_quiz_concept(*, profile: ProjectProfile, quiz: Quiz) -> tuple[str, str, bool]:
    explicit_concept = (quiz.concept or "").strip()
    nodes = _mind_map_nodes(profile.mind_map)
    search_text = " ".join(
        item
        for item in [
            explicit_concept,
            quiz.question,
            quiz.correct_answer,
            quiz.explanation,
            " ".join(str(option) for option in quiz.options) if isinstance(quiz.options, list) else "",
        ]
        if item
    )

    best_node = _best_matching_node(nodes, explicit_concept or search_text)
    if best_node:
        return best_node["id"], best_node["topic"], True

    fallback = explicit_concept or profile.subject or "General"
    return f"concept:{_slugify(fallback)}", fallback, False


def knowledge_state_for_progress(profile: ProjectProfile | None) -> list[dict[str, Any]]:
    if not profile or not isinstance(profile.knowledge_state, dict):
        return []
    return sorted(
        [_coerce_state_entry(value, concept_id=key, concept=key) for key, value in profile.knowledge_state.items()],
        key=lambda item: (-float(item["mastery"]), str(item["concept"]).lower()),
    )


async def _get_or_create_project_profile(
    *,
    session: AsyncSession,
    user_id: int,
    subject: str,
) -> ProjectProfile:
    result = await session.execute(
        select(ProjectProfile).where(
            ProjectProfile.user_id == user_id,
            func.lower(ProjectProfile.subject) == subject.lower(),
        )
    )
    profile = result.scalar_one_or_none()
    if profile:
        return profile

    profile = ProjectProfile(user_id=user_id, subject=subject)
    session.add(profile)
    await session.flush()
    return profile


def _best_matching_node(nodes: list[dict[str, Any]], text: str) -> dict[str, Any] | None:
    normalized_text = _normalize(text)
    if not normalized_text:
        return None

    best: tuple[float, dict[str, Any] | None] = (0.0, None)
    text_tokens = set(normalized_text.split())
    for node in nodes:
        terms = [node["topic"], *node.get("subtopics", [])]
        score = 0.0
        for term in terms:
            normalized_term = _normalize(str(term))
            if not normalized_term:
                continue
            if normalized_term in normalized_text or normalized_text in normalized_term:
                score = max(score, 1.0 + len(normalized_term) / 100)
                continue
            term_tokens = set(normalized_term.split())
            if term_tokens:
                score = max(score, len(text_tokens & term_tokens) / len(term_tokens))
        if score > best[0]:
            best = (score, node)

    return best[1] if best[0] >= 0.5 else None


def _mind_map_nodes(mind_map: dict[str, Any] | None) -> list[dict[str, Any]]:
    raw_nodes = mind_map.get("nodes", []) if isinstance(mind_map, dict) else []
    nodes: list[dict[str, Any]] = []
    if not isinstance(raw_nodes, list):
        return nodes
    for index, raw_node in enumerate(raw_nodes):
        if not isinstance(raw_node, dict):
            continue
        topic = str(raw_node.get("topic", "")).strip()
        if not topic:
            continue
        nodes.append(
            {
                "id": str(raw_node.get("id") or _slugify_with_index(topic, index)),
                "topic": topic,
                "subtopics": [
                    str(item).strip()
                    for item in raw_node.get("subtopics", [])
                    if str(item).strip()
                ],
            }
        )
    return nodes


def _coerce_state_entry(value: Any, *, concept_id: str, concept: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        value = {}
    params = _coerce_params(value.get("params"))
    return {
        "concept_id": str(value.get("concept_id") or concept_id),
        "concept": str(value.get("concept") or concept),
        "mastery": round(_clamp_probability(float(value.get("mastery", params["prior"]))), 4),
        "attempts": max(0, int(value.get("attempts", 0))),
        "correct": max(0, int(value.get("correct", 0))),
        "last_observed_at": value.get("last_observed_at"),
        "params": params,
    }


def _coerce_params(value: Any) -> dict[str, float]:
    params = dict(BKT_DEFAULT_PARAMS)
    if isinstance(value, dict):
        for key in params:
            if key in value:
                params[key] = _clamp_probability(float(value[key]))
    return params


def _clamp_probability(value: float) -> float:
    return max(0.001, min(0.999, value))


def _normalize(value: str) -> str:
    return " ".join("".join(ch.lower() if ch.isalnum() else " " for ch in value).split())


def _slugify(value: str) -> str:
    slug = "-".join(_normalize(value).split())
    return slug or "concept"


def _slugify_with_index(value: str, index: int) -> str:
    return f"{_slugify(value)}-{index}"
