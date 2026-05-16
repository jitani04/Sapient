from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_user_id
from app.db.session import get_db_session
from app.models.user import User
from app.schemas.conversation import ConversationCreate, ConversationRead, ConversationUpdate
from app.services.conversation_service import (
    create_conversation,
    delete_conversation_for_user,
    get_conversation_for_user,
    list_conversations_for_user,
    update_conversation_title_for_user,
)
from app.services.errors import ConversationNotFoundError

router = APIRouter(prefix="/conversations", tags=["conversations"])


@router.get("", response_model=list[ConversationRead])
async def list_conversations_endpoint(
    user_id: Annotated[int, Depends(get_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[ConversationRead]:
    conversations = await list_conversations_for_user(session=session, user_id=user_id)
    return [ConversationRead.model_validate(conversation) for conversation in conversations]


@router.post("", response_model=ConversationRead, status_code=status.HTTP_201_CREATED)
async def create_conversation_endpoint(
    user_id: Annotated[int, Depends(get_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    body: ConversationCreate = ConversationCreate(),
) -> ConversationRead:
    result = await session.execute(select(User.id).where(User.id == user_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    conversation = await create_conversation(
        session=session,
        user_id=user_id,
        subject=body.subject,
        is_lecture=body.is_lecture,
    )
    return ConversationRead.model_validate(conversation)


@router.get("/{conversation_id}", response_model=ConversationRead)
async def get_conversation_endpoint(
    conversation_id: int,
    user_id: Annotated[int, Depends(get_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> ConversationRead:
    try:
        conversation = await get_conversation_for_user(
            session=session,
            conversation_id=conversation_id,
            user_id=user_id,
        )
        return ConversationRead.model_validate(conversation)
    except ConversationNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.") from exc


@router.patch("/{conversation_id}", response_model=ConversationRead)
async def update_conversation_endpoint(
    conversation_id: int,
    user_id: Annotated[int, Depends(get_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    body: ConversationUpdate,
) -> ConversationRead:
    try:
        conversation = await update_conversation_title_for_user(
            session=session,
            conversation_id=conversation_id,
            user_id=user_id,
            title=body.title,
        )
        return ConversationRead.model_validate(conversation)
    except ConversationNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.") from exc


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation_endpoint(
    conversation_id: int,
    user_id: Annotated[int, Depends(get_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    try:
        await delete_conversation_for_user(
            session=session,
            conversation_id=conversation_id,
            user_id=user_id,
        )
    except ConversationNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.") from exc
