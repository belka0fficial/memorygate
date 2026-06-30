from pydantic import BaseModel
from typing import Any

class MemoryWriteRequest(BaseModel):
    text: str
    source_type: str = "user"
    memory_type: str | None = None
    confidence: str | None = None
    identity_weight: str | None = None
    tags: list[str] = []

class MemorySearchRequest(BaseModel):
    query: str

class MemoryResponse(BaseModel):
    id: str
    text: str
    summary: str
    memory_type: str
    source_type: str
    confidence: str
    identity_weight: str
    tags: list[str]
