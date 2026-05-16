import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_user_id
from app.core.config import get_settings
from app.core.llm_errors import is_llm_quota_error, retry_after_from_message
from app.core.rate_limit import rate_limit_user
from app.db.session import get_db_session
from app.models.conversation import Conversation
from app.models.project_profile import ProjectProfile
from app.models.user import User
from app.schemas.chat import ChatRequest
from app.services.chat_service import SseEvent, stream_chat
from app.services.conversation_service import get_conversation_for_user
from app.services.errors import ConversationNotFoundError
from app.services.feedback_service import retrieve_preference_memories
from app.services.knowledge_tracing_service import mastery_to_learning_status
from app.services.llm_service import LLMService
from app.services.web_image_service import WebImageService

settings = get_settings()
logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/chat",
    tags=["chat"],
    dependencies=[Depends(rate_limit_user("chat", settings.rate_limit_chat_per_min))],
)


TEACHING_PACING_PROMPT = (
    "Teaching pacing rule: introduce or define at most 2 new concepts, terms, or principles at a time. "
    "If the student asks for a broad list, teach the 2 most important ideas first, then offer to continue "
    "with the next 2. You may connect to already-known concepts, but do not dump 4+ new definitions in one turn."
)


def _build_tutor_customization_prompt(user: User) -> str:
    tutor_name = (user.tutor_name or "").strip()
    if tutor_name.lower() == "knowledgepal":
        tutor_name = settings.app_name

    sections = [
        "Personalized tutor configuration:",
        f"- Student name: {user.name or 'Unknown'}",
        f"- Student app goal: {user.use_case or 'Not specified'}",
        f"- Tutor name: {tutor_name or settings.app_name}",
        f"- Tutor tone: {user.tutor_tone}",
        f"- Tutor teaching style: {user.tutor_style}",
    ]
    if user.tutor_instructions:
        sections.append(f"- Student customization notes: {user.tutor_instructions}")
    sections.append(
        "Apply these preferences to style, pacing, examples, and how you refer to yourself. "
        "Do not let customization override the tutoring rules, source grounding, safety, or the student's current request."
    )
    return "\n".join(sections)


def _slugify_topic(value: str, index: int) -> str:
    slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in value.strip())
    while "--" in slug:
        slug = slug.replace("--", "-")
    slug = slug.strip("-")
    return f"{slug or 'topic'}-{index}"


def _topic_matches(value: str, candidates: list[str]) -> bool:
    normalized = value.strip().lower()
    if not normalized:
        return False
    return any(
        normalized in candidate.strip().lower() or candidate.strip().lower() in normalized
        for candidate in candidates
    )


def _status_for_map_node(
    *,
    node_id: str,
    topic: str,
    subtopics: list[str],
    knowledge_state: dict[str, object],
    manual_progress: dict[str, str],
    covered: set[str],
    weak: set[str],
    next_review: set[str],
) -> str:
    raw_knowledge = knowledge_state.get(node_id)
    if isinstance(raw_knowledge, dict):
        attempts = int(raw_knowledge.get("attempts", 0))
        mastery = float(raw_knowledge.get("mastery", 0))
        if attempts > 0:
            return mastery_to_learning_status(mastery, attempts)
    if node_id in manual_progress:
        return manual_progress[node_id]
    candidates = [topic, *subtopics]
    if any(_topic_matches(item, candidates) for item in [*weak, *next_review]):
        return "needs_review"
    if any(_topic_matches(item, candidates) for item in covered):
        return "mastered"
    return "not_started"


