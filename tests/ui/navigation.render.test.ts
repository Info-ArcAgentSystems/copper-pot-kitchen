/**
 * EVERY LINK GOES SOMEWHERE LIVE, AND A DRAFT SURVIVES THE TRIP.
 *
 * The defect this exists for cost two months of silent data loss.
 *
 * `271f179` regrouped eight tabs into five and left the old paths behind as
 * bookmark redirects: `<Route path="/recipes" element={<Navigate to=
 * "/library/recipes" replace />} />`. Correct, and kind to anyone who had
 * bookmarked the old URL. But three navigations inside the app still pointed at
 * `/recipes`, and two of them carried a draft recipe in `location.state`.
 *
 * A REDIRECT DESTROYS STATE. `<Navigate>` passes no `state` prop, so
 * react-router calls `navigate(to, { replace, state: undefined })`, which
 * reaches `createLocation(current, to, state = null)` — and the default takes
 * over. The screen that reads `location.state.draft` then sees null and renders
 * its list. Nothing errored. Nothing was saved. Every web import from 27 October
 * onwards failed exactly this way, and the database shows it: four stub recipes
 * created that day, all still `created_at == updated_at`.
 *
 * NONE OF THE EXISTING TESTS COULD SEE IT. `fillStub` was proved pure, the
 * repository was proved to update rather than insert, and the write path was
 * proved against a recording `Db`. All true, all green, and all downstream of a
 * handoff that never arrived. The gap was that nothing connected a `navigate()`
 * call to the route table it targets.
 *
 * So there are two guards here and they catch different halves:
 *
 *   the audit    no navigation anywhere in `src/` targets a redirect-only path,
 *                checked against App's OWN route table, so the next regroup
 *                cannot quietly strand another one
 *   the render   a draft placed on the live route actually reaches the editor
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { KitchenContext, type KitchenContextValue } from '../../src/auth/kitchenState';
import type {
  IngredientId,
  KitchenId,
  Recipe,
  RecipeId,
  RecipeLineId,
  RecipeUnit,
} from '../../src/engine/types';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const read = (path: string): string => readFileSync(join(SRC, path), 'utf8');

/** Every .ts/.tsx under src, by path relative to src. */
const sources = (dir = ''): readonly string[] =>
  readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = dir === '' ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });

const app = strip(read('App.tsx'));

/** `path` for every `<Route>` App declares, with whether it only redirects. */
const ALL_ROUTES: readonly { readonly path: string; readonly redirectOnly: boolean }[] = [
  ...app.matchAll(/<Route\s+path="([^"]+)"\s+element=\{(<[A-Za-z]+)/g),
].map((m) => ({ path: m[1] as string, redirectOnly: m[2] === '<Navigate' }));

/**
 * The same list WITHOUT the catch-all, and that exclusion is load-bearing.
 *
 * `path="*"` matches every string there is. Left in, the audit below would
 * resolve any destination at all — including a stranded one, if it ever sat
 * earlier in the file — and report a clean sweep while every link in the app
 * pointed at the not-found screen. A guard that cannot fail is worse than no
 * guard, because it reads like reassurance.
 *
 * So the catch-all is checked as its own thing, and never counted as somewhere
 * a link may legitimately lead.
 */
const ROUTES = ALL_ROUTES.filter((r) => r.path !== '*');

/** A route pattern as a matcher, so `/library/recipes` resolves `/library/:view`. */
const matches = (pattern: string, path: string): boolean =>
  new RegExp(`^${pattern.replace(/:[^/]+/g, '[^/]+')}$`).test(path);

/**
 * Every in-app destination, by the file and the form it was written in.
 *
 * Three forms, because the codebase uses three: `navigate('/x')`, the JSX
 * attribute `to="/x"`, and `{ to: '/x' }` in a table of links. A guard that knew
 * only the first would have missed Setup's two and the dashboard's tile, which
 * is three of the six sites this was written to find.
 */
