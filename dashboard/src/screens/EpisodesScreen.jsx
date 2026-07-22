import { useEffect, useState } from 'react';
import { CalendarRange, Check, Loader2, Plus, Search } from 'lucide-react';
import { api } from '../lib/api';
import { useAgent } from '../context/AgentContext';
import Button from '../components/Button';
import Modal from '../components/Modal';
import TextField, { TextArea } from '../components/TextField';
import ObjectInspector from '../components/ObjectInspector';
import { timeAgo } from '../lib/timeAgo';

function episodeRecord(data) {
  return {
    id: data.id, kind: 'episode', title: data.title, subtitle: data.summary,
    confidence: `${Math.round(data.confidence * 100)}%`, agentId: data.agent_id,
    created: data.created_at || data.occurred_start, updated: data.updated_at, data,
  };
}

export default function EpisodesScreen() {
  const { agentId } = useAgent();
  const [episodes, setEpisodes] = useState(null);
  const [evidence, setEvidence] = useState([]);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState(null);

  const load = async () => {
    const [episodeRows, evidenceRows] = await Promise.all([
      api.get('/lineage/episodes', { limit: 300 }, agentId).then((r) => r.results),
      api.get('/evidence', { limit: 300 }).then((r) => r.results),
    ]);
    setEpisodes(episodeRows);
    setEvidence(evidenceRows);
  };

  useEffect(() => { setEpisodes(null); load(); }, [agentId]);
  const visible = (episodes || []).filter((item) => `${item.title} ${item.summary} ${item.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="p-5 md:p-8">
      <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><h1 className="text-lg font-medium text-text">Episodes</h1><p className="mt-1 text-sm text-muted">Group evidence that belongs to the same real-world event before analysis.</p></div>
        <Button variant="primary" onClick={() => setAdding(true)}><Plus size={15} /> Create episode</Button>
      </div>
      <div className="relative mb-5"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search episodes..." className="w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-3 text-sm text-text outline-none focus:border-accent" /></div>
      {episodes === null ? <div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Loading episodes...</div> : visible.length === 0 ? <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted">No episodes yet. Create one from related evidence.</div> : <div className="overflow-hidden rounded-lg border border-border bg-surface">{visible.map((item, index) => <button key={item.id} onClick={() => setSelected(episodeRecord(item))} className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-white/[0.025] ${index ? 'border-t border-border' : ''}`}><span className="mt-0.5 rounded-md bg-blue-500/10 p-2 text-blue-400"><CalendarRange size={15} /></span><span className="min-w-0 flex-1"><strong className="block text-sm font-medium text-text">{item.title}</strong><span className="mt-1 block truncate text-xs text-muted">{item.summary || 'No summary'}</span><span className="mt-2 flex gap-2 text-[11px] text-muted"><b className="font-normal text-text/70">{item.episode_type}</b><span>{item.status}</span><span>{Math.round(item.confidence * 100)}%</span></span></span><span className="text-[11px] text-muted">{timeAgo(item.occurred_start || item.created_at)}</span></button>)}</div>}
      {adding && <CreateEpisodeModal evidence={evidence} agentId={agentId} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      {selected && <ObjectInspector record={selected} onClose={() => setSelected(null)} onChanged={(_, data) => { setSelected(episodeRecord(data)); setEpisodes((rows) => rows.map((v) => v.id === data.id ? data : v)); }} onRemoved={(record) => { setSelected(null); setEpisodes((rows) => rows.filter((v) => v.id !== record.id)); }} />}
    </div>
  );
}

function CreateEpisodeModal({ evidence, agentId, onClose, onSaved }) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [episodeType, setEpisodeType] = useState('event');
  const [occurredStart, setOccurredStart] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const visible = evidence.filter((item) => `${item.title} ${item.summary} ${item.source_key}`.toLowerCase().includes(filter.toLowerCase())).slice(0, 50);
  const toggle = (id) => setSelectedIds((ids) => ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id]);
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      await api.post('/lineage/episodes', { title, summary, episode_type: episodeType, evidence_ids: selectedIds, occurred_start: occurredStart ? new Date(occurredStart).toISOString() : null }, undefined, agentId);
      onSaved();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  return <Modal title="Create episode" onClose={onClose} width="max-w-2xl"><form onSubmit={submit} className="space-y-4"><TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus /><TextArea label="Summary" value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} /><div className="grid grid-cols-2 gap-3"><TextField label="Episode type" value={episodeType} onChange={(e) => setEpisodeType(e.target.value)} /><TextField label="Occurred at" type="datetime-local" value={occurredStart} onChange={(e) => setOccurredStart(e.target.value)} /></div><div><div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium text-muted">Evidence ({selectedIds.length} selected)</span><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter evidence" className="rounded-md border border-border bg-background px-2 py-1 text-xs text-text outline-none" /></div><div className="max-h-56 overflow-y-auto rounded-lg border border-border">{visible.length === 0 ? <p className="p-4 text-sm text-muted">No evidence available.</p> : visible.map((item, index) => <button type="button" key={item.id} onClick={() => toggle(item.id)} className={`flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-white/[0.025] ${index ? 'border-t border-border' : ''}`}><span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selectedIds.includes(item.id) ? 'border-accent bg-accent text-white' : 'border-border'}`}>{selectedIds.includes(item.id) && <Check size={11} />}</span><span className="min-w-0"><strong className="block truncate text-xs font-medium text-text">{item.title}</strong><span className="block truncate text-[11px] text-muted">{item.source_key} · {item.summary}</span></span></button>)}</div></div>{error && <p className="text-sm text-red-400">{error}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={!title.trim() || saving}>{saving ? 'Creating...' : 'Create episode'}</Button></div></form></Modal>;
}
