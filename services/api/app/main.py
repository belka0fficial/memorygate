from fastapi import FastAPI
from app.core.db import Base, engine
from app.routes.memory import router as memory_router
from app.routes.audit import router as audit_router
from app.models import memory, audit

app = FastAPI(title="MemoryGate")

@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)

@app.get("/health")
def health():
    return {"status": "ok"}

app.include_router(memory_router)
app.include_router(audit_router)
