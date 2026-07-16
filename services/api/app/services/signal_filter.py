"""Rule-based (no-LLM) signal filter applied before a memory write.

Two independent scores decide whether a write proceeds:

- novelty: how similar the text is to what's already stored for this agent
  (via vector search). Handled by the caller using `qdrant_store.find_near_duplicate`;
  this module just defines the bucket thresholds.
- value: would the agent act differently knowing this? A heuristic keyword
  score in [0, 1], compared against the agent's configured `value_threshold`.
"""

ACKNOWLEDGMENTS = {
    "ok", "okay", "yes", "no", "thanks", "thank you", "sure", "got it",
    "cool", "fine", "alright", "k", "yep", "nope", "kk",
}

PREFERENCE_WORDS = ["prefer", "always", "never", "i like", "i hate", "i want", "i decided", "i chose", "favorite", "i love"]
BEHAVIORAL_WORDS = [
    "every time", "whenever", "tends to", "usually", "habit", "pattern of",
    "keep doing", "can't stop", "cant stop", "again", "relapse", "spiraling",
]
RELATIONSHIP_WORDS = ["my friend", "my partner", "my boss", "my mom", "my dad", "my sister", "my brother", "works at", "lives in", "my wife", "my husband"]
GOAL_WORDS = ["goal", "need to", "deadline", "must", "have to", "constraint", "plan to", "trying to"]

NEGATION_WORDS = ["not", "no longer", "stopped", "don't", "never"]

HIGH_VALUE_WEIGHT = 0.3


def score_value(text: str, existing_similar_text: str | None = None) -> float:
    stripped = text.strip().lower().rstrip(".!")
    if stripped in ACKNOWLEDGMENTS:
        return 0.0

    words = text.strip().split()
    lower = text.lower()

    score = 0.0
    if any(w in lower for w in PREFERENCE_WORDS):
        score += HIGH_VALUE_WEIGHT
    if any(w in lower for w in BEHAVIORAL_WORDS):
        score += HIGH_VALUE_WEIGHT
    if any(w in lower for w in RELATIONSHIP_WORDS):
        score += HIGH_VALUE_WEIGHT
    if any(w in lower for w in GOAL_WORDS):
        score += HIGH_VALUE_WEIGHT

    if existing_similar_text and any(w in lower for w in NEGATION_WORDS):
        existing_lower = existing_similar_text.lower()
        if not any(w in existing_lower for w in NEGATION_WORDS):
            score += HIGH_VALUE_WEIGHT

    if score == 0.0 and len(words) < 4:
        return 0.0

    return min(score, 1.0)


NOVELTY_DUPLICATE = "duplicate"
NOVELTY_LOW = "low"
NOVELTY_NEW = "new"


def novelty_bucket(best_score: float | None, novelty_threshold: float) -> str:
    if best_score is None:
        return NOVELTY_NEW
    if best_score >= novelty_threshold:
        return NOVELTY_DUPLICATE
    if best_score >= 0.75:
        return NOVELTY_LOW
    return NOVELTY_NEW
