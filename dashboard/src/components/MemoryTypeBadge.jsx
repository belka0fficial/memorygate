const TYPES = {
  fact: { label: 'fact', dot: 'bg-mem-fact', text: 'text-mem-fact', bg: 'bg-mem-fact/10' },
  phase: { label: 'phase', dot: 'bg-mem-phase', text: 'text-mem-phase', bg: 'bg-mem-phase/10' },
  context: { label: 'context', dot: 'bg-mem-context', text: 'text-mem-context', bg: 'bg-mem-context/10' },
  watch: { label: 'watch', dot: 'bg-mem-watch', text: 'text-mem-watch', bg: 'bg-mem-watch/10' },
};

export const MEMORY_TYPES = Object.keys(TYPES);

export default function MemoryTypeBadge({ type }) {
  const t = TYPES[type] ?? { label: type || 'unknown', dot: 'bg-muted', text: 'text-muted', bg: 'bg-white/5' };
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${t.bg} ${t.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
      {t.label}
    </span>
  );
}