async def _build_learning_map_prompt_context(
    *,
    session: AsyncSession,
    user_id: int,
    subject: str,
) -> str | None:
    profile_result = await session.execute(
        select(ProjectProfile).where(
            ProjectProfile.user_id == user_id,
            func.lower(ProjectProfile.subject) == subject.lower(),
        )
    )
    profile = profile_result.scalar_one_or_none()
    if not profile or not profile.mind_map:
        return None

    conv_result = await session.execute(
        select(Conversation).where(
            Conversation.user_id == user_id,
            func.lower(Conversation.subject) == subject.lower(),
        )
    )
    covered: set[str] = set()
    weak: set[str] = set()
    next_review: set[str] = set()
    for conversation in conv_result.scalars():
        if not conversation.summary:
            continue
        covered.update(str(item) for item in conversation.summary.get("covered", []))
        weak.update(str(item) for item in conversation.summary.get("struggled_with", []))
        next_review.update(str(item) for item in conversation.summary.get("next_review", []))

    raw_nodes = profile.mind_map.get("nodes", [])
    if not isinstance(raw_nodes, list):
        return None

    manual_progress = profile.learning_map_progress or {}
    knowledge_state = profile.knowledge_state or {}
    map_nodes: list[dict[str, object]] = []
    for index, raw_node in enumerate(raw_nodes):
        if not isinstance(raw_node, dict):
            continue
        topic = str(raw_node.get("topic", "")).strip()
        if not topic:
            continue
        subtopics = [str(item) for item in raw_node.get("subtopics", []) if str(item).strip()]
        node_id = str(raw_node.get("id") or _slugify_topic(topic, index))
        raw_prerequisite_ids = raw_node.get("prerequisite_ids")
        prerequisite_ids = (
            [str(item) for item in raw_prerequisite_ids]
            if isinstance(raw_prerequisite_ids, list)
            else ([str(map_nodes[-1]["id"])] if map_nodes else [])
        )
        status = _status_for_map_node(
            node_id=node_id,
            topic=topic,
            subtopics=subtopics,
            knowledge_state=knowledge_state,
            manual_progress=manual_progress,
            covered=covered,
            weak=weak,
            next_review=next_review,
        )
        map_nodes.append(
            {
                "id": node_id,
                "topic": topic,
                "status": status,
                "mastery": None,
                "prerequisite_ids": prerequisite_ids,
                "prerequisites": [],
                "locked": False,
                "subtopics": subtopics[:4],
            }
        )

    if not map_nodes:
        return None

    status_by_id = {str(node["id"]): str(node["status"]) for node in map_nodes}
    topic_by_id = {str(node["id"]): str(node["topic"]) for node in map_nodes}
    for node in map_nodes:
        raw_knowledge = knowledge_state.get(str(node["id"]))
        if isinstance(raw_knowledge, dict) and raw_knowledge.get("mastery") is not None:
            node["mastery"] = round(float(raw_knowledge["mastery"]) * 100)
        prerequisite_ids = [str(item) for item in node.get("prerequisite_ids", [])]
        node["prerequisites"] = [topic_by_id[item] for item in prerequisite_ids if item in topic_by_id]
        node["locked"] = any(status_by_id.get(item) not in {"in_progress", "mastered"} for item in prerequisite_ids)

    recommended = next((node for node in map_nodes if node["status"] == "needs_review"), None)
    reason = "This topic is marked for review."
    if recommended is None:
        recommended = next(
            (node for node in map_nodes if node["status"] == "not_started" and not node["locked"]),
            None,
        )
        reason = "This is the next unlocked topic in the learning path."
    if recommended is None:
        recommended = next((node for node in map_nodes if node["status"] == "in_progress"), None)
        reason = "The student has started this topic but has not mastered it yet."

    lines = [
        "Student learning map context:",
        "Use this map to adapt tutoring. Prioritize needs_review topics, connect explanations to prerequisites, avoid jumping too far ahead unless the student asks, and explain locked topics by naming what to learn first.",
    ]
    if recommended:
        lines.append(f"- Recommended next: {recommended['topic']} ({reason})")
    else:
        lines.append("- Recommended next: Student appears caught up on this map.")

    mastered = sum(1 for node in map_nodes if node["status"] == "mastered")
    needs_review = sum(1 for node in map_nodes if node["status"] == "needs_review")
    lines.append(f"- Progress summary: {mastered}/{len(map_nodes)} topics mastered; {needs_review} need review.")
    lines.append("- Topics:")
    for node in map_nodes:
        mastery = f"; BKT mastery: {node['mastery']}%" if node.get("mastery") is not None else ""
        prereq = f"; prerequisites: {', '.join(node['prerequisites'])}" if node["prerequisites"] else ""
        locked = "; prerequisite not complete" if node["locked"] else ""
        subtopics = ", ".join(node["subtopics"]) if node["subtopics"] else "no subtopics listed"
        lines.append(f"  - {node['topic']}: {node['status']}{mastery}{prereq}{locked}; subtopics: {subtopics}")
    return "\n".join(lines)


