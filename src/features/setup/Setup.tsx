/**
 * The Setup hub.
 *
 * Five links rather than five tabs: the bottom bar has room for the things used
 * daily, and setup is not one of them.
 */

import { Link } from 'react-router-dom';
import { Screen } from '../../ui/Screen';
import type { ReactNode } from 'react';

const SECTIONS = [
  { to: 'customers', label: 'Customers', blurb: 'Who you cook for, and their client group' },
  { to: 'properties', label: 'Properties', blurb: 'Venues, access notes and facilities' },
  { to: 'suppliers', label: 'Suppliers', blurb: 'Used to group the shopping list' },
  { to: 'rates', label: 'Rate card', blurb: 'Per-head and flat rates by client group' },
  { to: 'templates', label: 'Service templates', blurb: 'What to pack for each service type' },
  // The live routes. `/ingredients` and `/recipes` still resolve, but only by
  // bouncing through a redirect that unmounts and remounts the whole Library.
  { to: '/library/ingredients', label: 'Ingredients', blurb: 'Three units, pack size and price' },
  { to: '/library/recipes', label: 'Recipes', blurb: 'Yields, components and sub-recipes' },
  { to: 'backup', label: 'Backup', blurb: 'Save everything to a file, restore it, or start again' },
] as const;

export function Setup(): ReactNode {
  return (
    <Screen
      title="Setup"
      description="Customers, properties, suppliers, rates and backups."
    >
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
    </Screen>
  );
}
