from functools import lru_cache
from sentence_transformers import SentenceTransformer
from app.core.config import EMBED_MODEL

@lru_cache(maxsize=1)
def get_embedding_model() -> SentenceTransformer:
    return SentenceTransformer(EMBED_MODEL)

def embed_text(text: str) -> list[float]:
    model = get_embedding_model()
    vec = model.encode(text, normalize_embeddings=True)
    return [float(x) for x in vec.tolist()]
