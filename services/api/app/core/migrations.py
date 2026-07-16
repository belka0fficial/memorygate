"""Additive, idempotent schema patches for tables that existed before agent
isolation / observation lifecycle / the 4-type memory taxonomy / the
clarification-into-observation merge were added.

`Base.metadata.create_all` (called before this, in main.py) only creates
tables that don't exist yet — it never alters an existing table. A fresh
database gets the new columns for free straight from the model definitions.
An existing database needs these run once at startup to catch up.
"""
import json
import uuid
from sqlalchemy import text
from sqlalchemy.engine import Engine

_AGENT_ID_TABLES = ["memories", "entities", "observations", "patterns"]

# old 7-type taxonomy -> current 4-type taxonomy (see services/classifier.py)
_LEGACY_MEMORY_TYPE_MAP = {
    "stable_preference": "fact",
    "identity_trait": "fact",
    "humor_style": "fact",
    "temporary_phase": "phase",
    "support_context": "phase",
    "task_context": "context",
    "harmful_pattern": "watch",
}
_CURRENT_MEMORY_TYPES = ("fact", "phase", "context", "watch")

# pending_clarifications.status -> the observation.status its merged row gets
_CLARIFICATION_STATUS_MAP = {
    "pending": "unconfirmed",
    "asked": "unconfirmed",
    "resolved": "confirmed",
    "dismissed": "archived",
}


def run_migrations(engine: Engine) -> None:
    with engine.begin() as conn:
        for table in _AGENT_ID_TABLES:
            conn.execute(text(
                f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT 'default'"
            ))
            conn.execute(text(
                f"CREATE INDEX IF NOT EXISTS ix_{table}_agent_id ON {table} (agent_id)"
            ))

        _rename_column(conn, "entities", "conker_notes", "agent_notes")
        _rename_column(conn, "entities", "conker_summary", "agent_summary")

        conn.execute(text(
            "ALTER TABLE observations ADD COLUMN IF NOT EXISTS exposure_count INTEGER NOT NULL DEFAULT 0"
        ))
        conn.execute(text(
            "ALTER TABLE observations ADD COLUMN IF NOT EXISTS max_exposures INTEGER NOT NULL DEFAULT 5"
        ))
        conn.execute(text(
            "ALTER TABLE observations ADD COLUMN IF NOT EXISTS confirmation_count INTEGER NOT NULL DEFAULT 0"
        ))
        conn.execute(text(
            "ALTER TABLE observations ADD COLUMN IF NOT EXISTS trigger_context TEXT NOT NULL DEFAULT ''"
        ))
        conn.execute(text(
            "ALTER TABLE observations ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ"
        ))
        conn.execute(text(
            "ALTER TABLE observations ADD COLUMN IF NOT EXISTS archive_reason TEXT"
        ))

        _migrate_memory_types(conn)
        _migrate_clarifications(conn)


def _table_exists(conn, name: str) -> bool:
    return conn.execute(text(
        "SELECT 1 FROM information_schema.tables WHERE table_name = :t"
    ), {"t": name}).first() is not None


def _migrate_memory_types(conn) -> None:
    conn.execute(text(
        "ALTER TABLE memories ADD COLUMN IF NOT EXISTS do_not_generalize BOOLEAN NOT NULL DEFAULT false"
    ))
    conn.execute(text(
        "ALTER TABLE memories ADD COLUMN IF NOT EXISTS review_by TIMESTAMPTZ"
    ))

    # 'do_not_generalize' used to be (mis)written as a memory_type value by
    # some callers rather than the flag it always conceptually was - turn it
    # into the flag, with a neutral fallback type since the original intent
    # (what type it should have been) isn't recoverable from that alone.
    conn.execute(text(
        "UPDATE memories SET do_not_generalize = true, memory_type = 'context' "
        "WHERE memory_type = 'do_not_generalize'"
    ))

    # 'low_confidence' memories were never durable memories - they were
    # unconfirmed signals that landed in the wrong table. Move them to
    # observations (their proper home) instead of remapping their type.
    # Only columns that exist at this point in the migration sequence are
    # populated here; raise_condition/needs_clarification (added below by
    # _migrate_clarifications, which always runs after this) get their
    # column defaults applied retroactively to these rows too.
    low_confidence_rows = conn.execute(text(
        "SELECT id, agent_id, text, created_at FROM memories WHERE memory_type = 'low_confidence'"
    )).fetchall()
    for row in low_confidence_rows:
        conn.execute(text(
            """
            INSERT INTO observations (
                id, agent_id, session_id, observed_at, signal_type, description,
                raw_context, hypothesis, hypothesis_confidence, status, confirmed_by,
                entity_ids_json, related_observation_ids_json, confirmation_count,
                exposure_count, max_exposures, trigger_context
            ) VALUES (
                :id, :agent_id, '', :observed_at, 'verbal', :description,
                'migrated from a low_confidence memory row', '', 0.3, 'unconfirmed', '',
                '[]', '[]', 0, 0, 5, ''
            )
            """
        ), {
            "id": str(uuid.uuid4()),
            "agent_id": row.agent_id,
            "observed_at": row.created_at,
            "description": row.text,
        })
    if low_confidence_rows:
        conn.execute(text("DELETE FROM memories WHERE memory_type = 'low_confidence'"))

    for old_type, new_type in _LEGACY_MEMORY_TYPE_MAP.items():
        conn.execute(text(
            "UPDATE memories SET memory_type = :new WHERE memory_type = :old"
        ), {"new": new_type, "old": old_type})

    # anything still not one of the 4 current types (an unrecognized legacy
    # value) falls back to 'context' rather than being left in an invalid
    # state the dashboard's 4 badge colors don't know how to render.
    placeholders = ", ".join(f"'{t}'" for t in _CURRENT_MEMORY_TYPES)
    conn.execute(text(
        f"UPDATE memories SET memory_type = 'context' WHERE memory_type NOT IN ({placeholders})"
    ))

    # phase memories need a review_by; default anything migrated in without one
    conn.execute(text(
        "UPDATE memories SET review_by = created_at + interval '14 days' "
        "WHERE memory_type = 'phase' AND review_by IS NULL"
    ))

    conn.execute(text("ALTER TABLE memories DROP COLUMN IF EXISTS identity_weight"))


