from pydantic import BaseModel


class AgentConfigUpdateRequest(BaseModel):
    novelty_threshold: float | None = None
    value_threshold: float | None = None
    max_observations: int | None = None
    signal_filter_enabled: bool | None = None
