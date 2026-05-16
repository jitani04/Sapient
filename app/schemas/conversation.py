from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.message import MessageRead


class ConversationCreate(BaseModel):
    subject: str | None = None
    is_lecture: bool = False


class ConversationUpdate(BaseModel):
    title: str | None = None


class ConversationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    subject: str | None = None
    title: str | None = None
    title_manually_edited: bool = False
    is_lecture: bool = False
    created_at: datetime
    messages: list[MessageRead] = Field(default_factory=list)
    summary: dict[str, Any] | None = None
