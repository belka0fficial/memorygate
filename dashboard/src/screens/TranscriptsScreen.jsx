import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Search, Loader2, RefreshCw, CheckCircle2, Circle } from 'lucide-react';
import { api } from '../lib/api';
import { useAgent } from '../context/AgentContext';
import { timeAgo } from '../lib/timeAgo';
import Button from '../components/Button';

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlight(text, query) {
  if (!query.trim()) return text;
  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="rounded bg-accent/30 px-0.5 text-text">{part}</mark>
      : part,
  );
}

const SPEAKER_RE = /^([A-Za-z][A-Za-z0-9 ]{0,24}):\s*(.*)$/;

function parseTranscript(text) {
  const lines = text.split('\n');
  const turns = [];
  for (const line of lines) {
    const m = line.match(SPEAKER_RE);
    if (m) {
      turns.push({ speaker: m[1], lines: [m[2]] });
    } else if (turns.length > 0) {
      turns[turns.length - 1].lines.push(line);
    } else {
      turns.push({ speaker: null, lines: [line] });
    }
  }
  return turns;
}

function isUserSpeaker(speaker) {
  if (!speaker) return false;
  const s = speaker.toLowerCase();
  return s.includes('user') || s.includes('human') || s.includes('alexey');
}

export default function TranscriptsScreen() {
  const { agentId } = useAgent();
  const [transcripts, setTranscripts] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [full, setFull] = useState(null);
  const [query, setQuery] = useState('');
  const [reprocessing, setReprocessing] = useState(false);

  const load = () => {
    setTranscripts(null);
    api.get(`/transcripts/${agentId}`, undefined, agentId).then((r) => setTranscripts(r.results));
  };

  useEffect(() => { load(); setSelectedId(null); setFull(null); }, [agentId]);

  useEffect(() => {
    if (!selectedId) { setFull(null); return; }
    setFull(null);
    api.get(`/transcripts/${selectedId}/full`, undefined, agentId).then(setFull);
  }, [selectedId]);

  const turns = useMemo(() => (full ? parseTranscript(full.transcript) : []), [full]);

  const reprocess = async () => {
    setReprocessing(true);
    try {
      const res = await api.post(`/transcripts/${selectedId}/reprocess`, {}, undefined, agentId);
      setFull((prev) => ({ ...prev, processed_by_soulgate: res.transcript.processed_by_soulgate }));
      setTranscripts((prev) => prev.map((t) => (t.id === selectedId ? { ...t, processed_by_soulgate: res.transcript.processed_by_soulgate } : t)));
    } finally {
      setReprocessing(false);
    }
  };

  if (selectedId) {
    return (
      <div className="p-5 md:p-8">
        <button onClick={() => setSelectedId(null)} className="mb-4 flex items-center gap-1.5 text-sm text-muted hover:text-text">
          <ArrowLeft size={15} /> Back to transcripts
        </button>

        {!full ? (
          <div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-medium text-text">Session {full.session_id || full.id.slice(0, 8)}</h1>
                <p className="text-xs text-muted">
                  {full.session_start ? timeAgo(full.session_start) : 'unknown start'} · {full.word_count} words
                  {' · '}
                  {full.processed_by_soulgate ? (
                    <span className="inline-flex items-center gap-1 text-status-positive"><CheckCircle2 size={11} /> processed</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-muted"><Circle size={11} /> unprocessed</span>
                  )}
                </p>
              </div>
              <Button variant="secondary" disabled={reprocessing} onClick={reprocess}>
                <RefreshCw size={14} className={reprocessing ? 'animate-spin' : ''} /> Re-process with SoulGate
              </Button>
            </div>

            <div className="relative mb-4">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search within transcript..."
                className="w-full max-w-sm rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text placeholder:text-muted/70 outline-none focus-visible:border-accent"
              />
            </div>

            <div className="rounded-lg border border-border bg-surface p-4 font-mono text-xs leading-relaxed">
              {turns.map((turn, i) => (
                <div key={i} className={`mb-3 rounded-md p-2.5 ${isUserSpeaker(turn.speaker) ? 'bg-white/[0.03]' : turn.speaker ? 'bg-accent/[0.06]' : ''}`}>
                  {turn.speaker && <div className="mb-1 font-semibold text-accent">{turn.speaker}</div>}
                  {turn.lines.map((line, j) => (
                    <div key={j} className="whitespace-pre-wrap text-text/90">{highlight(line, query)}</div>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="p-5 md:p-8">
      <h1 className="mb-5 text-lg font-medium text-text">Transcripts</h1>

      {transcripts === null ? (
        <div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : transcripts.length === 0 ? (
        <p className="text-sm text-muted">No transcripts archived yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Session</th>
                <th className="px-4 py-3 text-left">Words</th>
                <th className="px-4 py-3 text-left">Processed</th>
              </tr>
            </thead>
            <tbody>
              {transcripts.map((t) => (
                <tr key={t.id} onClick={() => setSelectedId(t.id)} className="cursor-pointer border-b border-border last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-3 text-text">{t.session_start ? timeAgo(t.session_start) : timeAgo(t.created_at)}</td>
                  <td className="px-4 py-3 text-muted">{t.session_id || t.id.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-muted">{t.word_count}</td>
                  <td className="px-4 py-3">
                    {t.processed_by_soulgate ? (
                      <span className="inline-flex items-center gap-1 text-status-positive"><CheckCircle2 size={13} /> yes</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-muted"><Circle size={13} /> no</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
