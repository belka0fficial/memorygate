def memory_rank_bonus(memory_type: str, identity_weight: str, confidence: str) -> float:
    type_bonus = {
        "stable_preference": 0.45,
        "identity_trait": 0.35,
        "humor_style": 0.20,
        "task_context": 0.10,
        "temporary_phase": -0.10,
    }.get(memory_type, 0.0)

    identity_bonus = {
        "high": 0.25,
        "medium": 0.10,
        "low": 0.0,
    }.get(identity_weight, 0.0)

    confidence_bonus = {
        "high": 0.20,
        "medium": 0.10,
        "low": 0.0,
    }.get(confidence, 0.0)

    return type_bonus + identity_bonus + confidence_bonus

def memory_strength(memory_type: str, identity_weight: str, confidence: str) -> float:
    return memory_rank_bonus(memory_type, identity_weight, confidence)
