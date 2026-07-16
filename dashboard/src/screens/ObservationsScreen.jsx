import { useEffect, useMemo, useState } from 'react';
import { Plus, Check, Ban, Archive, Zap, HelpCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useAgent } from '../context/AgentContext';
import { scopeAgentIds } from '../lib/agentScope';
import { timeAgo } from '../lib/timeAgo';
import StatusBadge from '../components/StatusBadge';
import AgentDot from '../components/AgentDot';
import Modal from '../components/Modal';
import Button from '../components/Button';
import { TextArea } from '../components/TextField';

const TABS = [
  { key: 'unconfirmed', label: 'Active' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'contradicted', label: 'Contradicted' },
  { key: 'archived', label: 'Archived' },
];
const SIGNAL_TYPES = ['all', 'verbal', 'tonal', 'behavioral', 'physical', 'timing', 'emotional'];

function initials(name) {
  return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function exposureColor(count, max) {
  const ratio = max > 0 ? count / max : 0;
  if (ratio >= 0.8) return '#EF4444';
  if (ratio >= 0.5) return '#F59E0B';
  return '#10B981';
}

export default function ObservationsScreen() {
  const { agentId, agents, isAll } = useAgent();
  const agentIds = useMemo(() => scopeAgentIds(agentId, agents), [agentId, agents]);

  const [observations, setObservations] = useState(null);
  const [tab, setTab] = useState('unconfirmed');
  const [signalFilter, setSignalFilter] = useState('all');
  const [needsClarificationOnly, setNeedsClarificationOnly] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [entityNames, setEntityNames] = useState({});

  const load = async () => {
    setObservations(null);
    const perAgent = await Promise.all(agentIds.map((id) => api.post('/observation/search', {}, undefined, id).then((r) => r.results)));
    const all = perAgent.flat();
    setObservations(all);

    const ids = [...new Set(all.flatMap((o) => o.entity_ids))];
    const names = {};
    await Promise.all(agentIds.map(async (id) => {
      const ents = await api.get('/entity', undefined, id);
      ents.forEach((e) => { if (ids.includes(e.id)) names[e.id] = e.name; });
    }));
    setEntityNames(names);
  };

  useEffect(() => { load(); }, [agentId]);

  const filtered = useMemo(() => {
    if (!observations) return [];
    return observations.filter((o) => {
      if (o.status !== tab) return false;
      if (signalFilter !== 'all' && o.signal_type !== signalFilter) return false;
      if (needsClarificationOnly && !o.needs_clarification) return false;
      return true;
    });
  }, [observations, tab, signalFilter, needsClarificationOnly]);

  const act = async (obs, action, extra) => {
    setBusyId(obs.id);
    try {
      const res = await api.post(`/observation/${obs.id}/${action}`, extra || {}, undefined, obs.agent_id);
      setObservations((prev) => prev.map((o) => (o.id === obs.id ? res.observation : o)));
    } finally {
      setBusyId(null);
    }
  };

  const handleUpdate = async (obs, patch) => {
    const res = await api.post(`/observation/update/${obs.id}`, patch, undefined, obs.agent_id);
    setObservations((prev) => prev.map((o) => (o.id === obs.id ? res.observation : o)));
  };

  const handleDelete = async (obs) => {
    await api.del(`/observation/${obs.id}`, undefined, obs.agent_id);
    setObservations((prev) => prev.filter((o) => o.id !== obs.id));
    setExpandedId(null);
  };

  const handleAdd = async (payload) => {
    const targetAgent = isAll ? agentIds[0] : agentId;
    await api.post('/observation/create', payload, undefined, targetAgent);
    setAdding(false);
    load();
  };

  return (
    <div className="p-5 md:p-8">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-lg font-medium text-text">Observations</h1>
        <Button variant="primary" onClick={() => setAdding(true)}><Plus size={15} /> Add Observation</Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${tab === t.key ? 'bg-white/[0.08] text-text' : 'text-muted hover:text-text'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <select value={signalFilter} onChange={(e) => setSignalFilter(e.target.value)}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text outline-none focus-visible:border-accent">
          {SIGNAL_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={needsClarificationOnly} onChange={(e) => setNeedsClarificationOnly(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
          Needs clarification only
        </label>
      </div>

      {observations === null && <p className="text-sm text-muted">Loading…</p>}
      {observations && filtered.length === 0 && <p className="py-12 text-center text-sm text-muted">Nothing here.</p>}

      <div className="flex flex-col gap-3">
        {filtered.map((o) => (
          <ObservationCard
            key={o.id}
            observation={o}
            isAll={isAll}
            expanded={expandedId === o.id}
            onToggleExpand={() => setExpandedId((id) => (id === o.id ? null : o.id))}
            entityNames={entityNames}
            busy={busyId === o.id}
            onConfirm={() => act(o, 'confirm')}
            onContradict={() => act(o, 'contradict')}
            onArchive={() => act(o, 'archive')}
            onSave={(patch) => handleUpdate(o, patch)}
            onDelete={() => handleDelete(o)}
            allObservations={observations}
            onJumpTo={(id) => { setExpandedId(id); }}
          />
        ))}
      </div>

      {adding && (
        <AddObservationModal
          agentIds={agentIds}
          onClose={() => setAdding(false)}
          onCreated={handleAdd}
        />
      )}
    </div>
  );
}

function ObservationCard({
  observation: o, isAll, expanded, onToggleExpand, entityNames, busy,
  onConfirm, onContradict, onArchive, onSave, onDelete, allObservations, onJumpTo,
}) {
  const [status, setStatus] = useState(o.status);
  const [hypothesis, setHypothesis] = useState(o.hypothesis);
  const [hypothesisConfidence, setHypothesisConfidence] = useState(o.hypothesis_confidence);
  const [confirmedBy, setConfirmedBy] = useState(o.confirmed_by);
  const [triggerContext, setTriggerContext] = useState(o.trigger_context);
  const [raiseCondition, setRaiseCondition] = useState(o.raise_condition);
  const [needsClarification, setNeedsClarification] = useState(o.needs_clarification);
  const [saving, setSaving] = useState(false);

  const dirty = status !== o.status || hypothesis !== o.hypothesis || hypothesisConfidence !== o.hypothesis_confidence
    || confirmedBy !== o.confirmed_by || triggerContext !== o.trigger_context
    || raiseCondition !== o.raise_condition || needsClarification !== o.needs_clarification;

  const save = async () => {
    setSaving(true);
    try {
      await onSave({
        status, hypothesis, hypothesis_confidence: Number(hypothesisConfidence),
        confirmed_by: confirmedBy, trigger_context: triggerContext,
        raise_condition: raiseCondition, needs_clarification: needsClarification,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <button onClick={onToggleExpand} className="flex w-full flex-col gap-2 text-left">
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted">{o.signal_type}</span>
          <StatusBadge status={o.status} />
          {o.confirmation_count >= 3 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400">
              <Zap size={11} /> Pattern candidate
            </span>
          )}
          {o.needs_clarification && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-medium text-muted">
              <HelpCircle size={11} /> Needs clarification
            </span>
          )}
          {isAll && <AgentDot agentId={o.agent_id} showLabel />}
          <span className="ml-auto text-[11px] text-muted">{timeAgo(o.observed_at)}</span>
        </div>
        <p className="line-clamp-2 text-sm font-medium text-text/90">{o.hypothesis || <span className="text-muted">No hypothesis yet.</span>}</p>
        <p className="line-clamp-1 text-xs text-muted">{o.description}</p>
        {o.needs_clarification && o.raise_condition && (
          <p className="text-xs italic text-muted">raise if {o.raise_condition}</p>
        )}
      </button>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, (o.exposure_count / Math.max(1, o.max_exposures)) * 100)}%`, background: exposureColor(o.exposure_count, o.max_exposures) }} />
          </div>
          <span className="text-[11px] text-muted">{o.exposure_count}/{o.max_exposures}</span>
        </div>
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">{Math.round(o.hypothesis_confidence * 100)}%</span>
        {o.entity_ids.length > 0 && (
          <div className="flex -space-x-1.5">
            {o.entity_ids.slice(0, 4).map((id) => (
              <span key={id} title={entityNames[id] || id} className="flex h-5 w-5 items-center justify-center rounded-full border border-surface bg-accent/20 text-[9px] font-medium text-accent">
                {initials(entityNames[id] || '?')}
              </span>
            ))}
          </div>
        )}

        {o.status === 'unconfirmed' && (
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" disabled={busy} onClick={onConfirm}><Check size={13} /> Confirm</Button>
            <Button variant="secondary" disabled={busy} onClick={onContradict}><Ban size={13} /> Contradict</Button>
            <Button variant="secondary" disabled={busy} onClick={onArchive}><Archive size={13} /> Archive</Button>
          </div>
        )}
      </div>

      {expanded && (
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
          <div>
            <span className="mb-1 block text-xs font-medium text-muted">Raw context</span>
            <p className="text-sm text-text/90">{o.raw_context || '—'}</p>
          </div>

          {o.related_observation_ids.length > 0 && (
            <div>
              <span className="mb-1 block text-xs font-medium text-muted">Related observations</span>
              <div className="flex flex-wrap gap-2">
                {o.related_observation_ids.map((id) => {
                  const exists = allObservations.some((x) => x.id === id);
                  return (
                    <button key={id} disabled={!exists} onClick={() => onJumpTo(id)}
                      className="rounded-full border border-border px-2 py-0.5 text-[11px] text-accent disabled:text-muted disabled:no-underline hover:underline">
                      {id.slice(0, 8)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <TextArea label="Hypothesis" value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} rows={2} />

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">Hypothesis confidence: {Number(hypothesisConfidence).toFixed(2)}</span>
            <input type="range" min="0" max="1" step="0.05" value={hypothesisConfidence} onChange={(e) => setHypothesisConfidence(e.target.value)} className="w-full accent-accent" />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus-visible:border-accent">
              {['unconfirmed', 'confirmed', 'contradicted', 'archived'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">Confirmed by</span>
            <input value={confirmedBy} onChange={(e) => setConfirmedBy(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus-visible:border-accent" />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">Trigger context</span>
            <input value={triggerContext} onChange={(e) => setTriggerContext(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus-visible:border-accent" />
          </label>

          <label className="flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={needsClarification} onChange={(e) => setNeedsClarification(e.target.checked)} className="h-4 w-4 accent-accent" />
            Needs clarification
          </label>

          {needsClarification && (
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted">Raise condition (when to surface this)</span>
              <input value={raiseCondition} onChange={(e) => setRaiseCondition(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus-visible:border-accent" />
            </label>
          )}

          <div className="flex justify-between gap-2">
            <Button variant="danger" onClick={onDelete}>Delete</Button>
            <Button variant="primary" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddObservationModal({ agentIds, onClose, onCreated }) {
  const [signalType, setSignalType] = useState('verbal');
  const [description, setDescription] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [hypothesisConfidence, setHypothesisConfidence] = useState('medium');
  const [triggerContext, setTriggerContext] = useState('');
  const [needsClarification, setNeedsClarification] = useState(false);
  const [raiseCondition, setRaiseCondition] = useState('');
  const [entityQuery, setEntityQuery] = useState('');
  const [entityResults, setEntityResults] = useState([]);
  const [selectedEntities, setSelectedEntities] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!entityQuery.trim()) { setEntityResults([]); return; }
    const t = setTimeout(async () => {
      const perAgent = await Promise.all(agentIds.map((id) => api.post('/entity/search', { query: entityQuery }, undefined, id).then((r) => r.results)));
      setEntityResults(perAgent.flat().filter((e) => !selectedEntities.some((s) => s.id === e.id)));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityQuery]);

  const confidenceValue = { high: 0.9, medium: 0.5, low: 0.2 }[hypothesisConfidence];

  const submit = async (e) => {
    e.preventDefault();
    if (!description.trim()) return;
    setSaving(true);
    try {
      await onCreated({
        signal_type: signalType,
        description,
        hypothesis,
        hypothesis_confidence: confidenceValue,
        trigger_context: triggerContext,
        needs_clarification: needsClarification,
        raise_condition: raiseCondition,
        entity_ids: selectedEntities.map((e) => e.id),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Add Observation" onClose={onClose} width="max-w-lg">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Signal type</span>
          <select value={signalType} onChange={(e) => setSignalType(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus-visible:border-accent">
            {SIGNAL_TYPES.filter((s) => s !== 'all').map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <TextArea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} required autoFocus />
        <TextArea label="Hypothesis" value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} rows={2} />

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Hypothesis confidence</span>
          <select value={hypothesisConfidence} onChange={(e) => setHypothesisConfidence(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus-visible:border-accent">
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Trigger context</span>
          <input value={triggerContext} onChange={(e) => setTriggerContext(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus-visible:border-accent" />
        </label>

        <label className="flex items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={needsClarification} onChange={(e) => setNeedsClarification(e.target.checked)} className="h-4 w-4 accent-accent" />
          Needs clarification
        </label>

        {needsClarification && (
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">Raise condition (when to surface this)</span>
            <input value={raiseCondition} onChange={(e) => setRaiseCondition(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus-visible:border-accent" />
          </label>
        )}

        <div>
          <span className="mb-1.5 block text-xs font-medium text-muted">Linked entities</span>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {selectedEntities.map((e) => (
              <span key={e.id} className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-text">
                {e.name}
                <button type="button" onClick={() => setSelectedEntities((prev) => prev.filter((x) => x.id !== e.id))} className="text-muted hover:text-text">×</button>
              </span>
            ))}
          </div>
          <div className="relative">
            <input value={entityQuery} onChange={(e) => setEntityQuery(e.target.value)} placeholder="Search entity by name…"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus-visible:border-accent" />
            {entityResults.length > 0 && (
              <div className="absolute left-0 right-0 z-10 mt-1 max-h-32 overflow-y-auto rounded-lg border border-border bg-surface">
                {entityResults.map((r) => (
                  <button key={r.id} type="button" onClick={() => { setSelectedEntities((prev) => [...prev, r]); setEntityQuery(''); setEntityResults([]); }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-text hover:bg-white/[0.06]">
                    {r.name} <span className="text-xs text-muted">{r.entity_type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-1 flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!description.trim() || saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}
