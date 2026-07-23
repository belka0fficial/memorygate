import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from app.core.agent import get_agent_id, resolve_agent_id
from app.core.db import SessionLocal
from app.models.entity import Entity
from app.models.episode_object import EpisodeObject
from app.models.evidence_object import EvidenceObject
from app.models.evidence_source import EvidenceSource
from app.models.memory import Memory
from app.models.object_link import ObjectLink
from app.models.processing_job import ProcessingJob
from app.schemas.runtime import AgentContextRequest, IngestEventRequest
from app.services.briefing import build_briefing
from app.services.qdrant_store import search_memory_embeddings
from app.services.runtime_pipeline import process_evidence
from app.services.scoring import memory_rank_bonus

router = APIRouter(prefix="/runtime", tags=["runtime"])


def _parse_dt(value: str | None):
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else datetime.now(timezone.utc)


def _job_dict(row):
    return {"id": row.id, "agent_id": row.agent_id, "evidence_id": row.evidence_id, "status": row.status,
            "attempts": row.attempts, "stage": row.stage, "error": row.error,
            "result": json.loads(row.result_json or "{}"),
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None}


@router.post("/ingest")
def ingest(payload: IngestEventRequest, header_agent_id: str = Depends(get_agent_id)):
    agent_id = resolve_agent_id(header_agent_id, payload.agent_id)
    db = SessionLocal()
    try:
        source = db.execute(select(EvidenceSource).where(EvidenceSource.source_key == payload.source_key.strip().lower())).scalar_one_or_none()
        if not source or not source.enabled:
            raise HTTPException(404, "Enabled evidence source not found")
        content = payload.content.strip() or payload.title.strip() or json.dumps(payload.payload, ensure_ascii=True)
        if not content:
            raise HTTPException(422, "Event must contain content, a title, or a payload")
        row = EvidenceObject(
            agent_id=agent_id, source_id=source.id, source_key=source.source_key, source_type=source.source_type,
            title=payload.title.strip() or content[:120], summary=content[:500],
            raw_payload_json=json.dumps(payload.payload), normalized_payload_json=json.dumps({"content": content}),
            tags_json=json.dumps(payload.tags), integrity_confidence=payload.integrity_confidence,
            processing_state="pending", occurred_at=_parse_dt(payload.occurred_at),
        )
        db.add(row)
        source.last_ingested_at = row.occurred_at
        db.commit()
        db.refresh(row)
        result = process_evidence(db, row, content) if payload.auto_process else None
        return {"status": "processed" if result else "accepted", "evidence_id": row.id, "processing": result}
    finally:
        db.close()


