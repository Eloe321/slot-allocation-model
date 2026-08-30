import type { TreeRow } from '@/lib/types';

/**
 * A row's allocation, drawn as its four real parts.
 *
 * `carved` is the one that matters: it is exactly the gap between a row's raw
 * availability and its netted availability — capacity a child row already
 * holds. Drawing it is the point. A parent reporting "65 free" while 35 of that
 * is carved is the bug this whole system exists to prevent, and a caption
 * saying so is far less convincing than the band itself.
 */
export function CapacityBar({ row, capacity }: { row: TreeRow; capacity: number }) {
  const carved = Math.max(0, row.rawAvailable - row.nettedAvailable);
  const segments = [
    { key: 'sold', value: row.soldSlots, label: 'sold' },
    { key: 'held', value: row.heldSlots, label: 'held' },
    { key: 'carved', value: carved, label: 'claimed by children' },
    { key: 'free', value: row.nettedAvailable, label: 'free' },
  ].filter((s) => s.value > 0);

  const scale = capacity > 0 ? capacity : 1;

  return (
    <div
      className="bar"
      role="img"
      aria-label={segments.map((s) => `${s.value} ${s.label}`).join(', ') || 'no capacity'}
    >
      {segments.map((s) => (
        <span
          key={s.key}
          data-seg={s.key}
          style={{ width: `${(s.value / scale) * 100}%` }}
          title={`${s.value} ${s.label}`}
        />
      ))}
    </div>
  );
}

export function CapacityLegend() {
  const items = [
    { key: 'sold', label: 'sold' },
    { key: 'held', label: 'held' },
    { key: 'carved', label: 'claimed by children' },
    { key: 'free', label: 'free' },
  ];
  return (
    <ul className="legend">
      {items.map((i) => (
        <li key={i.key}>
          <span className="bar" aria-hidden="true">
            <span data-seg={i.key} style={{ width: '100%' }} />
          </span>
          {i.label}
        </li>
      ))}
    </ul>
  );
}
