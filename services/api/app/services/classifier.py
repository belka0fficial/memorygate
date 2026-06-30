def classify_memory(text: str, source_type: str = "user") -> dict:
    lower = text.lower()

    if any(x in lower for x in ["always", "i am", "i like", "i prefer", "my favorite"]):
        return {
            "memory_type": "stable_preference",
            "confidence": "medium",
            "identity_weight": "medium",
            "summary": text[:280],
        }

    if any(x in lower for x in ["i hate everyone", "i want to disappear", "nothing matters", "i'm exhausted"]):
        return {
            "memory_type": "temporary_phase",
            "confidence": "low",
            "identity_weight": "low",
            "summary": text[:280],
        }

    if any(x in lower for x in ["joke", "sarcasm", "dark humor", "deadpan"]):
        return {
            "memory_type": "humor_style",
            "confidence": "medium",
            "identity_weight": "medium",
            "summary": text[:280],
        }

    return {
        "memory_type": "task_context",
        "confidence": "medium",
        "identity_weight": "low",
        "summary": text[:280],
    }
