import base64
import hashlib
import hmac
import re
import secrets
import time
from datetime import datetime, timezone
from app.core.config import MEMORYGATE_ADMIN_KEY
from app.models.auth_setting import AuthSetting
from app.models.agent_access_key import AgentAccessKey

_PBKDF2_ROUNDS = 200_000
_SINGLETON_ID = "singleton"
_MAX_FAILED_ATTEMPTS = 5
_LOCKOUT_SECONDS = 300
_attempt_state: dict[str, dict[str, float | int]] = {}


def _hash_key(key: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", key.encode("utf-8"), salt, _PBKDF2_ROUNDS)
    return f"{base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def _verify_key(key: str, encoded: str) -> bool:
    try:
        salt_b64, digest_b64 = encoded.split("$", 1)
        salt = base64.b64decode(salt_b64.encode())
        expected = base64.b64decode(digest_b64.encode())
    except Exception:
        return False
    actual = hashlib.pbkdf2_hmac("sha256", key.encode("utf-8"), salt, _PBKDF2_ROUNDS)
    return hmac.compare_digest(actual, expected)


def get_auth_row(db) -> AuthSetting | None:
    return db.get(AuthSetting, _SINGLETON_ID)


def get_auth_state(db) -> dict:
    row = get_auth_row(db)
    if row and row.admin_key_hash:
        return {"auth_enabled": True, "key_source": "database", "has_managed_key": True}
    if MEMORYGATE_ADMIN_KEY:
        return {"auth_enabled": True, "key_source": "environment", "has_managed_key": False}
    return {"auth_enabled": False, "key_source": "disabled", "has_managed_key": False}


def verify_admin_key(db, key: str | None) -> bool:
    row = get_auth_row(db)
    if row and row.admin_key_hash:
        return bool(key) and _verify_key(key, row.admin_key_hash)
    if not MEMORYGATE_ADMIN_KEY:
        return True
    return bool(key) and secrets.compare_digest(key, MEMORYGATE_ADMIN_KEY)


def validate_new_admin_key(key: str) -> str | None:
    if len(key) < 14:
        return "New key must be at least 14 characters long."
    if not re.search(r"[a-z]", key):
        return "New key must include at least one lowercase letter."
    if not re.search(r"[A-Z]", key):
        return "New key must include at least one uppercase letter."
    if not re.search(r"\d", key):
        return "New key must include at least one number."
    if not re.search(r"[^A-Za-z0-9]", key):
        return "New key must include at least one special character."
    return None


def set_admin_key(db, key: str) -> None:
    row = get_auth_row(db)
    if not row:
        row = AuthSetting(id=_SINGLETON_ID, admin_key_hash=_hash_key(key))
        db.add(row)
    else:
        row.admin_key_hash = _hash_key(key)
    db.commit()


def generate_admin_key(length: int = 24) -> str:
    return secrets.token_urlsafe(length)[:length]


def create_agent_access_key(db, label: str, agent_id: str) -> tuple[AgentAccessKey, str]:
    key = f"mg_read_{secrets.token_urlsafe(24)}"
    row = AgentAccessKey(label=label, agent_id=agent_id, key_hash=_hash_key(key))
    db.add(row)
    db.commit()
    db.refresh(row)
    return row, key


def verify_agent_access_key(db, key: str | None, agent_id: str) -> bool:
    if not key:
        return False
    rows = db.query(AgentAccessKey).filter(AgentAccessKey.agent_id == agent_id, AgentAccessKey.revoked.is_(False)).all()
    for row in rows:
        if _verify_key(key, row.key_hash):
            row.last_used_at = datetime.now(timezone.utc)
            db.commit()
            return True
    return False


def get_lockout_status(scope: str) -> int:
    state = _attempt_state.get(scope)
    if not state:
        return 0
    locked_until = float(state.get("locked_until", 0))
    now = time.time()
    if locked_until > now:
        return int(max(1, round(locked_until - now)))
    if locked_until:
        _attempt_state.pop(scope, None)
    return 0


def register_failed_attempt(scope: str) -> int:
    now = time.time()
    state = _attempt_state.get(scope, {"count": 0, "locked_until": 0.0})
    locked_until = float(state.get("locked_until", 0))
    if locked_until <= now:
        state["count"] = int(state.get("count", 0)) + 1
        state["locked_until"] = 0.0
    if int(state["count"]) >= _MAX_FAILED_ATTEMPTS:
        state["count"] = 0
        state["locked_until"] = now + _LOCKOUT_SECONDS
    _attempt_state[scope] = state
    return get_lockout_status(scope)


def clear_failed_attempts(scope: str) -> None:
    _attempt_state.pop(scope, None)
