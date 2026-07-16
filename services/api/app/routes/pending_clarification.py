import json
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy import select
from app.core.db import SessionLocal
from app.core.agent import get_agent_id, resolve_agent_id
from app.models.pending_clarification import PendingClarification
from app.schemas.pending_clarification import (
    PendingClarificationCreateRequest,
    PendingClarificationSearchRequest,
    PendingClarificationUpdateRequest,
)

router = APIRouter(prefix="/clarification", tags=["clarification"])

def _pc_to_dict(row: PendingClarification) -> dict:
    return {
        "id": row.id,
        "agent_id": row.agent_id,
        "session_id": row.session_id,
        "observed_at": row.observed_at.isoformat() if row.observed_at else None,
        "what_happened": row.what_happened,
        "hypotheses": json.loads(row.hypotheses_json),
        "status": row.status,
        "resolved_answer": row.resolved_answer,
        "ask_after": row.ask_after,
        "importance": row.importance,
        "entity_ids": json.loads(row.entity_ids_json),
        "related_observation_ids": json.loads(row.related_observation_ids_json),
    }

@router.post("/create")
def create_pending_clarification(payload: PendingClarificationCreateRequest, header_agent_id: str = Depends(get_agent_id)):
    agent_id = resolve_agent_id(header_agent_id, payload.agent_id)
    db = SessionLocal()
    try:
        row = PendingClarification(
            agent_id=agent_id,
            session_id=payload.session_id,
            what_happened=payload.what_happened,
            hypotheses_json=json.dumps(payload.hypotheses),
            status=payload.status,
            resolved_answer=payload.resolved_answer,
            ask_after=payload.ask_after,
            importance=payload.importance,
            entity_ids_json=json.dumps(payload.entity_ids),
            related_observation_ids_json=json.dumps(payload.related_observation_ids),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return {"status": "ok", "clarification": _pc_to_dict(row)}
    finally:
        db.close()

@router.post("/search")
def search_pending_clarifications(payload: PendingClarificationSearchRequest, header_agent_id: str = Depends(get_agent_id)):
    agent_id = resolve_agent_id(header_agent_id, payload.agent_id)
    db = SessionLocal()
    try:
        rows = db.execute(
            select(PendingClarification)
            .where(PendingClarification.agent_id == agent_id)
            .order_by(PendingClarification.observed_at.desc())
        ).scalars().all()

        results = []
        for row in rows:
            item = _pc_to_dict(row)

            if payload.status and item["status"] != payload.status:
                continue
            if payload.entity_id and payload.entity_id not in item["entity_ids"]:
                continue

            if payload.query:
                hay = " ".join([
                    item["what_happened"],
                    json.dumps(item["hypotheses"]),
                    item["status"],
                    item["resolved_answer"],
                    item["ask_after"],
                ]).lower()
                tokens = [t for t in payload.query.lower().replace("-", " ").split() if t]
                if not all(t in hay for t in tokens):
                    continue

            results.append(item)

        return {"results": results[:50]}
    finally:
        db.close()

@router.get("/{clarification_id}")
def get_pending_clarification(clarification_id: str, agent_id: str = Depends(get_agent_id)):
    db = SessionLocal()
    try:
        row = db.get(PendingClarification, clarification_id)
        if not row or row.agent_id != agent_id:
            raise HTTPException(404, "Pending clarification not found")
        return _pc_to_dict(row)
    finally:
        db.close()

@router.post("/update")
def update_pending_clarification(payload: PendingClarificationUpdateRequest, agent_id: str = Depends(get_agent_id)):
    db = SessionLocal()
    try:
        row = db.get(PendingClarification, payload.clarification_id)
        if not row or row.agent_id != agent_id:
            raise HTTPException(404, "Pending clarification not found")

        if payload.status is not None:
            row.status = payload.status
        if payload.resolved_answer is not None:
            row.resolved_answer = payload.resolved_answer
        if payload.ask_after is not None:
            row.ask_after = payload.ask_after
        if payload.importance is not None:
            row.importance = payload.importance
        if payload.hypotheses is not None:
            row.hypotheses_json = json.dumps(payload.hypotheses)
        if payload.related_observation_ids is not None:
            row.related_observation_ids_json = json.dumps(payload.related_observation_ids)

        db.commit()
        db.refresh(row)
        return {"status": "ok", "clarification": _pc_to_dict(row)}
    finally:
        db.close()