const DESTINATIONS: readonly { readonly file: string; readonly to: string; readonly withState: boolean }[] =
  sources()
    .filter((file) => file !== 'App.tsx')
    .flatMap((file) => {
      const code = strip(read(file));

      return [
        ...code.matchAll(/navigate\(\s*'(\/[^']*)'\s*(,\s*\{[^}]*)?/g),
        ...code.matchAll(/\bto=["'](\/[^"']*)["']()/g),
        ...code.matchAll(/\bto:\s*'(\/[^']*)'()/g),
      ].map((m) => ({
        file,
        to: m[1] as string,
        // Only a navigation CARRYING something loses anything by redirecting.
        withState: (m[2] ?? '').includes('state:'),
      }));
    });

describe('this file is the only kind that gets DOM types', () => {
  it('leaves the no-DOM line in tsconfig.test.json where it is', () => {
    /*
     * This test imports a SCREEN, and a screen types its handlers as
     * `EventTarget & HTMLInputElement` and reads `import.meta.env`. So it needs
     * DOM and vite types to compile, and it gets them from
     * `tsconfig.render.json`, which covers `*.render.test.ts` and nothing else.
     *
     * The easy way to have made this file compile was to add "DOM" to the test
     * project's `lib`, which covers every engine test too. That line exists so
     * that a test reaching for a browser global is a compile error rather than a
     * discovery, and widening it for one render test would have retired the
     * signal for all of them. This asserts it was not widened.
     */
    const testProject = readFileSync(
      fileURLToPath(new URL('../../tsconfig.test.json', import.meta.url)),
      'utf8',
    );

    expect(testProject, 'the engine tests can now see the DOM').toMatch(/"lib":\s*\["ES2023"\]/);
    expect(testProject).toContain('tests/**/*.render.test.ts');
  });
});

describe('the route table still welcomes an old bookmark', () => {
  it('keeps the legacy paths as redirects', () => {
    /*
     * The wrong fix for all of this is to delete the redirects. They are not the
     * defect — they are the reason a bookmark from the eight-tab era still lands
     * somewhere real, which `tests/ui/routes.test.ts` has its own say about.
     * The defect was the app's OWN links using them.
     */
    const redirects = ROUTES.filter((r) => r.redirectOnly).map((r) => r.path);

    for (const legacy of ['/jobs', '/today', '/recipes', '/ingredients', '/shopping', '/prep']) {
      expect(redirects, `${legacy} no longer resolves for an old bookmark`).toContain(legacy);
    }
  });

  it('has the SPA fallback that makes a refresh work at all', () => {
    /*
     * UNGUARDED UNTIL NOW, and found by inverting: deleting the rewrite left
     * every test in this repo green while refreshing `/service/shopping`
     * returned Vercel's 404. Nothing in `src/` can see a hosting config, so
     * nothing was looking at it.
     *
     * Vercel serves a real file first and only rewrites what it cannot find, so
     * this does not shadow the bundle, the fonts or anything else in `public/`
     * — verified on the deployed URL, where the JS, the CSS and the woff2 all
     * come back as themselves and only the routes come back as `index.html`.
     *
     * The Supabase edge functions are on `*.supabase.co` and are not touched by
     * a rewrite on this domain at all.
     */
    const config = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../vercel.json', import.meta.url)), 'utf8'),
    ) as { rewrites?: { source: string; destination: string }[] };

    const fallback = config.rewrites?.find((r) => r.destination === '/index.html');

    expect(fallback, 'the SPA fallback is gone — every inner route 404s on refresh').toBeDefined();
    // A catch-all, not one path at a time: `/service/shopping`, `/scan/invoice`
    // and everything added next year all depend on it.
    expect(fallback?.source, 'the fallback no longer catches everything').toMatch(
      /^\/\(\.\*\)$|^\/:path\*$/,
    );
  });

  it('answers a typo with the app’s own screen, not an empty column', () => {
    /*
     * `vercel.json` rewrites everything it cannot serve as a file to
     * `/index.html`, which is what makes refreshing an inner route work — and
     * the same rewrite hands a mistyped path to the app with a 200. Before the
     * catch-all, `<Routes>` matched nothing and rendered nothing: header, tabs,
     * and an empty column between them.
     */
    const catchAll = ALL_ROUTES.find((r) => r.path === '*');

    expect(catchAll, 'a mistyped path renders an empty column again').toBeDefined();
    expect(catchAll?.redirectOnly, 'the catch-all redirects rather than explaining').toBe(false);
    expect(app).toContain('<Route path="*" element={<NotFound />} />');
  });

  it('reads a route table that is actually there', () => {
    // If the regex ever stops matching App's syntax, every assertion below
    // passes vacuously against an empty list. This is the canary.
    expect(ROUTES.length, 'no routes parsed — the matcher has drifted').toBeGreaterThan(15);
    expect(DESTINATIONS.length, 'no destinations parsed').toBeGreaterThan(5);
  });
});

