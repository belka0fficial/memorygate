import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Brain, Clock3, Database, Loader2, Search, Sparkles, Zap } from 'lucide-react';
import { api } from '../lib/api';
import { useAgent } from '../context/AgentContext';
import { scopeAgentIds } from '../lib/agentScope';

async function safe(promise, fallback = []) { try { return await promise; } catch { return fallback; } }

export default function WindowsScreen() {
  const { agentId, agents } = useAgent();
  const agentIds = useMemo(() => scopeAgentIds(agentId, agents), [agentId, agents]);
  const [state, setState] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    Promise.all(agentIds.map(async (id) => ({
      id,
      briefing: await safe(api.get(`/briefing/${id}`, undefined, id), {}),
      observations: await safe(api.post('/observation/search', {}, undefined, id).then((r) => r.results)),
      memories: await safe(api.get('/memory', undefined, id)),
      entities: await safe(api.get('/entity', undefined, id)),
      transcripts: await safe(api.get(`/transcripts/${id}`, undefined, id).then((r) => r.results)),
    }))).then(setState);
  }, [agentId]);

  const runSearch = async (event) => {
    event.preventDefault(); if (!query.trim()) return;
    setSearching(true);
    const found = await Promise.all(agentIds.map(async (id) => {
      const [memories, entities] = await Promise.all([
        safe(api.post('/memory/search', { query }, undefined, id).then((r) => r.results)),
        safe(api.post('/entity/search', { query }, undefined, id).then((r) => r.results)),
      ]);
      return [...entities.map((v) => ({ type: 'entity', title: v.name, detail: v.description || v.agent_summary, score: v.similarity })), ...memories.map((v) => ({ type: 'memory', title: v.text, detail: `${v.memory_type} · ${v.confidence}`, score: v.similarity }))];
    }));
    setResults(found.flat().slice(0, 12)); setSearching(false);
  };

  if (!state) return <div className="workspace-page"><div className="table-empty"><Loader2 size={15} className="animate-spin" /> Assembling memory windows...</div></div>;
  const observations = state.flatMap((v) => v.observations);
  const memories = state.flatMap((v) => v.memories);
  const entities = state.flatMap((v) => v.entities);
  const transcripts = state.flatMap((v) => v.transcripts);
  const briefing = state[0]?.briefing || {};
  const recentObs = observations.filter((v) => Date.now() - new Date(v.observed_at).getTime() < 24 * 60 * 60 * 1000);

  return (
    <div className="workspace-page">
      <header className="workspace-header"><div><span className="eyebrow">Retrieval control</span><h1>Memory Windows</h1><p>Inspect exactly what is available now, what is being carried forward, and what remains in deep storage.</p></div></header>
      <div className="window-grid">
        <article className="memory-window realtime"><div className="window-number">01</div><div className="window-icon"><Zap size={19} /></div><h2>Realtime session</h2><p>The smallest, safest context assembled for the conversation happening now.</p><div className="window-metric"><strong>{Object.keys(briefing).length ? Math.ceil(JSON.stringify(briefing).length / 4) : 0}</strong><span>estimated tokens</span></div><ul><li><span>Open clarifications</span><b>{briefing.pending_clarifications?.length || 0}</b></li><li><span>Relevant people</span><b>{briefing.people_relevant?.length || 0}</b></li><li><span>Watch flags</span><b>{briefing.watch_flags?.length || 0}</b></li></ul><a href="/briefing">Open assembled context <ArrowRight size={13} /></a></article>
        <article className="memory-window short"><div className="window-number">02</div><div className="window-icon"><Clock3 size={19} /></div><h2>Short-term memory</h2><p>Recent sessions, active observations, and unfinished context that still matters.</p><div className="window-metric"><strong>{recentObs.length + transcripts.slice(0, 5).length}</strong><span>active recent objects</span></div><ul><li><span>24h observations</span><b>{recentObs.length}</b></li><li><span>Recent sessions</span><b>{Math.min(5, transcripts.length)}</b></li><li><span>Need clarification</span><b>{observations.filter((v) => v.needs_clarification).length}</b></li></ul><a href="/observations">Inspect recent context <ArrowRight size={13} /></a></article>
        <article className="memory-window long"><div className="window-number">03</div><div className="window-icon"><Database size={19} /></div><h2>Long-term memory</h2><p>The complete durable model, searched only when precise or deeper knowledge is needed.</p><div className="window-metric"><strong>{memories.length + entities.length}</strong><span>durable objects</span></div><ul><li><span>Data objects</span><b>{memories.length}</b></li><li><span>Entities</span><b>{entities.length}</b></li><li><span>High confidence</span><b>{memories.filter((v) => v.confidence === 'high').length}</b></li></ul><a href="/database">Browse the database <ArrowRight size={13} /></a></article>
      </div>

      <section className="retrieval-lab">
        <div className="retrieval-copy"><span><Brain size={17} /> Retrieval lab</span><h2>Ask the memory index</h2><p>This is deterministic semantic retrieval, not an AI answer. It lets you test what the conversational agent would be able to find.</p></div>
        <form onSubmit={runSearch} className="retrieval-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Try: what food do I usually enjoy?" /><button>{searching ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Search memory</button></form>
        {results.length > 0 && <div className="retrieval-results">{results.map((item, index) => <div key={`${item.type}-${index}`}><span className={`object-kind kind-${item.type}`}>{item.type}</span><strong>{item.title}</strong><p>{item.detail}</p>{item.score != null && <b>{Math.round(Math.max(0, item.score) * 100)}% match</b>}</div>)}</div>}
      </section>
    </div>
  );
}
