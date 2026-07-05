from pydantic import BaseModel, Field

class ObservationCreateRequest(BaseModel):
    session_id: str = ""
    signal_type: str
    description: str
    raw_context: str = ""
    hypothesis: str = ""
    hypothesis_confidence: float = 0.5
    status: str = "unconfirmed"
    confirmed_by: str = ""
    entity_ids: list[str] = Field(default_factory=list)
    related_observation_ids: list[str] = Field(default_factory=list)

class ObservationSearchRequest(BaseModel):
    query: str = ""
    signal_type: str | None = None
    status: str | None = None
    entity_id: str | None = None

class ObservationUpdateRequest(BaseModel):
    status: str | None = None
    hypothesis: str | None = None
    hypothesis_confidence: float | None = None
    confirmed_by: str | None = None
    related_observation_ids: list[str] | None = None
