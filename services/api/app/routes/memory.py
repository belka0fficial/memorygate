import json
from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from app.core.db import SessionLocal
from app.models.memory import Memory
from app.models.audit import MemoryAudit
from app.schemas.memory import MemoryWriteRequest, MemorySearchRequest
from app.services.classifier import classify_memory
from app.services.qdrant_store import (
    upsert_memory_embedding,
    search_memory_embeddings,
    find_near_duplicate,
)
from app.services.scoring import memory_rank_bonus, memory_strength

router = APIRouter(prefix="/memory", tags=["memory"])

NEAR_DUPLICATE_THRESHOLD = 0.92

def _row_to_dict(row):
    return {
        "id": row.id,
        "text": row.text,
        "summary": row.summary,
        "memory_type": row.memory_type,
        "source_type": row.source_type,
        "confidence": row.confidence,
        "identity_weight": row.identity_weight,
        "tags": json.loads(row.tags_json),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }

def _merge_tags(old_tags: list[str], new_tags: list[str]) -> list[str]:
    merged = []
    seen = set()
    for tag in old_tags + new_tags:
        if tag not in seen:
            seen.add(tag)
            merged.append(tag)
    return merged

def _upgrade_existing_memory(db, row, payload, final_memory_type, final_confidence, final_identity_weight, final_summary):
    old_tags = json.loads(row.tags_json)
    merged_tags = _merge_tags(old_tags, payload.tags)

    old_memory_type = row.memory_type
    old_strength = memory_strength(row.memory_type, row.identity_weight, row.confidence)
    new_strength = memory_strength(final_memory_type, final_identity_weight, final_confidence)

    upgraded = False
    if new_strength > old_strength:
        row.memory_type = final_memory_type
        row.confidence = final_confidence
        row.identity_weight = final_identity_weight
        row.summary = final_summary
        upgraded = True

    if merged_tags != old_tags:
        row.tags_json = json.dumps(merged_tags)
        upgraded = True

    if upgraded:
        db.add(MemoryAudit(
            action="upgrade",
            memory_id=row.id,
            payload_json=json.dumps({
                "text": payload.text,
                "old_memory_type": old_memory_type,
                "new_memory_type": row.memory_type,
                "tags": merged_tags,
            }),
        ))
        db.commit()

        upsert_memory_embedding(
            row.id,
            row.text,
            payload={
                "memory_type": row.memory_type,
                "source_type": row.source_type,
                "confidence": row.confidence,
                "identity_weight": row.identity_weight,
                "tags": merged_tags,
            },
        )

    return {
        "status": "ok",
        "id": row.id,
        "memory_type": row.memory_type,
        "summary": row.summary,
        "duplicate_of": row.id,
        "upgraded": upgraded,
    }

@router.post("/write")
def write_memory(payload: MemoryWriteRequest):
    db = SessionLocal()
    try:
        classified = classify_memory(payload.text, payload.source_type)

        final_memory_type = payload.memory_type or classified["memory_type"]
        final_confidence = payload.confidence or classified["confidence"]
        final_identity_weight = payload.identity_weight or classified["identity_weight"]
        final_summary = classified["summary"]

        normalized_text = payload.text.strip().lower()
        existing = db.execute(select(Memory).order_by(Memory.created_at.desc()).limit(100)).scalars().all()

        # exact duplicate
        for row in existing:
            if row.text.strip().lower() == normalized_text:
                return _upgrade_existing_memory(
                    db, row, payload,
                    final_memory_type,
                    final_confidence,
                    final_identity_weight,
                    final_summary,
                )

        # near duplicate by vector similarity
        near_hits = find_near_duplicate(payload.text, limit=3)
        if near_hits:
            best = near_hits[0]
            if best["score"] >= NEAR_DUPLICATE_THRESHOLD:
                row = db.get(Memory, best["id"])
                if row:
                    result = _upgrade_existing_memory(
                        db, row, payload,
                        final_memory_type,
                        final_confidence,
                        final_identity_weight,
                        final_summary,
                    )
                    result["near_duplicate_of"] = row.id
                    result["similarity"] = best["score"]
                    return result

        memory = Memory(
            text=payload.text,
            summary=final_summary,
            memory_type=final_memory_type,
            source_type=payload.source_type,
            confidence=final_confidence,
            identity_weight=final_identity_weight,
            tags_json=json.dumps(payload.tags),
        )
        db.add(memory)
        db.commit()
        db.refresh(memory)

        upsert_memory_embedding(
            memory.id,
            memory.text,
            payload={
                "memory_type": memory.memory_type,
                "source_type": memory.source_type,
                "confidence": memory.confidence,
                "identity_weight": memory.identity_weight,
                "tags": payload.tags,
            },
        )

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
        ids = search_memory_embeddings(payload.query, limit=20)

        rows = []
        if ids:
            id_to_rank = {memory_id: idx for idx, memory_id in enumerate(ids)}
            fetched = db.execute(select(Memory).where(Memory.id.in_(ids))).scalars().all()

            query_lower = payload.query.lower()
            rescored = []
            for row in fetched:
                base = max(0.0, 1.0 - (id_to_rank.get(row.id, 999) * 0.03))
                bonus = memory_rank_bonus(row.memory_type, row.identity_weight, row.confidence)

                text_lower = row.text.lower()
                lexical = 0.0
                if "humor" in query_lower and any(x in text_lower for x in ["humor", "sarcasm", "deadpan", "joke"]):
                    lexical += 0.35
                if any(x in query_lower for x in ["sidecar", "sidecars", "build", "architecture", "workflow"]) and any(
                    x in text_lower for x in ["sidecar", "sidecars", "build", "architecture", "workflow", "before"]
                ):
                    lexical += 0.35

                rescored.append((base + bonus + lexical, row))

            rescored.sort(key=lambda x: x[0], reverse=True)
            rows = [row for _, row in rescored]
        else:
            rows = db.execute(
                select(Memory)
                .where(Memory.text.ilike(f"%{payload.query}%"))
                .order_by(Memory.created_at.desc())
                .limit(20)
            ).scalars().all()

        return {"results": [_row_to_dict(row) for row in rows]}
    finally:
        db.close()

@router.get("")
def list_memory():
    db = SessionLocal()
    try:
        rows = db.execute(select(Memory).order_by(Memory.created_at.desc()).limit(100)).scalars().all()
        return [_row_to_dict(row) for row in rows]
    finally:
        db.close()

@router.get("/{memory_id}")
def get_memory(memory_id: str):
    db = SessionLocal()
    try:
        row = db.get(Memory, memory_id)
        if not row:
            raise HTTPException(404, "Memory not found")
        return _row_to_dict(row)
    finally:
        db.close()
