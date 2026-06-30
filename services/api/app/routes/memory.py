import json
from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from app.core.db import SessionLocal
from app.models.memory import Memory
from app.models.audit import MemoryAudit
from app.schemas.memory import MemoryWriteRequest, MemorySearchRequest
from app.services.classifier import classify_memory
from app.services.qdrant_stub import upsert_memory_embedding

router = APIRouter(prefix="/memory", tags=["memory"])

@router.post("/write")
def write_memory(payload: MemoryWriteRequest):
    db = SessionLocal()
    try:
        classified = classify_memory(payload.text, payload.source_type)

        memory = Memory(
            text=payload.text,
            summary=classified["summary"],
            memory_type=payload.memory_type or classified["memory_type"],
            source_type=payload.source_type,
            confidence=payload.confidence or classified["confidence"],
            identity_weight=payload.identity_weight or classified["identity_weight"],
            tags_json=json.dumps(payload.tags),
        )
        db.add(memory)
        db.commit()
        db.refresh(memory)

        upsert_memory_embedding(memory.id, memory.text)

        db.add(MemoryAudit(
            action="write",
            memory_id=memory.id,
            payload_json=json.dumps({
                "text": payload.text,
                "source_type": payload.source_type,
                "memory_type": memory.memory_type,
            }),
        ))
        db.commit()

        return {
            "status": "ok",
            "id": memory.id,
            "memory_type": memory.memory_type,
            "summary": memory.summary,
        }
    finally:
        db.close()

@router.post("/search")
def search_memory(payload: MemorySearchRequest):
    db = SessionLocal()
    try:
        rows = db.execute(
            select(Memory).where(Memory.text.ilike(f"%{payload.query}%")).order_by(Memory.created_at.desc()).limit(20)
        ).scalars().all()

        return {
            "results": [
                {
                    "id": row.id,
                    "text": row.text,
                    "summary": row.summary,
                    "memory_type": row.memory_type,
                    "source_type": row.source_type,
                    "confidence": row.confidence,
                    "identity_weight": row.identity_weight,
                    "tags": json.loads(row.tags_json),
                }
                for row in rows
            ]
        }
    finally:
        db.close()

@router.get("")
def list_memory():
    db = SessionLocal()
    try:
        rows = db.execute(
            select(Memory).order_by(Memory.created_at.desc()).limit(100)
        ).scalars().all()

        return [
            {
                "id": row.id,
                "text": row.text,
                "summary": row.summary,
                "memory_type": row.memory_type,
                "source_type": row.source_type,
                "confidence": row.confidence,
                "identity_weight": row.identity_weight,
                "tags": json.loads(row.tags_json),
            }
            for row in rows
        ]
    finally:
        db.close()

@router.get("/{memory_id}")
def get_memory(memory_id: str):
    db = SessionLocal()
    try:
        row = db.get(Memory, memory_id)
        if not row:
            raise HTTPException(404, "Memory not found")

        return {
            "id": row.id,
            "text": row.text,
            "summary": row.summary,
            "memory_type": row.memory_type,
            "source_type": row.source_type,
            "confidence": row.confidence,
            "identity_weight": row.identity_weight,
            "tags": json.loads(row.tags_json),
        }
    finally:
        db.close()
