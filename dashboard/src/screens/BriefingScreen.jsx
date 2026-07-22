import { useEffect, useState } from 'react';
import { Sunrise, RefreshCw, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAgent } from '../context/AgentContext';

function initials(name) {
  return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function tokenColor(count) {
  if (count < 200) return '#10B981';
  if (count <= 280) return '#F59E0B';
  return '#EF4444';
}

function Section({ title, children }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </div>
  );
}

export default function BriefingScreen() {
  const { agentId } = useAgent();
  const [briefing, setBriefing] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/briefing/${agentId}`, undefined, agentId);
      setBriefing(res);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [agentId]);

  const tokenCount = briefing ? Math.ceil(JSON.stringify(briefing).length / 4) : 0;

  return (
    <div className="p-5 md:p-8">
      <h1 className="mb-2 text-center text-lg font-medium text-text">Realtime Window</h1>
      <p className="mb-6 text-center text-sm text-muted">A live, session-ready assembly of the most relevant memory for immediate conversation use.</p>
      {!briefing && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      )}

      {briefing && (
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          <div className="rounded-lg border border-border bg-surface p-5 text-center">
            <Sunrise size={28} className="mx-auto mb-2 text-accent" />
            {briefing.emotional_state ? (
              <p className="text-base text-text">{briefing.emotional_state}</p>
            ) : (
              <p className="text-sm text-muted">No recent emotional signal</p>
            )}
          </div>

          <Section title="Mood & streaks">
            {briefing.mood_summary && <p className="mb-3 text-sm text-text/90">{briefing.mood_summary}</p>}
            {briefing.active_streaks.length === 0 ? (
              <p className="text-sm text-muted">No active streaks.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {briefing.active_streaks.map((s, i) => (
                  <span key={i} className={`rounded-full px-2.5 py-1 text-xs font-medium ${s.count >= 2 ? 'bg-amber-500/10 text-amber-400' : 'bg-white/5 text-muted'}`}>
                    {s.name}: {s.count}
                  </span>
                ))}
              </div>
            )}
          </Section>

          <Section title="Open clarifications">
            {briefing.pending_clarifications.length === 0 ? (
              <p className="text-sm text-muted">Nothing pending.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {briefing.pending_clarifications.slice(0, 2).map((c) => (
                  <li key={c.id} className="text-sm text-text/90">
                    {c.what}
                    {c.trigger_condition && (
                      <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">{c.trigger_condition}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Active tasks">
            {briefing.active_tasks.length === 0 ? (
              <p className="text-sm text-muted">No active tasks.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {briefing.active_tasks.map((t) => (
                  <div key={t.entity_id} className="rounded-lg border border-border p-3">
                    <p className="text-sm font-medium text-text">{t.name}</p>
                    <p className="text-xs text-muted">
                      {t.status || 'in progress'}
                      {t.sessions_stuck > 0 && ` · stuck ${t.sessions_stuck} session${t.sessions_stuck === 1 ? '' : 's'}`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="People">
            {briefing.people_relevant.length === 0 ? (
              <p className="text-sm text-muted">No relevant people.</p>
            ) : (
              <div className="flex flex-wrap gap-4">
                {briefing.people_relevant.map((p) => (
                  <div key={p.entity_id} className="flex w-32 flex-col items-center gap-2 text-center">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15 text-sm font-medium text-accent">
                      {initials(p.name)}
                    </span>
                    <div>
                      <p className="text-sm text-text">{p.name}</p>
                      {p.note && <p className="text-[11px] text-muted">{p.note}</p>}
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-white/5">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${p.warmth_level * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Watch flags">
            {briefing.watch_flags.length === 0 ? (
              <p className="text-sm text-muted">Nothing flagged.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {briefing.watch_flags.map((f, i) => (
                  <span key={i} className="rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-400">{f}</span>
                ))}
              </div>
            )}
          </Section>

          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="text-muted">Estimated tokens: {tokenCount} / 300</span>
              <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-text hover:bg-white/[0.06]">
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh Briefing
              </button>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, (tokenCount / 300) * 100)}%`, background: tokenColor(tokenCount) }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
