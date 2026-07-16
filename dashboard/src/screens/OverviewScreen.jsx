import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
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

function StatCard({ label, value, agentIds, agents }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-2xl font-semibold text-text">{value}</div>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
        {label}
        {agentIds.length === 1 && <AgentDot agentId={agentIds[0]} />}
      </div>
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
          api.post('/clarification/search', { status: 'pending' }, undefined, id).then((r) => r.results),
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
  data.perAgent.forEach(({ id, entities, observations, allPatterns, pendingClar }) => {
    entities.forEach((e) => feed.push({ type: 'entity', agentId: id, text: `${id} created entity "${e.name}"`, timestamp: e.created_at }));
    observations.forEach((o) => feed.push({ type: 'observation', agentId: id, text: `${id} logged ${o.signal_type} observation`, timestamp: o.observed_at }));
    allPatterns.forEach((p) => feed.push({ type: 'pattern', agentId: id, text: `${id} ${p.status === 'candidate' ? 'formed candidate pattern' : `${p.status} pattern`} "${p.pattern_name}"`, timestamp: p.created_at }));
    pendingClar.forEach((c) => feed.push({ type: 'clarification', agentId: id, text: `${id} filed a clarification`, timestamp: c.observed_at }));
  });
  feed.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const recentFeed = feed.slice(0, 20);

  return (
    <div className="p-5 md:p-8">
      <h1 className="mb-5 text-lg font-medium text-text">Overview</h1>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total Memories" value={totalMemories} agentIds={agentIds} />
        <StatCard label="Total Entities" value={totalEntities} agentIds={agentIds} />
        <StatCard label="Active Patterns" value={totalActivePatterns} agentIds={agentIds} />
        <StatCard label="Pending Clarifications" value={totalPendingClar} agentIds={agentIds} />
      </div>

      <div className="mb-6 rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted">Signal health</h2>
        <div className="flex flex-col gap-4">
          <Meter
            label="Observation promotion rate"
            pct={promotionRate}
            color={healthColor(promotionRate, { healthyMin: 5, healthyMax: 15, redMin: 2, redMax: 30 })}
          />
          <Meter label="Signal filter rejection rate" pct={rejectionRate} color="#3B82F6" />
          <Meter label="Memory novelty rate" pct={noveltyRate} color="#3B82F6" />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Activity</h2>
        {recentFeed.length === 0 ? (
          <p className="text-sm text-muted">No activity yet.</p>
        ) : (
          <div className="flex max-h-96 flex-col gap-2.5 overflow-y-auto">
            {recentFeed.map((item, i) => (
              <div key={i} className="flex items-center gap-2.5 text-sm">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: FEED_COLORS[item.type] }} />
                <span className="flex-1 truncate text-text/90">{item.text}</span>
                <span className="shrink-0 text-xs text-muted">{timeAgo(item.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
