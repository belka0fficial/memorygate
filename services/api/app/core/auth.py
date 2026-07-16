import secrets
from fastapi import Header, HTTPException
from app.core.config import MEMORYGATE_ADMIN_KEY


def require_key(x_memorygate_key: str | None = Header(None, alias="X-MemoryGate-Key")) -> str:
    """No key configured (MEMORYGATE_ADMIN_KEY unset) disables auth entirely - dev convenience,
    matching this service's existing no-auth default. Once a key is configured, every route
    routed through this dependency requires it, except /health."""
    if not MEMORYGATE_ADMIN_KEY:
        return "disabled"
    if not x_memorygate_key or not secrets.compare_digest(x_memorygate_key, MEMORYGATE_ADMIN_KEY):
        raise HTTPException(401, "missing or invalid X-MemoryGate-Key")
    return "admin"
