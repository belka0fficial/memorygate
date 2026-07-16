"""Scored multi-signal memory classifier.

Each candidate `memory_type` is defined by one or more independent keyword
"signal" lists. A signal fires (contributes weight 1.0) if any phrase in its
list appears in the text — some signals are gated by an exclusion list
instead (e.g. identity traits are disqualified by temporary-language
phrasing). The type with the most fired signals wins; ties are broken by
priority order. Confidence scales with how many signals fired: 1 -> low,
2 -> medium, 3+ -> high.
"""

# priority order used to break ties between types with equal signal counts
TYPE_PRIORITY = [
    "harmful_pattern",
    "stable_preference",
    "identity_trait",
    "humor_style",
    "temporary_phase",
    "support_context",
]

BASE_TYPE_INFO = {
    "harmful_pattern": {"identity_weight": "medium"},
    "stable_preference": {"identity_weight": "medium"},
    "identity_trait": {"identity_weight": "medium"},
    "humor_style": {"identity_weight": "medium"},
    "temporary_phase": {"identity_weight": "low"},
    "support_context": {"identity_weight": "low"},
    "task_context": {"identity_weight": "low"},
}

PREFERENCE_WORDS = ["always", "never", "prefer", "hate when"]
DOMAIN_WORDS = ["build", "code", "design", "food", "sleep", "train", "work"]

IDENTITY_PHRASES = ["i am", "i'm a", "my personality"]
TEMPORARY_LANGUAGE = ["feeling", "today", "right now"]

HUMOR_TERMS = ["dark humor", "sarcasm", "deadpan", "joke style", "humor style"]
PATTERN_LANGUAGE = ["always", "usually", "tend to", "kind of humor", "style of humor"]

TEMPORARY_TIMEFRAMES = ["right now", "lately", "these days", "this week"]
EMOTIONAL_LANGUAGE = ["exhausted", "hate everyone", "disappear", "nothing matters", "sad", "overwhelmed", "anxious", "stressed"]

HARMFUL_BEHAVIOR_INDICATORS = ["again", "keep doing", "can't stop", "relapse", "binge", "self-destructive", "spiraling", "hurting myself"]

SUPPORT_EMOTIONAL_WORDS = ["sad", "upset", "anxious", "stressed", "overwhelmed", "hurt", "struggling", "hard time"]
SUPPORT_TIMEFRAMES = ["today", "right now", "this week"]

# words that would negate an otherwise-matching contradiction signal
NEGATION_WORDS = ["not", "no longer", "stopped", "don't", "never"]


def _count_hits(lower: str, phrases: list[str]) -> int:
    return sum(1 for p in phrases if p in lower)


def _score_stable_preference(lower: str) -> int:
    signals = 0
    if _count_hits(lower, PREFERENCE_WORDS) > 0:
        signals += 1
    if _count_hits(lower, DOMAIN_WORDS) > 0:
        signals += 1
    # both must be present for this to count as a preference at all
    return signals if signals == 2 else 0


def _score_identity_trait(lower: str) -> int:
    if any(w in lower for w in TEMPORARY_LANGUAGE):
        return 0
    return sum(1 for p in IDENTITY_PHRASES if p in lower)


def _score_humor_style(lower: str) -> int:
    signals = 0
    if _count_hits(lower, HUMOR_TERMS) > 0:
        signals += 1
    if _count_hits(lower, PATTERN_LANGUAGE) > 0:
        signals += 1
    return signals


def _score_temporary_phase(lower: str) -> int:
    signals = 0
    if _count_hits(lower, TEMPORARY_TIMEFRAMES) > 0:
        signals += 1
    if _count_hits(lower, EMOTIONAL_LANGUAGE) > 0:
        signals += 1
    return signals


def _score_harmful_pattern(lower: str, source_type: str) -> int:
    signals = 0
    if _count_hits(lower, HARMFUL_BEHAVIOR_INDICATORS) > 0:
        signals += 1
    if source_type == "soulgate_inferred":
        signals += 1
    return signals


def _score_support_context(lower: str) -> int:
    signals = 0
    if _count_hits(lower, SUPPORT_EMOTIONAL_WORDS) > 0:
        signals += 1
    if _count_hits(lower, SUPPORT_TIMEFRAMES) > 0:
        signals += 1
    return signals


def _confidence_for(signal_count: int) -> str:
    if signal_count >= 3:
        return "high"
    if signal_count == 2:
        return "medium"
    return "low"


def classify_memory(text: str, source_type: str = "user") -> dict:
    lower = text.lower()

    scores = {
        "harmful_pattern": _score_harmful_pattern(lower, source_type),
        "stable_preference": _score_stable_preference(lower),
        "identity_trait": _score_identity_trait(lower),
        "humor_style": _score_humor_style(lower),
        "temporary_phase": _score_temporary_phase(lower),
        "support_context": _score_support_context(lower),
    }

    best_type = None
    best_score = 0
    for memory_type in TYPE_PRIORITY:
        score = scores[memory_type]
        if score > best_score:
            best_score = score
            best_type = memory_type

    if best_type is None:
        return {
            "memory_type": "task_context",
            "confidence": "medium",
            "identity_weight": BASE_TYPE_INFO["task_context"]["identity_weight"],
            "summary": text[:280],
        }

    confidence = _confidence_for(best_score)
    identity_weight = BASE_TYPE_INFO[best_type]["identity_weight"]
    if confidence == "high" and identity_weight == "medium":
        identity_weight = "high"

    return {
        "memory_type": best_type,
        "confidence": confidence,
        "identity_weight": identity_weight,
        "summary": text[:280],
    }
