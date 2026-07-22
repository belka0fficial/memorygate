import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Database, Loader2, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import { api } from '../lib/api';
import { useAgent } from '../context/AgentContext';
import { scopeAgentIds } from '../lib/agentScope';
import ObjectInspector from '../components/ObjectInspector';

const TYPES = ['all', 'entity', 'memory', 'evidence', 'episode', 'analysis', 'observation', 'pattern', 'transcript'];

function normalize(kind, data) {
  const title = data.name || data.text || data.title || data.pattern_name || data.description || data.output_summary || data.session_id || data.id;
  const subtitle = data.description && data.description !== title ? data.description : data.summary || data.interpretation || data.input_summary || '';
  const confidence = data.confidence ?? data.integrity_confidence ?? data.hypothesis_confidence ?? 'n/a';
  return {
    id: data.id,
    kind,
    title,
    subtitle,
    confidence: typeof confidence === 'number' ? `${Math.round(confidence * 100)}%` : confidence,
    agentId: data.agent_id,
    created: data.created_at || data.observed_at || data.occurred_at || data.session_start,
    updated: data.updated_at || data.last_confirmed_at || data.session_end,
    data,
  };
}

async function safe(promise, fallback = []) {
  try { return await promise; } catch { return fallback; }
}

export default function DatabaseScreen() {
  const { agentId, agents } = useAgent();
  const agentIds = useMemo(() => scopeAgentIds(agentId, agents), [agentId, agents]);
  const [rows, setRows] = useState(null);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [sort, setSort] = useState('updated');
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const scoped = await Promise.all(agentIds.map(async (id) => {
      const [memories, entities, observations, patterns, transcripts] = await Promise.all([
        safe(api.get('/memory', undefined, id)),
        safe(api.get('/entity', undefined, id)),
        safe(api.post('/observation/search', {}, undefined, id).then((r) => r.results)),
        safe(api.post('/pattern/search', {}, undefined, id).then((r) => r.results)),
        safe(api.get(`/transcripts/${id}`, undefined, id).then((r) => r.results)),
      ]);
      return [...memories.map((v) => normalize('memory', v)), ...entities.map((v) => normalize('entity', v)), ...observations.map((v) => normalize('observation', v)), ...patterns.map((v) => normalize('pattern', v)), ...transcripts.map((v) => normalize('transcript', v))];
    }));
    const [evidence, episodes, analysis] = await Promise.all([
      safe(api.get('/evidence', { limit: 300 }).then((r) => r.results)),
      Promise.all(agentIds.map((id) => safe(api.get('/lineage/episodes', { limit: 300 }, id).then((r) => r.results)))).then((rows) => rows.flat()),
      safe(api.get('/evidence/analysis', { limit: 300 }).then((r) => r.results)),
    ]);
    setRows([...scoped.flat(), ...evidence.map((v) => normalize('evidence', v)), ...episodes.map((v) => normalize('episode', v)), ...analysis.map((v) => normalize('analysis', v))]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [agentId]);

  const visible = useMemo(() => {
    if (!rows) return [];
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => type === 'all' || row.kind === type).filter((row) => !needle || `${row.title} ${row.subtitle} ${row.id} ${JSON.stringify(row.data)}`.toLowerCase().includes(needle)).sort((a, b) => {
      if (sort === 'type') return a.kind.localeCompare(b.kind);
      if (sort === 'title') return String(a.title).localeCompare(String(b.title));
      return new Date(b.updated || b.created || 0) - new Date(a.updated || a.created || 0);
    });
  }, [rows, query, type, sort]);

  const counts = useMemo(() => Object.fromEntries(TYPES.map((key) => [key, key === 'all' ? (rows?.length || 0) : (rows || []).filter((row) => row.kind === key).length])), [rows]);

  const updateRecord = (record, data) => {
    const next = normalize(record.kind, data);
    setRows((current) => current.map((row) => row.kind === record.kind && row.id === record.id ? next : row));
    setSelected(next);
  };

  const removeRecord = (record) => {
    setRows((current) => current.filter((row) => !(row.kind === record.kind && row.id === record.id)));
    setSelected(null);
  };

  return (
    <div className="workspace-page">
      <header className="workspace-header">
        <div><span className="eyebrow">Storage control</span><h1>Database</h1><p>Search, inspect, correct, and remove every object MemoryGate currently knows.</p></div>
        <button className="icon-action" onClick={load} disabled={loading}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh</button>
      </header>

      <div className="database-summary">
        <div className="database-mark"><Database size={20} /><span>Postgres + vector index</span></div>
        <div><strong>{rows?.length ?? '...'}</strong><span>total objects</span></div>
        <div><strong>{counts.entity || 0}</strong><span>entities</span></div>
        <div><strong>{counts.evidence || 0}</strong><span>evidence records</span></div>
        <div><strong>{counts.episode || 0}</strong><span>episodes</span></div>
      </div>

      <div className="database-toolbar">
        <div className="database-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search text, IDs, tags, payloads..." /></div>
        <label className="compact-select"><SlidersHorizontal size={14} /><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="updated">Recently changed</option><option value="title">Title</option><option value="type">Object type</option></select><ChevronDown size={13} /></label>
      </div>

      <div className="database-types">{TYPES.map((name) => <button key={name} onClick={() => setType(name)} className={type === name ? 'active' : ''}><span>{name}</span><b>{counts[name] || 0}</b></button>)}</div>

      <div className="database-table-wrap">
        <table className="database-table">
          <thead><tr><th>Object</th><th>Type</th><th>Confidence</th><th>Owner</th><th>Last change</th><th /></tr></thead>
          <tbody>
            {visible.map((row) => <tr key={`${row.kind}-${row.id}`} onClick={() => setSelected(row)}>
              <td><strong>{row.title}</strong><span>{row.subtitle || row.id}</span></td>
              <td><span className={`object-kind kind-${row.kind}`}>{row.kind}</span></td>
              <td className="mono-cell">{row.confidence}</td>
              <td>{row.agentId || 'system'}</td>
              <td>{row.updated || row.created ? new Date(row.updated || row.created).toLocaleString() : 'unknown'}</td>
              <td><ChevronRight size={15} /></td>
            </tr>)}
          </tbody>
        </table>
        {rows === null && <div className="table-empty"><Loader2 size={16} className="animate-spin" /> Loading database...</div>}
        {rows && visible.length === 0 && <div className="table-empty">No objects match these filters.</div>}
      </div>
      <p className="table-footnote">Showing {visible.length} of {rows?.length || 0} objects. Evidence and analysis are read-only; editable object types open save and remove controls.</p>

      {selected && <ObjectInspector record={selected} onClose={() => setSelected(null)} onChanged={updateRecord} onRemoved={removeRecord} />}
    </div>
  );
}
