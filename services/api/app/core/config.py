import os

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://memorygate:memorygate_dev_password@memorygate-db:5432/memorygate",
)

QDRANT_URL = os.getenv("QDRANT_URL", "http://qdrant:6333")
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "memories")

EMBED_MODEL = os.getenv("EMBED_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
EMBED_DIMENSION = int(os.getenv("EMBED_DIMENSION", "384"))
