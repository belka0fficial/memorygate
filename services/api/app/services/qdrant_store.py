from functools import lru_cache
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue
from app.core.config import QDRANT_URL, QDRANT_COLLECTION, EMBED_DIMENSION
from app.services.embeddings import embed_text

OBSERVATION_COLLECTION = f"{QDRANT_COLLECTION}_observations"


@lru_cache(maxsize=1)
def get_qdrant_client() -> QdrantClient:
    return QdrantClient(url=QDRANT_URL, check_compatibility=False)


def _ensure_collection(name: str) -> None:
    client = get_qdrant_client()
    collections = client.get_collections().collections
    names = {c.name for c in collections}
    if name not in names:
        client.create_collection(
            collection_name=name,
            vectors_config=VectorParams(size=EMBED_DIMENSION, distance=Distance.COSINE),
        )


def ensure_qdrant_collection() -> None:
    _ensure_collection(QDRANT_COLLECTION)


def ensure_observation_collection() -> None:
    _ensure_collection(OBSERVATION_COLLECTION)


def _build_filter(agent_id: str | None = None, extra: dict | None = None) -> Filter | None:
    conditions = []
    if agent_id:
        conditions.append(FieldCondition(key="agent_id", match=MatchValue(value=agent_id)))
    if extra:
        for key, value in extra.items():
            if value is not None:
                conditions.append(FieldCondition(key=key, match=MatchValue(value=value)))
    return Filter(must=conditions) if conditions else None


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


def search_memory_embeddings(query: str, limit: int = 20, agent_id: str | None = None) -> list[dict]:
    client = get_qdrant_client()
    query_vector = embed_text(query)
    hits = client.search(
        collection_name=QDRANT_COLLECTION,
        query_vector=query_vector,
        query_filter=_build_filter(agent_id),
        limit=limit,
        with_payload=True,
        with_vectors=False,
    )
    return [{"id": str(hit.id), "score": float(hit.score)} for hit in hits]


def delete_memory_embedding(memory_id: str) -> None:
    client = get_qdrant_client()
    client.delete(collection_name=QDRANT_COLLECTION, points_selector=[memory_id])


def find_near_duplicate(text: str, limit: int = 3, agent_id: str | None = None) -> list[dict]:
    client = get_qdrant_client()
    query_vector = embed_text(text)
    hits = client.search(
        collection_name=QDRANT_COLLECTION,
        query_vector=query_vector,
        query_filter=_build_filter(agent_id),
        limit=limit,
        with_payload=True,
        with_vectors=False,
    )
    return [
        {
            "id": str(hit.id),
            "score": float(hit.score),
            "payload": hit.payload or {},
        }
        for hit in hits
    ]


def upsert_observation_embedding(observation_id: str, text: str, payload: dict | None = None) -> None:
    client = get_qdrant_client()
    vector = embed_text(text)
    client.upsert(
        collection_name=OBSERVATION_COLLECTION,
        points=[
            PointStruct(
                id=observation_id,
                vector=vector,
                payload=payload or {},
            )
        ],
    )


def delete_observation_embedding(observation_id: str) -> None:
    client = get_qdrant_client()
    client.delete(collection_name=OBSERVATION_COLLECTION, points_selector=[observation_id])


def find_similar_observations(
    text: str, agent_id: str, signal_type: str | None = None, limit: int = 3
) -> list[dict]:
    client = get_qdrant_client()
    query_vector = embed_text(text)
    hits = client.search(
        collection_name=OBSERVATION_COLLECTION,
        query_vector=query_vector,
        query_filter=_build_filter(agent_id, {"signal_type": signal_type}),
        limit=limit,
        with_payload=True,
        with_vectors=False,
    )
    return [
        {
            "id": str(hit.id),
            "score": float(hit.score),
            "payload": hit.payload or {},
        }
        for hit in hits
    ]
