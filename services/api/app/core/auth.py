from fastapi import Header, HTTPException, Request
from app.core.db import SessionLocal
from app.services.auth_settings_service import clear_failed_attempts, get_auth_state, get_lockout_status, register_failed_attempt, verify_admin_key


def require_key(request: Request, x_memorygate_key: str | None = Header(None, alias="X-MemoryGate-Key")) -> str:
    """Auth is disabled only when neither an env key nor a DB-managed key exists."""
    client_host = request.client.host if request.client else "unknown"
    lock_scope = f"auth:{client_host}"
    db = SessionLocal()
    try:
        state = get_auth_state(db)
        if not state["auth_enabled"]:
            return "disabled"
        remaining = get_lockout_status(lock_scope)
        if remaining:
            raise HTTPException(429, f"Too many failed attempts. Try again in {remaining} seconds.")
        if not verify_admin_key(db, x_memorygate_key):
            remaining = register_failed_attempt(lock_scope)
            if remaining:
                raise HTTPException(429, f"Too many failed attempts. Try again in {remaining} seconds.")
            raise HTTPException(401, "missing or invalid X-MemoryGate-Key")
        clear_failed_attempts(lock_scope)
        return "admin"
    finally:
        db.close()
