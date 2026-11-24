import type { ReactNode } from 'react';
import { IconTile, type IconName } from './icons';

/**
 * One stat card: a label, a figure, a line saying what it covers — and its
 * icon. A null figure shows a dash, and the caption says why.
 */
export function Stat({
  icon,
  label,
  value,
  caption,
}: {
  icon: IconName;
  label: string;
  value: string | null;
  caption: string | null;
}): ReactNode {
  return (
    <div className="stat">
      <div className="stat-head">
        <span className="stat-label">{label}</span>
        <IconTile name={icon} size={18} />
      </div>
      <p className={value === null ? 'stat-value is-absent' : 'stat-value num'}>
        {value ?? '—'}
      </p>
      {caption !== null && <p className="stat-caption">{caption}</p>}
    </div>
  );
}

