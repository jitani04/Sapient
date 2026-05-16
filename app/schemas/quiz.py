from datetime import datetime

from pydantic import BaseModel, ConfigDict


class QuizRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    conversation_id: int
    message_id: int | None = None
    question: str
    concept: str | None = None
    quiz_type: str
    options: list[str] | None = None
    created_at: datetime


class AttemptCreate(BaseModel):
    answer: str


class AttemptResult(BaseModel):
    is_correct: bool
    correct_answer: str
    explanation: str
    concept: str | None = None
    mastery: float | None = None


class WeakQuizResponse(BaseModel):
    conversation_id: int
    quizzes: list[QuizRead]
