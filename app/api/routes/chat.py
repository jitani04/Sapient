import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_user_id
from app.core.config import get_settings
from app.core.llm_errors import is_llm_quota_error, retry_after_from_message
from app.core.rate_limit import rate_limit_user
from app.db.session import get_db_session
from app.models.conversation import Conversation
from app.models.message import Message, MessageRole
from app.models.project_profile import ProjectProfile
from app.models.user import User
from app.schemas.chat import ChatRequest
from app.services.chat_service import SseEvent, stream_chat
from app.services.conversation_service import get_conversation_for_user
from app.services.errors import ConversationNotFoundError
from app.services.feedback_service import retrieve_preference_memories
from app.services.knowledge_tracing_service import mastery_to_learning_status
from app.services.llm_service import create_llm_service
from app.services.resource_service import create_youtube_resource_provider
from app.services.web_image_service import WebImageService
from app.services.web_search_service import create_web_search_service

settings = get_settings()
logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/chat",
    tags=["chat"],
    dependencies=[Depends(rate_limit_user("chat", settings.rate_limit_chat_per_min))],
)


async def _prepare_existing_user_turn(
    *,
    session: AsyncSession,
    conversation_id: int,
    request: ChatRequest,
) -> tuple[str, int | None]:
    target_message_id = request.edit_message_id or request.retry_message_id
    if target_message_id is None:
        return request.message or "", None

    message = await session.get(Message, target_message_id)
    if message is None or message.conversation_id != conversation_id or message.role != MessageRole.USER:
        raise HTTPException(status_code=404, detail="User message not found.")

    if request.edit_message_id is not None:
        message.content = request.message or ""
        user_message = message.content
    else:
        user_message = message.content

    await session.execute(
        delete(Message).where(
            Message.conversation_id == conversation_id,
            Message.id > message.id,
        )
    )
    await session.commit()
    return user_message, message.id


