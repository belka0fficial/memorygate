def classify_memory(text: str, source_type: str = "user") -> dict:
    lower = text.lower()

    if any(x in lower for x in ["dark humor", "sarcasm", "deadpan", "joke style", "humor style"]):
        return {
            "memory_type": "humor_style",
            "confidence": "medium",
            "identity_weight": "medium",
            "summary": text[:280],
        }

    if any(x in lower for x in ["i prefer", "prefers", "my favorite", "i like", "always", "usually"]) and any(
        x in lower for x in ["build", "workflow", "before", "architecture", "sidecars"]
    ):
        return {
            "memory_type": "stable_preference",
            "confidence": "medium",
            "identity_weight": "medium",
            "summary": text[:280],
        }

    if any(x in lower for x in ["i am", "i'm", "my personality", "my style"]):
        return {
            "memory_type": "identity_trait",
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

    return {
        "memory_type": "task_context",
        "confidence": "medium",
        "identity_weight": "low",
        "summary": text[:280],
    }
