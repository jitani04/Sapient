from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.conversation import Conversation
from app.services.errors import ConversationNotFoundError


async def create_conversation(
    *,
    session: AsyncSession,
    user_id: int,
    subject: str | None = None,
    is_lecture: bool = False,
) -> Conversation:
    conversation = Conversation(user_id=user_id, subject=subject, is_lecture=is_lecture)
    session.add(conversation)
    await session.commit()
    return await get_conversation_for_user(session=session, conversation_id=conversation.id, user_id=user_id)


async def list_conversations_for_user(*, session: AsyncSession, user_id: int) -> list[Conversation]:
    result = await session.execute(
        select(Conversation)
        .where(
            Conversation.user_id == user_id,
            Conversation.is_lecture.is_(False),
            Conversation.messages.any(),
        )
        .options(selectinload(Conversation.messages))
        .order_by(Conversation.created_at.desc(), Conversation.id.desc())
    )
    return list(result.scalars())


async def get_conversation_for_user(*, session: AsyncSession, conversation_id: int, user_id: int) -> Conversation:
    result = await session.execute(
        select(Conversation)
        .where(Conversation.id == conversation_id, Conversation.user_id == user_id)
        .options(selectinload(Conversation.messages))
    )
    conversation = result.scalar_one_or_none()
    if conversation is None:
        raise ConversationNotFoundError
    return conversation


async def delete_conversation_for_user(*, session: AsyncSession, conversation_id: int, user_id: int) -> None:
    conversation = await get_conversation_for_user(
        session=session, conversation_id=conversation_id, user_id=user_id
    )
    await session.delete(conversation)
    await session.commit()


async def update_conversation_title_for_user(
    *,
    session: AsyncSession,
    conversation_id: int,
    user_id: int,
    title: str | None,
) -> Conversation:
    conversation = await get_conversation_for_user(
        session=session,
        conversation_id=conversation_id,
        user_id=user_id,
    )
    clean_title = (title or "").strip()
    conversation.title = clean_title[:120] or None
    conversation.title_manually_edited = True
    await session.commit()
    return await get_conversation_for_user(session=session, conversation_id=conversation_id, user_id=user_id)
