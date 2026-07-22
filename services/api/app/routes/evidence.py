import json
from datetime import datetime
from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from app.core.db import SessionLocal
from app.models.evidence_source import EvidenceSource
from app.models.evidence_object import EvidenceObject
from app.models.analysis_object import AnalysisObject
from app.schemas.evidence import EvidenceObjectCreateRequest, EvidenceSourceUpsertRequest

router = APIRouter(prefix="/evidence", tags=["evidence"])


def _parse_dt(value: str | None):
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _source_to_dict(row: EvidenceSource) -> dict:
    secrets = json.loads(row.secret_json or "{}")
    return {
        "id": row.id,
        "source_key": row.source_key,
        "source_type": row.source_type,
        "label": row.label,
        "description": row.description,
        "config": json.loads(row.config_json or "{}"),
        "secret_keys": sorted(secrets.keys()),
        "has_secrets": bool(secrets),
        "enabled": row.enabled,
        "last_ingested_at": row.last_ingested_at.isoformat() if row.last_ingested_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _evidence_to_dict(row: EvidenceObject) -> dict:
    return {
        "id": row.id,
        "source_id": row.source_id,
        "source_key": row.source_key,
        "source_type": row.source_type,
        "title": row.title,
        "summary": row.summary,
        "raw_payload": json.loads(row.raw_payload_json or "{}"),
        "normalized_payload": json.loads(row.normalized_payload_json or "{}"),
        "tags": json.loads(row.tags_json or "[]"),
        "integrity_confidence": row.integrity_confidence,
        "occurred_at": row.occurred_at.isoformat() if row.occurred_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.get("/sources")
def list_sources():
    db = SessionLocal()
    try:
        rows = db.execute(select(EvidenceSource).order_by(EvidenceSource.label.asc())).scalars().all()
        return {"results": [_source_to_dict(row) for row in rows]}
    finally:
        db.close()


@router.post("/sources")
def upsert_source(payload: EvidenceSourceUpsertRequest):
    db = SessionLocal()
    try:
        row = db.execute(
            select(EvidenceSource).where(EvidenceSource.source_key == payload.source_key.strip().lower())
        ).scalar_one_or_none()
        next_secret_json = json.dumps(payload.secrets)
        if row is None:
            row = EvidenceSource(
                source_key=payload.source_key.strip().lower(),
                source_type=payload.source_type.strip().lower(),
                label=payload.label.strip(),
                description=payload.description.strip(),
                config_json=json.dumps(payload.config),
                secret_json=next_secret_json,
                enabled=payload.enabled,
            )
            db.add(row)
        else:
            row.source_type = payload.source_type.strip().lower()
            row.label = payload.label.strip()
            row.description = payload.description.strip()
            row.config_json = json.dumps(payload.config)
            if payload.secrets:
                row.secret_json = next_secret_json
            row.enabled = payload.enabled
        db.commit()
        db.refresh(row)
        return _source_to_dict(row)
    finally:
        db.close()


@router.get("")
def list_evidence(source_key: str | None = None, limit: int = 100):
    db = SessionLocal()
    try:
        stmt = select(EvidenceObject).order_by(EvidenceObject.occurred_at.desc()).limit(max(1, min(limit, 300)))
        if source_key:
            stmt = stmt.where(EvidenceObject.source_key == source_key.strip().lower())
        rows = db.execute(stmt).scalars().all()
        return {"results": [_evidence_to_dict(row) for row in rows]}
    finally:
        db.close()


@router.post("")
def create_evidence(payload: EvidenceObjectCreateRequest):
    db = SessionLocal()
    try:
        source_key = payload.source_key.strip().lower()
        source = db.execute(select(EvidenceSource).where(EvidenceSource.source_key == source_key)).scalar_one_or_none()
        if source is None:
            raise HTTPException(404, f"Evidence source '{source_key}' not found")
        occurred_at = _parse_dt(payload.occurred_at)
        row = EvidenceObject(
            source_id=source.id,
            source_key=source.source_key,
            source_type=source.source_type,
            title=payload.title.strip(),
            summary=payload.summary.strip(),
            raw_payload_json=json.dumps(payload.raw_payload),
            normalized_payload_json=json.dumps(payload.normalized_payload),
            tags_json=json.dumps(payload.tags),
            integrity_confidence=payload.integrity_confidence,
            occurred_at=occurred_at or datetime.utcnow(),
        )
        db.add(row)
        source.last_ingested_at = row.occurred_at
        db.commit()
        db.refresh(row)
        return _evidence_to_dict(row)
    finally:
        db.close()


@router.get("/analysis")
def list_analysis(limit: int = 100):
    db = SessionLocal()
    try:
        rows = db.execute(
            select(AnalysisObject).order_by(AnalysisObject.created_at.desc()).limit(max(1, min(limit, 300)))
        ).scalars().all()
        return {
            "results": [
                {
                    "id": row.id,
                    "analysis_type": row.analysis_type,
                    "evidence_ids": json.loads(row.evidence_ids_json or "[]"),
                    "input_summary": row.input_summary,
                    "output_summary": row.output_summary,
                    "steps": json.loads(row.steps_json or "[]"),
                    "confidence": row.confidence,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                }
                for row in rows
            ]
        }
    finally:
        db.close()
