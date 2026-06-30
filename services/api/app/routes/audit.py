from fastapi import APIRouter
from sqlalchemy import select
from app.core.db import SessionLocal
from app.models.audit import MemoryAudit

router = APIRouter(prefix="/audit", tags=["audit"])

@router.get("")
def list_audit():
    db = SessionLocal()
    try:
        rows = db.execute(
            select(MemoryAudit).order_by(MemoryAudit.created_at.desc())
        ).scalars().all()

        return [
            {
                "id": row.id,
                "action": row.action,
                "memory_id": row.memory_id,
                "payload_json": row.payload_json,
                "created_at": row.created_at,
            }
            for row in rows
        ]
    finally:
        db.close()
