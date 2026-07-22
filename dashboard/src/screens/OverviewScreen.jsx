import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowUpRight, Blocks, Boxes, Database, FileSearch, Loader2, Network } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAgent } from '../context/AgentContext';
import { scopeAgentIds } from '../lib/agentScope';
import { timeAgo } from '../lib/timeAgo';
import AgentDot from '../components/AgentDot';

const FEED_COLORS = {
  memory: '#3B82F6',
  entity: '#8B5CF6',
  observation: '#F59E0B',
  pattern: '#10B981',
  clarification: '#EC4899',
};

function StatCard({ label, value, agentIds }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-2xl font-semibold text-text">{value}</div>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
        {label}
        {agentIds.length === 1 && <AgentDot agentId={agentIds[0]} />}
      </div>
    </div>
  );
}

function Section({ title, note, children }) {
  return (
    <section className="mb-8">
      <h2 className="mb-1 text-sm font-medium text-text">{title}</h2>
      {note && <p className="mb-3 text-xs text-muted">{note}</p>}
      <div className="overflow-hidden rounded-xl border border-border bg-surface">{children}</div>
    </section>
  );
}

function Pill({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm">
      <Icon size={14} className="text-accent" />
      <span className="text-muted">{label}</span>
      <span className="ml-auto text-text">{value}</span>
    </div>
  );
}

function healthColor(pct, { healthyMin, healthyMax, redMin, redMax }) {
  if (pct < redMin || pct > redMax) return '#EF4444';
  if (pct >= healthyMin && pct <= healthyMax) return '#10B981';
  return '#F59E0B';
}

function Meter({ label, pct, color }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-medium text-text">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
      </div>
    </div>
  );
}

