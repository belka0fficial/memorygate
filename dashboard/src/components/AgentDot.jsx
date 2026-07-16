import { useAgent } from '../context/AgentContext';

export default function AgentDot({ agentId, showLabel = false, className = '' }) {
  const { agents } = useAgent();
  const agent = agents.find((a) => a.id === agentId);
  const color = agent?.color || '#6B7280';

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      {showLabel && <span className="capitalize text-muted">{agent?.label || agentId}</span>}
    </span>
  );
}
