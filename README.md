# MemoryGate

MemoryGate is the canonical long-term memory service for [Conker](https://github.com/belka0fficial/conker).
It is a FastAPI service backed by **Postgres** (structured data) and **Qdrant**
(vector search), and it is the single authority for durable memory in the
system — nothing else writes memory directly.

It is not meant to be called directly by Hermes. The real path is:

```
Hermes → terminal → conker-tool CLI → ToolGate → MemoryGate
```

ToolGate is the only caller that should ever hit this service's endpoints.

## Repo layout

```
services/api/
  app/
    main.py              FastAPI app, router wiring, startup hooks
    core/
      config.py           env-driven config (DATABASE_URL, QDRANT_URL, embed model)
      db.py                SQLAlchemy engine/session/Base
    models/                one file per table group (memory, entity, observation,
                            pattern, pending_clarification, audit)
    schemas/               pydantic request/response models, one per route group
    routes/                one router per resource: memory, entity, observation,
                            pattern, pending_clarification (clarification), audit
    services/
      classifier.py        keyword-based memory_type classifier
      scoring.py            memory_rank_bonus / memory_strength weighting
      embeddings.py          sentence-transformers wrapper (lru-cached model)
      qdrant_store.py         Qdrant collection + upsert/search/near-duplicate
      qdrant_stub.py           unused no-op stand-in for qdrant_store
  requirements.txt
  Dockerfile
  run.sh                  local dev entrypoint (uvicorn --reload, port 8020)
docker-compose.yml        standalone postgres + qdrant for local dev (no api
                           service — see "Running" below)
```

In production (Conker's own `docker-compose.yml`), MemoryGate is built from
`services/api` and run as the `memorygate` container against
`memorygate-db` (Postgres) and `qdrant` — both defined in Conker's compose
file, not this repo's.

## Data model (Postgres)

| Table | Purpose |
|---|---|
| `memories` | Durable facts/preferences about Alexey. Has `memory_type`, `source_type`, `confidence`, `identity_weight`, `tags_json`, `created_at`/`updated_at`. |
| `memory_audit` | Append-only log of every `write`/`upgrade` action against `memories`. |
| `entities` | Structured world model: people, projects, places, concepts. Has `attributes_json` (freeform JSONB-style blob), `conker_notes` (private reasoning) and `conker_summary` (surfaced summary) as separate fields, `importance_level`. |
| `entity_edges` | Typed, directional relationships between entities (`relationship_type`, `strength` 0–1, `since_when`). |
| `entity_events` | Discrete things that happened to/with an entity (`event_type`, `emotional_weight`). |
| `entity_history` | Full audit trail of entity field changes (`old_value_json`/`new_value_json`, `change_reason`, `triggered_by`). |
| `observations` | Single, not-yet-confirmed signal instances. `signal_type` is one of verbal / tonal / behavioral / physical / timing. `status` is unconfirmed / confirmed / rejected. Carries a `hypothesis` + `hypothesis_confidence`. |
| `patterns` | Regularities promoted from 3+ observations. Tracks `instance_count`/`confirmation_count`/`contradiction_count`, `status` (candidate / active / deprecated / contradicted), `promoted_at`. |
| `pending_clarifications` | Ambiguous signals queued to ask about later instead of guessing. `status` is pending / asked / resolved / dismissed, with `ask_after` gating when it's safe to bring up. |

All list-typed and freeform fields are stored as JSON text columns
(`*_json`) and deserialized on read — there's no native array/JSONB typing
in play, just `Text` columns holding `json.dumps(...)` output.

## Vector store (Qdrant)

- One collection, name from `QDRANT_COLLECTION` (default `memories`).
- Embeddings: `sentence-transformers/all-MiniLM-L6-v2`, 384-dim, **cosine** distance.
- The embedding model is loaded once (`lru_cache`) and warmed up on startup
  (`app/main.py` calls `embed_text("warmup")`).
- Every memory write upserts a Qdrant point keyed by the memory's Postgres
  `id`, with `memory_type`/`source_type`/`confidence`/`identity_weight`/`tags`
  as payload.
- `/memory/search` embeds the query, does a Qdrant similarity search for
  candidate IDs, then re-scores/reorders them using Postgres data (see
  Scoring below). If Qdrant returns nothing (e.g. empty collection) it falls
  back to a plain `ILIKE` substring search over `memories.text`.
- Only entities and observations that live in Postgres are graph/relational —
  Qdrant only ever indexes `memories.text`. Entities have no embeddings.

## Memory classification

`services/classifier.py` is a **keyword-matching classifier**, not an LLM
call. Given `text` (and `source_type`, currently unused by the logic), it
returns one of five `memory_type`s, first match wins:

| memory_type | Trigger keywords (case-insensitive) | confidence | identity_weight |
|---|---|---|---|
| `humor_style` | "dark humor", "sarcasm", "deadpan", "joke style", "humor style" | medium | medium |
| `stable_preference` | ("i prefer"/"prefers"/"my favorite"/"i like"/"always"/"usually") AND ("build"/"workflow"/"before"/"architecture"/"sidecars") | medium | medium |
| `identity_trait` | "i am", "i'm", "my personality", "my style" | medium | medium |
| `temporary_phase` | "i hate everyone", "i want to disappear", "nothing matters", "i'm exhausted" | low | low |
| `task_context` (default/fallback) | none of the above matched | medium | low |

The caller (ToolGate/Hermes) can also pass explicit `memory_type` /
`confidence` / `identity_weight` in the write payload, which override the
classifier's guess.

## Scoring (`services/scoring.py`)

`memory_rank_bonus(memory_type, identity_weight, confidence)` sums three
independent weights:

```
type_bonus:       stable_preference 0.45, identity_trait 0.35, humor_style 0.20,
                   task_context 0.10, temporary_phase -0.10 (else 0.0)
identity_bonus:    high 0.25, medium 0.10, low 0.0
confidence_bonus:  high 0.20, medium 0.10, low 0.0
```

This score (aka "memory strength") is used two places:

1. **Search ranking** — `/memory/search` blends Qdrant's vector-rank
   position, this strength bonus, and a couple of hardcoded lexical
   boosts (keyword hits for "humor"/"sidecar"/"architecture"/etc.) into a
   single sort key.
2. **Write-time upgrade decisions** — when a new write duplicates an
   existing memory (exact text match, or vector cosine similarity ≥ 0.92),
   MemoryGate doesn't create a second row. It compares the strength of the
   existing memory against the strength implied by the new write, and only
   overwrites `memory_type`/`confidence`/`identity_weight`/`summary` if the
   new value scores higher. Tags are always merged (union, order-preserving)
   regardless of whether the type/confidence upgrade happens. Every upgrade
   or fresh write is logged to `memory_audit`.

## API

Base URL in-cluster: `http://memorygate:8020`. All routes are JSON in,
JSON out.

### `/memory`
- `POST /memory/write` — `{text, source_type?, memory_type?, confidence?, identity_weight?, tags?}` → classifies (or accepts overrides), dedupes (exact text, then vector similarity ≥0.92), upgrades or inserts, returns `{status, id, memory_type, summary, upgraded?, duplicate_of?, near_duplicate_of?, similarity?}`.
- `POST /memory/search` — `{query}` → Qdrant nearest-neighbor + rescoring, or ILIKE fallback. Returns `{results: [...]}`.
- `GET /memory` — last 100 memories, newest first.
- `GET /memory/{id}` — single memory, 404 if missing.

### `/entity`
- `POST /entity/create`
- `GET /entity/{id}`
- `POST /entity/search` — `{query, entity_type?}`, matches name/description/conker_summary/conker_notes via ILIKE.
- `PATCH /entity/{id}` and `POST /entity/update` (`{entity_id, ...}`) — both do the same partial update + write an `entity_history` row. Two paths exist for legacy-tool-call compatibility (see `entity.update2` in ToolGate).
- `POST /entity/link` — create a typed `entity_edges` row between two existing entities.
- `GET /entity/{id}/edges`
- `POST /entity/event` — append an `entity_events` row.
- `GET /entity/{id}/events`
- `GET /entity/{id}/history` — full `entity_history` audit trail.

### `/observation`
- `POST /observation/create`
- `POST /observation/search` — `{query?, signal_type?, status?, entity_id?}`, filtered/substring-matched in Python (no SQL LIKE), capped at 50 results.
- `GET /observation/{id}`
- `POST /observation/update/{id}` — partial update (status, hypothesis, hypothesis_confidence, confirmed_by, related_observation_ids).

### `/pattern`
- `POST /pattern/create`
- `POST /pattern/search` — same query/status/entity_id filtering style as observations.
- `GET /pattern/{id}`
- `POST /pattern/update/{id}` — partial update; flips `promoted_at` to now if status transitions to `active` and wasn't set before.
- `POST /pattern/promote` — `{pattern_name, query?, entity_id?, min_observations=3, confidence=0.75, interpretation?, recommended_action?}`. Scans observations matching the filter; if fewer than `min_observations` match, returns `{status: "not_enough_evidence", matched_count, required}` instead of creating anything. Otherwise creates a `Pattern` row, auto-`active`+`promoted_at` if `confidence >= 0.85`, else `candidate`.

### `/clarification` (backed by `pending_clarifications`)
- `POST /clarification/create`
- `POST /clarification/search` — query is tokenized and every token must appear somewhere in the haystack (AND match, not substring).
- `GET /clarification/{id}`
- `POST /clarification/update` — `{clarification_id, ...}` partial update.

### `/audit`
- `GET /audit` — all `memory_audit` rows, newest first. No pagination/filtering.

### `/health`
- `GET /health` → `{"status": "ok"}`.

## Config (env vars)

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://memorygate:memorygate_dev_password@memorygate-db:5432/memorygate` | Postgres connection string |
| `QDRANT_URL` | `http://qdrant:6333` | Qdrant endpoint |
| `QDRANT_COLLECTION` | `memories` | Qdrant collection name |
| `EMBED_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` | HF model id for embeddings |
| `EMBED_DIMENSION` | `384` | Must match the embedding model's output size |

Defaults assume Docker Compose networking (service name `memorygate-db`,
not `localhost`). In Conker's production compose file, `DATABASE_URL` points
at `memorygate-db` and `QDRANT_URL` at `qdrant` (both sibling containers on
`conker_net`).

## Running

**This repo's own `docker-compose.yml`** only stands up Postgres
(`memorygate-postgres`, host port 5434) and Qdrant (`memorygate-qdrant`,
host ports 6335/6336) for local development — there's no `api` service in
it. Run the FastAPI app itself with:

```bash
cd services/api
docker compose -f ../../docker-compose.yml up -d   # postgres + qdrant
./run.sh                                            # uvicorn --reload on :8020, needs .venv
```

`run.sh` expects a `.venv` already created with `requirements.txt`
installed, and reads `DATABASE_URL`/`QDRANT_URL` from `services/api/.env`
(gitignored) or falls back to the Docker Compose service-name defaults in
`core/config.py`, which won't resolve outside a Docker network — override
them to point at `localhost:5434` / `localhost:6335` for a bare local run.

**In production**, MemoryGate is built and run from Conker's own
`docker-compose.yml` (`memorygate` service), alongside `memorygate-db` and
`qdrant`, on the `conker_net` Docker network. Tables are created
automatically on startup via `Base.metadata.create_all` — there is no
separate migration tool or migration files in this repo; schema changes are
plain SQLAlchemy model edits that `create_all` picks up additively (it
cannot alter or drop existing columns).

## Notable gaps / rough edges

- `qdrant_stub.py` is dead code — an unused no-op stand-in for
  `qdrant_store.py`, never imported anywhere.
- No auth on any route. MemoryGate trusts its caller (ToolGate) completely;
  it has no notion of who's asking.
- `classifier.py` is pure keyword matching, not a model call — it will
  misclassify anything that doesn't hit its literal trigger phrases,
  silently falling back to `task_context`.
- Memories don't carry `entity_ids` — there's no schema link from a memory
  row to the entities it's about, so memory↔entity graph edges (e.g. in
  Conker's dashboard) can't be drawn from this data today.
- `/observation/search`, `/pattern/search`, and `/clarification/search`
  all load their full table and filter/substring-match in Python rather
  than in SQL — fine at current scale, won't scale past a few thousand rows.
- Two entity-update routes (`PATCH /entity/{id}` and `POST /entity/update`)
  do the exact same thing; kept for caller compatibility, not because they
  diverge in behavior.
