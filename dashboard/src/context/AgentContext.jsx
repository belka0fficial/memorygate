import { createContext, useContext, useState, useCallback } from 'react';

const STORAGE_KEY = 'memorygate_agents';
const SELECTED_KEY = 'memorygate_selected_agent';

export const BUILTIN_AGENTS = [
  { id: 'conker', label: 'Conker', color: '#3B82F6' },
  { id: 'emolga', label: 'Emolga', color: '#10B981' },
  // Isolated by agent_id like any other agent - use this for manual testing
  // and experiments so they never mix into Conker's real model of you.
  { id: 'conker-dev', label: 'Conker (dev)', color: '#6B7280' },
];

const EXTRA_COLORS = ['#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'];

function loadCustomAgents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCustomAgents(agents) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(agents));
}

const AgentContext = createContext(null);

export function AgentProvider({ children }) {
  const [customAgents, setCustomAgents] = useState(loadCustomAgents);
  const [agentId, setAgentIdState] = useState(() => localStorage.getItem(SELECTED_KEY) || 'conker');

  const agents = [...BUILTIN_AGENTS, ...customAgents];

  const setAgentId = useCallback((id) => {
    localStorage.setItem(SELECTED_KEY, id);
    setAgentIdState(id);
  }, []);

  const addAgent = useCallback((id) => {
    const trimmed = id.trim().toLowerCase();
    if (!trimmed) return;
    const exists = BUILTIN_AGENTS.some((a) => a.id === trimmed) || customAgents.some((a) => a.id === trimmed);
    if (!exists) {
      const color = EXTRA_COLORS[customAgents.length % EXTRA_COLORS.length];
      const next = [...customAgents, { id: trimmed, label: trimmed, color }];
      setCustomAgents(next);
      saveCustomAgents(next);
    }
    setAgentId(trimmed);
  }, [customAgents, setAgentId]);

  return (
    <AgentContext.Provider value={{ agentId, setAgentId, agents, addAgent, isAll: agentId === 'all' }}>
      {children}
    </AgentContext.Provider>
  );
}

export function useAgent() {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useAgent must be used within AgentProvider');
  return ctx;
}

export function agentColor(agents, id) {
  return agents.find((a) => a.id === id)?.color || '#6B7280';
}
