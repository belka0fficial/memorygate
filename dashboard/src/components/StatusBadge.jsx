const STATUS_MAP = {
  // observations
  unconfirmed: 'pending',
  confirmed: 'positive',
  contradicted: 'negative',
  archived: 'neutral',
  // patterns
  candidate: 'pending',
  active: 'positive',
  deprecated: 'neutral',
  // clarifications
  pending: 'pending',
  asked: 'neutral',
  resolved: 'positive',
  dismissed: 'negative',
};

const KIND_STYLES = {
  positive: { dot: 'bg-status-positive', text: 'text-status-positive', bg: 'bg-status-positive/10' },
  pending: { dot: 'bg-status-pending', text: 'text-status-pending', bg: 'bg-status-pending/10' },
  negative: { dot: 'bg-status-negative', text: 'text-status-negative', bg: 'bg-status-negative/10' },
  neutral: { dot: 'bg-status-neutral', text: 'text-status-neutral', bg: 'bg-status-neutral/10' },
};

export default function StatusBadge({ status }) {
  const kind = STATUS_MAP[status] ?? 'neutral';
  const s = KIND_STYLES[kind];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
}
