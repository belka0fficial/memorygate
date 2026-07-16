// When "all" is selected, every screen fans requests out across every known
// agent and merges the results client-side (no backend "all agents" query
// exists, by design - agent isolation is enforced server-side per request).
export function scopeAgentIds(agentId, agents) {
  return agentId === 'all' ? agents.map((a) => a.id) : [agentId];
}

export async function fetchPerAgent(agentIds, fn) {
  const perAgent = await Promise.all(agentIds.map((id) => fn(id).then((items) => items.map((item) => ({ ...item, agent_id: item.agent_id ?? id })))));
  return perAgent.flat();
}
