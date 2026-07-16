def memory_rank_bonus(memory_type: str, confidence: str) -> float:
    type_bonus = {
        "fact": 0.45,
        "watch": 0.40,
        "context": 0.10,
        "phase": -0.05,
    }.get(memory_type, 0.0)

    confidence_bonus = {
        "high": 0.20,
        "medium": 0.10,
        "low": 0.0,
    }.get(confidence, 0.0)

    return type_bonus + confidence_bonus

def memory_strength(memory_type: str, confidence: str) -> float:
    return memory_rank_bonus(memory_type, confidence)
