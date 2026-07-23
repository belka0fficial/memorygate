import json
import hmac
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Header, Request
from sqlalchemy import or_, select
from app.core.agent import get_agent_id, resolve_agent_id
from app.core.auth import require_key, require_read_key
from app.services.auth_settings_service import clear_failed_attempts, get_lockout_status, register_failed_attempt
from app.core.db import SessionLocal
from app.models.entity import Entity
from app.models.episode_object import EpisodeObject
from app.models.evidence_object import EvidenceObject
from app.models.evidence_source import EvidenceSource
from app.models.memory import Memory
from app.models.object_link import ObjectLink
from app.models.processing_job import ProcessingJob
from app.schemas.runtime import AgentContextRequest, IngestEventRequest, MemoryQuestionRequest
from app.services.briefing import build_briefing
from app.services.qdrant_store import search_memory_embeddings
from app.services.ollama_service import answer_with_context, ollama_health
from app.services.scoring import memory_rank_bonus
from app.services.memory_truth import mark_unsupported

router = APIRouter(prefix="/runtime", tags=["runtime"])


def _parse_dt(value: str | None):
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else datetime.now(timezone.utc)


def _enqueue(db, source: EvidenceSource, payload: IngestEventRequest, agent_id: str) -> dict:
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
    job = None
    if payload.auto_process:
        job = ProcessingJob(agent_id=agent_id, evidence_id=row.id, status="pending", stage="queued")
        db.add(job)
        db.commit()
        db.refresh(job)
    return {"status": "queued" if job else "accepted", "evidence_id": row.id, "job_id": job.id if job else None}


def _job_dict(row):
    return {"id": row.id, "agent_id": row.agent_id, "evidence_id": row.evidence_id, "status": row.status,
            "attempts": row.attempts, "stage": row.stage, "error": row.error,
            "result": json.loads(row.result_json or "{}"),
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None}


@router.post("/ingest")
def ingest(payload: IngestEventRequest, header_agent_id: str = Depends(get_agent_id), _: str = Depends(require_key)):
    agent_id = resolve_agent_id(header_agent_id, payload.agent_id)
    db = SessionLocal()
    try:
        source = db.execute(select(EvidenceSource).where(EvidenceSource.source_key == payload.source_key.strip().lower())).scalar_one_or_none()
        if not source or not source.enabled:
            raise HTTPException(404, "Enabled evidence source not found")
        return _enqueue(db, source, payload, agent_id)
    finally:
        db.close()


@router.post("/listeners/{source_key}")
def listener_ingest(source_key: str, payload: IngestEventRequest, request: Request, x_memorygate_listener_key: str | None = Header(None, alias="X-MemoryGate-Listener-Key")):
    """Dedicated listener ingress: source token only, never an admin credential."""
    db = SessionLocal()
    try:
        source = db.execute(select(EvidenceSource).where(EvidenceSource.source_key == source_key.strip().lower())).scalar_one_or_none()
        if not source or not source.enabled:
            raise HTTPException(404, "Enabled evidence source not found")
        client_host = request.client.host if request.client else "unknown"
        lock_scope = f"listener:{client_host}:{source.source_key}"
        remaining = get_lockout_status(lock_scope)
        if remaining:
            raise HTTPException(429, f"Too many failed attempts. Try again in {remaining} seconds.")
        secret = json.loads(source.secret_json or "{}").get("ingest_key", "")
        if not secret or not x_memorygate_listener_key or not hmac.compare_digest(secret, x_memorygate_listener_key):
            remaining = register_failed_attempt(lock_scope)
            if remaining:
                raise HTTPException(429, f"Too many failed attempts. Try again in {remaining} seconds.")
            raise HTTPException(401, "invalid listener key")
        clear_failed_attempts(lock_scope)
        config = json.loads(source.config_json or "{}")
        payload.source_key = source.source_key
        payload.agent_id = config.get("agent_id", "default")
        return _enqueue(db, source, payload, payload.agent_id)
    finally:
        db.close()


