from app.models.agent_config import AgentConfig

DEFAULTS = dict(
    novelty_threshold=0.90,
    value_threshold=0.3,
    max_observations=150,
    signal_filter_enabled=True,
)


def get_or_create_config(db, agent_id: str) -> AgentConfig:
    row = db.get(AgentConfig, agent_id)
    if row:
        return row

    row = AgentConfig(agent_id=agent_id, **DEFAULTS)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def config_to_dict(row: AgentConfig) -> dict:
    return {
        "agent_id": row.agent_id,
        "novelty_threshold": row.novelty_threshold,
        "value_threshold": row.value_threshold,
        "max_observations": row.max_observations,
        "signal_filter_enabled": row.signal_filter_enabled,
    }
