# MemoryGate

**The canonical long-term memory service for [Conker](https://github.com/belka0fficial/conker).**

MemoryGate is a FastAPI service backed by **Postgres** (structured data) and **Qdrant**
(vector search) that gives Conker a durable, queryable model of the person it's
working with — facts and preferences, behavioral patterns, a relational entity
graph, and a full session-transcript archive. It is the single authority for
durable memory in the system: nothing else writes memory directly, and nothing
in it is guessed at inference time that couldn't be traced back to something
it actually observed.

```
Hermes → terminal → conker-tool CLI → ToolGate → MemoryGate
                                          ↑
                                      SoulGate  (transcript archive, inferred signals)
```

ToolGate is the primary caller for everyday reads/writes; SoulGate calls it
directly for the transcript archive and post-session extraction. MemoryGate
is not meant to be called directly by Hermes.

---

## Contents

- [Screenshots](#screenshots)
- [Why it exists](#why-it-exists)
- [How memory flows through the system](#how-memory-flows-through-the-system)
- [Data model](#data-model-postgres)
- [Core behaviors](#core-behaviors)
- [API reference](#api-reference)
- [Dashboard](#dashboard)
- [Running it](#running-it)
- [Configuration](#configuration-env-vars)
- [Repo layout](#repo-layout)
- [Follow-up: SoulGate-side work](#follow-up-soulgate-side-work)
- [Known limitations](#known-limitations)

---

## Screenshots

**Beliefs** — the user-facing view. "What Conker believes about you," in
plain sentences, not raw database rows.

![Beliefs screen](docs/screenshots/beliefs.png)

**Overview** — system health at a glance: totals, signal-health meters, a
live activity feed.

![Overview screen](docs/screenshots/overview.png)

<table>
<tr>
<td width="50%">

**Entities** — a relational graph of the people, projects, and places in
Conker's world, D3 force-directed, colored by type.

![Entities graph](docs/screenshots/entities-graph.png)

</td>
<td width="50%">

**Observations** — individual signals with a hypothesis, a confirmation
count, and an exposure budget, before they ever become a belief.

![Observations screen](docs/screenshots/observations.png)

</td>
</tr>
<tr>
<td width="50%">

**Patterns** — regularities auto-promoted from 3+ confirmed observations,
with confidence hard-capped so nothing is ever "impossible to doubt."

![Patterns screen](docs/screenshots/patterns.png)

</td>
<td width="50%">

**Memories** — the four-type taxonomy (fact / phase / context / watch),
`review_by` dates, `do_not_generalize` flags.

![Memories screen](docs/screenshots/memories.png)

</td>
</tr>
</table>

**Briefing** — a structured pre-session object (not a prompt string):
mood, streaks, open clarifications, active tasks, relevant people, watch
flags, all trimmed to a token budget.

![Briefing screen](docs/screenshots/briefing.png)

**Transcripts** — the "remember everything" layer underneath all of the
above: full session transcripts, never scored or filtered, readable with
speaker shading and in-transcript search.

![Transcript detail view](docs/screenshots/transcript-detail.png)

---

## Why it exists

Conker needs to remember things about the person it's working with —
durably, honestly, and without either hallucinating confidence it hasn't
earned or drowning in raw transcript text it can't act on. MemoryGate is
built around one idea: **memory should be layered by how sure the system is**,
and every layer should be able to point at the evidence underneath it.

- A stray comment becomes an **observation** — a single signal with a
  hypothesis attached, worth almost nothing on its own.
- The same hypothesis, seen three separate times, auto-promotes into a
  **pattern** — a regularity, still deprecatable, still capped below 100%
  confidence by design.
- A durable fact or preference gets written straight to **memory**, scored
  and classified into one of four types.
- Every full session gets archived as a **transcript**, unfiltered — the
  fast-path index above it is a curated subset, not the whole record.
- A relational **entity graph** tracks the actual nouns in Conker's world —
  people, projects, places — separate from attributes about the user.

Nothing here calls an LLM. Classification, scoring, dedup, and clustering
are all deterministic — keyword-signal heuristics and vector similarity,
not a model call — which is a deliberate simplicity/accuracy tradeoff (see
[Known limitations](#known-limitations)).

## How memory flows through the system

```mermaid
flowchart TD
    ToolGate -->|writes and reads| MG
    SoulGate -->|archives transcripts and writes inferred signals| MG
    Dashboard -->|reads and writes, key-gated| MG

    subgraph MG[MemoryGate API]
        direction TB
        SignalFilter[Signal filter] --> Classifier[Classifier] --> Dedup[Dedup and scoring]
        Lifecycle[Observation lifecycle] --> Promotion[Pattern promotion]
        Briefing[Briefing builder]
    end

    MG --> Postgres[(Postgres)]
    MG --> Qdrant[(Qdrant)]
```

Postgres holds every structured table (`memories`, `entities`,
`observations`, `patterns`, `session_transcripts`, `memory_audit`). Qdrant
holds three vector collections — one each for memories, observations, and
entities — used for near-duplicate detection and semantic search.

Every request carries an `agent_id` (header or body field) and every table
is scoped to it — one MemoryGate instance serves every agent (Conker,
other Conker instances, anything else ToolGate fronts) without their data
ever mixing. See [Agent isolation](#agent-isolation) below.

## Data model (Postgres)

| Table | Purpose |
|---|---|
| `memories` | Durable facts/preferences. `memory_type` (`fact` / `phase` / `context` / `watch`), `source_type`, `confidence`, `do_not_generalize`, `review_by` (effectively required for `phase`), `tags_json`. |
| `memory_audit` | Append-only log of every `write`/`upgrade`/`edit`/`delete`/`filtered` action against `memories`. |
| `entities` | Structured world model: people, projects, places, concepts. `entity_type` is a hard-enforced enum (human/project/organization/place/concept/habit/object). `attributes_json` (freeform), `agent_notes` (private), `agent_summary` (surfaced), `importance_level`. |
| `entity_edges` | Typed, directional relationships between entities (`relationship_type`, `strength` 0–1, `since_when`). |
| `entity_events` | Discrete things that happened to/with an entity (`event_type`, `emotional_weight`). |
| `entity_history` | Full audit trail of entity field changes. |
| `observations` | Single signal instances — also where former "clarifications" live. `signal_type`, `status` (unconfirmed/confirmed/contradicted/archived), `hypothesis` (required — see below) + `hypothesis_confidence`, `confirmation_count`, `exposure_count`/`max_exposures`, `raise_condition` + `needs_clarification`. |
| `patterns` | Regularities promoted from 3+ observations. `instance_count`/`confirmation_count`/`contradiction_count`, `status` (candidate/active/deprecated/contradicted), `confidence` (hard-capped at 0.95). |
| `agent_configs` | Per-agent signal filter / observation budget settings, created with defaults on first use. |
| `session_transcripts` | Full session transcripts — the "remember everything" layer. `session_id`, `transcript`, `word_count`, `processed_by_soulgate`. |

All list-typed and freeform fields are JSON text columns, deserialized on
read. Schema changes are additive: `Base.metadata.create_all` creates
missing tables on startup, and `app/core/migrations.py` runs right after it
to patch existing databases (new columns, taxonomy remaps, table merges,
entity-dedup cleanup) — all idempotent, safe to run on every boot.

<details>
<summary><b>Full migration history (expand)</b></summary>

`app/core/migrations.py` additively patches pre-existing databases on every
startup:

- Adds `agent_id` to every table that predates agent isolation.
- Renames `entities.conker_notes`/`conker_summary` → `agent_notes`/`agent_summary`.
- Adds the observation-lifecycle columns (`exposure_count`, `max_exposures`,
  `confirmation_count`, `trigger_context`, `archived_at`, `archive_reason`).
- Remaps the old 9-value `memory_type` taxonomy onto the current 4 types —
  `low_confidence` rows move to `observations` instead of being relabeled
  (they were never durable memories to begin with); `do_not_generalize` rows
  become the boolean flag on a `context`-typed row; everything else maps
  onto `fact`/`phase`/`context`/`watch` via a lookup table; drops
  `memories.identity_weight`.
- Migrates `pending_clarifications` rows into `observations`
  (`needs_clarification=true`, `ask_after` → `raise_condition`, `importance`
  → `hypothesis_confidence`) and drops that table.
- Merges duplicate `entities` rows (same `agent_id`+`entity_type`+
  normalized name) into the oldest row per group, repointing every
  `entity_edges`/`entity_events`/`entity_history` row and the
  `entity_ids_json`/`applies_to_entity_ids_json` membership arrays on
  `observations`/`patterns` before dropping the duplicates. Naturally
  idempotent — once there's at most one row per group, it's a no-op.

Every step is `IF NOT EXISTS`/existence-checked, so a fresh database (which
already has the current schema from the model definitions) skips all of it.

</details>

## Core behaviors

### Agent isolation

Every caller identifies itself with an `agent_id` (`X-Agent-Id` header, or
an `agent_id` body field that wins if both are present; omitted entirely,
it defaults to `"default"`). Every table carries `agent_id` and every query
is scoped to it — including get-by-id routes, which `404` (not `403`) on a
row owned by a different agent, so one agent can't even enumerate another's
data. Qdrant payloads carry `agent_id` too, and every vector search filters
on it.

This is a single shared secret's worth of trust, not per-agent auth (see
[Authentication](#authentication)) — it prevents cross-agent leakage between
well-behaved callers, not a malicious one holding the shared key.

### Authentication

Optional, off by default. Set `MEMORYGATE_ADMIN_KEY` and every route except
`/health` requires it as the `X-MemoryGate-Key` header (constant-time
comparison). Unset = wide open, matching the historical default.
`GET /auth/check` is what the dashboard's login screen calls to validate a
typed-in key.

### Memory classification

Four types: **`fact`** (durable preferences/identity/humor-style),
**`phase`** (temporary emotional/circumstantial states — carries a
`review_by`), **`context`** (default/fallback), **`watch`** (behavioral
patterns worth monitoring). A **scored multi-signal keyword classifier**
(`services/classifier.py`), not an LLM call: each type is defined by
independent keyword-list "signals," the type with the most fired signals
wins (ties broken `watch` > `fact` > `phase`), confidence scales with
signal count. No match falls back to `context`.

Callers can pass an explicit `memory_type` override — a legacy 7-value type
name is transparently normalized to its new bucket, but anything
unrecognized gets a **`422`**, not a silent write into a garbage column
value.

### Signal filter

Runs inside `POST /memory/write`, before classification:

1. **Value score** — a [0,1] keyword heuristic; pure acknowledgments score
   0; preference/behavioral/relationship/goal language add up. Below the
   agent's `value_threshold` (default 0.3) → `{"status": "filtered"}`,
   nothing stored.
2. **Novelty** — vector similarity against existing memories. `≥ 0.90`:
   same memory, upgrade-in-place. `0.75–0.90`: written but `confidence`
   forced to `low`. `< 0.75`: normal write.

### Observation lifecycle

- **Dedup** — a new observation embeds its description and searches a
  dedicated Qdrant collection, scoped to `agent_id` + `signal_type`. A hit
  `≥ 0.85` similarity increments the existing row's `confirmation_count`
  instead of inserting a duplicate.
- **`hypothesis` is required.** An observation with nothing to confirm or
  contradict defeats the entire lifecycle — the API rejects an empty one
  with `422`, on both create and update.
- **Budget** — a hard cap on active observations per agent (default 150);
  hitting it archives the most-exposed unconfirmed observation to make
  room.
- **Exposure** — `POST /observation/session-context` increments exposure on
  observations whose trigger context matches the current session; hitting
  `max_exposures` while still unconfirmed auto-archives it.
- **Clarifications live here.** The old `pending_clarifications` table is
  gone — `raise_condition` (when to surface this) and `needs_clarification`
  (bool) are columns on `observations` now.

### Pattern promotion

Runs after every observation create/confirm. Qualifying observations
(confirmed, or confirmed-by-dedup twice) are grouped by
`(signal_type, normalized hypothesis text)` — a cluster of 3+ creates or
reinforces a `candidate` pattern, which promotes to `active` at
`confirmation_count ≥ 5` and demotes to `deprecated` at
`contradiction_count ≥ 3`.

Two invariants worth calling out because they were both real bugs at one
point:

- **`confirmation_count` only increments when the cluster actually grew.**
  This function reprocesses every observation of a signal_type on every
  create, not just ones joining a given cluster — without this guard, an
  unrelated observation would silently re-confirm every existing pattern of
  that type.
- **Confidence is hard-capped at 0.95, everywhere it's set** — backend
  (`MAX_PATTERN_CONFIDENCE`) and the dashboard's own derived-confidence
  display formula, independently, since the frontend computes its own
  ratio rather than trusting the stored field. 100% confidence would make
  a pattern impossible to deprecate, which breaks the honesty the whole
  promote/deprecate pipeline depends on.

### Session transcripts

The "remember everything" layer, sitting below the signal filter entirely —
nothing in `session_transcripts` is scored, filtered, or deleted by
anything else here. SoulGate archives a full session
(`POST /transcripts`), reads it back as lightweight metadata
(`GET /transcripts/{agent_id}`) or in full (`GET /transcripts/{id}/full`),
and should call `POST /transcripts/{id}/mark-processed` once it's done
extracting from it — see [Follow-up](#follow-up-soulgate-side-work), since
that call isn't wired up on the SoulGate side yet.

### Pre-session briefing

`GET /briefing/{agent_id}` builds a structured object (not a prompt
string): last-24h emotional state, entity-event streaks, up to 2 open
clarifications, in-progress project entities (deduped by normalized name,
defensively, independent of whatever state `entities` is in), relevant
people, recent `watch`-type memories. Trimmed to a ~300-token budget by
dropping fields in priority order — `emotional_state`/`mood_summary`/
`active_streaks` are never cut.

### Scoring

`memory_rank_bonus(memory_type, confidence)` sums a type bonus
(`fact` 0.45, `watch` 0.40, `context` 0.10, `phase` −0.05) and a confidence
bonus (high 0.20 / medium 0.10 / low 0). Used for search-result ranking
(blended with Qdrant's vector rank) and write-time upgrade decisions (a
duplicate write only overwrites the existing memory's type/confidence if
the new value scores higher; tags always merge regardless).

## API reference

Base URL in-cluster: `http://memorygate:8020`. All JSON in, JSON out. Every
route except `/health` and `GET /auth/check` accepts `X-Agent-Id` (or
`agent_id` in the body) and, if `MEMORYGATE_ADMIN_KEY` is set, requires
`X-MemoryGate-Key`.

<details>
<summary><b><code>/memory</code></b></summary>

- `POST /memory/write` — `{agent_id?, text, source_type?, memory_type?, confidence?, do_not_generalize?, review_by?, tags?}` → signal filter → classify (or accept an override, normalized/validated against the 4-type enum) → dedupe (exact text, then vector novelty) → upgrade-or-insert. Returns `{status, id, memory_type, summary, upgraded?, duplicate_of?, near_duplicate_of?, similarity?, low_novelty?}` or `{status: "filtered", reason: "low value"}`. An unrecognized `memory_type` override → `422`.
- `POST /memory/search` — `{agent_id?, query}` → Qdrant nearest-neighbor + rescoring, ILIKE fallback if the collection's empty.
- `GET /memory` — last 100 for the caller's agent, newest first.
- `GET /memory/{id}`
- `PATCH /memory/{id}` — partial edit; re-embeds, logs an `edit` audit row.
- `DELETE /memory/{id}` — removes the row + its Qdrant point; logs a `delete` audit row.

</details>

<details>
<summary><b><code>/entity</code></b></summary>

- `POST /entity/create` — `entity_type` must be one of the 7-value enum (human/project/organization/place/concept/habit/object) or `422`. Dedup-checks first: exact name match, then embedding similarity `≥ 0.9` — a hit merges tags/attributes/description into the existing row and returns `deduplicated: true` instead of inserting.
- `POST /entity/merge` — `{keep_entity_id, merge_entity_id}`. Manual merge for near-duplicates create-time dedup didn't catch — repoints every referencing table, merges fields, deletes the loser. Backs the entity graph's merge action.
- `GET /entity` — last 100, newest-updated first.
- `GET /entity/{id}`
- `DELETE /entity/{id}` — hard delete, doesn't cascade to edges/events/history (orphaned rows are simply invisible to readers that filter by still-existing entities).
- `POST /entity/search` — `{agent_id?, query, entity_type?}`, ILIKE over name/description/summary/notes.
- `PATCH /entity/{id}` / `POST /entity/update` — same partial update, two paths for caller compatibility.
- `POST /entity/link` — create a typed edge between two owned entities.
- `GET /entity/{id}/edges` — edges where the entity is either endpoint (dedupe by `id` if aggregating across several entities — the same edge comes back once per endpoint queried).
- `POST /entity/event` / `GET /entity/{id}/events`
- `GET /entity/{id}/history`

</details>

<details>
<summary><b><code>/observation</code></b></summary>

- `POST /observation/create` — `{agent_id?, session_id?, signal_type, description, raw_context?, hypothesis, hypothesis_confidence?, status?, confirmed_by?, trigger_context?, max_exposures?, raise_condition?, needs_clarification?, entity_ids?, related_observation_ids?}` — `hypothesis` required (non-empty) or `422`. Dedup-checks, enforces the active-observation budget, runs pattern promotion.
- `POST /observation/search` — `{agent_id?, query?, signal_type?, status?, entity_id?, needs_clarification?}`.
- `GET /observation/active` — all non-archived; optional `needs_clarification` filter.
- `POST /observation/session-context` — `{agent_id?, session_context}` → exposure tracking.
- `GET /observation/{id}`
- `DELETE /observation/{id}` — hard delete, distinct from the soft `archive` below.
- `POST /observation/update/{id}` — partial update; `hypothesis` can't be blanked to `""`.
- `POST /observation/{id}/confirm` — `{confirmed_by?}` → confirmed, `confirmation_count += 1`, runs pattern promotion.
- `POST /observation/{id}/contradict` — `{reason?}` → contradicted.
- `POST /observation/{id}/archive` — `{reason?}` → archived.

</details>

<details>
<summary><b><code>/pattern</code></b></summary>

- `POST /pattern/create`
- `POST /pattern/search` — query/status/entity_id filtering.
- `GET /pattern/active/{agent_id}` / `GET /pattern/candidates/{agent_id}`
- `GET /pattern/{id}`
- `POST /pattern/update/{id}` — partial update.
- `POST /pattern/{id}/confirm` — `confirmation_count += 1`, auto-promotes at 5.
- `POST /pattern/{id}/contradict` — `contradiction_count += 1`, auto-demotes at 3.
- `POST /pattern/promote` — `{pattern_name, query?, entity_id?, min_observations=3, confidence=0.75, interpretation?, recommended_action?}`. Fewer than `min_observations` matches → `{status: "not_enough_evidence"}` instead of creating anything.

All `confidence` values are clamped to `≤ 0.95` on every write path.

</details>

<details>
<summary><b><code>/transcripts</code></b></summary>

- `POST /transcripts` — `{agent_id?, session_id?, transcript, session_start?, session_end?, word_count?}`. Called by SoulGate after a session ends; `word_count` auto-computed if omitted.
- `GET /transcripts/{agent_id}` — metadata-only session list (no transcript text).
- `GET /transcripts/{id}/full` — metadata + full text. Worth gating behind the admin key.
- `POST /transcripts/{id}/reprocess` — flips `processed_by_soulgate` back to `false`.
- `POST /transcripts/{id}/mark-processed` — flips it to `true`. SoulGate should call this once extraction finishes — see [Follow-up](#follow-up-soulgate-side-work).

</details>

<details>
<summary><b>Everything else — <code>/config</code>, <code>/briefing</code>, <code>/audit</code>, <code>/auth</code>, <code>/health</code></b></summary>

- `GET`/`PUT /config/{agent_id}` — `{novelty_threshold, value_threshold, max_observations, signal_filter_enabled}`, defaults on first use.
- `GET /briefing/{agent_id}` — see [Pre-session briefing](#pre-session-briefing).
- `GET /audit` — all `memory_audit` rows, newest first, global (no agent scoping — it's an append-only log).
- `GET /auth/check` — validates `X-MemoryGate-Key`.
- `GET /health` → `{"status": "ok"}`, never requires a key.

`/clarification` and `pending_clarifications` are gone — use `/observation`
with `needs_clarification` instead.

</details>

## Dashboard

`dashboard/` is a Vite + React 19 + Tailwind v4 SPA on port 8021, matching
ToolGate's dashboard conventions so the two can merge later. It talks to
this API directly and has no server-side state of its own. Flat dark
theme, no gradients/shadows/glow.

A login screen gates the app (skipped entirely if no admin key is
configured). The agent selector — `All | Conker | Emolga | Conker (dev) |
+ Add` — scopes every screen; **Conker (dev)** is a built-in isolated
profile for manual testing/experiments so they never mix into Conker's
real data (the screenshots above for Entities/Observations/Memories/
Transcripts were taken against it).

Primary nav: **Overview, Beliefs, Entities, Briefing, Transcripts.**
**Memories, Observations, Patterns** live under a collapsible **Debug**
section — raw-data views, not what a user reads day to day.

| Screen | What it shows |
|---|---|
| **Overview** | Stat cards, three signal-health meters (promotion/rejection/novelty rate, derived from the audit log), a merged activity feed. |
| **Beliefs** | The user-facing view — active patterns as plain sentences with expand-to-evidence, high-confidence memories below. |
| **Entities** | Graph (D3 force layout, color by type, pan/zoom, a merge action — select two nodes, pick which to keep) and Table views. |
| **Observations** (Debug) | Active/Confirmed/Contradicted/Archived tabs, exposure bar, confidence badge, needs-clarification flag. |
| **Patterns** (Debug) | Active + candidate sections, confirmation/contradiction bars, capped confidence. |
| **Memories** (Debug) | Semantic search, type/confidence filters, `do_not_generalize`/`review_by` on cards. |
| **Briefing** | Renders the briefing object section by section, plus a live token-budget meter. |
| **Transcripts** | Session list → full-text reading view, speaker shading, in-transcript search, re-process action. |

Mobile: bottom tab bar, capped at 5 tabs plus a "More" overflow.

**Local screenshot/interaction tooling** (`dashboard/screenshot*.mjs`, all
Puppeteer, gitignored output in `dashboard/temporary screenshots/`) — built
up while verifying each screen against live data, kept around for future
UI work: `screenshot.mjs <url> [label]` (plain screenshot),
`screenshot-agent.mjs` (sets the selected agent first),
`screenshot-auth.mjs` (drives the real login form), and
`screenshot-interact.mjs <url> [label] [agent] [key] [actions] [w] [h]`
(the general-purpose one — a `;`-separated action list of `search:<q>`,
`click:<css selector>`, `clickText:<substring>`, `clickAt:x,y`,
`type:<css selector>|<text>`, `wait:<ms>`, run before the screenshot). The
screenshots in this README were taken with it.

## Running it

**Docker-only** (no local Python/Node toolchain needed beyond Docker
itself):

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

(`memorygate-master_default` is Compose's default network name for this
project — check `docker network ls` if yours differs. Drop the
`MEMORYGATE_ADMIN_KEY` line to run with auth disabled. If you rebuild after
editing source, `docker rm -f memorygate-api` first — a background `docker
build` snapshots its context at start, so edits made mid-build won't be
picked up by a container already running the old image.)

**Local dev with hot reload**, if you have a Python venv set up:

```bash
cd services/api
docker compose -f ../../docker-compose.yml up -d   # postgres + qdrant
./run.sh                                            # uvicorn --reload on :8020, needs .venv
```

`run.sh` reads `DATABASE_URL`/`QDRANT_URL` from `services/api/.env`
(gitignored) or falls back to Docker Compose service-name defaults, which
won't resolve outside a Docker network — override to `localhost:5434` /
`localhost:6335` for a bare local run.

**Dashboard:**

```bash
cd dashboard
npm install
npm run dev          # vite dev server on :8021, proxies /api -> :8020
```

Or built + served like production:

```bash
npm run build
python server.py     # serves dashboard/dist on 0.0.0.0:8021
```

**In production**, MemoryGate is built and run from Conker's own
`docker-compose.yml` (`memorygate` service) alongside `memorygate-db` and
`qdrant`, on the `conker_net` network — this repo's own `docker-compose.yml`
only stands up Postgres/Qdrant for local dev, no `api` service.

## Configuration (env vars)

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://memorygate:memorygate_dev_password@memorygate-db:5432/memorygate` | Postgres connection string |
| `QDRANT_URL` | `http://qdrant:6333` | Qdrant endpoint |
| `QDRANT_COLLECTION` | `memories` | Base Qdrant collection name (observations/entities get `_observations`/`_entities` suffixes) |
| `EMBED_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` | HF model id for embeddings |
| `EMBED_DIMENSION` | `384` | Must match the embedding model's output size |
| `MEMORYGATE_ADMIN_KEY` | `""` (unset) | If set, every route except `/health` requires it as `X-MemoryGate-Key`. Unset = auth disabled. |

Defaults assume Docker Compose networking (service name `memorygate-db`,
not `localhost`). In Conker's production compose file, `DATABASE_URL`
points at `memorygate-db` and `QDRANT_URL` at `qdrant` (sibling containers
on `conker_net`).

## Repo layout

```
services/api/
  app/
    main.py              FastAPI app, router wiring, startup hooks
    core/
      config.py           env-driven config
      db.py                SQLAlchemy engine/session/Base
      agent.py              X-Agent-Id / agent_id resolution
      auth.py                X-MemoryGate-Key check, no-op if unset
      migrations.py           additive schema patches for pre-existing databases
    models/                one file per table group
    schemas/               pydantic request/response models
    routes/                one router per resource
    services/
      classifier.py        keyword-based memory_type classifier (4 types)
      scoring.py            memory_rank_bonus / memory_strength weighting
      embeddings.py          sentence-transformers wrapper (lru-cached)
      qdrant_store.py         3 Qdrant collections: memories/observations/entities
      signal_filter.py         value/novelty scoring gate on memory writes
      entity_dedup.py           create-time dedup + manual merge
      observation_lifecycle.py dedup/budget/exposure for observations
      pattern_promotion.py      auto-promotes observation clusters into patterns
      briefing.py                builds the GET /briefing/{agent_id} object
  requirements.txt
  Dockerfile
  run.sh                  local dev entrypoint
dashboard/                Vite + React 19 + Tailwind v4 admin SPA (:8021)
docs/screenshots/         images used in this README
docker-compose.yml        standalone postgres + qdrant for local dev
```

## Follow-up: SoulGate-side work

Three items live on the extraction side, in SoulGate's prompt and worker,
not in this repo:

1. **Call `POST /transcripts/{id}/mark-processed`.** The endpoint exists
   but nothing calls it yet — until SoulGate's worker hits it after
   finishing extraction, the "reprocess an already-handled transcript →
   duplicate extraction" risk it exists to prevent is still live. Top
   priority of the three; it's a correctness gap, not a quality one.
2. **Prompt rule: preferences/habits-as-attributes/traits are never
   entities.** MemoryGate rejects an unrecognized `entity_type`, but can't
   stop a *valid* type being chosen for the wrong reason (e.g. filing "I
   prefer dark mode" as a `concept` entity instead of a `fact` memory).
3. **Prompt definition for `watch`** (+ one example): a harmful behavioral
   pattern needing protective attention — not "the text happens to overlap
   with the classifier's keyword list."

## Known limitations

<details>
<summary>Expand — heuristics, scaling ceilings, and rough edges</summary>

- `classifier.py` and `signal_filter.py` are pure keyword/heuristic
  scoring, not a model call. `pattern_promotion.py`'s "similar hypothesis"
  clustering is exact-normalized-text matching, not real semantic
  similarity.
- Auth is single-tier: the shared key proves a caller may talk to
  MemoryGate at all, not which `agent_id` it's allowed to claim. Agent
  isolation prevents leakage between well-behaved callers; it isn't an
  authentication boundary by itself.
- Memories don't carry `entity_ids` — no schema link from a memory to the
  entities it's about, so the Beliefs screen's memory "evidence" is just
  the memory's own text, not linked observations (unlike a pattern's
  evidence, which is real).
- `/observation/search` and `/pattern/search` load their full table
  (agent-scoped in SQL) and filter the rest in Python — fine at current
  scale, won't hold past a few thousand rows per agent.
- The Transcripts speaker view is a `^Speaker: text$`-per-line regex
  heuristic — anything that doesn't look like `"Name: message"` renders as
  one continuous unstyled block.
- `DELETE /entity/{id}` doesn't cascade — edges/events/history rows are
  left orphaned (harmless; every reader filters to still-existing
  entities, but they accumulate with no live owner).
- The dashboard's "All agents" view is client-side fan-out across every
  known agent in parallel — `N×` the requests of a single-agent view, and
  only knows about agents the browser has locally recorded.
- `entity_type` is a hard-enforced enum now, but that only stops a caller
  from filing something into the *wrong table* — it can't tell a
  well-formed "this concept has relationships worth tracking" call from a
  bare preference that happened to pick a valid type anyway. That
  judgment call is made entirely on the extraction side — see
  [Follow-up](#follow-up-soulgate-side-work).
- `qdrant_stub.py` is dead code, unused.
- Two entity-update routes (`PATCH /entity/{id}` and `POST /entity/update`)
  do the exact same thing, kept for caller compatibility.
- The dashboard's Overview signal-health meters only reflect `memory_audit`
  rows written *after* the `agent_id`/`low_novelty` payload enrichment
  shipped — older rows lack those fields and are silently excluded from
  the per-agent filter, so a long-lived deployment's early history won't
  count toward these percentages.
- The old `low_confidence`-memories-to-observations migration has to
  invent a `signal_type` for rows that never had one — it hardcodes
  `'verbal'`, a guess, not a recovered fact.

</details>
