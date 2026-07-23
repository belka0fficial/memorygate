# MemoryGate

MemoryGate is a local-first memory service for one personal AI agent. It receives evidence, preserves lineage, turns durable signals into structured memory, and returns a bounded context package that an agent can use without direct database access.

It is deliberately not a general chatbot, autonomous executor, or replacement for your main agent. MemoryGate stores, retrieves, and explains knowledge. Your agent remains responsible for reasoning and action.

## What It Solves

Personal agents need reliable context without carrying an entire history in every prompt. MemoryGate separates that problem into durable layers:

| Layer | Purpose |
| --- | --- |
| Evidence | Immutable raw inputs from listeners, sessions, APIs, or manual capture. |
| Analysis | A recorded interpretation of one or more evidence objects. |
| Memory | Durable facts, phases, context, and watch items suitable for retrieval. |
| Entity | Structured people, projects, places, concepts, habits, and objects. |
| Episode | A time-bounded event that groups related evidence. |

Every object can be inspected in the dashboard alongside its history, links, and supporting material.

## Architecture

```text
Agent / Listener
      |
      v
Evidence ingress --> Evidence object --> Processing job --> Analysis --> Memory / Entity / Episode
      |                                                        |
      +------------------------------ lineage -----------------+

Agent read key --> bounded context retrieval --> Memory Lab or agent response
```

### Storage and Search

- **PostgreSQL** is the source of truth for all memory, evidence, history, audit, and configuration records.
- **Qdrant** is the semantic vector index used to retrieve meaningfully related memories, entities, and observations.
- **Embeddings** use `sentence-transformers/all-MiniLM-L6-v2` with 384 dimensions by default.
- **Lexical matching** supplements vector results so exact names and project terms are not hidden by similarity ranking.

Changing the configured LLM does **not** change the vector database or embeddings. The LLM is used only for bounded evidence analysis and read-only answers.

## Security Model

MemoryGate assumes the dashboard is an administrative surface and keeps agents on a separate read-only interface.

- Admin keys are stored as PBKDF2-SHA256 hashes, never plaintext.
- Failed key verification is limited to five attempts with a five-minute lockout per client scope.
- Agent read keys are separate, scoped credentials. They can retrieve context but cannot ingest, edit, reset, or administer MemoryGate.
- Listener ingestion uses a source-specific secret, not the admin key.
- LLMs receive no write, delete, shell, or tool capability through MemoryGate.
- OpenAI API keys, when configured, are encrypted at rest in the MemoryGate server volume and never returned to the dashboard after saving.
- Backups exclude admin/read-key hashes and listener secrets.

Local deployment protects against remote misuse, not a fully compromised host. Running the agent and MemoryGate services on separate machines is the recommended next isolation step.

## Quick Start

### Prerequisites

- Docker Desktop with Compose
- Node.js 22+ only when running the dashboard outside Docker

### Start the services

```powershell
docker compose up -d --build
```

The default services are:

| Service | Address |
| --- | --- |
| Dashboard | `http://localhost:8021` |
| API | `http://localhost:8020` |
| PostgreSQL | `localhost:5434` |
| Qdrant | `localhost:6335` |
| Ollama | `localhost:11434` |

The dashboard can also be started with `npm run build` from `dashboard/`. Development runtime addresses may differ from the Compose defaults.

### Configure access

1. Open **Settings** in the dashboard.
2. Change the initial admin key to a long unique value.
3. Create one read key for your agent integration.
4. Add evidence sources and their listener secrets only through the dashboard.

## AI Runtime

MemoryGate supports two bounded model providers from **Settings -> AI Runtime**:

- **Ollama** is the default local provider. Select any installed local model, such as `qwen3:4b`.
- **OpenAI API** accepts a model identifier and an OpenAI API key. The key is sent only from MemoryGate's API server to `api.openai.com`; it is never stored in browser storage or exposed to an agent.

The selected model can:

- Propose observations and memory candidates from evidence.
- Answer a read-only Memory Lab question from retrieved context.

The selected model cannot:

- Write, delete, reset, or call tools through MemoryGate.
- Receive a hidden Memory Lab conversation history.
- Replace semantic retrieval or directly access PostgreSQL/Qdrant.

OpenAI uses the server-side Responses API with a Bearer API key. Keep the key private and treat provider usage as paid external processing. See the [OpenAI API quickstart](https://platform.openai.com/docs/quickstart/make-your-first-api-request) and [model catalog](https://developers.openai.com/api/docs/models).

## Dashboard

The dashboard is a single-workspace operating console for one agent:

- **Command Center**: system counts, signal health, and recent activity.
- **Live Pipeline**: a timestamped trace of incoming data through evidence, analysis, knowledge, and write decisions.
- **Memory Lab**: saved browser-session investigations. Each question is independent and read-only; inspect the exact objects supplied to the model.
- **Database**: search and inspect every object type in one table.
- **Entities, Data Objects, Sources & Evidence, Episodes, Sessions, Observations, Derived Patterns**: focused views for each layer.
- **Architecture**: developer-facing object, lineage, truth, and search model.
- **Settings**: keys, backups, AI runtime, and destructive operations.

## Agent Integration

Give external agents a **read key**, not the admin key. They should retrieve context before answering or acting, then send raw events through a listener or approved ingest path.

```powershell
python services/cli/memorygate.py context "What should I remember about this project?"
```

An MCP configuration and a Claude Code skill are included under `integrations/`. These integrations are intentionally read-focused: external agents should not be able to rewrite the memory architecture by prompt injection.

## Evidence Ingestion

Create a source in **Sources & Evidence**, then send an event to its dedicated listener endpoint:

```text
POST /runtime/listeners/{source_key}
X-MemoryGate-Listener-Key: <source-specific secret>
```

An event becomes an immutable evidence object. With automatic processing enabled, it receives a processing job that may produce analysis, observations, and durable memory candidates. All resulting objects retain lineage rather than silently replacing their source.

## Backups and Reset

Settings provides logical JSON backups and a **Danger Zone**.

- **Create backup** exports memory data, lineage, and processing state to the persistent backup volume.
- **Reset all memory** removes all stored memory, evidence, entities, transcripts, analysis, episodes, processing records, and matching vector points.
- **Reset data from a date** removes records created on or after the selected date.

Every reset requires the current admin key and the exact phrase `RESET MEMORY`. A backup is created before any destructive change. Admin access, agent read keys, listener configuration, backups, and AI configuration are preserved.

## Development

### API

```powershell
cd services/api
docker build -t memorygate-api:local .
```

### Dashboard

```powershell
cd dashboard
npm ci
npm run build
```

### Verification

```powershell
docker ps
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8020/health
```

## Project Layout

```text
dashboard/             React administrative console
services/api/          FastAPI service, models, retrieval, workers, and security
services/cli/          Terminal client for agent integrations
services/mcp/          MCP server bridge
integrations/          Agent-specific skills and MCP configuration
```

## Operational Notes

- Keep all secrets out of Git. Use the Settings UI or server environment configuration.
- Do not expose the dashboard/API directly to the public internet. Put them behind a private network, VPN, or authenticated reverse proxy when leaving localhost.
- Backups are logical exports, not an encrypted disaster-recovery system. Protect the Docker volume and copy important backups to secure storage.
- MemoryGate can preserve evidence and history, but no automated system can guarantee a fact is true. Confidence, provenance, and review remain part of the design.
