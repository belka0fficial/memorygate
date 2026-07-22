from pydantic import BaseModel, Field


class EpisodeCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    summary: str = ""
    episode_type: str = "event"
    status: str = "open"
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    tags: list[str] = []
    evidence_ids: list[str] = []
    occurred_start: str | None = None
    occurred_end: str | None = None
    agent_id: str | None = None


class EpisodeUpdateRequest(BaseModel):
    title: str | None = None
    summary: str | None = None
    episode_type: str | None = None
    status: str | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    tags: list[str] | None = None
    occurred_start: str | None = None
    occurred_end: str | None = None


class ObjectLinkCreateRequest(BaseModel):
    source_type: str
    source_id: str
    target_type: str
    target_id: str
    relationship: str = Field(min_length=1, max_length=100)
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    metadata: dict = {}
    created_by: str = "user"
