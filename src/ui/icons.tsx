/**
 * One small set of line icons, drawn inline.
 *
 * Inline SVG with `currentColor`, so an icon takes the colour of whatever holds
 * it and nothing is fetched. Every icon is DECORATION beside words that say the
 * same thing — always `aria-hidden`, never the only label on anything.
 *
 * Sized by attribute rather than CSS: `tests/ui/tokens.test.ts` scans the
 * stylesheet for any height under the 44px touch floor.
 */

import type { ReactNode } from 'react';

const PATHS = {
  jobs: ['M4 6.5h16v13H4z', 'M4 10.5h16', 'M8.5 4v4', 'M15.5 4v4'],
  service: ['M7 5H5.5v15h13V5H17', 'M9 3.5h6v3H9z', 'M8.5 11l1.5 1.5 3-3', 'M8.5 16.5h7'],
  money: ['M3.5 7h17v10h-17z', 'M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5', 'M6.5 10v4', 'M17.5 10v4'],
  library: ['M12 6.5C10 5 7 4.8 4 5.5v13c3-.7 6-.5 8 1', 'M12 6.5c2-1.5 5-1.7 8-1v13c-3-.7-6-.5-8 1', 'M12 6.5v13'],
  scan: ['M4 8h3.5L9 5.5h6L16.5 8H20v11H4z', 'M12 10.5a3 3 0 1 0 0 6a3 3 0 1 0 0-6'],
  chat: ['M4 5h16v11H9l-5 4z', 'M8 9.5h8', 'M8 12.5h5'],
  settings: ['M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6', 'M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8'],
  people: ['M9 11a3 3 0 1 0 0-6a3 3 0 1 0 0 6', 'M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5', 'M16 5.3a3 3 0 0 1 0 5.4', 'M17.5 14.7c1.6.6 2.6 2 3 4.3'],
  home: ['M4 11l8-6.5 8 6.5', 'M6 9.5V19.5h12V9.5', 'M10 19.5v-5h4v5'],
  truck: ['M3 7h11v9H3z', 'M14 10h4l3 3v3h-7z', 'M7 18.5a1.5 1.5 0 1 0 0-3a1.5 1.5 0 1 0 0 3', 'M17 18.5a1.5 1.5 0 1 0 0-3a1.5 1.5 0 1 0 0 3'],
  tag: ['M4 4h7l9 9-7 7-9-9z', 'M8.5 8.5h.01'],
  box: ['M4 8l8-4 8 4v8l-8 4-8-4z', 'M4 8l8 4 8-4', 'M12 12v8'],
  menu: ['M6 4h12v16H6z', 'M9 8h6', 'M9 11.5h6', 'M9 15h4'],
  cloud: ['M7 18a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6 1.5A3.3 3.3 0 0 1 17 18z', 'M12 11v5', 'M9.8 13.8L12 16l2.2-2.2'],
  chart: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M3 20h18'],
  cart: ['M3 4h2.5l2 11h10.5l2-8H6.5', 'M9 19.5a1 1 0 1 0 0-2a1 1 0 1 0 0 2', 'M17 19.5a1 1 0 1 0 0-2a1 1 0 1 0 0 2'],
  guests: ['M12 11a3.5 3.5 0 1 0 0-7a3.5 3.5 0 1 0 0 7', 'M5 20c.8-3.7 3.6-5.5 7-5.5s6.2 1.8 7 5.5'],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22 }: { readonly name: IconName; readonly size?: number }): ReactNode {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** An icon on a soft square — beside a page title, a section heading, a stat. */
export function IconTile({ name, size = 20 }: { readonly name: IconName; readonly size?: number }): ReactNode {
  return (
    <span className="icon-tile" aria-hidden="true">
      <Icon name={name} size={size} />
    </span>
  );
}

/** A section heading with its icon tile. The words are the heading. */
export function SectionHeading({
  icon,
  children,
}: {
  readonly icon: IconName;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <h2 className="with-icon">
      <IconTile name={icon} size={18} />
      <span>{children}</span>
    </h2>
  );
}
