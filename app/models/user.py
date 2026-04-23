from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    google_id: Mapped[str | None] = mapped_column(String(255), unique=True, index=True, nullable=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    use_case: Mapped[str | None] = mapped_column(String(100), nullable=True)
    onboarding_complete: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    tutor_name: Mapped[str] = mapped_column(String(80), default="KnowledgePal", server_default="KnowledgePal", nullable=False)
    tutor_tone: Mapped[str] = mapped_column(String(80), default="Supportive", server_default="Supportive", nullable=False)
    tutor_style: Mapped[str] = mapped_column(String(120), default="Socratic guide", server_default="Socratic guide", nullable=False)
    tutor_instructions: Mapped[str] = mapped_column(String(1000), default="", server_default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    conversations: Mapped[list["Conversation"]] = relationship(back_populates="user")
    materials: Mapped[list["Material"]] = relationship(back_populates="user", cascade="all, delete-orphan")