describe('no navigation inside the app targets a redirect', () => {
  it('every destination resolves to a route that renders something', () => {
    const stranded = DESTINATIONS.filter((d) => {
      const route = ROUTES.find((r) => matches(r.path, d.to));
      return route === undefined || route.redirectOnly;
    });

    /*
     * Reported as a list rather than one at a time: when a regroup strands
     * links, it strands several, and finding them one failing test per run is
     * how five of the six here stayed hidden behind the one that was noticed.
     */
    expect(
      stranded.map((d) => `${d.file} → ${d.to}`),
      'these navigate through a redirect, which remounts the screen and strips location state',
    ).toEqual([]);
  });

  it('and a navigation CARRYING state is checked twice over', () => {
    /*
     * The severe half, stated separately because the consequences differ. A
     * stranded `<Link>` costs a remount and a flash of the loading state. A
     * stranded `navigate(…, { state })` silently destroys what it was carrying,
     * and the screen it lands on looks like a normal screen.
     */
    const carrying = DESTINATIONS.filter((d) => d.withState);

    expect(carrying.length, 'nothing carries state — has the draft handoff gone?').toBeGreaterThan(0);

    for (const d of carrying) {
      const route = ROUTES.find((r) => matches(r.path, d.to));

      expect(route, `${d.file} carries state to ${d.to}, which is not a route at all`).toBeDefined();
      expect(
        route?.redirectOnly,
        `${d.file} carries state to ${d.to}, a redirect — the state will not arrive`,
      ).toBe(false);
    }
  });

  it('the two draft handoffs point at the editor itself', () => {
    // Named, because these are the two that were broken and the two where the
    // cost is a silent loss rather than a flicker.
    expect(strip(read('features/setup/Recipes.tsx'))).toContain(
      "navigate('/library/recipes', { state: { draft: fillStub(stub, candidate) } })",
    );
    expect(strip(read('features/scan/ScanMenu.tsx'))).toContain(
      "navigate('/library/recipes', { state: { draft: draftFromWebReview(candidate) } })",
    );
  });
});

