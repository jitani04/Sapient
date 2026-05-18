from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Awaitable, Callable

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.models.conversation import Conversation
from app.models.message import Message, MessageRole
from app.models.message_feedback import MessageFeedback
from app.models.preference_memory import PreferenceMemory
from app.models.user import User
from app.schemas.feedback import FeedbackAnalyticsRead, FeedbackCreate
from app.services.embedding_service import create_embedding_service
from app.services.errors import ConversationNotFoundError

if TYPE_CHECKING:
    from app.services.llm_service import LLMService

logger = logging.getLogger(__name__)

ALLOWED_REASON_CATEGORIES = {
    "incorrect_or_hallucinated",
    "did_not_answer_question",
    "too_vague",
    "too_verbose",
    "too_short",
    "gave_answer_too_quickly",
    "not_enough_hints",
    "wrong_or_missing_source",
    "bad_formatting",
    "tool_or_retrieval_failed",
    "tone_issue",
    "helpful",
    "other",
}
ALLOWED_STABILITY = {"low", "medium", "high"}
_FORBIDDEN_PREFERENCE_FRAGMENTS = (
    "always give the final answer",
    "give the final answer",
    "never challenge",
    "agree with the student",
    "agree with me",
    "even when wrong",
)


@dataclass(slots=True)
class FeedbackClassificationInput:
    rating: str
    feedback_text: str | None
    correction: str | None
    original_user_message: str | None
    assistant_response: str | None
    task_type: str | None


@dataclass(slots=True)
class FeedbackClassification:
    reason_category: str
    feedback_summary: str
    derived_preference: str | None
    should_update_user_preferences: bool
    stability: str
    caveat: str | None


Classifier = Callable[..., Awaitable[FeedbackClassification]]


def _clean_optional_text(value: str | None, *, limit: int = 1000) -> str | None:
    if value is None:
        return None
    clean = value.strip()
    return clean[:limit] or None


