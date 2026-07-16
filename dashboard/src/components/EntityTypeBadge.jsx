export const ENTITY_TYPE_COLORS = {
  human: 'var(--color-entity-human)',
  project: 'var(--color-entity-project)',
  organization: 'var(--color-entity-organization)',
  place: 'var(--color-entity-place)',
  concept: 'var(--color-entity-concept)',
  habit: 'var(--color-entity-habit)',
  object: 'var(--color-entity-object)',
};

export function entityTypeColor(type) {
  return ENTITY_TYPE_COLORS[type] || '#6b7280';
}

export default function EntityTypeBadge({ type }) {
  const color = entityTypeColor(type);
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {type}
    </span>
  );
}