TEACHING_PACING_PROMPT = (
    "Teaching pacing rule: introduce or define at most 2 new concepts, terms, or principles at a time. "
    "If the student asks for a broad list, teach the 2 most important ideas first, then offer to continue "
    "with the next 2. You may connect to already-known concepts, but do not dump 4+ new definitions in one turn."
    "\n\nCode and math explanation rule: when providing code, formulas, derivations, or worked math, explain it "
    "line by line or step by step. Keep each step concise, name what changed, and check understanding before "
    "adding a larger extension."
    "\n\nWeb search rule: when a web_search tool is available, use it for current/latest information, outside references, "
    "or when the student asks you to search the web. Cite web-sourced claims with the [Web N] labels returned by the tool. "
    "If the tool is not available, say you can use study materials and general model knowledge, but cannot browse live web sources."
    "\n\nResource recommendation rule: when the student asks for resources, recommendations, links, a video, an article, "
    "a tutorial, a textbook, a course, or 'where can I learn more' — call the find_resource tool, do not describe "
    "categories of resources in prose. Pick the most fitting topic and kind (video or article) and call it. If the "
    "answer benefits from both a video and an article, call find_resource twice (once for each)."
    "\n\nNo-duplication rule for tool-rendered cards: when you call generate_quiz, create_diagram, find_image, or "
    "find_resource, the resulting card already shows the full artifact (question + options + explanation for quiz, "
    "the rendered Mermaid diagram, the image with caption, the resource title + link + reason). Do NOT also write "
    "those contents in your message text — that produces duplicate content shown twice to the student. Your message "
    "around a tool call should set context ('here's a quick check', 'this diagram shows how the parts connect') and "
    "then continue teaching; the card is the source of truth for what it contains."
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
    reason = "previously covered but the student is struggling with it"
    if recommended is None:
        recommended = next(
            (node for node in map_nodes if node["status"] == "in_progress"), None
        )
        reason = "the student has started this topic but has not mastered it yet"
    if recommended is None:
        recommended = next(
            (node for node in map_nodes if node["status"] == "not_started" and not node["locked"]),
            None,
        )
        reason = "this is the next unlocked topic in the learning path"

    def _format_node(node: dict[str, object]) -> str:
        parts: list[str] = [str(node["topic"])]
        if node.get("mastery") is not None:
            parts.append(f"BKT mastery {node['mastery']}%")
        subtopics = node.get("subtopics") or []
        if subtopics:
            parts.append(f"subtopics: {', '.join(str(item) for item in subtopics)}")
        prerequisites = node.get("prerequisites") or []
        if prerequisites:
            parts.append(f"prerequisites: {', '.join(str(item) for item in prerequisites)}")
        if node.get("locked"):
            parts.append("locked until prerequisites are covered")
        return "  - " + "; ".join(parts)

    covered_nodes = [node for node in map_nodes if node["status"] == "mastered"]
    in_progress_nodes = [node for node in map_nodes if node["status"] == "in_progress"]
    needs_review_nodes = [node for node in map_nodes if node["status"] == "needs_review"]
    not_covered_nodes = [node for node in map_nodes if node["status"] == "not_started"]

    lines: list[str] = [
        f"Student learning map for {subject}:",
        f"This is the curriculum for {subject}. It is the source of truth for what the student has covered, what they have not, and what to teach next. Treat the goal topic as the focus of this conversation unless the student explicitly redirects.",
        "",
    ]

    lines.append(f"Covered (mastered, {len(covered_nodes)}/{len(map_nodes)}):")
    if covered_nodes:
        lines.extend(_format_node(node) for node in covered_nodes)
    else:
        lines.append("  - (none yet)")

    if in_progress_nodes:
        lines.append("")
        lines.append(f"In progress ({len(in_progress_nodes)}):")
        lines.extend(_format_node(node) for node in in_progress_nodes)

    if needs_review_nodes:
        lines.append("")
        lines.append(f"Needs review (previously covered but struggling, {len(needs_review_nodes)}):")
        lines.extend(_format_node(node) for node in needs_review_nodes)

    lines.append("")
    lines.append(f"Not yet covered ({len(not_covered_nodes)}):")
    if not_covered_nodes:
        lines.extend(_format_node(node) for node in not_covered_nodes)
    else:
        lines.append("  - (none — student has reached every topic on the map)")

    lines.append("")
    if recommended is None:
        lines.append("Goal: the student has reached every topic on this map. Reinforce, quiz, or extend rather than introducing new curriculum.")
    else:
        lines.append(f"Goal: cover \"{recommended['topic']}\" next — {reason}.")
        prereqs = recommended.get("prerequisites") or []
        if recommended.get("locked") and prereqs:
            lines.append(
                f"  (This goal is locked until the student covers: {', '.join(str(item) for item in prereqs)}. "
                "Teach those prerequisites first.)"
            )
        subtopics = recommended.get("subtopics") or []
        if subtopics:
            lines.append(
                f"  Subtopics to cover within the goal: {', '.join(str(item) for item in subtopics)}."
            )

    lines.append("")
    lines.append("How to use this map:")
    lines.append("- Drive every response toward the goal topic. If the student asks something off-path, answer briefly and steer back.")
    lines.append("- Never claim a not-yet-covered topic is already known; never re-teach a covered topic unless the student asks or it is in needs-review.")
    lines.append("- When explaining the goal, connect it to already-covered topics by name so the student sees the progression.")
    lines.append("- If the goal is locked, teach the missing prerequisites first and say so explicitly.")
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

    user_message, existing_user_message_id = await _prepare_existing_user_turn(
        session=session,
        conversation_id=conversation_id,
        request=request,
    )

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
            query=user_message,
            task_type=conversation.subject,
            settings=settings,
        )
    except Exception as exc:  # noqa: BLE001 - preference memory must not block tutoring.
        logger.warning(
            "Preference memory retrieval failed",
            extra={"conversation_id": conversation_id, "user_id": user_id, "error": str(exc)},
        )
        preference_memories = []

    llm_service = create_llm_service(model=conversation.model)
    image_service = WebImageService()
    web_search_service = create_web_search_service()
    resource_provider = create_youtube_resource_provider()

    async def event_stream() -> AsyncIterator[str]:
        try:
            source = stream_chat(
                session=session,
                llm_service=llm_service,
                conversation_id=conversation_id,
                user_id=user_id,
                user_message=user_message,
                system_prompt=system_prompt,
                user_message_id=existing_user_message_id,
                image_service=image_service,
                web_search_service=web_search_service,
                resource_provider=resource_provider,
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
        finally:
            await session.close()

    return StreamingResponse(event_stream(), media_type="text/event-stream")
