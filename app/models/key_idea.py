from datetime import datetime

from typing import Any

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class KeyIdea(Base):
    __tablename__ = "key_ideas"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    subject: Mapped[str | None] = mapped_column(String(255), nullable=True)
    concept: Mapped[str] = mapped_column(String(255), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    # Optional attached artifact: "text" (snippet from a message), "diagram"
    # (Mermaid source), or "image" (URL + caption). Null for auto-saved tutor
    # notes that have no attachment.
    artifact_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    artifact_data: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Spaced repetition (SM-2)
    sr_interval: Mapped[int] = mapped_column(Integer, default=1, nullable=False, server_default="1")
    sr_repetitions: Mapped[int] = mapped_column(Integer, default=0, nullable=False, server_default="0")
    sr_ease_factor: Mapped[float] = mapped_column(Float, default=2.5, nullable=False, server_default="2.5")
    sr_due_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