def _format_sse_event(event: SseEvent) -> str:
    payload = json.dumps(event.data, ensure_ascii=True)
    return f"event: {event.event}\ndata: {payload}\n\n"


async def _with_keepalive(source: AsyncIterator[SseEvent], keepalive_seconds: int) -> AsyncIterator[str]:
    iterator = source.__aiter__()
    while True:
        try:
            event = await asyncio.wait_for(anext(iterator), timeout=keepalive_seconds)
            yield _format_sse_event(event)
        except TimeoutError:
            yield ": keep-alive\n\n"
        except StopAsyncIteration:
            return


@router.post("/{conversation_id}")
async def stream_chat_endpoint(
    conversation_id: int,
    request: ChatRequest,
    user_id: Annotated[int, Depends(get_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> StreamingResponse:
    try:
        conversation = await get_conversation_for_user(session=session, conversation_id=conversation_id, user_id=user_id)
    except ConversationNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Conversation not found.") from exc

    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    system_prompt = settings.system_prompt
    if conversation.subject:
        system_prompt = f"The student is studying: {conversation.subject}.\n\n{system_prompt}"
        learning_map_context = await _build_learning_map_prompt_context(
            session=session,
            user_id=user_id,
            subject=conversation.subject,
        )
        if learning_map_context:
            system_prompt = f"{system_prompt}\n\n{learning_map_context}"
    system_prompt = f"{system_prompt}\n\n{TEACHING_PACING_PROMPT}"
    system_prompt = f"{system_prompt}\n\n{_build_tutor_customization_prompt(user)}"
    try:
        preference_memories = await retrieve_preference_memories(
            session=session,
            user_id=user_id,
            query=request.message,
            task_type=conversation.subject,
            settings=settings,
        )
    except Exception as exc:  # noqa: BLE001 - preference memory must not block tutoring.
        logger.warning(
            "Preference memory retrieval failed",
            extra={"conversation_id": conversation_id, "user_id": user_id, "error": str(exc)},
        )
        preference_memories = []

    llm_service = LLMService(
        api_key=settings.llm_api_key,
        model=settings.llm_model,
        timeout_seconds=settings.llm_timeout_seconds,
    )
    image_service = WebImageService()

    async def event_stream() -> AsyncIterator[str]:
        try:
            source = stream_chat(
                session=session,
                llm_service=llm_service,
                conversation_id=conversation_id,
                user_id=user_id,
                user_message=request.message,
                system_prompt=system_prompt,
                image_service=image_service,
                preference_summary=user.preference_summary,
                preference_memories=preference_memories,
            )
            async for payload in _with_keepalive(source, settings.keepalive_seconds):
                yield payload
        except Exception as exc:  # noqa: BLE001
            payload: dict[str, object] = {"error": str(exc)}
            if is_llm_quota_error(exc):
                payload = {
                    "error": "AI is rate-limited right now. Please try again in a moment.",
                    "rate_limited": True,
                    "retry_after_seconds": retry_after_from_message(str(exc)),
                }
            yield _format_sse_event(SseEvent(event="error", data=payload))

    return StreamingResponse(event_stream(), media_type="text/event-stream")
