import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { useAgent } from '../context/AgentContext';
import { scopeAgentIds } from '../lib/agentScope';
import { timeAgo } from '../lib/timeAgo';
import Button from '../components/Button';
import AgentDot from '../components/AgentDot';

const PROMOTE_AT_CONFIRMATIONS = 5;
// Mirrors MAX_PATTERN_CONFIDENCE in services/pattern_promotion.py - a pattern
// that could show 100% could never be doubted, which means it could never
// be deprecated. This derived ratio bypasses the backend's stored (already
// capped) confidence field, so it needs its own cap.
const MAX_CONFIDENCE = 0.95;

function derivedConfidence(p) {
  const total = p.confirmation_count + p.contradiction_count;
  const raw = total > 0 ? p.confirmation_count / total : p.confidence;
  return Math.min(raw, MAX_CONFIDENCE);
}

function PatternCard({ pattern, isAll, busy, onConfirm, onContradict, onDismiss, candidate }) {
  const barMax = Math.max(pattern.confirmation_count, pattern.contradiction_count, 1);
  const confidence = derivedConfidence(pattern);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-base font-bold text-text">{pattern.pattern_name}</p>
          <p className="mt-0.5 text-xs text-muted">{pattern.description}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {candidate && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400">Candidate</span>}
          {isAll && <AgentDot agentId={pattern.agent_id} showLabel />}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-24 shrink-0 text-[11px] text-muted">Confirmations</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
          <div className="h-full rounded-full bg-blue-500" style={{ width: `${(pattern.confirmation_count / barMax) * 100}%` }} />
        </div>
        <span className="w-5 text-right text-[11px] text-muted">{pattern.confirmation_count}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-24 shrink-0 text-[11px] text-muted">Contradictions</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
          <div className="h-full rounded-full bg-red-500" style={{ width: `${(pattern.contradiction_count / barMax) * 100}%` }} />
        </div>
        <span className="w-5 text-right text-[11px] text-muted">{pattern.contradiction_count}</span>
      </div>

      <div className="flex items-center justify-between text-xs text-muted">
        <span>Confidence: <span className="text-text">{Math.round(confidence * 100)}%</span></span>
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px]">{pattern.instance_count} instances</span>
      </div>

      {candidate && (
        <p className="text-xs text-muted">
          {pattern.confirmation_count >= PROMOTE_AT_CONFIRMATIONS
            ? 'Ready to activate.'
            : `${PROMOTE_AT_CONFIRMATIONS - pattern.confirmation_count} more confirmation${PROMOTE_AT_CONFIRMATIONS - pattern.confirmation_count === 1 ? '' : 's'} to activate`}
        </p>
      )}

      <div className="mt-1 flex gap-2">
        {candidate && (
          <Button variant="secondary" className="flex-1" disabled={busy} onClick={onConfirm}>Confirm</Button>
        )}
        <Button variant="secondary" className="flex-1" disabled={busy} onClick={onContradict}>Contradict</Button>
        {candidate && (
          <Button variant="secondary" className="flex-1" disabled={busy} onClick={onDismiss}>Dismiss</Button>
        )}
      </div>
    </div>
  );
}

export default function PatternsScreen() {
  const { agentId, agents, isAll } = useAgent();
  const agentIds = useMemo(() => scopeAgentIds(agentId, agents), [agentId, agents]);

  const [patterns, setPatterns] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [candidatesOpen, setCandidatesOpen] = useState(true);

  const load = async () => {
    setPatterns(null);
    const perAgent = await Promise.all(agentIds.map((id) => api.post('/pattern/search', {}, undefined, id).then((r) => r.results)));
    setPatterns(perAgent.flat());
  };

  useEffect(() => { load(); }, [agentId]);

  const act = async (pattern, action, extra) => {
    setBusyId(pattern.id);
    try {
      const res = action === 'dismiss'
        ? await api.post(`/pattern/update/${pattern.id}`, { status: 'deprecated' }, undefined, pattern.agent_id)
        : await api.post(`/pattern/${pattern.id}/${action}`, extra || {}, undefined, pattern.agent_id);
      const updated = res.pattern;
      setPatterns((prev) => prev.map((p) => (p.id === pattern.id ? updated : p)));
    } finally {
      setBusyId(null);
    }
  };

  if (patterns === null) return <div className="p-5 md:p-8"><p className="text-sm text-muted">Loading…</p></div>;

  const active = patterns.filter((p) => p.status === 'active');
  const candidates = patterns.filter((p) => p.status === 'candidate');

  return (
    <div className="p-5 md:p-8">
      <h1 className="mb-5 text-lg font-medium text-text">Patterns</h1>

      <section className="mb-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Active ({active.length})</h2>
        {active.length === 0 ? (
          <p className="text-sm text-muted">No active patterns yet. Patterns form from 3+ converging observations.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {active.map((p) => (
              <PatternCard key={p.id} pattern={p} isAll={isAll} busy={busyId === p.id}
                onContradict={() => act(p, 'contradict')} />
            ))}
          </div>
        )}
      </section>

      <section>
        <button onClick={() => setCandidatesOpen((o) => !o)} className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted hover:text-text">
          {candidatesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Candidates ({candidates.length})
        </button>
        {candidatesOpen && (
          candidates.length === 0 ? (
            <p className="text-sm text-muted">No candidates. Confirm observations to build patterns.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {candidates.map((p) => (
                <PatternCard key={p.id} pattern={p} isAll={isAll} candidate busy={busyId === p.id}
                  onConfirm={() => act(p, 'confirm')} onContradict={() => act(p, 'contradict')} onDismiss={() => act(p, 'dismiss')} />
              ))}
            </div>
          )
        )}
      </section>
    </div>
  );
}
