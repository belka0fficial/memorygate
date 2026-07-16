import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Loader2, Plus, ShieldOff, CalendarClock } from 'lucide-react';
import { api } from '../lib/api';
import { useAgent } from '../context/AgentContext';
import { scopeAgentIds } from '../lib/agentScope';
import { timeAgo } from '../lib/timeAgo';
import MemoryTypeBadge, { MEMORY_TYPES } from '../components/MemoryTypeBadge';
import SidePanel from '../components/SidePanel';
import Modal from '../components/Modal';
import Button from '../components/Button';
import TextField, { TextArea } from '../components/TextField';
import AgentDot from '../components/AgentDot';

const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];

function isoToDateInput(iso) {
  return iso ? iso.slice(0, 10) : '';
}

export default function MemoriesScreen() {
  const { agentId, agents, isAll } = useAgent();
  const agentIds = useMemo(() => scopeAgentIds(agentId, agents), [agentId, agents]);

  const [memories, setMemories] = useState(null);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [wasSearch, setWasSearch] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const [confidenceFilter, setConfidenceFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const [selected, setSelected] = useState(null);
  const [adding, setAdding] = useState(false);
  const debounceRef = useRef(null);

  const loadAll = async () => {
    setMemories(null);
    setWasSearch(false);
    const perAgent = await Promise.all(agentIds.map((id) => api.get('/memory', undefined, id)));
    setMemories(perAgent.flat());
  };

  useEffect(() => { loadAll(); }, [agentId]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!search.trim()) {
      loadAll();
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const perAgent = await Promise.all(agentIds.map((id) => api.post('/memory/search', { query: search }, undefined, id).then((r) => r.results)));
        setMemories(perAgent.flat());
        setWasSearch(true);
        setSort('relevant');
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const filtered = useMemo(() => {
    if (!memories) return [];
    let list = memories.filter((m) => {
      if (typeFilter !== 'all' && m.memory_type !== typeFilter) return false;
      if (confidenceFilter !== 'all' && m.confidence !== confidenceFilter) return false;
      return true;
    });
    list = [...list];
    if (sort === 'newest') list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    else if (sort === 'oldest') list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    else if (sort === 'relevant' && wasSearch) list.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
    return list;
  }, [memories, typeFilter, confidenceFilter, sort, wasSearch]);

  const handleDelete = async (memory) => {
    await api.del(`/memory/${memory.id}`, undefined, memory.agent_id);
    setSelected(null);
    setMemories((prev) => prev.filter((m) => m.id !== memory.id));
  };

  const handleSave = async (memory, patch) => {
    const res = await api.patch(`/memory/${memory.id}`, patch, undefined, memory.agent_id);
    setMemories((prev) => prev.map((m) => (m.id === memory.id ? res.memory : m)));
    setSelected(res.memory);
  };

  const handleAdd = async (payload) => {
    const targetAgent = isAll ? agentIds[0] : agentId;
    const res = await api.post('/memory/write', payload, undefined, targetAgent);
    setAdding(false);
    if (res.status === 'ok') loadAll();
    return res;
  };

  return (
    <div className="p-5 md:p-8">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-lg font-medium text-text">Memories</h1>
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plus size={15} /> Add Memory
        </Button>
      </div>

      <div className="relative mb-4">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search memories..."
          className="w-full rounded-lg border border-border bg-surface py-3 pl-10 pr-4 text-sm text-text placeholder:text-muted/70 outline-none transition-colors focus-visible:border-accent"
        />
        {searching && <Loader2 size={15} className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-muted" />}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text outline-none focus-visible:border-accent">
          <option value="all">All types</option>
          {MEMORY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

        <select value={confidenceFilter} onChange={(e) => setConfidenceFilter(e.target.value)}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text outline-none focus-visible:border-accent">
          <option value="all">All confidence</option>
          {CONFIDENCE_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <select value={sort} onChange={(e) => setSort(e.target.value)}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text outline-none focus-visible:border-accent">
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="relevant" disabled={!wasSearch}>Most relevant</option>
        </select>

        <span className="ml-auto text-xs text-muted">{filtered.length} shown</span>
      </div>

      {memories === null && (
        <div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      )}

      {memories && filtered.length === 0 && (
        <p className="py-12 text-center text-sm text-muted">No memories found.</p>
      )}

      {memories && filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filtered.map((m) => (
            <button
              key={m.id}
              onClick={() => setSelected(m)}
              className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface p-4 text-left transition-colors hover:border-accent/40"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <MemoryTypeBadge type={m.memory_type} />
                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">{m.confidence}</span>
                  {m.do_not_generalize && (
                    <span title="Do not generalize from this memory"><ShieldOff size={13} className="text-amber-400" /></span>
                  )}
                </div>
                {wasSearch && m.similarity != null && (
                  <span className="text-[11px] text-muted">{Math.round(Math.max(0, m.similarity) * 100)}%</span>
                )}
              </div>
              <p className="line-clamp-3 text-sm text-text/90">{m.text}</p>
              <div className="mt-auto flex items-center gap-2 text-[11px] text-muted">
                {isAll && <AgentDot agentId={m.agent_id} />}
                <span>{m.source_type}</span>
                <span>· {timeAgo(m.created_at)}</span>
                {m.memory_type === 'phase' && m.review_by && (
                  <span className="ml-auto flex items-center gap-1 text-mem-phase">
                    <CalendarClock size={11} /> review {isoToDateInput(m.review_by)}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <MemoryDetailPanel memory={selected} onClose={() => setSelected(null)} onDelete={handleDelete} onSave={handleSave} />
      )}

      {adding && (
        <AddMemoryModal onClose={() => setAdding(false)} onSave={handleAdd} defaultAgent={isAll ? agentIds[0] : agentId} />
      )}
    </div>
  );
}

function MemoryDetailPanel({ memory, onClose, onDelete, onSave }) {
  const [text, setText] = useState(memory.text);
  const [memoryType, setMemoryType] = useState(memory.memory_type);
  const [confidence, setConfidence] = useState(memory.confidence);
  const [doNotGeneralize, setDoNotGeneralize] = useState(memory.do_not_generalize);
  const [reviewBy, setReviewBy] = useState(isoToDateInput(memory.review_by));
  const [tags, setTags] = useState(memory.tags.join(', '));
  const [saving, setSaving] = useState(false);

  const dirty = text !== memory.text || memoryType !== memory.memory_type || confidence !== memory.confidence
    || doNotGeneralize !== memory.do_not_generalize || reviewBy !== isoToDateInput(memory.review_by)
    || tags !== memory.tags.join(', ');

  const save = async () => {
    setSaving(true);
    try {
      await onSave(memory, {
        text,
        memory_type: memoryType,
        confidence,
        do_not_generalize: doNotGeneralize,
        review_by: reviewBy ? new Date(reviewBy).toISOString() : null,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SidePanel title="Memory detail" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <TextArea label="Text" value={text} onChange={(e) => setText(e.target.value)} rows={5} />

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Memory type</span>
          <select value={memoryType} onChange={(e) => setMemoryType(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus-visible:border-accent">
            {MEMORY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Confidence</span>
          <select value={confidence} onChange={(e) => setConfidence(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus-visible:border-accent">
            {CONFIDENCE_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={doNotGeneralize} onChange={(e) => setDoNotGeneralize(e.target.checked)} className="h-4 w-4 accent-accent" />
          Do not generalize from this memory
        </label>

        {memoryType === 'phase' && (
          <TextField label="Review by" type="date" value={reviewBy} onChange={(e) => setReviewBy(e.target.value)} />
        )}

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Tags (comma separated)</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus-visible:border-accent" />
        </label>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-muted">Linked entities</span>
          <p className="text-sm text-muted">No linked entities.</p>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs text-muted">
          <div>
            <div className="mb-1 font-medium text-muted">Created</div>
            {timeAgo(memory.created_at)}
          </div>
          <div>
            <div className="mb-1 font-medium text-muted">Updated</div>
            {timeAgo(memory.updated_at) || '—'}
          </div>
        </div>

        <div className="mt-2 flex justify-between gap-2 border-t border-border pt-4">
          <Button variant="danger" onClick={() => onDelete(memory)}>Delete</Button>
          <Button variant="primary" disabled={!dirty || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </SidePanel>
  );
}

function AddMemoryModal({ onClose, onSave, defaultAgent }) {
  const [text, setText] = useState('');
  const [memoryType, setMemoryType] = useState('');
  const [confidence, setConfidence] = useState('');
  const [doNotGeneralize, setDoNotGeneralize] = useState(false);
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSaving(true);
    setResult(null);
    try {
      const res = await onSave({
        text,
        memory_type: memoryType || undefined,
        confidence: confidence || undefined,
        do_not_generalize: doNotGeneralize,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      if (res.status !== 'ok') setResult(res);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Add Memory" onClose={onClose} width="max-w-lg">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextArea label="Text" value={text} onChange={(e) => setText(e.target.value)} rows={5} required autoFocus />

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Memory type (optional — auto-classified if left blank)</span>
          <select value={memoryType} onChange={(e) => setMemoryType(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus-visible:border-accent">
            <option value="">Auto</option>
            {MEMORY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Confidence (optional)</span>
          <select value={confidence} onChange={(e) => setConfidence(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus-visible:border-accent">
            <option value="">Auto</option>
            {CONFIDENCE_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={doNotGeneralize} onChange={(e) => setDoNotGeneralize(e.target.checked)} className="h-4 w-4 accent-accent" />
          Do not generalize from this memory
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Tags (comma separated)</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus-visible:border-accent" />
        </label>

        <div className="text-xs text-muted">Agent: <span className="capitalize text-text">{defaultAgent}</span></div>

        {result?.status === 'filtered' && (
          <p className="text-sm text-amber-400">Rejected as low value — nothing was stored.</p>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!text.trim() || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