@router.post("/context")
def agent_context(payload: AgentContextRequest, header_agent_id: str = Depends(get_agent_id)):
    agent_id = resolve_agent_id(header_agent_id, payload.agent_id)
    db = SessionLocal()
    try:
        memories = []
        try:
            hits = search_memory_embeddings(payload.query, limit=payload.max_items * 2, agent_id=agent_id)
            for hit in hits:
                row = db.get(Memory, hit["id"])
                if row and row.agent_id == agent_id:
                    score = hit["score"] + memory_rank_bonus(row.memory_type, row.confidence)
                    memories.append({"id": row.id, "text": row.text, "summary": row.summary, "type": row.memory_type,
                                     "confidence": row.confidence, "score": round(score, 4), "source_type": row.source_type})
        except Exception:
            rows = db.execute(select(Memory).where(Memory.agent_id == agent_id, Memory.text.ilike(f"%{payload.query}%")).limit(payload.max_items)).scalars().all()
            memories = [{"id": row.id, "text": row.text, "summary": row.summary, "type": row.memory_type,
                         "confidence": row.confidence, "score": memory_rank_bonus(row.memory_type, row.confidence), "source_type": row.source_type} for row in rows]
        memories.sort(key=lambda item: item["score"], reverse=True)

        terms = [term for term in payload.query.split() if len(term) > 2][:8]
        entity_filter = or_(*[or_(Entity.name.ilike(f"%{term}%"), Entity.description.ilike(f"%{term}%"), Entity.agent_summary.ilike(f"%{term}%")) for term in terms]) if terms else Entity.name.ilike(f"%{payload.query}%")
        entities = db.execute(select(Entity).where(Entity.agent_id == agent_id, entity_filter).limit(8)).scalars().all()
        episodes = db.execute(select(EpisodeObject).where(EpisodeObject.agent_id == agent_id, or_(EpisodeObject.title.ilike(f"%{payload.query}%"), EpisodeObject.summary.ilike(f"%{payload.query}%"))).limit(5)).scalars().all()
        evidence = []
        if payload.include_evidence:
            evidence = db.execute(select(EvidenceObject).where(EvidenceObject.agent_id == agent_id, EvidenceObject.invalidated_at.is_(None), or_(EvidenceObject.title.ilike(f"%{payload.query}%"), EvidenceObject.summary.ilike(f"%{payload.query}%"))).limit(5)).scalars().all()
        return {
            "query": payload.query, "agent_id": agent_id, "briefing": build_briefing(db, agent_id),
            "memories": memories[:payload.max_items],
            "entities": [{"id": r.id, "name": r.name, "type": r.entity_type, "description": r.description, "summary": r.agent_summary, "attributes": json.loads(r.attributes_json)} for r in entities],
            "episodes": [{"id": r.id, "title": r.title, "summary": r.summary, "occurred_start": r.occurred_start.isoformat() if r.occurred_start else None} for r in episodes],
            "evidence": [{"id": r.id, "title": r.title, "summary": r.summary, "source": r.source_key, "occurred_at": r.occurred_at.isoformat()} for r in evidence],
            "usage": {"instruction": "Use high-confidence memories and entities first. Treat episodes/evidence as supporting context, not settled truth."},
        }
    finally:
        db.close()


@router.get("/jobs")
def list_jobs(agent_id: str = Depends(get_agent_id), status: str | None = None, limit: int = 100):
    db = SessionLocal()
    try:
        stmt = select(ProcessingJob).where(ProcessingJob.agent_id == agent_id)
        if status:
            stmt = stmt.where(ProcessingJob.status == status)
        rows = db.execute(stmt.order_by(ProcessingJob.created_at.desc()).limit(max(1, min(limit, 300)))).scalars().all()
        return {"results": [_job_dict(row) for row in rows]}
    finally:
        db.close()


@router.post("/jobs/{job_id}/retry")
def retry_job(job_id: str, agent_id: str = Depends(get_agent_id)):
    db = SessionLocal()
    try:
        job = db.get(ProcessingJob, job_id)
        if not job or job.agent_id != agent_id:
            raise HTTPException(404, "Processing job not found")
        evidence = db.get(EvidenceObject, job.evidence_id)
        if not evidence:
            raise HTTPException(404, "Evidence no longer exists")
        content = json.loads(evidence.normalized_payload_json or "{}").get("content") or evidence.summary
        return {"status": "ok", "processing": process_evidence(db, evidence, content)}
    finally:
        db.close()


@router.post("/evidence/{evidence_id}/invalidate")
def invalidate_evidence(evidence_id: str, reason: str, agent_id: str = Depends(get_agent_id)):
    db = SessionLocal()
    try:
        evidence = db.get(EvidenceObject, evidence_id)
        if not evidence or evidence.agent_id != agent_id:
            raise HTTPException(404, "Evidence not found")
        evidence.invalidated_at = datetime.now(timezone.utc)
        evidence.invalidation_reason = reason
        evidence.processing_state = "invalidated"
        links = db.execute(select(ObjectLink).where(ObjectLink.source_type == "evidence", ObjectLink.source_id == evidence_id)).scalars().all()
        for link in links:
            link.confidence = 0.0
            link.metadata_json = json.dumps({"invalidated": True, "reason": reason})
        db.commit()
        return {"status": "ok", "affected_links": len(links)}
    finally:
        db.close()
