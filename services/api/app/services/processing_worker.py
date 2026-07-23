import json
import threading
import time
from sqlalchemy import select
from app.core.config import PROCESSING_POLL_SECONDS
from app.core.db import SessionLocal
from app.models.evidence_object import EvidenceObject
from app.models.processing_job import ProcessingJob
from app.services.runtime_pipeline import process_evidence

_stop = threading.Event()
_thread: threading.Thread | None = None


def _run() -> None:
    while not _stop.is_set():
        db = SessionLocal()
        try:
            job = db.execute(select(ProcessingJob).where(ProcessingJob.status == "pending").order_by(ProcessingJob.created_at.asc()).limit(1)).scalar_one_or_none()
            if job:
                evidence = db.get(EvidenceObject, job.evidence_id)
                if not evidence:
                    job.status = "failed"
                    job.error = "evidence no longer exists"
                    db.commit()
                else:
                    content = json.loads(evidence.normalized_payload_json or "{}").get("content") or evidence.summary
                    process_evidence(db, evidence, content, job)
        except Exception:
            db.rollback()
        finally:
            db.close()
        _stop.wait(PROCESSING_POLL_SECONDS)


def start_worker() -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_run, name="memorygate-processing", daemon=True)
    _thread.start()


def stop_worker() -> None:
    _stop.set()
