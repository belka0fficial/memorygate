"""Additive, idempotent schema patches for tables that existed before agent
isolation / observation lifecycle / clarification importance were added.

`Base.metadata.create_all` (called before this, in main.py) only creates
tables that don't exist yet — it never alters an existing table. A fresh
database gets the new columns for free straight from the model definitions.
An existing database needs these run once at startup to catch up.
"""
from sqlalchemy import text
from sqlalchemy.engine import Engine

_AGENT_ID_TABLES = ["memories", "entities", "observations", "patterns", "pending_clarifications"]


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

        conn.execute(text(
            "ALTER TABLE pending_clarifications ADD COLUMN IF NOT EXISTS importance FLOAT NOT NULL DEFAULT 0.5"
        ))


def _rename_column(conn, table: str, old: str, new: str) -> None:
    old_exists = conn.execute(text(
        "SELECT 1 FROM information_schema.columns WHERE table_name = :t AND column_name = :c"
    ), {"t": table, "c": old}).first()
    new_exists = conn.execute(text(
        "SELECT 1 FROM information_schema.columns WHERE table_name = :t AND column_name = :c"
    ), {"t": table, "c": new}).first()

    if old_exists and not new_exists:
        conn.execute(text(f"ALTER TABLE {table} RENAME COLUMN {old} TO {new}"))
