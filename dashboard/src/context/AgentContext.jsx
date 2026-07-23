import { createContext, useContext } from 'react';

export const PRIMARY_AGENT = { id: 'conker', label: 'Conker', color: '#3B82F6' };

const AgentContext = createContext(null);

export function AgentProvider({ children }) {
  return (
    <AgentContext.Provider value={{ agentId: PRIMARY_AGENT.id, agents: [PRIMARY_AGENT], isAll: false }}>
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
  return PRIMARY_AGENT.color;
}
