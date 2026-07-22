import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAgent } from '../context/AgentContext';
import { scopeAgentIds } from '../lib/agentScope';
import { timeAgo } from '../lib/timeAgo';
import MemoryTypeBadge from '../components/MemoryTypeBadge';
import AgentDot from '../components/AgentDot';

function PatternRow({ pattern, isAll }) {
  const [open, setOpen] = useState(false);
  const [evidence, setEvidence] = useState(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && evidence === null) {
      const rows = await Promise.all(
        pattern.observation_ids.slice(0, 10).map((id) =>
          api.get(`/observation/${id}`, undefined, pattern.agent_id).catch(() => null),
        ),
      );
      setEvidence(rows.filter(Boolean));
    }
  };

  const sentence = pattern.interpretation || pattern.pattern_name;

  return (
    <div className="rounded-lg border border-border bg-surface">
      <button onClick={toggle} className="flex w-full items-start gap-2.5 p-4 text-left">
        {open ? <ChevronDown size={15} className="mt-0.5 shrink-0 text-muted" /> : <ChevronRight size={15} className="mt-0.5 shrink-0 text-muted" />}
        <div className="flex-1">
          <p className="text-sm text-text">{sentence}</p>
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted">
            <span>confirmed x{pattern.confirmation_count}</span>
            {isAll && <AgentDot agentId={pattern.agent_id} showLabel />}
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-border p-4">
          <span className="mb-2 block text-xs font-medium text-muted">Evidence</span>
          {evidence === null ? (
            <div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={13} className="animate-spin" /> Loading…</div>
          ) : evidence.length === 0 ? (
            <p className="text-sm text-muted">No evidence observations found.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {evidence.map((ev) => (
                <li key={ev.id} className="text-xs text-text/80">
                  <span className="text-muted">[{ev.signal_type}]</span> {ev.description}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function MemoryRow({ memory, isAll }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-surface">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-2.5 p-4 text-left">
        {open ? <ChevronDown size={15} className="mt-0.5 shrink-0 text-muted" /> : <ChevronRight size={15} className="mt-0.5 shrink-0 text-muted" />}
        <div className="flex-1">
          <p className="text-sm text-text">{memory.text}</p>
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted">
            <MemoryTypeBadge type={memory.memory_type} />
            <span>{timeAgo(memory.created_at)}</span>
            {isAll && <AgentDot agentId={memory.agent_id} showLabel />}
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-border p-4">
          <span className="mb-2 block text-xs font-medium text-muted">Evidence</span>
          <p className="text-xs text-text/80">
            This is a durable data object recorded directly from conversation, not derived from a pattern of
            observations. The text above is its primary source form.
          </p>
          {memory.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {memory.tags.map((t) => <span key={t} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">{t}</span>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function BeliefsScreen() {
  const { agentId, agents, isAll } = useAgent();
  const agentIds = useMemo(() => scopeAgentIds(agentId, agents), [agentId, agents]);

  const [patterns, setPatterns] = useState(null);
  const [memories, setMemories] = useState(null);

  useEffect(() => {
    setPatterns(null);
    setMemories(null);

    Promise.all(agentIds.map((id) => api.get(`/pattern/active/${id}`, undefined, id).then((r) => r.results))).then((r) => setPatterns(r.flat()));
    Promise.all(agentIds.map((id) => api.get('/memory', undefined, id))).then((r) => setMemories(r.flat().filter((m) => m.confidence === 'high')));
  }, [agentId]);

  const loading = patterns === null || memories === null;

  return (
    <div className="p-5 md:p-8">
      <h1 className="text-lg font-medium text-text">Knowledge</h1>
      <p className="mb-6 text-sm text-muted">The highest-confidence layer of MemoryGate: promoted patterns and durable data objects ready for direct use.</p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : (
        <div className="flex flex-col gap-8">
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Pattern knowledge</h2>
            {patterns.length === 0 ? (
              <p className="text-sm text-muted">No active patterns yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {patterns.map((p) => <PatternRow key={p.id} pattern={p} isAll={isAll} />)}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Stable data objects</h2>
            {memories.length === 0 ? (
              <p className="text-sm text-muted">No high-confidence memories yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {memories.map((m) => <MemoryRow key={m.id} memory={m} isAll={isAll} />)}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
