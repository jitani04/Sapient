from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_user_id
from app.db.session import get_db_session, get_session_factory
from app.schemas.feedback import FeedbackAnalyticsRead, FeedbackCreate, FeedbackRead
from app.services.errors import ConversationNotFoundError
from app.services.feedback_service import (
    create_or_update_feedback,
    delete_feedback_for_message,
    enrich_feedback_in_background,
    feedback_analytics_for_user,
)

router = APIRouter(prefix="/feedback", tags=["feedback"])


@router.post("", response_model=FeedbackRead, status_code=status.HTTP_201_CREATED)
async def create_feedback_endpoint(
    body: FeedbackCreate,
    user_id: Annotated[int, Depends(get_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    background_tasks: BackgroundTasks,
) -> FeedbackRead:
    try:
        feedback = await create_or_update_feedback(session=session, user_id=user_id, body=body)
    except ConversationNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found.") from exc

    if feedback.feedback_text or feedback.correction:
        background_tasks.add_task(
            enrich_feedback_in_background,
            session_factory=get_session_factory(),
            feedback_id=feedback.id,
        )

    return FeedbackRead.model_validate(feedback)


@router.delete("/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_feedback_endpoint(
    message_id: int,
    user_id: Annotated[int, Depends(get_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    try:
        await delete_feedback_for_message(session=session, user_id=user_id, message_id=message_id)
    except ConversationNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feedback not found.") from exc


@router.get("/analytics", response_model=FeedbackAnalyticsRead)
async def feedback_analytics_endpoint(
    user_id: Annotated[int, Depends(get_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> FeedbackAnalyticsRead:
    return await feedback_analytics_for_user(session=session, user_id=user_id)
