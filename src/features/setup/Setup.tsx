/**
 * The Setup hub.
 *
 * Five links rather than five tabs: the bottom bar has room for the things used
 * daily, and setup is not one of them.
 */

import { Link } from 'react-router-dom';
import { Screen } from '../../ui/Screen';
import { IconTile } from '../../ui/icons';
import type { ReactNode } from 'react';

const SECTIONS = [
  { to: 'groups', icon: 'people', label: 'Client groups', blurb: 'How you group clients for pricing' },
  { to: 'customers', icon: 'people', label: 'Customers', blurb: 'Who you cook for, and their client group' },
  { to: 'properties', icon: 'home', label: 'Properties', blurb: 'Venues, access notes and facilities' },
  { to: 'suppliers', icon: 'truck', label: 'Suppliers', blurb: 'Used to group the shopping list' },
  { to: 'rates', icon: 'tag', label: 'Rate card', blurb: 'Per-head and flat prices for each client group' },
  { to: 'templates', icon: 'box', label: 'Service templates', blurb: 'What to pack for each service type' },
  { to: 'menus', icon: 'menu', label: 'Saved menus', blurb: 'Your usual dishes for a service type — your BBQ' },
  // The live routes. `/ingredients` and `/recipes` still resolve, but only by
  // bouncing through a redirect that unmounts and remounts the whole Library.
  { to: '/library/ingredients', icon: 'cart', label: 'Ingredients', blurb: 'Three units, pack size and price' },
  { to: '/library/recipes', icon: 'library', label: 'Recipes', blurb: 'Yields, components and sub-recipes' },
  { to: 'backup', icon: 'cloud', label: 'Backup', blurb: 'Save everything to a file, restore it, or start again' },
] as const;

export function Setup(): ReactNode {
  return (
    <Screen
      title="Setup"
      icon="settings"
      description="Customers, properties, suppliers, rates and backups."
    >
      <ul className="records">
        {SECTIONS.map((s) => (
          <li key={s.to}>
            <Link to={s.to} className="record tap">
              <span className="record-row">
                <IconTile name={s.icon} />
                <span className="record-body">
                  <strong>{s.label}</strong>
                  <span className="muted">{s.blurb}</span>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
