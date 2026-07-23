import os

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://memorygate:memorygate_dev_password@memorygate-db:5432/memorygate",
)

QDRANT_URL = os.getenv("QDRANT_URL", "http://qdrant:6333")
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "memories")

EMBED_MODEL = os.getenv("EMBED_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
EMBED_DIMENSION = int(os.getenv("EMBED_DIMENSION", "384"))

MEMORYGATE_ADMIN_KEY = os.getenv("MEMORYGATE_ADMIN_KEY", "")

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://memorygate-ollama:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:4b")
OLLAMA_ENABLED = os.getenv("OLLAMA_ENABLED", "true").lower() in {"1", "true", "yes"}
PROCESSING_POLL_SECONDS = float(os.getenv("PROCESSING_POLL_SECONDS", "2"))
BACKUP_DIR = os.getenv("BACKUP_DIR", "/data/backups")
RUNTIME_SECRET_PATH = os.getenv("RUNTIME_SECRET_PATH", "/data/runtime-fernet.key")
