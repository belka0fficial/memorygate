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
      config.py           env-driven config (DATABASE_URL, QDRANT_URL, embed model, admin key)
      db.py                SQLAlchemy engine/session/Base
      agent.py              X-Agent-Id / agent_id resolution (FastAPI dependency)
      auth.py                X-MemoryGate-Key check (FastAPI dependency), no-op if unset
      migrations.py           additive ALTER TABLE patches for pre-existing databases
    models/                one file per table group (memory, entity, observation,
                            pattern, agent_config, session_transcript, audit)
    schemas/               pydantic request/response models, one per route group
    routes/                one router per resource: memory, entity, observation,
                            pattern, agent_config, briefing, transcript, audit
    services/
      classifier.py        keyword-based memory_type classifier (4 types)
      scoring.py            memory_rank_bonus / memory_strength weighting
      embeddings.py          sentence-transformers wrapper (lru-cached model)
      qdrant_store.py         Qdrant collection + upsert/search/near-duplicate
      qdrant_stub.py           unused no-op stand-in for qdrant_store
      signal_filter.py         value/novelty scoring gate on memory writes
      observation_lifecycle.py dedup/budget/exposure for observations
      pattern_promotion.py      auto-promotes observation clusters into patterns
      briefing.py                builds the GET /briefing/{agent_id} object
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

## Agent isolation

Every caller identifies itself with an `agent_id` — either the `X-Agent-Id`
header on any request, or an `agent_id` field in the JSON body (body wins
over header when both are present). Callers that don't send one fall back
to `agent_id="default"`, which keeps old integrations working unchanged.

