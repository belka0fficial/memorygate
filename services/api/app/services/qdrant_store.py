from functools import lru_cache
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct
from app.core.config import QDRANT_URL, QDRANT_COLLECTION, EMBED_DIMENSION
from app.services.embeddings import embed_text

@lru_cache(maxsize=1)
def get_qdrant_client() -> QdrantClient:
    return QdrantClient(url=QDRANT_URL)

def ensure_qdrant_collection() -> None:
    client = get_qdrant_client()
    collections = client.get_collections().collections
    names = {c.name for c in collections}
    if QDRANT_COLLECTION not in names:
        client.create_collection(
            collection_name=QDRANT_COLLECTION,
            vectors_config=VectorParams(size=EMBED_DIMENSION, distance=Distance.COSINE),
        )

def upsert_memory_embedding(memory_id: str, text: str, payload: dict | None = None) -> None:
    client = get_qdrant_client()
    vector = embed_text(text)
    client.upsert(
        collection_name=QDRANT_COLLECTION,
        points=[
            PointStruct(
                id=memory_id,
                vector=vector,
                payload=payload or {},
            )
        ],
    )

def search_memory_embeddings(query: str, limit: int = 20) -> list[str]:
    client = get_qdrant_client()
    query_vector = embed_text(query)
    hits = client.search(
        collection_name=QDRANT_COLLECTION,
        query_vector=query_vector,
        limit=limit,
        with_payload=True,
    )
    return [str(hit.id) for hit in hits]
