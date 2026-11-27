/**
 * Every route that existed before the five-tab nav still resolves.
 *
 * The eight-tab bar put Shopping, Prep, Packing, Recipes and Ingredients at
 * top-level URLs, and the dashboard at `/`. Those are in Paul's history and on
 * his home screen. Moving them into Service and Library without redirects would
 * turn each one into a blank router miss — not a 404 page, which would at least
 * say something, but nothing at all.
 *
 * Source-inspected rather than rendered: mounting the router would need a DOM,
 * a Supabase client and a signed-in kitchen, none of which a unit test has. What
 * can be checked without any of that is that every old path still appears with
 * somewhere to go, and that is the property that actually breaks.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const app = readFileSync(fileURLToPath(new URL('../../src/App.tsx', import.meta.url)), 'utf8');

/** Paths the old tab bar and its links could put in a bookmark. */
const OLD_PATHS = [
  '/shopping',
  '/prep',
  '/packing',
  '/recipes',
  '/ingredients',
  '/today',
] as const;

describe('old bookmarks still land somewhere', () => {
  it.each(OLD_PATHS)('%s still has a route', (path) => {
    expect(app, `${path} has no route — a bookmark to it renders nothing`).toContain(
      `path="${path}"`,
    );
  });

  it.each(OLD_PATHS)('%s redirects rather than rendering a dead end', (path) => {
    const route = new RegExp(`path="${path}"\\s+element=\\{<Navigate to="([^"]+)"`).exec(app);

    expect(route, `${path} exists but does not redirect`).not.toBeNull();
    expect(route?.[1], `${path} redirects to nothing`).toMatch(/^\//);
  });

  it('the index route renders Today, and Jobs has its own live route', () => {
    // Nov 2026: Today is the home tab again, and `/jobs` stopped being a
    // redirect and became the Jobs list. An old `/jobs` bookmark therefore
    // still lands on Jobs — now directly rather than via a redirect.
    expect(app).toMatch(/path="\/"\s+element=\{<Dashboard \/>\}/);
    expect(app).toMatch(/path="\/jobs"\s+element=\{<Jobs \/>\}/);
  });

  it('every scanner route is untouched', () => {
    // The Scan hub is a signpost. If these moved, every existing deep link and
    // the hub itself would break together.
    for (const mode of ['job-sheet', 'recipe-card', 'invoice', 'menu']) {
      expect(app).toContain(`path="/scan/${mode}"`);
    }
  });

  it('Setup is still reachable now that it has left the tab bar', () => {
    expect(app).toContain('path="/setup"');
    expect(app, 'Setup left the tabs with no header link to replace it').toMatch(
      /NavLink to="\/setup"/,
    );
  });
});

describe('the tab bar fits a phone', () => {
  it('has exactly six tabs', () => {
    // Eight scrolled sideways, which is what hid Recipes, Ingredients and Setup.
    const tabs = /const TABS = \[([\s\S]*?)\] as const;/.exec(app)?.[1] ?? '';

    // Six since Today came back (Nov 2026): ~65px each at 390px, ~53px at 320px,
    // still clear of the 44px floor. A seventh needs that sum redone first.
    expect([...tabs.matchAll(/\{ to: '/g)]).toHaveLength(6);
  });

  it('leads with Today and ends with Scan', () => {
    const tabs = /const TABS = \[([\s\S]*?)\] as const;/.exec(app)?.[1] ?? '';
    const labels = [...tabs.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);

    expect(labels).toEqual(['Today', 'Jobs', 'Service', 'Money', 'Library', 'Scan']);
  });
});
