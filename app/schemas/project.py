from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class ProjectSetupRequest(BaseModel):
    subject: str
    level: str | None = None
    goals: str | None = None


class ProjectProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    subject: str
    level: str | None = None
    goals: str | None = None
    mind_map: dict[str, Any] | None = None
    created_at: datetime


class ProjectProgressRead(BaseModel):
    total_sessions: int
    sessions_with_summary: int
    quizzes_attempted: int
    quizzes_passed: int
    pass_rate: float | None
    concepts_covered: list[str]
    weak_areas: list[str]
    next_review: list[str]
