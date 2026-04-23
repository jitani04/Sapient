import json
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_user_id
from app.core.config import get_settings
from app.db.session import get_db_session
from app.models.conversation import Conversation
from app.models.key_idea import KeyIdea
from app.services.conversation_service import get_conversation_for_user
from app.services.llm_service import LLMService

logger = logging.getLogger(__name__)
router = APIRouter(tags=["artifacts"])

DbDep = Annotated[AsyncSession, Depends(get_db_session)]
UserDep = Annotated[int, Depends(get_user_id)]


class KeyIdeaRead(BaseModel):
    id: int
    concept: str
    summary: str
    subject: str | None
    created_at: str

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm(cls, obj: KeyIdea) -> "KeyIdeaRead":
        return cls(
            id=obj.id,
            concept=obj.concept,
            summary=obj.summary,
            subject=obj.subject,
            created_at=obj.created_at.isoformat(),
        )


class SessionSummary(BaseModel):
    covered: list[str]
    struggled_with: list[str]
    key_concepts: list[str]
    next_review: list[str]


@router.get("/conversations/{conversation_id}/key-ideas", response_model=list[KeyIdeaRead])
async def list_key_ideas(
    conversation_id: int,
    user_id: UserDep,
    session: DbDep,
) -> list[KeyIdeaRead]:
    await get_conversation_for_user(session=session, conversation_id=conversation_id, user_id=user_id)
    result = await session.execute(
        select(KeyIdea)
        .where(KeyIdea.conversation_id == conversation_id, KeyIdea.user_id == user_id)
        .order_by(KeyIdea.created_at.asc())
    )
    return [KeyIdeaRead.from_orm(k) for k in result.scalars()]


@router.delete("/key-ideas/{idea_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_key_idea(
    idea_id: int,
    user_id: UserDep,
    session: DbDep,
) -> None:
    idea = await session.get(KeyIdea, idea_id)
    if not idea or idea.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found.")
    await session.delete(idea)
    await session.commit()


@router.post("/conversations/{conversation_id}/summary", response_model=SessionSummary)
async def generate_summary(
    conversation_id: int,
    user_id: UserDep,
    session: DbDep,
) -> SessionSummary:
    conv = await get_conversation_for_user(session=session, conversation_id=conversation_id, user_id=user_id)

    if conv.summary:
        return SessionSummary(**conv.summary)

    messages = sorted(conv.messages, key=lambda m: (m.created_at, m.id))
    if len(messages) < 2:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Session is too short to summarize.")

    history_text = "\n".join(
        f"{m.role.value.upper()}: {m.content}" for m in messages
    )

    prompt = (
        "You are given a tutoring session transcript. Analyze it and return ONLY a valid JSON object — "
        "no markdown, no explanation. Use this exact structure:\n"
        '{"covered":["topic1","topic2"],"struggled_with":["topic"],"key_concepts":["Concept: explanation"],"next_review":["topic"]}\n\n'
        "Rules:\n"
        "- covered: topics the student engaged with successfully (3-6 items)\n"
        "- struggled_with: topics where the student made errors or needed repeated hints (0-3 items)\n"
        "- key_concepts: short 'Concept: 1-sentence explanation' strings (3-5 items)\n"
        "- next_review: topics the student should revisit next session (2-4 items)\n\n"
        f"TRANSCRIPT:\n{history_text}"
    )

    settings = get_settings()
    llm = LLMService(
        api_key=settings.llm_api_key,
        model=settings.llm_model,
        timeout_seconds=settings.llm_timeout_seconds,
    )
    lc_messages = llm.to_langchain_messages([
        {"role": "system", "content": "You output only valid JSON. No markdown."},
        {"role": "user", "content": prompt},
    ])

    response = await llm._llm.ainvoke(lc_messages)
    raw: str = response.content if isinstance(response.content, str) else ""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    try:
        data: dict[str, Any] = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Summary JSON parse failed: %s", raw[:300])
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not generate summary. Try again.")

    summary = SessionSummary(
        covered=data.get("covered", []),
        struggled_with=data.get("struggled_with", []),
        key_concepts=data.get("key_concepts", []),
        next_review=data.get("next_review", []),
    )

    conv.summary = summary.model_dump()
    await session.commit()

    return summary
