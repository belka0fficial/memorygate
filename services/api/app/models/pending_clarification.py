from sqlalchemy import String, Text, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base
import uuid

class PendingClarification(Base):
    __tablename__ = "pending_clarifications"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id: Mapped[str] = mapped_column(String, default="", index=True)
    observed_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    what_happened: Mapped[str] = mapped_column(Text)
    hypotheses_json: Mapped[str] = mapped_column(Text, default="[]")

    status: Mapped[str] = mapped_column(String, default="pending", index=True)  # pending / asked / resolved / dismissed
    resolved_answer: Mapped[str] = mapped_column(Text, default="")
    ask_after: Mapped[str] = mapped_column(String, default="")

    entity_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    related_observation_ids_json: Mapped[str] = mapped_column(Text, default="[]")
