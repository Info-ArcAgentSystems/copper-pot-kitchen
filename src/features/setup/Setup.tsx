/**
 * The Setup hub.
 *
 * Five links rather than five tabs: the bottom bar has room for the things used
 * daily, and setup is not one of them.
 */

import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

const SECTIONS = [
  { to: 'customers', label: 'Customers', blurb: 'Who you cook for, and their client group' },
  { to: 'properties', label: 'Properties', blurb: 'Venues, access notes and facilities' },
  { to: 'suppliers', label: 'Suppliers', blurb: 'Used to group the shopping list' },
  { to: 'rates', label: 'Rate card', blurb: 'Per-head and flat rates by client group' },
  { to: 'templates', label: 'Service templates', blurb: 'What to pack for each service type' },
] as const;

export function Setup(): ReactNode {
  return (
    <div>
      <h1>Setup</h1>
      <ul className="records">
        {SECTIONS.map((s) => (
          <li key={s.to}>
            <Link to={s.to} className="record tap">
              <strong>{s.label}</strong>
              <span className="muted">{s.blurb}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
