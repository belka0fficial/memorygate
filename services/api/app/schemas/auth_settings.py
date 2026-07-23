from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class AdminKeyUpdateRequest(BaseModel):
    current_key: str = Field(min_length=1)
    new_key: str = Field(min_length=8)


class AdminKeyRotateRequest(BaseModel):
    current_key: str = Field(min_length=1)
    length: int = Field(default=24, ge=16, le=48)


class AgentKeyCreateRequest(BaseModel):
    label: str = Field(min_length=2, max_length=80)
    agent_id: str = Field(min_length=1, max_length=80)


class AiRuntimeUpdateRequest(BaseModel):
    current_key: str = Field(min_length=1)
    provider: Literal["ollama", "openai"]
    model: str = Field(min_length=1, max_length=160)
    api_key: str | None = Field(default=None, max_length=500)
    clear_api_key: bool = False


class MemoryResetRequest(BaseModel):
    current_key: str = Field(min_length=1)
    confirmation: str = Field(min_length=1, max_length=80)
    reset_from: datetime | None = None
