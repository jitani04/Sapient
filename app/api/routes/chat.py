import asyncio
import json
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_user_id
from app.core.config import get_settings
from app.core.llm_errors import is_llm_quota_error, retry_after_from_message
from app.core.rate_limit import rate_limit_user
from app.db.session import get_db_session
from app.models.user import User
from app.schemas.chat import ChatRequest
from app.services.chat_service import SseEvent, stream_chat
from app.services.conversation_service import get_conversation_for_user
from app.services.errors import ConversationNotFoundError
from app.services.llm_service import LLMService
from app.services.web_image_service import WebImageService

settings = get_settings()
router = APIRouter(
    prefix="/chat",
    tags=["chat"],
    dependencies=[Depends(rate_limit_user("chat", settings.rate_limit_chat_per_min))],
)


def _build_tutor_customization_prompt(user: User) -> str:
    sections = [
        "Personalized tutor configuration:",
        f"- Student name: {user.name or 'Unknown'}",
        f"- Student app goal: {user.use_case or 'Not specified'}",
        f"- Tutor name: {user.tutor_name}",
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
    system_prompt = f"{system_prompt}\n\n{_build_tutor_customization_prompt(user)}"

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