def _build_context(db, payload: AgentContextRequest, agent_id: str) -> dict:
        memories = []
        try:
            hits = search_memory_embeddings(payload.query, limit=payload.max_items * 2, agent_id=agent_id)
            for hit in hits:
                row = db.get(Memory, hit["id"])
                if row and row.agent_id == agent_id and row.status == "active":
                    score = hit["score"] + memory_rank_bonus(row.memory_type, row.confidence)
                    memories.append({"id": row.id, "text": row.text, "summary": row.summary, "type": row.memory_type,
                                     "confidence": row.confidence, "score": round(score, 4), "source_type": row.source_type})
        except Exception:
            rows = db.execute(select(Memory).where(Memory.agent_id == agent_id, Memory.status == "active", Memory.text.ilike(f"%{payload.query}%")).limit(payload.max_items)).scalars().all()
            memories = [{"id": row.id, "text": row.text, "summary": row.summary, "type": row.memory_type,
                         "confidence": row.confidence, "score": memory_rank_bonus(row.memory_type, row.confidence), "source_type": row.source_type} for row in rows]
        # Vector similarity is useful but must not hide an exact project/name
        # match. Add lexical candidates so retrieval is robust during early or
        # sparse embedding collections too.
        query_terms = [term.lower().strip(".,?!:;\"'") for term in payload.query.split() if len(term) > 2]
        known_ids = {item["id"] for item in memories}
        for row in db.execute(select(Memory).where(Memory.agent_id == agent_id, Memory.status == "active").order_by(Memory.updated_at.desc()).limit(200)).scalars().all():
            if row.id in known_ids:
                continue
            text = f"{row.text} {row.summary}".lower()
            matches = sum(1 for term in query_terms if term in text)
            if matches:
                memories.append({"id": row.id, "text": row.text, "summary": row.summary, "type": row.memory_type,
                                 "confidence": row.confidence, "score": round(memory_rank_bonus(row.memory_type, row.confidence) + matches * 0.3, 4),
                                 "source_type": row.source_type})
        memories.sort(key=lambda item: item["score"], reverse=True)

        terms = [term for term in payload.query.split() if len(term) > 2][:8]
        entity_filter = or_(*[or_(Entity.name.ilike(f"%{term}%"), Entity.description.ilike(f"%{term}%"), Entity.agent_summary.ilike(f"%{term}%")) for term in terms]) if terms else Entity.name.ilike(f"%{payload.query}%")
        episode_filter = or_(*[or_(EpisodeObject.title.ilike(f"%{term}%"), EpisodeObject.summary.ilike(f"%{term}%")) for term in terms]) if terms else EpisodeObject.title.ilike(f"%{payload.query}%")
        evidence_filter = or_(*[or_(EvidenceObject.title.ilike(f"%{term}%"), EvidenceObject.summary.ilike(f"%{term}%")) for term in terms]) if terms else EvidenceObject.title.ilike(f"%{payload.query}%")
        entities = db.execute(select(Entity).where(Entity.agent_id == agent_id, entity_filter).limit(8)).scalars().all()
        episodes = db.execute(select(EpisodeObject).where(EpisodeObject.agent_id == agent_id, episode_filter).limit(5)).scalars().all()
        evidence = []
        if payload.include_evidence:
            evidence = db.execute(select(EvidenceObject).where(EvidenceObject.agent_id == agent_id, EvidenceObject.invalidated_at.is_(None), evidence_filter).limit(5)).scalars().all()
        return {
            "query": payload.query, "agent_id": agent_id, "briefing": build_briefing(db, agent_id),
            "memories": memories[:payload.max_items],
            "entities": [{"id": r.id, "name": r.name, "type": r.entity_type, "description": r.description, "summary": r.agent_summary, "attributes": json.loads(r.attributes_json)} for r in entities],
            "episodes": [{"id": r.id, "title": r.title, "summary": r.summary, "occurred_start": r.occurred_start.isoformat() if r.occurred_start else None} for r in episodes],
            "evidence": [{"id": r.id, "title": r.title, "summary": r.summary, "source": r.source_key, "occurred_at": r.occurred_at.isoformat()} for r in evidence],
            "usage": {"instruction": "Use high-confidence memories and entities first. Treat episodes/evidence as supporting context, not settled truth."},
        }


