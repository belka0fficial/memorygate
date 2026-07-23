---
name: memorygate
description: Retrieve read-only personal memory context before answering user-specific questions.
---

# MemoryGate

Before answering questions about the user's preferences, history, people, routines, projects, or previous decisions, run:

```bash
python services/cli/memorygate.py context "<the question>"
```

Use returned memories and entities as primary context. Treat evidence and episodes as support, not certain truth. Do not use ingestion, invalidation, database writes, or admin keys from an agent session.
