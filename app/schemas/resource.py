from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class ResourceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    subject: str
    conversation_id: int | None = None
    message_id: int | None = None
    kind: Literal["video", "article"]
    source: Literal["youtube", "web"]
    title: str
    url: str
    snippet: str | None = None
    thumbnail_url: str | None = None
    topic: str | None = None
    created_at: datetime
