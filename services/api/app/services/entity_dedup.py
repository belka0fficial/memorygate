"""Dedup check for entity creation - exact name match first, then embedding
similarity, scoped to (agent_id, entity_type) so e.g. a person and a project
that happen to share a name never collide."""
from sqlalchemy import select, func
from app.models.entity import Entity
from app.services.qdrant_store import find_similar_entities

DEDUP_SIMILARITY_THRESHOLD = 0.9


def _normalize(name: str) -> str:
    return " ".join(name.strip().lower().split())


def find_duplicate(db, agent_id: str, entity_type: str, name: str) -> Entity | None:
    normalized = _normalize(name)
    exact = db.execute(
        select(Entity).where(
            Entity.agent_id == agent_id,
            Entity.entity_type == entity_type,
            func.lower(func.trim(Entity.name)) == normalized,
        )
    ).scalars().first()
    if exact:
        return exact

    hits = find_similar_entities(name, agent_id=agent_id, entity_type=entity_type, limit=1)
    if hits and hits[0]["score"] >= DEDUP_SIMILARITY_THRESHOLD:
        return db.get(Entity, hits[0]["id"])

    return None
