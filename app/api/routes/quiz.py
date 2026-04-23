from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_user_id
from app.db.session import get_db_session
from app.models.conversation import Conversation
from app.models.quiz import Quiz, QuizAttempt
from app.schemas.quiz import AttemptCreate, AttemptResult, QuizRead

router = APIRouter(tags=["quizzes"])


@router.get("/conversations/{conversation_id}/quizzes", response_model=list[QuizRead])
async def list_quizzes(
    conversation_id: int,
    user_id: Annotated[int, Depends(get_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[QuizRead]:
    conv = await session.get(Conversation, conversation_id)
    if not conv or conv.user_id != user_id:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    result = await session.execute(
        select(Quiz)
        .where(Quiz.conversation_id == conversation_id)
        .order_by(Quiz.created_at.asc())
    )
    return [QuizRead.model_validate(q) for q in result.scalars()]


@router.post("/quizzes/{quiz_id}/attempt", response_model=AttemptResult)
async def submit_attempt(
    quiz_id: int,
    body: AttemptCreate,
    user_id: Annotated[int, Depends(get_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> AttemptResult:
    quiz = await session.get(Quiz, quiz_id)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found.")

    conv = await session.get(Conversation, quiz.conversation_id)
    if not conv or conv.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized.")

    is_correct = body.answer.strip().lower() == quiz.correct_answer.strip().lower()

    session.add(QuizAttempt(quiz_id=quiz_id, user_id=user_id, answer=body.answer, is_correct=is_correct))
    await session.commit()

    return AttemptResult(is_correct=is_correct, correct_answer=quiz.correct_answer, explanation=quiz.explanation)


@router.post("/quizzes/{quiz_id}/skip", response_model=AttemptResult)
async def skip_quiz(
    quiz_id: int,
    user_id: Annotated[int, Depends(get_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> AttemptResult:
    quiz = await session.get(Quiz, quiz_id)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found.")

    conv = await session.get(Conversation, quiz.conversation_id)
    if not conv or conv.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized.")

    return AttemptResult(is_correct=False, correct_answer=quiz.correct_answer, explanation=quiz.explanation)
