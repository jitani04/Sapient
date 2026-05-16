from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_user_id
from app.core.config import get_settings
from app.db.session import get_db_session
from app.models.conversation import Conversation
from app.models.quiz import Quiz, QuizAttempt
from app.schemas.quiz import AttemptCreate, AttemptResult, QuizRead
from app.services.knowledge_tracing_service import update_knowledge_state_for_quiz
from app.services.llm_service import LLMService
from app.services.quiz_grading_service import grade_quiz_attempt

router = APIRouter(tags=["quizzes"])


class ManualQuizCreate(BaseModel):
    subject: str | None = Field(default=None, max_length=255)
    question: str = Field(min_length=1, max_length=2000)
    concept: str | None = Field(default=None, max_length=255)
    quiz_type: str = Field(pattern="^(multiple_choice|short_answer)$")
    options: list[str] | None = None
    correct_answer: str = Field(min_length=1, max_length=2000)
    explanation: str = Field(default="", max_length=4000)


async def _get_or_create_manual_quiz_conversation(
    session: AsyncSession,
    user_id: int,
    subject: str | None,
) -> Conversation:
    clean_subject = subject.strip() if subject and subject.strip() else None
    stmt = select(Conversation).where(
        Conversation.user_id == user_id,
        Conversation.title == "Manual quizzes",
        Conversation.title_manually_edited.is_(True),
    )
    if clean_subject:
        stmt = stmt.where(Conversation.subject == clean_subject)
    else:
        stmt = stmt.where(Conversation.subject.is_(None))
    result = await session.execute(stmt.order_by(Conversation.id.asc()).limit(1))
    conversation = result.scalar_one_or_none()
    if conversation:
        return conversation
    conversation = Conversation(
        user_id=user_id,
        subject=clean_subject,
        title="Manual quizzes",
        title_manually_edited=True,
    )
    session.add(conversation)
    await session.flush()
    return conversation


@router.post("/quizzes", response_model=QuizRead, status_code=status.HTTP_201_CREATED)
async def create_manual_quiz(
    body: ManualQuizCreate,
    user_id: Annotated[int, Depends(get_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> QuizRead:
    if body.quiz_type == "multiple_choice":
        options = [o.strip() for o in (body.options or []) if o.strip()]
        if len(options) < 2:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Multiple-choice quizzes need at least 2 options.",
            )
        if body.correct_answer.strip() not in options:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="correct_answer must match one of the options exactly.",
            )
    else:
        options = None

    conversation = await _get_or_create_manual_quiz_conversation(session, user_id, body.subject)
    quiz = Quiz(
        conversation_id=conversation.id,
        question=body.question.strip(),
        concept=(body.concept.strip() if body.concept and body.concept.strip() else None),
        quiz_type=body.quiz_type,
        options=options,
        correct_answer=body.correct_answer.strip(),
        explanation=body.explanation.strip(),
    )
    session.add(quiz)
    await session.commit()
    await session.refresh(quiz)
    return QuizRead.model_validate(quiz)


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

    naive_correct = body.answer.strip().lower() == quiz.correct_answer.strip().lower()

    # Fast path: a multiple-choice answer that exactly matches the canonical
    # answer doesn't need a teaching moment — return the stored explanation
    # and skip the LLM round-trip.
    if naive_correct and quiz.quiz_type == "multiple_choice":
        is_correct = True
        explanation = quiz.explanation
    else:
        settings = get_settings()
        llm_service = LLMService(
            api_key=settings.llm_api_key,
            model=settings.llm_model,
            timeout_seconds=settings.llm_timeout_seconds,
        )
        graded = await grade_quiz_attempt(
            llm_service=llm_service,
            question=quiz.question,
            correct_answer=quiz.correct_answer,
            user_answer=body.answer,
            base_explanation=quiz.explanation,
            quiz_type=quiz.quiz_type,
            options=quiz.options if isinstance(quiz.options, list) else None,
        )
        is_correct = graded.is_correct
        explanation = graded.explanation

    session.add(QuizAttempt(quiz_id=quiz_id, user_id=user_id, answer=body.answer, is_correct=is_correct))
    trace = await update_knowledge_state_for_quiz(
        session=session,
        user_id=user_id,
        subject=conv.subject,
        quiz=quiz,
        is_correct=is_correct,
    )
    await session.commit()

    return AttemptResult(
        is_correct=is_correct,
        correct_answer=quiz.correct_answer,
        explanation=explanation,
        concept=trace.concept if trace else quiz.concept,
        mastery=trace.mastery if trace else None,
    )


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

    session.add(QuizAttempt(quiz_id=quiz_id, user_id=user_id, answer="[skipped]", is_correct=False))
    trace = await update_knowledge_state_for_quiz(
        session=session,
        user_id=user_id,
        subject=conv.subject,
        quiz=quiz,
        is_correct=False,
    )
    await session.commit()

    return AttemptResult(
        is_correct=False,
        correct_answer=quiz.correct_answer,
        explanation=quiz.explanation,
        concept=trace.concept if trace else quiz.concept,
        mastery=trace.mastery if trace else None,
    )
