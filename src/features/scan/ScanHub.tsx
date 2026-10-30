/**
 * Scan — the four scanners, visible.
 *
 * WHY THIS EXISTS. Every scanner was reachable only through a plain text link
 * rendered above the `<h1>` of another screen: job sheet behind Jobs, recipe
 * card and menu behind Recipes, invoice behind Ingredients. Two of those hosts
 * were themselves behind a sideways scroll in an eight-tab bar. The owner could
 * not find the camera, which is a fair response to a feature with no visible
 * entry point.
 *
 * NOTHING HERE SCANS. Each card navigates to the existing `/scan/*` route and
 * those components are untouched — same review, same commit path, same refusals.
 * This is a signpost, not a new scanner.
 *
 * The cards are links rather than buttons: they navigate, so they should be
 * middle-clickable, long-pressable and bookmarkable like any other destination.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Screen } from '../../ui/Screen';

/*
 * PLACEHOLDER ICONS.
 *
 * The app has no icon system — `public/icons.svg` is leftover Vite-starter
 * scaffolding (a Bluesky mark) referenced nowhere. These are inline, sized in
 * `em` so they ride the type ramp, and `aria-hidden` because the card's title
 * already says what it is. Replace wholesale when a real set arrives.
 */
const PlaceholderIcon = ({ d }: { d: string }): ReactNode => (
  <svg className="scan-card-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const MODES = [
  {
    to: '/scan/job-sheet',
    title: 'Job sheet',
    blurb: 'Bookings become draft jobs',
    icon: 'M8 4h8a2 2 0 0 1 2 2v14l-3-2-3 2-3-2-3 2V6a2 2 0 0 1 2-2Z M9 9h6 M9 13h4',
  },
  {
    to: '/scan/recipe-card',
    title: 'Recipe card',
    blurb: 'One card becomes a draft recipe',
    icon: 'M5 4h14v16H5z M9 8h6 M9 12h6 M9 16h3',
  },
  {
    to: '/scan/invoice',
    title: 'Invoice',
    blurb: 'Line items update your prices',
    icon: 'M6 3h12v18l-3-2-3 2-3-2-3 2Z M9 8h6 M9 12h6',
  },
  {
    to: '/scan/menu',
    title: 'Menu',
    blurb: 'Dish names find candidate recipes',
    icon: 'M6 3h12v18H6z M10 7h4 M9 11h6 M9 15h6',
  },
] as const;

export function ScanHub(): ReactNode {
  return (
    <Screen
      title="Scan"
      description="Photograph a page and it becomes a draft you check before anything is saved."
    >
      <div className="scan-grid">
        {MODES.map((mode) => (
          <Link key={mode.to} to={mode.to} className="scan-card">
            <PlaceholderIcon d={mode.icon} />
            <span className="scan-card-title">{mode.title}</span>
            <span className="scan-card-blurb">{mode.blurb}</span>
          </Link>
        ))}
      </div>
    </Screen>
  );
}