`memories`, `entities`, `observations`, `patterns`, and
`session_transcripts` all carry an `agent_id` column, and every query
against them is scoped to the caller's `agent_id` — including get-by-id
routes, which 404 (not 403) on a row that belongs to a different agent, so
one agent can't enumerate another's data. Qdrant payloads carry `agent_id`
too, and every vector search filters on it. `entity_edges`,
`entity_events`, and `entity_history` aren't scoped directly — they inherit
isolation from the `entity_id` they hang off (ownership is checked before
they're read or written).

Per-agent write-time behavior (signal filter thresholds, observation
budget) is configurable via `GET`/`PUT /config/{agent_id}` — see
"Signal filter" and "Observation lifecycle" below.

## Authentication

Optional, off by default. If `MEMORYGATE_ADMIN_KEY` is unset, `core/auth.py`'s
`require_key` dependency is a no-op and every route behaves as before
(the historical no-auth default). Set it and every route except `/health`
requires it as the `X-MemoryGate-Key` header, checked with
`secrets.compare_digest` (constant-time, mirrors ToolGate's own key-auth
pattern exactly — same header-based approach, same comparison function).
Wrong or missing key → `401`.

`GET /auth/check` is the only route that exists purely for this: the
dashboard's login screen calls it with whatever key the user typed, and a
`200` (vs `401`) is how it decides whether to unlock. It returns
`{"tier": "admin"}` on success or `{"tier": "disabled"}` when no key is
configured at all.

This is a single shared secret, not per-agent auth — it gates the whole
API, orthogonal to the per-agent isolation above. A caller with the right
key can still declare (and thus act as) any `agent_id` it wants; the key
only proves the caller is allowed to talk to MemoryGate at all.

## Data model (Postgres)

| Table | Purpose |
|---|---|
| `memories` | Durable facts/preferences. Has `agent_id`, `memory_type` (`fact` / `phase` / `context` / `watch`), `source_type`, `confidence`, `do_not_generalize`, `review_by` (required in practice for `phase`, optional otherwise), `tags_json`, `created_at`/`updated_at`. |
| `memory_audit` | Append-only log of every `write`/`upgrade`/`edit`/`delete`/`filtered` action against `memories`. |
| `entities` | Structured world model: people, projects, places, concepts. Has `agent_id`, `attributes_json` (freeform JSONB-style blob), `agent_notes` (private reasoning) and `agent_summary` (surfaced summary) as separate fields, `importance_level`. |
| `entity_edges` | Typed, directional relationships between entities (`relationship_type`, `strength` 0–1, `since_when`). |
| `entity_events` | Discrete things that happened to/with an entity (`event_type`, `emotional_weight`). |
| `entity_history` | Full audit trail of entity field changes (`old_value_json`/`new_value_json`, `change_reason`, `triggered_by`). |
| `observations` | Single signal instances - also where former clarifications live now. Has `agent_id`, `signal_type` (verbal / tonal / behavioral / physical / timing / anything else the caller passes), `status` (unconfirmed / confirmed / contradicted / archived), `hypothesis` + `hypothesis_confidence`, `confirmation_count`, `exposure_count`/`max_exposures`, `trigger_context`, `archived_at`/`archive_reason`, `raise_condition` (when to surface this) + `needs_clarification` (bool). |
| `patterns` | Regularities promoted from 3+ observations. Has `agent_id`, tracks `instance_count`/`confirmation_count`/`contradiction_count`, `status` (candidate / active / deprecated / contradicted), `promoted_at`. |
| `agent_configs` | Per-agent signal filter / observation budget settings: `novelty_threshold`, `value_threshold`, `max_observations`, `signal_filter_enabled`. Row is created with defaults on first read/write for a new `agent_id`. |
| `session_transcripts` | Full session transcripts - the "remember everything" layer, never scored/filtered/deleted by anything else in this service. Has `agent_id`, `session_id` (from Hermes `state.db`), `transcript`, `session_start`/`session_end`, `word_count`, `processed_by_soulgate`. |

`pending_clarifications` is gone - clarifications merged into `observations`
(see "Observation lifecycle" below).

All list-typed and freeform fields are stored as JSON text columns
(`*_json`) and deserialized on read — there's no native array/JSONB typing
in play, just `Text` columns holding `json.dumps(...)` output.

Because `Base.metadata.create_all` only creates missing tables and never
alters existing ones, `app/core/migrations.py` runs on every startup right
after `create_all` and additively patches older databases: adds the
`agent_id` columns, renames `entities.conker_notes`/`conker_summary` to
`agent_notes`/`agent_summary`, adds the observation-lifecycle columns,
remaps the old 9-value `memory_type` taxonomy onto the current 4 types
(moving `low_confidence` rows to `observations` instead, and turning
`memory_type='do_not_generalize'` rows into the `do_not_generalize` flag),
drops `memories.identity_weight`, and migrates `pending_clarifications`
rows into `observations` before dropping that table entirely. All of it is
`IF NOT EXISTS`/existence-checked, so it's a no-op on a fresh database
(which already gets the current schema straight from the model
definitions) and safe to run repeatedly.

## Vector store (Qdrant)

- One collection, name from `QDRANT_COLLECTION` (default `memories`).
- Embeddings: `sentence-transformers/all-MiniLM-L6-v2`, 384-dim, **cosine** distance.
- The embedding model is loaded once (`lru_cache`) and warmed up on startup
  (`app/main.py` calls `embed_text("warmup")`).
- Every memory write upserts a Qdrant point keyed by the memory's Postgres
  `id`, with `memory_type`/`source_type`/`confidence`/`tags` as payload.
- `/memory/search` embeds the query, does a Qdrant similarity search for
  candidate IDs, then re-scores/reorders them using Postgres data (see
  Scoring below). If Qdrant returns nothing (e.g. empty collection) it falls
  back to a plain `ILIKE` substring search over `memories.text`.
- Only entities and observations that live in Postgres are graph/relational —
  Qdrant only ever indexes `memories.text`. Entities have no embeddings.

## Memory classification

Four memory types: **`fact`** (durable preferences/identity/humor-style),
**`phase`** (temporary emotional/circumstantial states - carries a
`review_by`), **`context`** (default/fallback, everyday task info), and
**`watch`** (behavioral patterns worth monitoring). This used to be seven
finer-grained types; `services/classifier.py`'s underlying keyword-signal
detectors are unchanged from that version, just aggregated into fewer
output buckets (`stable_preference`/`identity_trait`/`humor_style` → `fact`,
`temporary_phase`/`support_context` → `phase`, `task_context` → `context`,
`harmful_pattern` → `watch`).

Still a **scored multi-signal keyword classifier**, not an LLM call. Each
candidate type is defined by one or more independent keyword-list
"signals"; a signal fires (weight 1.0) if any phrase in its list is present
(some are gated by an exclusion list instead, e.g. `fact`-via-identity-
phrase is disqualified by temporary-language phrasing). The type with the
most fired signals wins, ties broken by priority order (`watch` > `fact` >
`phase`); confidence scales with signal count (1 → low, 2 → medium,
3+ → high). No match at all falls back to `context` (medium confidence).
`watch` also fires on `source_type == "soulgate_inferred"` as one of its
two signals.

The caller (ToolGate/Hermes) can also pass explicit `memory_type` /
`confidence` in the write payload, which override the classifier's guess.
An explicit override using one of the *old* seven type names is
transparently normalized to its new bucket (`normalize_memory_type()`) -
not-yet-updated callers keep working instead of getting an unrecognized
value stored.

## Signal filter (`services/signal_filter.py`)

Runs inside `POST /memory/write`, before classification, gated per-agent by
`agent_configs.signal_filter_enabled` (default on):

1. **Value score** — a rule-based [0, 1] heuristic. Pure acknowledgments
   ("ok", "thanks", ...) and short fillers score 0 outright. Preference,
   behavioral-pattern, relationship, and goal/constraint language each add
   0.3, capped at 1.0. If the score is below the agent's `value_threshold`
   (default 0.3), the write is rejected: `{"status": "filtered", "reason":
   "low value"}` (also logged to `memory_audit` as a `filtered` action) and
   nothing is stored.
2. **Novelty** — vector similarity (agent-scoped) against existing
   memories, via the same Qdrant near-duplicate search the old hardcoded
   0.92 threshold used, now driven by the agent's configurable
   `novelty_threshold` (default 0.90): ≥ threshold is treated as the same
   memory (goes through the existing upgrade-in-place path, `duplicate_of`
   set); 0.75–threshold is "low novelty" — written normally but with
   `confidence` forced to `low` (unless the caller passed one explicitly)
   and `low_novelty: true` in the response; below 0.75 is a normal write.

## Observation lifecycle (`services/observation_lifecycle.py`)

- **Dedup** — `POST /observation/create` embeds `description` into a
  second Qdrant collection (`{QDRANT_COLLECTION}_observations`) and
  searches it filtered by `agent_id` + `signal_type`. A hit ≥ 0.85
  similarity is treated as the same observation: no new row, the existing
  one's `confirmation_count` is incremented and returned with
  `deduplicated: true`.
- **Budget** — each agent has a hard cap of `agent_configs.max_observations`
  (default 150) active (`status="unconfirmed"`) observations. Hitting the
  cap on create archives the highest-`exposure_count` unconfirmed
  observation first (`archive_reason: "max active observations reached;
  archived to make room"`).
- **Exposure** — `POST /observation/session-context {session_context}`
  increments `exposure_count` on unconfirmed observations whose
  `trigger_context` matches (substring/keyword overlap) the given session
  text; hitting `max_exposures` (default 5) while still `unconfirmed`
  auto-archives with `archive_reason: "max exposures without
  confirmation"`.
- Explicit lifecycle transitions: `POST /observation/{id}/confirm`,
  `POST /observation/{id}/contradict`, `POST /observation/{id}/archive`,
  `GET /observation/active` (everything except `status="archived"`).
  Confirming an observation (or deduping into one) also runs pattern
  promotion (see below) for that agent/signal_type.
- `DELETE /observation/{id}` is a genuine hard delete (row + its Qdrant
  dedup-collection point) - distinct from `archive`, which is a soft,
  reversible-in-spirit status transition.

**Clarifications live here now.** `pending_clarifications` was merged into
`observations`: `raise_condition` (free text - when to surface this) and
`needs_clarification` (bool) replace what used to be a separate table with
its own `ask_after`/`status`/`importance` fields. `POST /observation/search`
and `GET /observation/active` both accept an optional `needs_clarification`
filter; there's no dedicated clarification endpoint anymore. Existing
`pending_clarifications` rows were migrated in (`status` pending/asked →
`unconfirmed`, resolved → `confirmed`, dismissed → `archived`; `ask_after`
→ `raise_condition`; `importance` → `hypothesis_confidence`, since both
were already 0–1 floats and there's no dedicated importance column
post-merge; `hypotheses`/`resolved_answer` preserved losslessly as JSON in
`raw_context`, since `Observation` has no equivalent fields for either) and
the table was dropped.

## Pattern promotion (`services/pattern_promotion.py`)

Runs after every observation create/confirm. Qualifying observations
(`status="confirmed"` or `confirmation_count >= 2`) are grouped by
`(signal_type, normalized hypothesis text)` — exact-normalized-text
clustering stands in for "similar hypothesis" since there's no LLM doing
semantic grouping here. A cluster of 3+ creates (or reinforces) a
`candidate` pattern named `"{signal_type}: {hypothesis[:60]}"`; a candidate
promotes to `active` at `confirmation_count >= 5`, and an `active` pattern
demotes to `deprecated` at `contradiction_count >= 3`. Manual transitions:
`POST /pattern/{id}/confirm`, `POST /pattern/{id}/contradict`,
`GET /pattern/active/{agent_id}`, `GET /pattern/candidates/{agent_id}`.

Since this function reclusters and reprocesses on *every* observation
create for the signal_type (not just ones that join a given cluster), an
existing pattern's `confirmation_count` only increments when its cluster
actually grew (`len(members) > instance_count`) — otherwise an unrelated
observation of the same signal_type would silently re-confirm every
existing pattern of that type each time it was created, running
`confirmation_count` arbitrarily far ahead of `instance_count`. Confidence
is also hard-capped at `MAX_PATTERN_CONFIDENCE = 0.95` everywhere it's
set (`POST /pattern/create`, `/update/{id}`, `/promote`) — 100% confidence
would make a pattern impossible to deprecate, which breaks the honesty
the whole promote/deprecate pipeline depends on. The dashboard's
`PatternsScreen.jsx` computes its own displayed confidence
(`confirmation_count / (confirmation_count + contradiction_count)`,
falling back to the stored value when there's no evidence yet) rather
than reading the stored field directly, so it has its own matching
`MAX_CONFIDENCE = 0.95` clamp — the backend cap alone doesn't reach this
derived ratio.

## Session transcripts (`models/session_transcript.py`)

The "remember everything" layer, sitting below the signal filter entirely:
nothing in `session_transcripts` is scored, filtered, or deleted by
anything in this service. The signal filter only ever decides what earns
*fast-path index access* into `memories`/`observations` - transcripts are
the unfiltered source of truth underneath that, meant to be called by
SoulGate after a session ends (`POST /transcripts`, auto-computing
`word_count` if omitted) and read back either as lightweight per-session
metadata (`GET /transcripts/{agent_id}` - no transcript text, which can be
arbitrarily large) or in full (`GET /transcripts/{id}/full`, the one route
in this group most worth gating behind `MEMORYGATE_ADMIN_KEY` given it's
raw conversation content). `POST /transcripts/{id}/reprocess` flips
`processed_by_soulgate` back to `false` so SoulGate's own worker picks it
up again on its next pass - MemoryGate never invokes SoulGate itself, it's
just the archive.

## Pre-session briefing (`services/briefing.py`)

`GET /briefing/{agent_id}` builds a structured object (not a prompt
string) from recent state — last-24h emotional-signal observation, entity
event "streaks", top-2 open clarifications (`Observation` rows with
`needs_clarification=True`, ordered by `hypothesis_confidence` as the
importance proxy now that there's no dedicated importance column),
in-progress `project` entities touched in the last 21 days (deduped by
normalized entity name, keeping whichever copy has been stuck longer, in
case the entities table has duplicates the dedup migration hasn't caught
yet), `human` entities with recent activity or
`attributes.scheduled_for == today`, and
recent `watch`-type memories as watch flags. Several fields ride on
`entities.attributes_json` (project `status`/`sessions_stuck`, person
`warmth_level`/`note`/`scheduled_for`) rather than new columns, since that
blob already exists for exactly this kind of extensible per-entity data.
The whole object is trimmed to a ~300-token budget (rough `len(json)/4`
estimate) by dropping, in order: `watch_flags`, `people_relevant`,
`active_tasks` beyond 1, `pending_clarifications` beyond 1 —
`emotional_state`/`mood_summary`/`active_streaks` are never cut.

## Scoring (`services/scoring.py`)

`memory_rank_bonus(memory_type, confidence)` sums two independent weights
(an `identity_weight` component existed here before that column was
removed - see "Memory classification" above):

```
type_bonus:        fact 0.45, watch 0.40, context 0.10, phase -0.05 (else 0.0)
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
   overwrites `memory_type`/`confidence`/`summary` if the new value scores
   higher. Tags are always merged (union, order-preserving) regardless of
   whether the type/confidence upgrade happens. Every upgrade or fresh
   write is logged to `memory_audit`.

## API

Base URL in-cluster: `http://memorygate:8020`. All routes are JSON in,
JSON out. Every route below (except `/health` and `GET /auth/check`) also
accepts an `X-Agent-Id` header (or `agent_id` body field, which wins if
both are present); omitted entirely, it defaults to `"default"`. If
`MEMORYGATE_ADMIN_KEY` is set, every route except `/health` additionally
requires `X-MemoryGate-Key` — see "Authentication" above.

### `/memory`
- `POST /memory/write` — `{agent_id?, text, source_type?, memory_type?, confidence?, do_not_generalize?, review_by?, tags?}` → signal filter, then classifies (or accepts overrides — old 7-type names are normalized to the current 4, see "Memory classification"), dedupes (exact text, then agent-scoped vector novelty check), upgrades or inserts, returns `{status, id, memory_type, summary, upgraded?, duplicate_of?, near_duplicate_of?, similarity?, low_novelty?}` or `{status: "filtered", reason: "low value"}`. `review_by` auto-defaults to +14 days if the resolved type is `phase` and none was given. An explicit `memory_type` override that isn't one of the 4 current types or a recognized legacy alias gets a `422`, not a silent pass-through.
- `POST /memory/search` — `{agent_id?, query}` → Qdrant nearest-neighbor + rescoring, or ILIKE fallback, both agent-scoped. Returns `{results: [...]}`; each result carries the raw Qdrant cosine `similarity` score (omitted on the ILIKE-fallback path, since there's no vector score to report) alongside `updated_at`.
- `GET /memory` — last 100 memories for the caller's agent, newest first.
- `GET /memory/{id}` — single memory, 404 if missing or owned by a different agent.
- `PATCH /memory/{id}` — `{text?, memory_type?, confidence?, do_not_generalize?, review_by?, tags?}` partial edit; re-embeds and logs an `edit` audit row.
- `DELETE /memory/{id}` — removes the row and its Qdrant point; logs a `delete` audit row.

### `/entity`
- `POST /entity/create` — now takes `agent_notes`/`agent_summary` (renamed from `conker_notes`/`conker_summary` — any agent can keep its own notes on an entity now, not just Conker). `entity_type` must be one of `CURRENT_ENTITY_TYPES` (human/project/organization/place/concept/habit/object) or the request gets a `422`. Dedup-checks first: exact name match (case/whitespace-insensitive, scoped to `agent_id`+`entity_type`), then embedding similarity (`>= 0.9`, its own Qdrant collection) — a hit merges the incoming tags/attributes/description into the existing row and returns it with `deduplicated: true` instead of inserting a new one.
- `POST /entity/merge` — `{keep_entity_id, merge_entity_id}`. Manual merge for near-duplicates the create-time dedup didn't catch (below the similarity threshold, or two entities with genuinely different names that a human recognizes as the same thing) — repoints `entity_edges`/`entity_events`/`entity_history` and the `entity_ids_json`/`applies_to_entity_ids_json` membership on `observations`/`patterns`, merges tags/attributes/description into `keep_entity_id`, deletes `merge_entity_id`. Backs the entity graph's merge action (select two nodes → pick which to keep).
- `GET /entity` — last 100 entities for the caller's agent, newest-updated first (mirrors `GET /memory`).
- `GET /entity/{id}`
- `DELETE /entity/{id}` — hard delete. Doesn't cascade to `entity_edges`/`entity_events`/`entity_history`; orphaned edges are simply invisible to callers that only ever request edges for entities that still exist (the dashboard's graph, for one, filters edges to nodes actually in its current node set).
- `POST /entity/search` — `{agent_id?, query, entity_type?}`, matches name/description/agent_summary/agent_notes via ILIKE, agent-scoped.
- `PATCH /entity/{id}` and `POST /entity/update` (`{entity_id, ...}`) — both do the same partial update (now including `name`, so entities can be renamed) + write an `entity_history` row. Two paths exist for legacy-tool-call compatibility (see `entity.update2` in ToolGate).
- `POST /entity/link` — create a typed `entity_edges` row between two existing entities (both must belong to the caller's agent).
- `GET /entity/{id}/edges` — returns edges where the entity is either endpoint. Note for callers aggregating edges across several entities: the same edge comes back once per endpoint entity queried, so dedupe by `id` (the dashboard learned this one the hard way — see `loadEntitiesAndEdges` in `EntitiesScreen.jsx`).
- `POST /entity/event` — append an `entity_events` row.
- `GET /entity/{id}/events`
- `GET /entity/{id}/history` — full `entity_history` audit trail.

### `/observation`
- `POST /observation/create` — `{agent_id?, session_id?, signal_type, description, raw_context?, hypothesis, hypothesis_confidence?, status?, confirmed_by?, trigger_context?, max_exposures?, raise_condition?, needs_clarification?, entity_ids?, related_observation_ids?}` — `hypothesis` is required (non-empty); an observation with nothing to confirm or contradict defeats the whole lifecycle, so the API rejects it with a `422` rather than accepting one. Dedup-checks first (see "Observation lifecycle" above); on a miss, enforces the active-observation budget, then inserts and runs pattern promotion.
- `POST /observation/search` — `{agent_id?, query?, signal_type?, status?, entity_id?, needs_clarification?}`, agent-scoped at the SQL level, then filtered/substring-matched in Python, capped at 50 results.
- `GET /observation/active` — all non-archived observations for the caller's agent; accepts an optional `needs_clarification` query param.
- `POST /observation/session-context` — `{agent_id?, session_context}` → exposure tracking, see above.
- `GET /observation/{id}`
- `DELETE /observation/{id}` — hard delete (row + its Qdrant point in the dedup collection), distinct from `POST /observation/{id}/archive` below, which is a soft, reversible-in-spirit status transition, not a deletion.
- `POST /observation/update/{id}` — partial update (status, hypothesis, hypothesis_confidence, confirmed_by, trigger_context, raise_condition, needs_clarification, related_observation_ids). `hypothesis`, if given, can't be blanked to `""` — same non-empty rule as create.
- `POST /observation/{id}/confirm` — `{confirmed_by?}` → status=confirmed, `confirmation_count += 1`, runs pattern promotion.
- `POST /observation/{id}/contradict` — `{reason?}` → status=contradicted.
- `POST /observation/{id}/archive` — `{reason?}` → status=archived, `archived_at` set.

### `/pattern`
- `POST /pattern/create`
- `POST /pattern/search` — same query/status/entity_id filtering style as observations, agent-scoped.
- `GET /pattern/active/{agent_id}` / `GET /pattern/candidates/{agent_id}`
- `GET /pattern/{id}`
- `POST /pattern/update/{id}` — partial update; flips `promoted_at` to now if status transitions to `active` and wasn't set before.
- `POST /pattern/{id}/confirm` — `confirmation_count += 1`, auto-promotes candidate → active at 5.
- `POST /pattern/{id}/contradict` — `contradiction_count += 1`, auto-demotes active → deprecated at 3.
- `POST /pattern/promote` — `{pattern_name, query?, entity_id?, min_observations=3, confidence=0.75, interpretation?, recommended_action?}`. Scans this agent's observations matching the filter; if fewer than `min_observations` match, returns `{status: "not_enough_evidence", matched_count, required}` instead of creating anything. Otherwise creates a `Pattern` row, auto-`active`+`promoted_at` if `confidence >= 0.85`, else `candidate`.

`/clarification` and `pending_clarifications` are gone — see "Observation
lifecycle" above; use `/observation` with `needs_clarification` instead.

### `/transcripts`
- `POST /transcripts` — `{agent_id?, session_id?, transcript, session_start?, session_end?, word_count?}`. Called by SoulGate after a session ends; `word_count` is computed from `transcript` if omitted. Never touches the signal filter.
- `GET /transcripts/{agent_id}` — session list, metadata only (`id`, `session_id`, `session_start`/`session_end`, `word_count`, `processed_by_soulgate`, `created_at`) — no transcript text.
- `GET /transcripts/{id}/full` — metadata plus the full `transcript` text. The one route in this group most worth gating behind `MEMORYGATE_ADMIN_KEY`.
- `POST /transcripts/{id}/reprocess` — flips `processed_by_soulgate` back to `false`; not in the original spec, added to back the dashboard's "Re-process with SoulGate" button. MemoryGate doesn't invoke SoulGate itself.
- `POST /transcripts/{id}/mark-processed` — flips `processed_by_soulgate` to `true`. Also not in the original spec, but necessary: nothing else in this codebase ever set the flag to `true`, so a transcript could never show as processed even after SoulGate genuinely finished with it. SoulGate should call this once it's done extracting from a transcript.

### `/config`
- `GET /config/{agent_id}` — `{agent_id, novelty_threshold, value_threshold, max_observations, signal_filter_enabled}`, created with defaults on first read.
- `PUT /config/{agent_id}` — partial update of the same fields.

### `/briefing`
- `GET /briefing/{agent_id}` — see "Pre-session briefing" above.

### `/audit`
- `GET /audit` — all `memory_audit` rows, newest first. No pagination/filtering, no agent scoping (it's a global append-only log). `write`/`upgrade`/`filtered` rows carry `agent_id` and (for `write`) `low_novelty` inside `payload_json`, added specifically so the dashboard's Overview screen can derive per-agent signal-health rates from this log without a dedicated stats endpoint.

### `/auth`
- `GET /auth/check` — validates the `X-MemoryGate-Key` header; see "Authentication" above.

### `/health`
- `GET /health` → `{"status": "ok"}`. Never requires a key.

## Config (env vars)

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://memorygate:memorygate_dev_password@memorygate-db:5432/memorygate` | Postgres connection string |
| `QDRANT_URL` | `http://qdrant:6333` | Qdrant endpoint |
| `QDRANT_COLLECTION` | `memories` | Qdrant collection name |
| `EMBED_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` | HF model id for embeddings |
| `EMBED_DIMENSION` | `384` | Must match the embedding model's output size |
| `MEMORYGATE_ADMIN_KEY` | `""` (unset) | If set, every route except `/health` requires it as the `X-MemoryGate-Key` header (checked via `secrets.compare_digest`, mirrors ToolGate's key auth). Unset = auth disabled, matching this service's historical no-auth default. `GET /auth/check` is what the dashboard's login screen calls to validate a key. |

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

**Docker-only local run** (no `.venv` needed — useful if your local Python
can't build `numpy`/`sentence-transformers` from source, e.g. a Python
version newer than they ship wheels for yet):

```bash
docker compose up -d                     # postgres + qdrant, from this repo
cd services/api && docker build -t memorygate-api .
docker run -d --name memorygate-api \
  --network memorygate-master_default \
  -p 8020:8020 \
  -e DATABASE_URL="postgresql+psycopg://memorygate:memorygate_dev_password@memorygate-postgres:5432/memorygate" \
  -e QDRANT_URL="http://memorygate-qdrant:6333" \
  -e MEMORYGATE_ADMIN_KEY="whatever-you-want" \
  memorygate-api
```

(`memorygate-master_default` is the network Compose creates for this
project by default — check `docker network ls` if your Compose project
name differs. Drop the `MEMORYGATE_ADMIN_KEY` line entirely to run with
auth disabled — see "Authentication" above.)

If the container image needs rebuilding after a code change, `docker rm -f
memorygate-api` before the `docker build`/`docker run` pair above — `docker
build` snapshots the build context when it starts, so editing files after
kicking off a background build won't be picked up by a container already
running from the old image.

## Dashboard

`dashboard/` is a separate Vite + React 19 + Tailwind v4 SPA on port 8021,
matching ToolGate's dashboard tech stack, file structure, and component
conventions exactly (same package versions, same dark surfaces/borders,
same `Layout`/`Modal`/`Button`/api.js patterns) so the two can merge later.
It talks to this API directly; it has no server-side state of its own.
Design tokens: background `#0A0A0A`, surface `#111111`, border `#1A1A1A`,
text `#EDEDED`/`#888888`, accent `#3B82F6` — flat throughout, no gradients,
no shadows, no glow, 8px card radius.

**Auth**: a login screen (`AuthScreen.jsx`/`AuthContext.jsx`, structurally
identical to ToolGate's) gates the whole app. It POSTs whatever key the
user types to `GET /auth/check`; on `200` the key is kept in
`sessionStorage` only (never `localStorage`, cleared on tab close) and
attached as `X-MemoryGate-Key` on every subsequent request; a `401` from
any request clears it and bounces back to the login screen. If the API has
no `MEMORYGATE_ADMIN_KEY` configured, `/auth/check` always succeeds
regardless of what's typed.

**Agent selector**: a dropdown in the sidebar (also shown large/centered
at the top of the Briefing screen) — `All | Conker | Emolga | Conker (dev) | + Add`.
Conker, Emolga, and Conker (dev) are built in with fixed colors (blue
`#3B82F6`, green `#10B981`, gray `#6B7280`) — Conker (dev) is isolated by
`agent_id` like any other agent, meant for manual testing/experiments so
they never mix into Conker's real data; `+ Add` registers an arbitrary
extra `agent_id`, persisted to
`localStorage` and assigned a color from a small rotating palette. Every
screen scopes its requests to whichever agent is selected; `All` fans the
same requests out across every known agent in parallel and merges the
results client-side (`lib/agentScope.js`) — there's no server-side "all
agents" query, since that would cut against agent isolation.

Primary nav: **Overview**, **Beliefs**, **Entities**, **Briefing**,
**Transcripts**. **Memories**, **Observations**, and **Patterns** live
under a collapsible **Debug** section in the sidebar (collapsed by
default, auto-opens if a debug route is active) — they're the raw-data
views, not what a user is meant to read day to day. There's no
Clarifications screen anymore; former clarifications surface inside
Observations instead.

- **Overview** — four stat cards (memories/entities/active patterns/pending clarifications), three signal-health meters (observation→pattern promotion rate, signal-filter rejection rate, memory novelty rate — all derived client-side from `/audit` + list endpoints, see the `/audit` note above), and a merged activity feed (last 20 events across memories/entities/observations/patterns, newest first — a `needs_clarification` observation gets its own feed color rather than double-counting as both).
- **Beliefs** — the user-facing view, "what Conker believes about you": active patterns rendered as plain sentences (`interpretation` or `pattern_name`) with confirmation count, expand-to-evidence (fetches the pattern's `observation_ids` on demand); high-confidence memories (`confidence === "high"`) below, each with its own expand — memories have no observation links in the data model, so their "evidence" is honestly just their own text, not fabricated.
- **Memories** (Debug) — debounced (300ms) semantic search with similarity % on results, type/confidence/sort filters, 2-column cards with a `do_not_generalize` flag icon and a `review_by` date shown on `phase`-type cards, a right-side detail panel (edit text/type/confidence/do_not_generalize/review_by/tags, delete), and an Add Memory modal. No `identity_weight` anywhere — that column is gone.
- **Entities** — **Graph** and **Table** view toggle. Graph: D3 force layout, node color by `entity_type`, node radius by `importance_level`, edges dashed when `direction="bidirectional"`, pan/zoom controls + type-filter checkboxes + a search-and-highlight box overlaid top-right, a floating-action-button to add an entity, and a merge toggle (amber icon in the control cluster) — click it, click two nodes to select them (amber ring), pick which one to keep, confirm; calls `POST /entity/merge` and updates the graph in place. Table: sortable columns, 25/page pagination. Both open the same right-side detail panel — editable name/description/agent_notes/agent_summary/importance/tags, a collapsible raw-JSON attributes editor, and Connections/Events/History tabs (the Connections tab is where Add Connection lives, with a relationship-type suggestion list, a strength slider, and a directed/bidirectional radio).
- **Observations** (Debug) — Active/Confirmed/Contradicted/Archived tabs (the four `status` values, "Active" being the friendlier label for `unconfirmed`), signal-type filter, a "needs clarification only" checkbox filter, a labeled exposure bar (color-coded by how close `exposure_count` is to `max_exposures`, with an "Exposure" caption and a tooltip explaining the archive-at-max behavior) and a confidence badge that reads "N% confidence" rather than a bare percentage, an amber "Pattern candidate" flag at `confirmation_count >= 3`, a "Needs clarification" badge + muted `raise if {raise_condition}` line on flagged cards, click-to-expand-inline (not a side panel) for the full edit form (including raise_condition/needs_clarification) + delete, and an Add Observation modal with debounced entity search for `entity_ids`.
- **Patterns** (Debug) — Active and collapsible Candidates sections, confirmation/contradiction count bars, a derived confidence % (`confirmations / (confirmations + contradictions)`, falling back to the stored `confidence` when both are zero, capped at 95% — see "Pattern promotion" above), "N more confirmations to activate" on candidates, Confirm/Contradict/Dismiss (Dismiss sets `status="deprecated"` via `POST /pattern/update/{id}` — there's no dedicated dismiss endpoint, candidates just don't have one, unlike observations).
- **Briefing** — renders the `GET /briefing/{agent_id}` object section by section (emotional state, mood + streak pills, up to 2 open clarifications, active tasks, a horizontal row of person cards with initials avatars and a warmth bar, red watch-flag pills), plus a live token counter (`Math.ceil(JSON.stringify(briefing).length / 4)`, same rough estimate the backend uses for its 300-token trim) with a green/amber/red progress bar and a Refresh button.
- **Transcripts** — session list (date, session ID, word count, processed badge); clicking one opens a full-text reading view in monospace with alternating speaker shading (a `^Speaker: text$`-per-line regex parser, since transcripts have no structured turn format — lines with no matching prefix continue the previous turn), an in-transcript search box that highlights matches, and a "Re-process with SoulGate" button (`POST /transcripts/{id}/reprocess`).

Mobile: bottom tab bar, capped at 5 visible tabs (Overview/Beliefs/
Entities/Briefing + a "More" tab that expands Transcripts and the three
Debug screens) rather than cramming everything in.

```bash
cd dashboard
npm install
npm run dev          # vite dev server on :8021, proxies /api -> :8020
```

For a production-ish build served by its own tiny FastAPI static server
(mirrors ToolGate's `server.py` pattern):

```bash
npm run build
python server.py     # serves dashboard/dist on 0.0.0.0:8021
```

**Local screenshot/interaction scripts** (`dashboard/screenshot*.mjs`, all
puppeteer, gitignored output in `dashboard/temporary screenshots/`) —
built up while verifying each screen against live data, kept around
because they're generically useful for future UI changes:
- `screenshot.mjs <url> [label]` — plain full-page screenshot.
- `screenshot-agent.mjs <url> [label] [agent]` — sets `localStorage`'s
  selected agent before screenshotting (no login).
- `screenshot-auth.mjs <url> [label] [agent] [key]` — drives the real
  login form (types the key, submits) before navigating to `url`.
- `screenshot-interact.mjs <url> [label] [agent] [key] [actions] [w] [h]`
  — like `screenshot-auth.mjs`, plus a `;`-separated action list run
  before the screenshot: `search:<q>`, `click:<css selector>`,
  `clickText:<substring>` (case-sensitive, matches the smallest element
  whose text contains it — tab labels are lowercase even though CSS
  capitalizes them for display, so match on lowercase), `clickAt:x,y`
  (for SVG/canvas/`<tr onClick>` targets `clickText`/`click` can't
  reliably reach, e.g. graph nodes or table rows), `type:<css
  selector>|<text>` (generic "focus this input and type", for anything
  that isn't the memories search box `search:` already special-cases),
  `wait:<ms>`.

## Follow-up: SoulGate-side work

Three items from the last review round can't be fixed in this repo because
they live on the extraction side, in SoulGate's prompt and worker, not
here. Tracked together since they're the same repo-boundary issue:

1. **Call `POST /transcripts/{id}/mark-processed`.** The endpoint exists
   (see `/transcripts` above) but nothing calls it yet — until SoulGate's
   worker hits it after finishing extraction on a transcript, the flag can
   never actually become `true` in practice, and the "reprocess a
   transcript SoulGate already handled → duplicate extraction" risk this
   endpoint exists to prevent is still live. A nicer API sitting unused
   next to the problem isn't a fix. **This is the top-priority item of
   the three** — the other two are extraction-quality issues, this one is
   a correctness gap with a concrete failure mode (duplicate memories from
   double-processing the same session).
2. **Add an explicit prompt rule: preferences, habits-as-attributes, and
   traits are never entities.** MemoryGate now rejects an unrecognized
   `entity_type` at the API level (see "Notable gaps" below), but it
   can't stop SoulGate from choosing a *valid* type for the wrong reason —
   e.g. filing "prefers dark mode" as a `concept` entity instead of a
   `fact` memory. That's a judgment call made at extraction time.
3. **Add a `watch` definition + one example to the prompt.** `watch` means
   a harmful behavioral pattern needing protective attention, not "the
   text contains a testing/QA phrase that happens to overlap with the
   classifier's keyword list." One labeled example in the prompt (a real
   harmful-pattern sentence vs. a sentence that merely mentions testing)
   would give the classifier's heuristics something to actually agree
   with instead of fighting.

## Notable gaps / rough edges

- `qdrant_stub.py` is dead code — an unused no-op stand-in for
  `qdrant_store.py`, never imported anywhere.
- Auth is opt-in and single-tier (`MEMORYGATE_ADMIN_KEY` unset = wide
  open, matching the historical default; set = one shared key gates the
  whole API). There's no per-agent authentication — the key only proves a
  caller may talk to MemoryGate at all, not which `agent_id` it's allowed
  to claim. Agent isolation prevents cross-agent data leakage between
  well-behaved callers, but it isn't an authentication boundary in itself:
  anything holding the shared key (or hitting an unkeyed instance) can
  still declare any `agent_id` it wants.
- `classifier.py` and `signal_filter.py` are pure keyword/heuristic
  scoring, not a model call — they will misclassify or misjudge anything
  that doesn't hit their literal trigger phrases. `classifier.py` silently
  falls back to `context`; `pattern_promotion.py`'s "similar hypothesis"
  clustering is exact-normalized-text matching, not real semantic
  similarity.
- Memories don't carry `entity_ids` — there's no schema link from a memory
  row to the entities it's about, so memory↔entity graph edges can't be
  drawn from this data today (the dashboard's entity graph is built from
  `entity_edges` only). It also means the Beliefs screen's "evidence" for a
  high-confidence memory is just the memory's own text, not real linked
  observations, unlike a pattern's evidence (which is real).
- `/observation/search` and `/pattern/search` both load their full table
  (agent-scoped in SQL first, at least) and filter/substring-match the
  rest in Python — fine at current scale, won't scale past a few thousand
  rows per agent.
- The `low_confidence`-memories-to-observations migration (see "Data
  model" above) has to invent a `signal_type` for rows that never had
  one — it hardcodes `'verbal'`, which is a guess, not a recovered fact.
- The Transcripts screen's speaker-alternating view is a regex heuristic
  (`^Speaker: text$` per line, unmatched lines continue the previous
  turn) — transcripts have no structured turn format to parse instead, so
  anything that doesn't look like `"Name: message"` renders as one
  continuous unstyled block rather than failing loudly.
- Two entity-update routes (`PATCH /entity/{id}` and `POST /entity/update`)
  do the exact same thing; kept for caller compatibility, not because they
  diverge in behavior.
- `DELETE /entity/{id}` doesn't cascade — deleting an entity leaves its
  `entity_edges`/`entity_events`/`entity_history` rows in place, orphaned.
  Harmless today since every reader either scopes by a still-existing
  entity's id or (like the dashboard's graph) filters edges down to nodes
  it actually has, but it means those tables can accumulate rows with no
  live owner.
- The dashboard's "Overview" signal-health meters (rejection rate, novelty
  rate) only reflect `memory_audit` rows written *after* the `agent_id`/
  `low_novelty` payload enrichment shipped — older rows lack those fields
  and are silently excluded from the per-agent filter, so a long-lived
  deployment's early history won't count toward these percentages.
- The dashboard's "All agents" view is entirely client-side fan-out
  (`lib/agentScope.js` calling every known-agent request in parallel and
  merging); there's no bulk cross-agent endpoint, so it makes `N×` the
  requests of a single-agent view and only knows about agents the browser
  has locally recorded (built-in Conker/Emolga/Conker (dev), plus anything
  added via "+ Add" in *that* browser's `localStorage`).
- `entity_type` is now a hard-enforced 7-value enum
  (`CURRENT_ENTITY_TYPES` in `routes/entity.py`: human / project /
  organization / place / concept / habit / object), mirroring what
  `memory_type` already does — an unrecognized value on `POST
  /entity/create` gets a `422`, not a silent insert. This stops a caller
  from filing something into the wrong table at the schema level, but it
  can't stop the *right* type from being chosen for the *wrong* reason —
  nothing here can tell a well-formed "this concept has relationships
  worth tracking" call from a bare preference that happened to pick
  `concept` instead of writing a `fact` memory (both are valid
  `entity_type` values). That judgment call is made entirely by the
  caller (SoulGate) at extraction time, outside this codebase — see
  "Follow-up: SoulGate-side work" below. `classifier.py`'s
  keyword-heuristic `watch` detection has the same class of problem in
  the other direction: it fires on literal phrases like "keep doing" /
  "can't stop", so text that happens to contain testing/QA language can
  trip it as readily as a real harmful pattern.
