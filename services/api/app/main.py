from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from app.core.db import Base, engine
from app.core.migrations import run_migrations
from app.core.auth import require_key
from app.routes.memory import router as memory_router
from app.routes.audit import router as audit_router
from app.routes.entity import router as entity_router
from app.routes.observation import router as observation_router
from app.routes.pattern import router as pattern_router
from app.routes.agent_config import router as agent_config_router
from app.routes.briefing import router as briefing_router
from app.routes.transcript import router as transcript_router
from app.routes.auth_settings import router as auth_settings_router
from app.routes.evidence import router as evidence_router
from app.routes.lineage import router as lineage_router
from app.models import memory, audit, agent_config
from app.models import auth_setting
from app.models import evidence_source, evidence_object, analysis_object
from app.models import episode_object, object_link
from app.models import entity
from app.models import observation
from app.models import pattern
from app.models import session_transcript
from app.services.qdrant_store import ensure_qdrant_collection, ensure_observation_collection, ensure_entity_collection
from app.services.embeddings import get_embedding_model, embed_text

app = FastAPI(title="MemoryGate")

# The dashboard is served from a different port than the API; key auth is
# header-based (no cookies), so permissive CORS carries no meaningful extra
# risk here - matches ToolGate's dashboard/API CORS posture.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)
    ensure_qdrant_collection()
    ensure_observation_collection()
    ensure_entity_collection()
    get_embedding_model()
    embed_text("warmup")

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/auth/check")
def auth_check(tier: str = Depends(require_key)):
    return {"tier": tier}

_auth = [Depends(require_key)]

app.include_router(auth_settings_router, dependencies=_auth)
app.include_router(evidence_router, dependencies=_auth)
app.include_router(lineage_router, dependencies=_auth)
app.include_router(memory_router, dependencies=_auth)
app.include_router(audit_router, dependencies=_auth)
app.include_router(entity_router, dependencies=_auth)

app.include_router(observation_router, dependencies=_auth)

app.include_router(pattern_router, dependencies=_auth)

app.include_router(agent_config_router, dependencies=_auth)

app.include_router(briefing_router, dependencies=_auth)

app.include_router(transcript_router, dependencies=_auth)
