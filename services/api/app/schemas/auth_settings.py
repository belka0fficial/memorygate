from pydantic import BaseModel, Field


class AdminKeyUpdateRequest(BaseModel):
    current_key: str = Field(min_length=1)
    new_key: str = Field(min_length=8)


class AdminKeyRotateRequest(BaseModel):
    current_key: str = Field(min_length=1)
    length: int = Field(default=24, ge=16, le=48)