describe('a draft placed on the live route reaches the editor', () => {
  /*
   * The half the audit cannot reach: that the destination READS what it is
   * handed. A link can point at a live route and still be met by a screen that
   * ignores `location.state`.
   *
   * `renderToStaticMarkup` rather than a DOM, like every other render test here
   * — `tsconfig.test.json` has no DOM lib on purpose. It runs no effects, which
   * is a feature: `useAsync` never fires, so this touches no network and needs
   * no database, and the only thing deciding what renders is the location.
   */
  beforeAll(() => {
    // The component builds a Supabase client before it renders anything. The
    // client is never called here — no effect runs — but it must construct.
    vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key-not-a-real-one');
  });

  const draft: Recipe = {
    id: 'stub-id-kept' as RecipeId,
    kitchenId: 'kitchen-1' as KitchenId,
    // His name for it, not the page's — `fillStub` keeps the stub's.
    name: 'Nolan Roast Chicken',
    course: 'main',
    yieldType: 'batch',
    portionsPerBatch: 4,
    batchUnit: 'tray',
    confidence: 'missing',
    makeAheadDays: 0,
    sameDayOnly: true,
    freezable: false,
    onsiteFinish: false,
    method: null,
    note: 'Imported from https://example.test/roast-chicken',
    components: [
      {
        id: '' as RecipeLineId,
        kind: 'ingredient',
        ingredientId: 'ing-butter' as IngredientId,
        displayName: 'unsalted butter',
        qty: 50,
        unit: 'g' as RecipeUnit,
        position: 0,
      },
    ],
    unquantified: [
      { id: '' as RecipeLineId, item: 'head of garlic', reason: 'a number with no unit' },
    ],
  };

  /*
   * The membership, supplied through the CONTEXT rather than the provider.
   *
   * `RecipeForm` reads it for the kitchen id it saves under, and
   * `KitchenProvider` would reach for a session to get one. The context is
   * exported, so the provider's job — signing in — is simply not done here. It
   * is not what this test is about, and needing a real session would make this
   * another test that cannot run without credentials.
   */
  const kitchen: KitchenContextValue = {
    state: {
      status: 'ready',
      user: { id: 'user-1', email: null },
      membership: { kitchenId: 'kitchen-1', kitchenName: 'Copper Pot', role: 'owner' },
    },
    refresh: async () => {},
  };

  const render = async (state: unknown): Promise<string> => {
    const { Recipes } = await import('../../src/features/setup/Recipes');

    return renderToStaticMarkup(
      createElement(
        KitchenContext.Provider,
        { value: kitchen },
        createElement(
          MemoryRouter,
          { initialEntries: [{ pathname: '/library/recipes', state }] },
          createElement(Recipes),
        ),
      ),
    );
  };

  it('opens the editor filled in, with his name and the page’s components', async () => {
    const html = await render({ draft });

    // His name, in the field — not the page's title, and not a new blank form.
    expect(html, 'the draft did not reach the editor').toContain('value="Nolan Roast Chicken"');
    /*
     * The LINES, not just the title: a form showing the name and no components
     * would be a different failure wearing the same face.
     *
     * The component is checked by its quantity and unit rather than by
     * "unsalted butter", which is not on the page. Its name lives in a
     * `<select>` of the owner's ingredients, and no effect runs here, so the
     * dropdown is still empty and the line shows only what the draft carried
     * directly. Asserting the name would have been asserting a read this test
     * deliberately never makes.
     */
    expect(html).toContain('value="50"');
    expect(html).toContain('value="g"');
    expect(html).toContain('Remove this component');
    expect(html).toContain('value="head of garlic"');
    expect(html).toContain('Imported from https://example.test/roast-chicken');
  });

  it('the not-found screen says WHICH address, so a typo is visible', async () => {
    /*
     * The whole value of it over a blank column is that it reads the path back
     * to him: `/sevice/shopping` is its own diagnosis the moment he sees it.
     * Rendered rather than read, because the path comes off `useLocation` and a
     * screen that ignored it would look perfectly fine in the source.
     */
    const { NotFound } = await import('../../src/features/NotFound');

    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ['/sevice/shopping'] },
        createElement(NotFound),
      ),
    );

    expect(html, 'the not-found screen does not say what was asked for').toContain(
      '<strong>/sevice/shopping</strong>',
    );
    expect(html, 'no way back').toContain('Go to Jobs');
  });

  it('and WITHOUT the state renders the list, so the state is what decides', async () => {
    /*
     * The contrast is the proof. Without it, an editor that rendered
     * unconditionally would pass the assertion above while the draft was being
     * thrown away — which is a fair description of the bug this file is for.
     */
    const html = await render(null);

    expect(html).not.toContain('value="Nolan Roast Chicken"');
    expect(html).not.toContain('head of garlic');
    // No effects run, so the list is in its first state: honestly waiting.
    expect(html).toContain('Loading your recipes…');
  });
});
