from fastapi import Header

DEFAULT_AGENT_ID = "default"


def get_agent_id(x_agent_id: str = Header(default=DEFAULT_AGENT_ID, alias="X-Agent-Id")) -> str:
    """FastAPI dependency: resolves the caller's agent_id from the X-Agent-Id header."""
    return x_agent_id or DEFAULT_AGENT_ID


def resolve_agent_id(header_agent_id: str, payload_agent_id: str | None) -> str:
    """Body-level agent_id (when a schema carries one) always wins over the header."""
    return payload_agent_id or header_agent_id or DEFAULT_AGENT_ID
