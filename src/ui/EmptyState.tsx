/**
 * What a screen shows before the owner has entered anything.
 *
 * Rule 1: the app ships EMPTY. There are no seed recipes, no demo toggle and no
 * fallback list of ingredients. A fresh install shows this and invites him to add
 * something — which means every screen needs a real empty state, not a blank area
 * that looks broken.
 */

import type { ReactNode } from 'react';

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}): ReactNode {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p className="muted">{description}</p>
      {action}
    </div>
  );
}
