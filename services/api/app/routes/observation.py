import json
from fastapi import APIRouter, HTTPException
from sqlalchemy import select, and_
from app.core.db import SessionLocal
from app.models.observation import Observation
from app.schemas.observation import (
    ObservationCreateRequest,
    ObservationSearchRequest,
    ObservationUpdateRequest,
)

router = APIRouter(prefix="/observation", tags=["observation"])

def _obs_to_dict(row: Observation) -> dict:
    return {
        "id": row.id,
        "session_id": row.session_id,
        "observed_at": row.observed_at.isoformat() if row.observed_at else None,
        "signal_type": row.signal_type,
        "description": row.description,
        "raw_context": row.raw_context,
        "hypothesis": row.hypothesis,
        "hypothesis_confidence": row.hypothesis_confidence,
        "status": row.status,
        "confirmed_by": row.confirmed_by,
        "entity_ids": json.loads(row.entity_ids_json),
        "related_observation_ids": json.loads(row.related_observation_ids_json),
    }

@router.post("/create")
def create_observation(payload: ObservationCreateRequest):
    db = SessionLocal()
    try:
        row = Observation(
            session_id=payload.session_id,
            signal_type=payload.signal_type,
            description=payload.description,
            raw_context=payload.raw_context,
            hypothesis=payload.hypothesis,
            hypothesis_confidence=payload.hypothesis_confidence,
            status=payload.status,
            confirmed_by=payload.confirmed_by,
            entity_ids_json=json.dumps(payload.entity_ids),
            related_observation_ids_json=json.dumps(payload.related_observation_ids),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return {"status": "ok", "observation": _obs_to_dict(row)}
    finally:
        db.close()

@router.post("/search")
def search_observations(payload: ObservationSearchRequest):
    db = SessionLocal()
    try:
        stmt = select(Observation)

        filters = []
        if payload.signal_type:
            filters.append(Observation.signal_type == payload.signal_type)
        if payload.status:
            filters.append(Observation.status == payload.status)
        if filters:
            stmt = stmt.where(and_(*filters))

        rows = db.execute(stmt.order_by(Observation.observed_at.desc())).scalars().all()

        results = []
        for row in rows:
            item = _obs_to_dict(row)

            if payload.entity_id and payload.entity_id not in item["entity_ids"]:
                continue

            if payload.query:
                hay = " ".join([
                    item["description"],
                    item["raw_context"],
                    item["hypothesis"],
                    item["status"],
                    item["signal_type"],
                ]).lower()
                if payload.query.lower() not in hay:
                    continue

            results.append(item)

        return {"results": results[:50]}
    finally:
        db.close()

@router.get("/{observation_id}")
def get_observation(observation_id: str):
    db = SessionLocal()
    try:
        row = db.get(Observation, observation_id)
        if not row:
            raise HTTPException(404, "Observation not found")
        return _obs_to_dict(row)
    finally:
        db.close()

@router.post("/update/{observation_id}")
def update_observation(observation_id: str, payload: ObservationUpdateRequest):
    db = SessionLocal()
    try:
        row = db.get(Observation, observation_id)
        if not row:
            raise HTTPException(404, "Observation not found")

        if payload.status is not None:
            row.status = payload.status
        if payload.hypothesis is not None:
            row.hypothesis = payload.hypothesis
        if payload.hypothesis_confidence is not None:
            row.hypothesis_confidence = payload.hypothesis_confidence
        if payload.confirmed_by is not None:
            row.confirmed_by = payload.confirmed_by
        if payload.related_observation_ids is not None:
            row.related_observation_ids_json = json.dumps(payload.related_observation_ids)

        db.commit()
        db.refresh(row)
        return {"status": "ok", "observation": _obs_to_dict(row)}
    finally:
        db.close()
