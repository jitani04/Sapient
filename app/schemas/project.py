from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, HttpUrl

LearningMapStatus = str


class KnowledgeStateRead(BaseModel):
    concept_id: str
    concept: str
    mastery: float
    attempts: int
    correct: int
    last_observed_at: str | None = None
    params: dict[str, float]


class ProjectSetupRequest(BaseModel):
    subject: str
    level: str | None = None
    goals: str | None = None
    cover_image_url: HttpUrl | None = None
    cover_image_storage_key: str | None = None
    cover_image_source: str | None = None
    cover_image_source_url: HttpUrl | None = None
    cover_image_photographer: str | None = None
    cover_image_photographer_url: HttpUrl | None = None


class ProjectProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    subject: str
    level: str | None = None
    goals: str | None = None
    cover_image_url: str | None = None
    cover_image_storage_key: str | None = None
    cover_image_source: str | None = None
    cover_image_source_url: str | None = None
    cover_image_photographer: str | None = None
    cover_image_photographer_url: str | None = None
    mind_map: dict[str, Any] | None = None
    learning_map_progress: dict[str, LearningMapStatus] | None = None
    knowledge_state: dict[str, KnowledgeStateRead] | None = None
    created_at: datetime


class LearningMapProgressUpdate(BaseModel):
    node_id: str
    status: LearningMapStatus


class ProjectMindMapUpdate(BaseModel):
    mind_map: dict[str, Any]
    learning_map_progress: dict[str, LearningMapStatus] | None = None


class ProjectCoverImageUploadResponse(BaseModel):
    storage_key: str
    image_url: str
    expires_in: int


class ProjectCoverImageOption(BaseModel):
    id: str
    image_url: str
    thumbnail_url: str
    photographer: str
    photographer_url: str
    source_url: str
    source: str


class ProjectProgressRead(BaseModel):
    total_sessions: int
    sessions_with_summary: int
    quizzes_attempted: int
    quizzes_passed: int
    pass_rate: float | None
    concepts_covered: list[str]
    weak_areas: list[str]
    next_review: list[str]
    knowledge_mastery: list[KnowledgeStateRead] = []
