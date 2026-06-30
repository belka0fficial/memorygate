from sqlalchemy import String, Text, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base
import uuid

class Memory(Base):
    __tablename__ = "memories"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    text: Mapped[str] = mapped_column(Text)
    summary: Mapped[str] = mapped_column(Text, default="")
    memory_type: Mapped[str] = mapped_column(String, default="task_context")
    source_type: Mapped[str] = mapped_column(String, default="user")
    confidence: Mapped[str] = mapped_column(String, default="medium")
    identity_weight: Mapped[str] = mapped_column(String, default="medium")
    tags_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
