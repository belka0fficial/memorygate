import json
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy import select, or_
from app.core.db import SessionLocal
from app.core.agent import get_agent_id, resolve_agent_id
from app.models.entity import Entity, EntityEdge, EntityEvent, EntityHistory
from app.schemas.entity import (
    EntityCreateRequest,
    EntityUpdateRequest,
    EntitySearchRequest,
    EntityLinkRequest,
    EntityEventCreateRequest,
    EntityUpdateByIdRequest,
)

router = APIRouter(prefix="/entity", tags=["entity"])

def _entity_to_dict(row: Entity) -> dict:
    return {
        "id": row.id,
        "agent_id": row.agent_id,
        "entity_type": row.entity_type,
        "name": row.name,
        "description": row.description,
        "tags": json.loads(row.tags_json),
        "attributes": json.loads(row.attributes_json),
        "agent_notes": row.agent_notes,
        "agent_summary": row.agent_summary,
        "importance_level": row.importance_level,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }

def _get_owned_entity(db, entity_id: str, agent_id: str) -> Entity:
    row = db.get(Entity, entity_id)
    if not row or row.agent_id != agent_id:
        raise HTTPException(404, "Entity not found")
    return row

@router.get("")
def list_entities(agent_id: str = Depends(get_agent_id)):
    db = SessionLocal()
    try:
        rows = db.execute(
            select(Entity).where(Entity.agent_id == agent_id).order_by(Entity.updated_at.desc()).limit(100)
        ).scalars().all()
        return [_entity_to_dict(row) for row in rows]
    finally:
        db.close()

@router.post("/create")
def create_entity(payload: EntityCreateRequest, header_agent_id: str = Depends(get_agent_id)):
    agent_id = resolve_agent_id(header_agent_id, payload.agent_id)
    db = SessionLocal()
    try:
        entity = Entity(
            agent_id=agent_id,
            entity_type=payload.entity_type,
            name=payload.name,
            description=payload.description,
            tags_json=json.dumps(payload.tags),
            attributes_json=json.dumps(payload.attributes),
            agent_notes=payload.agent_notes,
            agent_summary=payload.agent_summary,
            importance_level=payload.importance_level,
        )
        db.add(entity)
        db.commit()
        db.refresh(entity)

        db.add(EntityHistory(
            entity_id=entity.id,
            changed_field="entity_created",
            old_value_json="null",
            new_value_json=json.dumps(_entity_to_dict(entity)),
            change_reason="entity created",
            triggered_by="system",
        ))
        db.commit()

        return {"status": "ok", "entity": _entity_to_dict(entity)}
    finally:
        db.close()

@router.delete("/{entity_id}")
def delete_entity(entity_id: str, agent_id: str = Depends(get_agent_id)):
    db = SessionLocal()
    try:
        row = _get_owned_entity(db, entity_id, agent_id)
        db.delete(row)
        db.commit()
        return {"status": "ok"}
    finally:
        db.close()

@router.get("/{entity_id}")
def get_entity(entity_id: str, agent_id: str = Depends(get_agent_id)):
    db = SessionLocal()
    try:
        row = _get_owned_entity(db, entity_id, agent_id)
        return _entity_to_dict(row)
    finally:
        db.close()

@router.post("/search")
def search_entities(payload: EntitySearchRequest, header_agent_id: str = Depends(get_agent_id)):
    agent_id = resolve_agent_id(header_agent_id, payload.agent_id)
    db = SessionLocal()
    try:
        stmt = select(Entity).where(
            Entity.agent_id == agent_id,
            or_(
                Entity.name.ilike(f"%{payload.query}%"),
                Entity.description.ilike(f"%{payload.query}%"),
                Entity.agent_summary.ilike(f"%{payload.query}%"),
                Entity.agent_notes.ilike(f"%{payload.query}%"),
            )
        )
        if payload.entity_type:
            stmt = stmt.where(Entity.entity_type == payload.entity_type)

        rows = db.execute(stmt.order_by(Entity.updated_at.desc()).limit(20)).scalars().all()
        return {"results": [_entity_to_dict(row) for row in rows]}
    finally:
        db.close()

@router.patch("/{entity_id}")
def update_entity(entity_id: str, payload: EntityUpdateRequest, agent_id: str = Depends(get_agent_id)):
    db = SessionLocal()
    try:
        row = _get_owned_entity(db, entity_id, agent_id)

        before = _entity_to_dict(row)

        if payload.name is not None:
            row.name = payload.name
        if payload.description is not None:
            row.description = payload.description
        if payload.tags is not None:
            row.tags_json = json.dumps(payload.tags)
        if payload.attributes is not None:
            row.attributes_json = json.dumps(payload.attributes)
        if payload.agent_notes is not None:
            row.agent_notes = payload.agent_notes
        if payload.agent_summary is not None:
            row.agent_summary = payload.agent_summary
        if payload.importance_level is not None:
            row.importance_level = payload.importance_level

        db.commit()
        db.refresh(row)

        after = _entity_to_dict(row)

        db.add(EntityHistory(
            entity_id=row.id,
            changed_field="entity_updated",
            old_value_json=json.dumps(before),
            new_value_json=json.dumps(after),
            change_reason=payload.change_reason,
            triggered_by=payload.triggered_by,
        ))
        db.commit()

        return {"status": "ok", "entity": after}
    finally:
        db.close()

