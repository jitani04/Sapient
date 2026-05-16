from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AssignmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    subject: str | None = None
    title: str
    description: str | None = None
    due_at: datetime
    source: str
    source_uid: str | None = None
    source_url: str | None = None
    completed: bool
    feed_id: int | None = None
    created_at: datetime
    updated_at: datetime


class AssignmentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    due_at: datetime
    subject: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=5000)
    source_url: str | None = Field(default=None, max_length=2048)


class AssignmentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    due_at: datetime | None = None
    subject: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=5000)
    source_url: str | None = Field(default=None, max_length=2048)
    completed: bool | None = None


class CalendarFeedRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    url: str
    subject: str | None = None
    source: str
    last_synced_at: datetime | None = None
    created_at: datetime


class CalendarFeedCreate(BaseModel):
    name: str = Field(default="Canvas calendar", min_length=1, max_length=255)
    url: str = Field(min_length=1, max_length=4096)
    subject: str | None = Field(default=None, max_length=255)


class CalendarFeedSyncResponse(BaseModel):
    feed: CalendarFeedRead
    imported_count: int
    total_events: int


class SmartReminderRead(BaseModel):
    id: str
    kind: str
    severity: str
    title: str
    body: str
    subject: str | None = None
    assignment_id: int | None = None
    due_at: str | None = None
