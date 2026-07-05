from pydantic import BaseModel, Field
from typing import Any

class PendingClarificationCreateRequest(BaseModel):
    session_id: str = ""
    what_happened: str
    hypotheses: list[dict[str, Any]] = Field(default_factory=list)
    status: str = "pending"
    resolved_answer: str = ""
    ask_after: str = ""
    entity_ids: list[str] = Field(default_factory=list)
    related_observation_ids: list[str] = Field(default_factory=list)

class PendingClarificationSearchRequest(BaseModel):
    query: str = ""
    status: str | None = None
    entity_id: str | None = None

class PendingClarificationUpdateRequest(BaseModel):
    clarification_id: str
    status: str | None = None
    resolved_answer: str | None = None
    ask_after: str | None = None
    hypotheses: list[dict[str, Any]] | None = None
    related_observation_ids: list[str] | None = None