@router.post("/link")
def link_entities(payload: EntityLinkRequest, agent_id: str = Depends(get_agent_id)):
    db = SessionLocal()
    try:
        _get_owned_entity(db, payload.from_entity_id, agent_id)
        _get_owned_entity(db, payload.to_entity_id, agent_id)

        edge = EntityEdge(
            from_entity_id=payload.from_entity_id,
            to_entity_id=payload.to_entity_id,
            relationship_type=payload.relationship_type,
            strength=payload.strength,
            direction=payload.direction,
            notes=payload.notes,
            since_when=payload.since_when,
        )
        db.add(edge)
        db.commit()

        return {
            "status": "ok",
            "edge": {
                "id": edge.id,
                "from_entity_id": edge.from_entity_id,
                "to_entity_id": edge.to_entity_id,
                "relationship_type": edge.relationship_type,
                "strength": edge.strength,
                "direction": edge.direction,
                "notes": edge.notes,
                "since_when": edge.since_when,
            },
        }
    finally:
        db.close()

@router.get("/{entity_id}/edges")
def get_entity_edges(entity_id: str, agent_id: str = Depends(get_agent_id)):
    db = SessionLocal()
    try:
        _get_owned_entity(db, entity_id, agent_id)

        rows = db.execute(
            select(EntityEdge).where(
                or_(
                    EntityEdge.from_entity_id == entity_id,
                    EntityEdge.to_entity_id == entity_id,
                )
            )
        ).scalars().all()

        return {
            "results": [
                {
                    "id": row.id,
                    "from_entity_id": row.from_entity_id,
                    "to_entity_id": row.to_entity_id,
                    "relationship_type": row.relationship_type,
                    "strength": row.strength,
                    "direction": row.direction,
                    "notes": row.notes,
                    "since_when": row.since_when,
                }
                for row in rows
            ]
        }
    finally:
        db.close()

@router.post("/event")
def create_entity_event(payload: EntityEventCreateRequest, agent_id: str = Depends(get_agent_id)):
    db = SessionLocal()
    try:
        _get_owned_entity(db, payload.entity_id, agent_id)

        event = EntityEvent(
            entity_id=payload.entity_id,
            event_type=payload.event_type,
            description=payload.description,
            emotional_weight=payload.emotional_weight,
            occurred_at=payload.occurred_at,
        )
        db.add(event)
        db.commit()
        db.refresh(event)

        return {
            "status": "ok",
            "event": {
                "id": event.id,
                "entity_id": event.entity_id,
                "event_type": event.event_type,
                "description": event.description,
                "emotional_weight": event.emotional_weight,
                "occurred_at": event.occurred_at,
            },
        }
    finally:
        db.close()

@router.get("/{entity_id}/events")
def get_entity_events(entity_id: str, agent_id: str = Depends(get_agent_id)):
    db = SessionLocal()
    try:
        _get_owned_entity(db, entity_id, agent_id)

        rows = db.execute(
            select(EntityEvent).where(EntityEvent.entity_id == entity_id).order_by(EntityEvent.created_at.desc())
        ).scalars().all()

        return {
            "results": [
                {
                    "id": row.id,
                    "entity_id": row.entity_id,
                    "event_type": row.event_type,
                    "description": row.description,
                    "emotional_weight": row.emotional_weight,
                    "occurred_at": row.occurred_at,
                }
                for row in rows
            ]
        }
    finally:
        db.close()

@router.get("/{entity_id}/history")
def get_entity_history(entity_id: str, agent_id: str = Depends(get_agent_id)):
    db = SessionLocal()
    try:
        _get_owned_entity(db, entity_id, agent_id)

        rows = db.execute(
            select(EntityHistory).where(EntityHistory.entity_id == entity_id).order_by(EntityHistory.snapshot_at.desc())
        ).scalars().all()

        return {
            "results": [
                {
                    "id": row.id,
                    "entity_id": row.entity_id,
                    "changed_field": row.changed_field,
                    "old_value": json.loads(row.old_value_json),
                    "new_value": json.loads(row.new_value_json),
                    "change_reason": row.change_reason,
                    "triggered_by": row.triggered_by,
                    "snapshot_at": row.snapshot_at.isoformat() if row.snapshot_at else None,
                }
                for row in rows
            ]
        }
    finally:
        db.close()


@router.post("/update")
def update_entity_by_id(payload: EntityUpdateByIdRequest, agent_id: str = Depends(get_agent_id)):
    db = SessionLocal()
    try:
        row = _get_owned_entity(db, payload.entity_id, agent_id)

        before = _entity_to_dict(row)

        if payload.name is not None:
            row.name = payload.name
        if payload.description is not None:
            row.description = payload.description
        if payload.tags is not None:
            row.tags_json = json.dumps(payload.tags)
        if payload.attributes is not None:
            row.attributes_json = json.dumps(payload.attributes)
        if payload.agent_notes is not None:
            row.agent_notes = payload.agent_notes
        if payload.agent_summary is not None:
            row.agent_summary = payload.agent_summary
        if payload.importance_level is not None:
            row.importance_level = payload.importance_level

        db.commit()
        db.refresh(row)

        after = _entity_to_dict(row)

        db.add(EntityHistory(
            entity_id=row.id,
            changed_field="entity_updated",
            old_value_json=json.dumps(before),
            new_value_json=json.dumps(after),
            change_reason=payload.change_reason,
            triggered_by=payload.triggered_by,
        ))
        db.commit()

        return {"status": "ok", "entity": after}
    finally:
        db.close()
