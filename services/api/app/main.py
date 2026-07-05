from fastapi import FastAPI
from app.core.db import Base, engine
from app.routes.memory import router as memory_router
from app.routes.audit import router as audit_router
from app.routes.entity import router as entity_router
from app.routes.observation import router as observation_router
from app.routes.pattern import router as pattern_router
from app.routes.pending_clarification import router as clarification_router
from app.models import memory, audit
from app.models import entity
from app.models import observation
from app.models import pattern
from app.models import pending_clarification
from app.services.qdrant_store import ensure_qdrant_collection
from app.services.embeddings import get_embedding_model, embed_text

app = FastAPI(title="MemoryGate")

@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    ensure_qdrant_collection()
    get_embedding_model()
    embed_text("warmup")

@app.get("/health")
def health():
    return {"status": "ok"}

app.include_router(memory_router)
app.include_router(audit_router)
app.include_router(entity_router)

app.include_router(observation_router)

app.include_router(pattern_router)

app.include_router(clarification_router)