def _migrate_clarifications(conn) -> None:
    conn.execute(text(
        "ALTER TABLE observations ADD COLUMN IF NOT EXISTS raise_condition TEXT NOT NULL DEFAULT ''"
    ))
    conn.execute(text(
        "ALTER TABLE observations ADD COLUMN IF NOT EXISTS needs_clarification BOOLEAN NOT NULL DEFAULT false"
    ))

    if not _table_exists(conn, "pending_clarifications"):
        return

    # this table predates agent isolation too - make sure agent_id is
    # populated before reading it out below, same as every other legacy table.
    conn.execute(text(
        "ALTER TABLE pending_clarifications ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT 'default'"
    ))
    conn.execute(text(
        "ALTER TABLE pending_clarifications ADD COLUMN IF NOT EXISTS importance FLOAT NOT NULL DEFAULT 0.5"
    ))

    rows = conn.execute(text(
        "SELECT id, agent_id, session_id, observed_at, what_happened, hypotheses_json, "
        "status, resolved_answer, ask_after, importance, entity_ids_json, related_observation_ids_json "
        "FROM pending_clarifications"
    )).fetchall()

    for row in rows:
        raw_context = json.dumps({
            "migrated_from": "pending_clarifications",
            "hypotheses": json.loads(row.hypotheses_json) if row.hypotheses_json else [],
            "resolved_answer": row.resolved_answer,
            "importance": row.importance,
        })
        conn.execute(text(
            """
            INSERT INTO observations (
                id, agent_id, session_id, observed_at, signal_type, description,
                raw_context, hypothesis, hypothesis_confidence, status, confirmed_by,
                entity_ids_json, related_observation_ids_json, confirmation_count,
                exposure_count, max_exposures, trigger_context, raise_condition,
                needs_clarification
            ) VALUES (
                :id, :agent_id, :session_id, :observed_at, 'verbal', :description,
                :raw_context, '', :importance, :status, '',
                :entity_ids_json, :related_observation_ids_json, 0,
                0, 5, '', :raise_condition, true
            )
            """
        ), {
            "id": row.id,
            "agent_id": row.agent_id,
            "session_id": row.session_id,
            "observed_at": row.observed_at,
            "description": row.what_happened,
            "raw_context": raw_context,
            # hypothesis_confidence doubles as the importance-ordering signal
            # post-merge (see services/briefing.py) - importance was already 0-1.
            "importance": min(1.0, max(0.0, row.importance if row.importance is not None else 0.5)),
            "status": _CLARIFICATION_STATUS_MAP.get(row.status, "unconfirmed"),
            "entity_ids_json": row.entity_ids_json or "[]",
            "related_observation_ids_json": row.related_observation_ids_json or "[]",
            "raise_condition": row.ask_after or "",
        })

    conn.execute(text("DROP TABLE pending_clarifications"))


def _rename_column(conn, table: str, old: str, new: str) -> None:
    old_exists = conn.execute(text(
        "SELECT 1 FROM information_schema.columns WHERE table_name = :t AND column_name = :c"
    ), {"t": table, "c": old}).first()
    new_exists = conn.execute(text(
        "SELECT 1 FROM information_schema.columns WHERE table_name = :t AND column_name = :c"
    ), {"t": table, "c": new}).first()

    if old_exists and not new_exists:
        conn.execute(text(f"ALTER TABLE {table} RENAME COLUMN {old} TO {new}"))