export default function OverviewScreen() {
  const { agentId, agents } = useAgent();
  const [data, setData] = useState(null);

  const agentIds = useMemo(() => scopeAgentIds(agentId, agents), [agentId, agents]);

  useEffect(() => {
    let cancelled = false;
    setData(null);

    async function load() {
      const perAgent = await Promise.all(agentIds.map(async (id) => {
        const [memories, entities, activePatterns, allPatterns, pendingClar, observations] = await Promise.all([
          api.get('/memory', undefined, id),
          api.get('/entity', undefined, id),
          api.get(`/pattern/active/${id}`, undefined, id).then((r) => r.results),
          api.post('/pattern/search', {}, undefined, id).then((r) => r.results),
          api.post('/observation/search', { needs_clarification: true, status: 'unconfirmed' }, undefined, id).then((r) => r.results),
          api.post('/observation/search', {}, undefined, id).then((r) => r.results),
        ]);
        return { id, memories, entities, activePatterns, allPatterns, pendingClar, observations };
      }));

      const auditRows = await api.get('/audit');
      const relevantAudit = agentId === 'all'
        ? auditRows
        : auditRows.filter((row) => {
          try { return JSON.parse(row.payload_json).agent_id === agentId; } catch { return false; }
        });

      if (!cancelled) setData({ perAgent, auditRows: relevantAudit });
    }

    load();
    return () => { cancelled = true; };
  }, [agentId, agentIds, agents]);

  if (!data) {
    return (
      <div className="p-5 md:p-8">
        <div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      </div>
    );
  }

  const totalMemories = data.perAgent.reduce((n, a) => n + a.memories.length, 0);
  const totalEntities = data.perAgent.reduce((n, a) => n + a.entities.length, 0);
  const totalActivePatterns = data.perAgent.reduce((n, a) => n + a.activePatterns.length, 0);
  const totalPendingClar = data.perAgent.reduce((n, a) => n + a.pendingClar.length, 0);

  const totalObservations = data.perAgent.reduce((n, a) => n + a.observations.length, 0);
  const promotedObsIds = new Set();
  data.perAgent.forEach((a) => a.allPatterns.forEach((p) => p.observation_ids.forEach((id) => promotedObsIds.add(id))));
  const promotionRate = totalObservations > 0 ? (promotedObsIds.size / totalObservations) * 100 : 0;

  const writeAttempts = data.auditRows.filter((r) => ['write', 'filtered', 'upgrade'].includes(r.action));
  const filteredCount = writeAttempts.filter((r) => r.action === 'filtered').length;
  const rejectionRate = writeAttempts.length > 0 ? (filteredCount / writeAttempts.length) * 100 : 0;

  const novelWrites = writeAttempts.filter((r) => {
    if (r.action !== 'write') return false;
    try { return JSON.parse(r.payload_json).low_novelty !== true; } catch { return true; }
  });
  const noveltyRate = writeAttempts.length > 0 ? (novelWrites.length / writeAttempts.length) * 100 : 0;

  const feed = [];
  data.auditRows.forEach((r) => {
    let payload = {};
    try { payload = JSON.parse(r.payload_json); } catch { /* ignore */ }
    const who = payload.agent_id || 'unknown';
    const label = r.action === 'write'
      ? `wrote ${payload.memory_type || 'memory'}`
      : r.action === 'filtered'
        ? 'filtered a low-value write'
        : `${r.action} a memory`;
    feed.push({ type: 'memory', agentId: who, text: `${who} ${label}`, timestamp: r.created_at });
  });
  data.perAgent.forEach(({ id, entities, observations, allPatterns }) => {
    entities.forEach((e) => feed.push({ type: 'entity', agentId: id, text: `${id} created entity "${e.name}"`, timestamp: e.created_at }));
    observations.forEach((o) => feed.push({
      type: o.needs_clarification ? 'clarification' : 'observation',
      agentId: id,
      text: o.needs_clarification ? `${id} flagged something needing clarification` : `${id} logged ${o.signal_type} observation`,
      timestamp: o.observed_at,
    }));
    allPatterns.forEach((p) => feed.push({ type: 'pattern', agentId: id, text: `${id} ${p.status === 'candidate' ? 'formed candidate pattern' : `${p.status} pattern`} "${p.pattern_name}"`, timestamp: p.created_at }));
  });
  feed.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const recentFeed = feed.slice(0, 20);

  return (
    <div className="p-5 md:p-8">
      <div className="mb-6 flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
        <div>
          <span className="eyebrow">Memory operations</span>
          <h1 className="mt-1 text-lg font-medium text-text">Command Center</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">The operational state of your personal memory system: what is arriving, what changed, and what the agent can retrieve right now.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/pipeline" className="icon-action"><Activity size={14} /> Watch pipeline <ArrowUpRight size={13} /></Link>
          <Link to="/database" className="icon-action"><Database size={14} /> Browse database <ArrowUpRight size={13} /></Link>
          <Link to="/windows" className="icon-action"><Boxes size={14} /> Inspect windows <ArrowUpRight size={13} /></Link>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total Memories" value={totalMemories} agentIds={agentIds} />
        <StatCard label="Total Entities" value={totalEntities} agentIds={agentIds} />
        <StatCard label="Active Patterns" value={totalActivePatterns} agentIds={agentIds} />
        <StatCard label="Pending Clarifications" value={totalPendingClar} agentIds={agentIds} />
      </div>

      <Section title="Memory architecture state" note="High-level health across long-term knowledge, entity structure, and signal processing.">
        <div className="grid gap-3 px-4 py-4 md:grid-cols-2 xl:grid-cols-4">
          <Pill icon={Database} label="Long-term objects" value={totalMemories + totalEntities + totalObservations} />
          <Pill icon={Network} label="Knowledge graph nodes" value={totalEntities} />
          <Pill icon={Blocks} label="Promoted beliefs" value={totalActivePatterns} />
          <Pill icon={FileSearch} label="Open clarifications" value={totalPendingClar} />
        </div>
      </Section>

      <Section title="Signal health" note="Quick operational read on what MemoryGate is doing with incoming signal.">
        <div className="flex flex-col gap-5 px-4 py-4">
          <Meter
            label="Observation promotion rate"
            pct={promotionRate}
            color={healthColor(promotionRate, { healthyMin: 5, healthyMax: 15, redMin: 2, redMax: 30 })}
          />
          <Meter label="Signal filter rejection rate" pct={rejectionRate} color="#3B82F6" />
          <Meter label="Memory novelty rate" pct={noveltyRate} color="#3B82F6" />
        </div>
      </Section>

      <Section title="Recent activity" note="Merged feed across writes, entities, observations, and promoted patterns. This is the fastest way to see how the memory system is evolving right now.">
        {recentFeed.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted">No activity yet.</p>
        ) : (
          recentFeed.map((item, i) => (
            <div key={i} className={`flex items-center gap-4 px-4 py-3 text-sm ${i > 0 ? 'border-t border-border' : ''}`}>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: FEED_COLORS[item.type] }} />
              <span className="min-w-0 flex-1 text-text/90">{item.text}</span>
              <div className="hidden shrink-0 sm:block">
                <AgentDot agentId={item.agentId} showLabel />
              </div>
              <span className="shrink-0 text-xs text-muted">{timeAgo(item.timestamp)}</span>
            </div>
          ))
        )}
      </Section>
    </div>
  );
}
