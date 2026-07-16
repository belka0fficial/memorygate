const TYPES = {
  stable_preference: { label: 'stable preference', dot: 'bg-mem-stable', text: 'text-mem-stable', bg: 'bg-mem-stable/10' },
  identity_trait: { label: 'identity trait', dot: 'bg-mem-identity', text: 'text-mem-identity', bg: 'bg-mem-identity/10' },
  humor_style: { label: 'humor style', dot: 'bg-mem-humor', text: 'text-mem-humor', bg: 'bg-mem-humor/10' },
  temporary_phase: { label: 'temporary phase', dot: 'bg-mem-temporary', text: 'text-mem-temporary', bg: 'bg-mem-temporary/10' },
  task_context: { label: 'task context', dot: 'bg-mem-task', text: 'text-mem-task', bg: 'bg-mem-task/10' },
  harmful_pattern: { label: 'harmful pattern', dot: 'bg-mem-harmful', text: 'text-mem-harmful', bg: 'bg-mem-harmful/10' },
  support_context: { label: 'support context', dot: 'bg-mem-support', text: 'text-mem-support', bg: 'bg-mem-support/10' },
};

export default function MemoryTypeBadge({ type }) {
  const t = TYPES[type] ?? { label: type || 'unknown', dot: 'bg-muted', text: 'text-muted', bg: 'bg-white/5' };
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${t.bg} ${t.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
      {t.label}
    </span>
  );
}