def _strip_code_fences(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        body = raw.split("```", 2)
        if len(body) >= 2:
            inner = body[1]
            if inner.lstrip().startswith("json"):
                inner = inner.lstrip()[4:]
            raw = inner.rsplit("```", 1)[0]
    return raw.strip()


def _safe_derived_preference(value: str | None) -> str | None:
    if not value:
        return None
    clean = value.strip()
    if not clean:
        return None
    lowered = clean.lower()
    if any(fragment in lowered for fragment in _FORBIDDEN_PREFERENCE_FRAGMENTS):
        return None
    return clean[:1000]


def _normalise_classification(data: dict[str, Any]) -> FeedbackClassification:
    reason_category = str(data.get("reason_category") or "other").strip()
    if reason_category not in ALLOWED_REASON_CATEGORIES:
        reason_category = "other"

    stability = str(data.get("stability") or "low").strip().lower()
    if stability not in ALLOWED_STABILITY:
        stability = "low"

    derived_preference = _safe_derived_preference(data.get("derived_preference"))
    should_update = bool(data.get("should_update_user_preferences")) and derived_preference is not None
    if stability == "low":
        should_update = False

    feedback_summary = str(data.get("feedback_summary") or "").strip()[:500]
    if not feedback_summary:
        feedback_summary = "The user left feedback on the assistant response."

    caveat = _clean_optional_text(str(data.get("caveat")) if data.get("caveat") is not None else None, limit=500)
    return FeedbackClassification(
        reason_category=reason_category,
        feedback_summary=feedback_summary,
        derived_preference=derived_preference,
        should_update_user_preferences=should_update,
        stability=stability,
        caveat=caveat,
    )


def _build_classifier_prompt(entry: FeedbackClassificationInput) -> str:
    return f"""
You are analyzing user feedback for an LLM tutoring app.

Your job is to classify the feedback and extract safe personalization signals.

Important:
- Do not blindly turn dislikes into preferences.
- A student may dislike an answer because it challenged them appropriately.
- Feedback should adapt communication style and tutoring strategy, but must not override correctness, safety, or the learning objective.
- Do not create preferences like "always give the final answer" or "agree with the student."
- For tutoring/practice tasks, prefer hints, scaffolding, and checking understanding before final answers unless the student explicitly asks for the answer.
- If the feedback is vague or one-off, mark should_update_user_preferences as false or stability as low.

Return valid JSON only with:
{{
  "reason_category": one of the allowed categories,
  "feedback_summary": one short sentence summarizing the feedback,
  "derived_preference": one safe future-facing preference, or null,
  "should_update_user_preferences": boolean,
  "stability": "low" | "medium" | "high",
  "caveat": one short caveat or null
}}

Allowed reason categories:
- incorrect_or_hallucinated
- did_not_answer_question
- too_vague
- too_verbose
- too_short
- gave_answer_too_quickly
- not_enough_hints
- wrong_or_missing_source
- bad_formatting
- tool_or_retrieval_failed
- tone_issue
- helpful
- other

Feedback:
Rating: {entry.rating}
User feedback text: {entry.feedback_text or ""}
Correction: {entry.correction or ""}

Original user message:
{entry.original_user_message or ""}

Assistant response:
{entry.assistant_response or ""}

Task type:
{entry.task_type or ""}
""".strip()


async def classify_feedback(
    *,
    llm_service: "LLMService",
    feedback_entry: FeedbackClassificationInput,
) -> FeedbackClassification:
    prompt = _build_classifier_prompt(feedback_entry)
    lc_messages = llm_service.to_langchain_messages([{"role": "user", "content": prompt}])
    response = await llm_service._llm.ainvoke(lc_messages)  # noqa: SLF001
    raw = response.content if isinstance(response.content, str) else ""
    data = json.loads(_strip_code_fences(raw))
    return _normalise_classification(data)


async def _get_owned_message_context(
    *,
    session: AsyncSession,
    user_id: int,
    conversation_id: int,
    message_id: int,
) -> tuple[Conversation, Message, Message | None]:
    result = await session.execute(
        select(Conversation, Message)
        .join(Message, Message.conversation_id == Conversation.id)
        .where(
            Conversation.id == conversation_id,
            Conversation.user_id == user_id,
            Message.id == message_id,
            Message.conversation_id == conversation_id,
            Message.role == MessageRole.ASSISTANT,
        )
    )
    row = result.one_or_none()
    if row is None:
        raise ConversationNotFoundError(f"Message {message_id} not found for conversation {conversation_id}.")

    conversation, assistant_message = row
    previous_user_message = await session.scalar(
        select(Message)
        .where(
            Message.conversation_id == conversation_id,
            Message.role == MessageRole.USER,
            Message.id < message_id,
        )
        .order_by(Message.id.desc())
        .limit(1)
    )
    return conversation, assistant_message, previous_user_message


async def create_or_update_feedback(
    *,
    session: AsyncSession,
    user_id: int,
    body: FeedbackCreate,
    classifier: Classifier | None = None,
    llm_service: "LLMService | None" = None,
    settings: Settings | None = None,
) -> MessageFeedback:
    """Persist the rating row synchronously. LLM enrichment runs in the background."""
    settings = settings or get_settings()
    conversation, assistant_message, previous_user_message = await _get_owned_message_context(
        session=session,
        user_id=user_id,
        conversation_id=body.conversation_id,
        message_id=body.message_id,
    )

    feedback_text = _clean_optional_text(body.feedback_text)
    correction = _clean_optional_text(body.correction)
    existing = await session.scalar(
        select(MessageFeedback).where(
            MessageFeedback.user_id == user_id,
            MessageFeedback.message_id == body.message_id,
        )
    )
    feedback = existing or MessageFeedback(
        user_id=user_id,
        message_id=body.message_id,
        conversation_id=body.conversation_id,
    )
    feedback.rating = body.rating
    feedback.feedback_text = feedback_text
    feedback.correction = correction
    feedback.task_type = conversation.subject
    feedback.prompt_version = settings.prompt_version
    feedback.model_name = settings.llm_model
    # Trace metadata is only meaningful when the frontend still has the original
    # SSE end event — on later re-rates we leave the prior values alone.
    if body.latency_ms is not None:
        feedback.latency_ms = body.latency_ms
    if body.retrieved_chunk_ids is not None:
        feedback.retrieved_chunk_ids = body.retrieved_chunk_ids
    if body.tool_trace is not None:
        feedback.tool_trace = body.tool_trace

    # Comment text changed (or was cleared) — drop the prior LLM enrichment so we don't
    # leave a misleading classification next to fresh-but-not-yet-classified text.
    if not existing or feedback_text != existing.feedback_text or correction != existing.correction:
        feedback.llm_reason_category = None
        feedback.llm_feedback_summary = None
        feedback.llm_derived_preference = None
        feedback.llm_should_update_user_preferences = None
        feedback.llm_stability = None
        feedback.llm_caveat = None

    if classifier is not None and (feedback_text or correction):
        if llm_service is None:
            from app.services.llm_service import create_llm_service

            llm_service = create_llm_service()
        classification = await classifier(
            llm_service=llm_service,
            feedback_entry=FeedbackClassificationInput(
                rating=body.rating,
                feedback_text=feedback_text,
                correction=correction,
                original_user_message=previous_user_message.content if previous_user_message else None,
                assistant_response=assistant_message.content,
                task_type=conversation.subject,
            ),
        )
        feedback.llm_reason_category = classification.reason_category
        feedback.llm_feedback_summary = classification.feedback_summary
        feedback.llm_derived_preference = classification.derived_preference
        feedback.llm_should_update_user_preferences = classification.should_update_user_preferences
        feedback.llm_stability = classification.stability
        feedback.llm_caveat = classification.caveat

    if not existing:
        session.add(feedback)

    await session.commit()
    await session.refresh(feedback)
    return feedback


async def enrich_feedback_in_background(
    *,
    session_factory: Callable[[], AsyncSession],
    feedback_id: int,
    classifier: Classifier = classify_feedback,
    llm_service: "LLMService | None" = None,
    settings: Settings | None = None,
) -> None:
    """Run LLM classification + preference updates for a saved feedback row.

    Runs out-of-band so the feedback POST returns immediately. Failures only
    log a warning — the user's rating is already safely persisted.
    """
    settings = settings or get_settings()
    async with session_factory() as session:  # type: ignore[call-arg]
        feedback = await session.get(MessageFeedback, feedback_id)
        if feedback is None:
            return

        if not (feedback.feedback_text or feedback.correction):
            # Nothing to classify, but we may still want to refresh the preference summary
            # if this rating affects a thumbs-down quorum.
            return

        conversation = await session.get(Conversation, feedback.conversation_id)
        assistant_message = await session.get(Message, feedback.message_id)
        if conversation is None or assistant_message is None:
            return

        previous_user_message = await session.scalar(
            select(Message)
            .where(
                Message.conversation_id == feedback.conversation_id,
                Message.role == MessageRole.USER,
                Message.id < feedback.message_id,
            )
            .order_by(Message.id.desc())
            .limit(1)
        )

        if llm_service is None:
            from app.services.llm_service import create_llm_service

            llm_service = create_llm_service()

        try:
            classification = await classifier(
                llm_service=llm_service,
                feedback_entry=FeedbackClassificationInput(
                    rating=feedback.rating,
                    feedback_text=feedback.feedback_text,
                    correction=feedback.correction,
                    original_user_message=previous_user_message.content if previous_user_message else None,
                    assistant_response=assistant_message.content,
                    task_type=conversation.subject,
                ),
            )
            feedback.llm_reason_category = classification.reason_category
            feedback.llm_feedback_summary = classification.feedback_summary
            feedback.llm_derived_preference = classification.derived_preference
            feedback.llm_should_update_user_preferences = classification.should_update_user_preferences
            feedback.llm_stability = classification.stability
            feedback.llm_caveat = classification.caveat
            await session.commit()
            await session.refresh(feedback)
        except Exception as exc:  # noqa: BLE001 - background enrichment must not raise.
            logger.warning("Feedback classification failed: %s", exc)
            return

        if (
            settings.enable_feedback_preferences
            # Positive feedback intentionally does NOT trigger preference updates:
            # a thumbs-up on a sycophantic answer would otherwise reinforce the
            # behavior. Style preferences flow exclusively through thumbs-down
            # with a written reason, so the student has to articulate the issue.
            and feedback.rating == "thumbs_down"
            and (feedback.feedback_text or feedback.correction)
        ):
            try:
                await update_user_preference_summary(
                    session=session,
                    user_id=feedback.user_id,
                    llm_service=llm_service,
                    settings=settings,
                )
                await maybe_store_preference_memory(session=session, feedback=feedback, settings=settings)
            except Exception as exc:  # noqa: BLE001 - personalization is best-effort.
                logger.warning("Preference update failed: %s", exc)


def _build_preference_summary_prompt(feedback_entries: list[MessageFeedback]) -> str:
    rendered_entries = []
    for entry in feedback_entries:
        parts = [
            f"- Rating: {entry.rating}",
            f"  Category: {entry.llm_reason_category or 'unknown'}",
            f"  Summary: {entry.llm_feedback_summary or ''}",
            f"  Derived preference: {entry.llm_derived_preference or ''}",
            f"  Stability: {entry.llm_stability or 'unknown'}",
        ]
        if entry.correction:
            parts.append(f"  Correction: {entry.correction}")
        if entry.llm_caveat:
            parts.append(f"  Caveat: {entry.llm_caveat}")
        rendered_entries.append("\n".join(parts))

    return f"""
You are summarizing stable tutoring preferences from analyzed user feedback.

Important:
- Do not blindly infer that the tutor should always comply with dislikes.
- Feedback may reflect frustration, not a stable learning preference.
- Separate communication style preferences from learning strategy preferences.
- Do not recommend giving away answers just because the user disliked being challenged.
- Ignore one-off feedback unless repeated or clearly useful.
- Keep the summary short and actionable.

Given the analyzed feedback entries below, produce at most 5 bullets total under these headings:

Communication preferences:
- ...

Learning strategy preferences:
- ...

Caveats:
- ...

Only include preferences that are useful for future tutoring.

Analyzed feedback entries:
{chr(10).join(rendered_entries)}
""".strip()


async def update_user_preference_summary(
    *,
    session: AsyncSession,
    user_id: int,
    llm_service: "LLMService | None" = None,
    settings: Settings | None = None,
) -> str | None:
    settings = settings or get_settings()
    result = await session.execute(
        select(MessageFeedback)
        .where(
            MessageFeedback.user_id == user_id,
            MessageFeedback.llm_derived_preference.is_not(None),
        )
        .order_by(
            MessageFeedback.llm_should_update_user_preferences.desc().nullslast(),
            MessageFeedback.correction.is_not(None).desc(),
            case(
                (MessageFeedback.llm_stability == "high", 3),
                (MessageFeedback.llm_stability == "medium", 2),
                (MessageFeedback.llm_stability == "low", 1),
                else_=0,
            ).desc(),
            MessageFeedback.created_at.desc(),
        )
        .limit(settings.preference_summary_max_feedback_items)
    )
    feedback_entries = list(result.scalars())
    feedback_entries = [
        entry
        for entry in feedback_entries
        if entry.llm_should_update_user_preferences is True or entry.llm_derived_preference
    ]

    user = await session.get(User, user_id)
    if not user:
        return None
    if not feedback_entries:
        user.preference_summary = None
        user.preference_summary_updated_at = datetime.now(UTC)
        await session.commit()
        return None

    if llm_service is None:
        from app.services.llm_service import create_llm_service
        llm_service = create_llm_service()
    prompt = _build_preference_summary_prompt(feedback_entries)
    response = await llm_service._llm.ainvoke(llm_service.to_langchain_messages([{"role": "user", "content": prompt}]))  # noqa: SLF001
    summary = response.content.strip() if isinstance(response.content, str) else ""
    user.preference_summary = summary[:2000] or None
    user.preference_summary_updated_at = datetime.now(UTC)
    await session.commit()
    return user.preference_summary


async def maybe_store_preference_memory(
    *,
    session: AsyncSession,
    feedback: MessageFeedback,
    settings: Settings | None = None,
) -> PreferenceMemory | None:
    settings = settings or get_settings()
    if not settings.enable_preference_memory:
        return None
    derived_preference = _safe_derived_preference(feedback.llm_derived_preference)
    if not derived_preference:
        return None

    embedding_service = create_embedding_service()
    embedding = await embedding_service.embed_query(derived_preference)
    memory = PreferenceMemory(
        user_id=feedback.user_id,
        source_feedback_id=feedback.id,
        task_type=feedback.task_type,
        rating=feedback.rating,
        llm_reason_category=feedback.llm_reason_category,
        derived_preference=derived_preference,
        embedding=embedding,
        stability=feedback.llm_stability or "low",
    )
    session.add(memory)
    await session.commit()
    await session.refresh(memory)
    return memory


async def retrieve_preference_memories(
    *,
    session: AsyncSession,
    user_id: int,
    query: str,
    task_type: str | None,
    settings: Settings | None = None,
) -> list[str]:
    settings = settings or get_settings()
    if not settings.enable_preference_memory:
        return []

    embedding_service = create_embedding_service()
    query_embedding = await embedding_service.embed_query(query)
    distance = PreferenceMemory.embedding.cosine_distance(query_embedding)
    stmt = (
        select(PreferenceMemory, distance.label("distance"))
        .where(
            PreferenceMemory.user_id == user_id,
            PreferenceMemory.derived_preference.is_not(None),
            (PreferenceMemory.expires_at.is_(None)) | (PreferenceMemory.expires_at > func.now()),
        )
        .order_by(distance.asc(), PreferenceMemory.created_at.desc())
        .limit(settings.preference_memory_top_k)
    )
    if task_type:
        stmt = stmt.where(
            (PreferenceMemory.task_type == task_type) | (PreferenceMemory.task_type.is_(None))
        )

    result = await session.execute(stmt)
    return [memory.derived_preference for memory, _distance in result.all()[: settings.preference_memory_top_k]]


async def feedback_analytics_for_user(*, session: AsyncSession, user_id: int) -> FeedbackAnalyticsRead:
    async def counts(column: Any) -> dict[str, int]:
        result = await session.execute(
            select(column, func.count(MessageFeedback.id))
            .where(MessageFeedback.user_id == user_id, column.is_not(None))
            .group_by(column)
            .order_by(func.count(MessageFeedback.id).desc())
        )
        return {str(key): int(value) for key, value in result.all() if key is not None}

    return FeedbackAnalyticsRead(
        rating_counts=await counts(MessageFeedback.rating),
        reason_category_counts=await counts(MessageFeedback.llm_reason_category),
        prompt_version_counts=await counts(MessageFeedback.prompt_version),
        task_type_counts=await counts(MessageFeedback.task_type),
        model_name_counts=await counts(MessageFeedback.model_name),
        common_feedback_summaries=await counts(MessageFeedback.llm_feedback_summary),
    )