@router.post("/context")
def agent_context(payload: AgentContextRequest, header_agent_id: str = Depends(get_agent_id), _: str = Depends(require_read_key)):
    agent_id = resolve_agent_id(header_agent_id, payload.agent_id)
    db = SessionLocal()
    try:
        return _build_context(db, payload, agent_id)
    finally:
        db.close()


@router.post("/ask")
def ask_memorygate(payload: MemoryQuestionRequest, header_agent_id: str = Depends(get_agent_id), _: str = Depends(require_read_key)):
    agent_id = resolve_agent_id(header_agent_id, payload.agent_id)
    db = SessionLocal()
    try:
        context = _build_context(db, AgentContextRequest(query=payload.question, max_items=8, include_evidence=payload.include_evidence), agent_id)
        answer = answer_with_context(payload.question, context)
        if not answer:
            raise HTTPException(503, "Local Ollama answer service is unavailable")
        return {"question": payload.question, "answer": answer, "context": context}
    finally:
        db.close()


@router.get("/jobs")
def list_jobs(agent_id: str = Depends(get_agent_id), status: str | None = None, limit: int = 100, _: str = Depends(require_key)):
    db = SessionLocal()
    try:
        stmt = select(ProcessingJob).where(ProcessingJob.agent_id == agent_id)
        if status:
            stmt = stmt.where(ProcessingJob.status == status)
        rows = db.execute(stmt.order_by(ProcessingJob.created_at.desc()).limit(max(1, min(limit, 300)))).scalars().all()
        return {"results": [_job_dict(row) for row in rows]}
    finally:
        db.close()


@router.get("/health")
def runtime_health(_: str = Depends(require_key)):
    return {"ollama": ollama_health()}


@router.post("/jobs/{job_id}/retry")
def retry_job(job_id: str, agent_id: str = Depends(get_agent_id), _: str = Depends(require_key)):
    db = SessionLocal()
    try:
        job = db.get(ProcessingJob, job_id)
        if not job or job.agent_id != agent_id:
            raise HTTPException(404, "Processing job not found")
        evidence = db.get(EvidenceObject, job.evidence_id)
        if not evidence:
            raise HTTPException(404, "Evidence no longer exists")
        job.status = "pending"
        job.stage = "retry_queued"
        job.error = ""
        db.commit()
        return {"status": "queued", "job_id": job.id}
    finally:
        db.close()


@router.post("/evidence/{evidence_id}/invalidate")
def invalidate_evidence(evidence_id: str, reason: str, agent_id: str = Depends(get_agent_id), _: str = Depends(require_key)):
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
        episode_ids = [link.target_id for link in links if link.target_type == "episode"]
        analysis_links = db.execute(select(ObjectLink).where(ObjectLink.source_type == "episode", ObjectLink.source_id.in_(episode_ids), ObjectLink.target_type == "analysis")).scalars().all() if episode_ids else []
        affected_analysis_ids = [link.target_id for link in analysis_links]
        affected_memories = []
        if affected_analysis_ids:
            memory_links = db.execute(select(ObjectLink).where(ObjectLink.source_type == "analysis", ObjectLink.source_id.in_(affected_analysis_ids), ObjectLink.target_type == "memory")).scalars().all()
            for memory_link in memory_links:
                memory_link.confidence = 0.0
                memory_link.metadata_json = json.dumps({"invalidated": True, "reason": reason, "via": evidence_id})
                memory = db.get(Memory, memory_link.target_id)
                if memory and memory.source_type == "automatic_listener":
                    active_support = db.execute(select(ObjectLink).where(ObjectLink.target_type == "memory", ObjectLink.target_id == memory.id, ObjectLink.relationship == "supports", ObjectLink.confidence > 0)).scalars().all()
                    if not active_support:
                        mark_unsupported(db, memory, f"all evidence support invalidated: {reason}")
                        affected_memories.append(memory.id)
        db.commit()
        return {"status": "ok", "affected_links": len(links), "memories_needing_review": affected_memories}
    finally:
        db.close()
