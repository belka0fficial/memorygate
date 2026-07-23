from pydantic import BaseModel, Field


class IngestEventRequest(BaseModel):
    source_key: str
    title: str = ""
    content: str = ""
    payload: dict = {}
    occurred_at: str | None = None
    tags: list[str] = []
    integrity_confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    auto_process: bool = True
    agent_id: str | None = None


class AgentContextRequest(BaseModel):
    query: str = Field(min_length=1)
    session_context: str = ""
    max_items: int = Field(default=12, ge=1, le=30)
    include_evidence: bool = False
    agent_id: str | None = None
