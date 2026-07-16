import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { useAgent } from '../context/AgentContext';

export default function AgentSelector({ className = '', large = false }) {
  const { agentId, setAgentId, agents, addAgent } = useAgent();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newId, setNewId] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setAdding(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const current = agentId === 'all'
    ? { id: 'all', label: 'All', color: null }
    : agents.find((a) => a.id === agentId) || { id: agentId, label: agentId, color: '#6B7280' };

  const submitAdd = (e) => {
    e.preventDefault();
    if (!newId.trim()) return;
    addAgent(newId);
    setNewId('');
    setAdding(false);
    setOpen(false);
  };

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-2 rounded-lg border border-border bg-surface text-text transition-colors hover:bg-white/[0.04] ${
          large ? 'px-4 py-3 text-base' : 'px-3 py-2 text-sm'
        }`}
      >
        {current.color ? (
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: current.color }} />
        ) : (
          <span className="h-2 w-2 shrink-0 rounded-full border border-muted" />
        )}
        <span className="flex-1 text-left capitalize">{current.label}</span>
        <ChevronDown size={large ? 16 : 14} className="text-muted" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 rounded-lg border border-border bg-surface py-1">
          <button
            onClick={() => { setAgentId('all'); setOpen(false); }}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-white/[0.06] ${agentId === 'all' ? 'text-text' : 'text-muted'}`}
          >
            <span className="h-2 w-2 rounded-full border border-muted" />
            All
          </button>
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => { setAgentId(a.id); setOpen(false); }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm capitalize transition-colors hover:bg-white/[0.06] ${agentId === a.id ? 'text-text' : 'text-muted'}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: a.color }} />
              {a.label}
            </button>
          ))}

          <div className="my-1 border-t border-border" />

          {adding ? (
            <form onSubmit={submitAdd} className="px-3 py-1.5">
              <input
                autoFocus
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                onBlur={() => !newId.trim() && setAdding(false)}
                placeholder="agent_id"
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-text outline-none focus-visible:border-accent"
              />
            </form>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-muted transition-colors hover:bg-white/[0.06] hover:text-text"
            >
              <Plus size={14} /> Add
            </button>
          )}
        </div>
      )}
    </div>
  );
}
