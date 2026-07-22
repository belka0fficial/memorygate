from pydantic import BaseModel, Field


class EvidenceSourceUpsertRequest(BaseModel):
    source_key: str = Field(min_length=2)
    source_type: str = Field(min_length=2)
    label: str = Field(min_length=2)
    description: str = ""
    enabled: bool = True
    config: dict = {}
    secrets: dict = {}


class EvidenceObjectCreateRequest(BaseModel):
    source_key: str = Field(min_length=2)
    title: str = ""
    summary: str = Field(min_length=1)
    raw_payload: dict = {}
    normalized_payload: dict = {}
    tags: list[str] = []
    integrity_confidence: float = Field(default=1.0, ge=0.01, le=1.0)
    occurred_at: str | None = None
