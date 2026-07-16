import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAgent } from '../context/AgentContext';
import { scopeAgentIds } from '../lib/agentScope';
import { timeAgo } from '../lib/timeAgo';
import Modal from '../components/Modal';
import Button from '../components/Button';
import { TextArea } from '../components/TextField';
import AgentDot from '../components/AgentDot';

export default function ClarificationsScreen() {
  const { agentId, agents, isAll } = useAgent();
  const agentIds = useMemo(() => scopeAgentIds(agentId, agents), [agentId, agents]);

  const [items, setItems] = useState(null);
  const [tab, setTab] = useState('pending');
  const [busyId, setBusyId] = useState(null);
  const [resolving, setResolving] = useState(null);

  const load = async () => {
    setItems(null);
    const perAgent = await Promise.all(agentIds.map((id) => api.post('/clarification/search', {}, undefined, id).then((r) => r.results)));
    setItems(perAgent.flat());
  };

  useEffect(() => { load(); }, [agentId]);

  const pending = useMemo(() => (items || []).filter((c) => c.status === 'pending' || c.status === 'asked').sort((a, b) => b.importance - a.importance), [items]);
  const resolved = useMemo(() => (items || []).filter((c) => c.status === 'resolved' || c.status === 'dismissed').sort((a, b) => new Date(b.observed_at) - new Date(a.observed_at)), [items]);

  const archive = async (item) => {
    setBusyId(item.id);
    try {
      const res = await api.post('/clarification/update', { clarification_id: item.id, status: 'dismissed' }, undefined, item.agent_id);
      setItems((prev) => prev.map((c) => (c.id === item.id ? res.clarification : c)));
    } finally {
      setBusyId(null);
    }
  };

  const resolve = async (item, resolvedAnswer) => {
    const res = await api.post('/clarification/update', { clarification_id: item.id, status: 'resolved', resolved_answer: resolvedAnswer }, undefined, item.agent_id);
    setItems((prev) => prev.map((c) => (c.id === item.id ? res.clarification : c)));
    setResolving(null);
  };

  if (items === null) return <div className="p-5 md:p-8"><p className="text-sm text-muted">Loading…</p></div>;

  return (
    <div className="p-5 md:p-8">
      <h1 className="mb-5 text-lg font-medium text-text">Clarifications</h1>

      <div className="mb-5 flex gap-1 rounded-lg border border-border bg-surface p-1 w-fit">
        <button onClick={() => setTab('pending')} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${tab === 'pending' ? 'bg-white/[0.08] text-text' : 'text-muted hover:text-text'}`}>Pending ({pending.length})</button>
        <button onClick={() => setTab('resolved')} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${tab === 'resolved' ? 'bg-white/[0.08] text-text' : 'text-muted hover:text-text'}`}>Resolved ({resolved.length})</button>
      </div>

      {tab === 'pending' && (
        pending.length === 0 ? (
          <p className="text-sm text-muted">Nothing pending.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {pending.map((c) => (
              <div key={c.id} className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-text/90">{c.what_happened}</p>
                  {isAll && <AgentDot agentId={c.agent_id} />}
                </div>

                {c.hypotheses?.length > 0 && (
                  <ul className="list-disc pl-4 text-xs text-muted">
                    {c.hypotheses.map((h, i) => <li key={i}>{typeof h === 'string' ? h : JSON.stringify(h)}</li>)}
                  </ul>
                )}

                {c.ask_after && <p className="text-xs italic text-muted">raise if {c.ask_after}</p>}

                <span className="text-[11px] text-muted">{timeAgo(c.observed_at)}</span>

                <div className="mt-1 flex gap-2">
                  <Button variant="secondary" className="flex-1" disabled={busyId === c.id} onClick={() => setResolving(c)}>Mark Resolved</Button>
                  <Button variant="secondary" className="flex-1" disabled={busyId === c.id} onClick={() => archive(c)}>Archive</Button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'resolved' && (
        resolved.length === 0 ? (
          <p className="text-sm text-muted">Nothing resolved yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-surface divide-y divide-border">
            {resolved.map((c) => (
              <div key={c.id} className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-text/90">{c.what_happened}</p>
                  <span className="shrink-0 text-[11px] text-muted">{timeAgo(c.observed_at)}</span>
                </div>
                {c.resolved_answer ? (
                  <p className="mt-1 text-xs text-status-positive">{c.resolved_answer}</p>
                ) : (
                  <p className="mt-1 text-xs text-muted">Archived without resolution.</p>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {resolving && (
        <ResolveModal item={resolving} onClose={() => setResolving(null)} onResolve={(answer) => resolve(resolving, answer)} />
      )}
    </div>
  );
}

function ResolveModal({ item, onClose, onResolve }) {
  const [answer, setAnswer] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!answer.trim()) return;
    setSaving(true);
    try {
      await onResolve(answer);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="What was the actual answer?" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-muted">{item.what_happened}</p>
        <TextArea label="Resolution" value={answer} onChange={(e) => setAnswer(e.target.value)} rows={4} required autoFocus />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!answer.trim() || saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}
