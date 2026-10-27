/**
 * What the owner actually READS when a screen is not ready.
 *
 * `sourceState.test.ts` proves the decision and `sourceNotice.test.ts` proves
 * the structure. Neither renders the component, so neither can tell you whether
 * the result is a sentence a person would want to read — and the whole point of
 * this work was that "Could not load: Failed to fetch" was structurally fine and
 * useless to a man holding a phone in a supermarket.
 *
 * So this one renders it, through the real React renderer, and asserts the
 * words. `renderToStaticMarkup` rather than a DOM: `tsconfig.test.json` has no
 * DOM lib on purpose, and `createElement` keeps this a `.ts` file so it stays
 * that way. A test needing a browser global would be a signal something had
 * stopped being pure.
 *
 * The cases are the ones the ten screens actually produce.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SourceNotice } from '../../src/ui/SourceNotice';
import { sourceState, type DataSource } from '../../src/ui/sourceState';

const loading = { status: 'loading' } as DataSource['state'];
const ready = { status: 'ready', data: [] } as unknown as DataSource['state'];
const failed = (message: string): DataSource['state'] =>
  ({ status: 'error', error: new Error(message) }) as unknown as DataSource['state'];

const source = (what: string, why: string, state: DataSource['state']): DataSource => ({
  what,
  why,
  state,
  reload: () => {},
});

const render = (sources: readonly DataSource[], title?: string): string =>
  renderToStaticMarkup(createElement(SourceNotice, { state: sourceState(sources), title }));

describe('a ready screen says nothing at all', () => {
  it('renders empty — no stray wrapper, no stale "Loading…"', () => {
    // The dashboard used to say "Loading…" forever after a failed read. An
    // empty render is the only correct output here.
    expect(render([source('your jobs', 'x', ready)], 'Prep')).toBe('');
  });
});

describe('a loading screen names what it is waiting for', () => {
  it('one read', () => {
    expect(render([source('your jobs', 'x', loading)], 'Prep')).toContain(
      'Loading your jobs…',
    );
  });

  it('two reads join with "and", not a comma', () => {
    const html = render(
      [source('your jobs', 'x', loading), source('your recipes', 'y', loading)],
      'Prep',
    );

    expect(html).toContain('Loading your jobs and your recipes…');
  });

  it('three reads read as a sentence', () => {
    // "a, b and c" — a list a person would say out loud. The point of naming
    // them at all is that "waiting on what you have already bought" is the
    // difference between slow and frozen.
    const html = render(
      [
        source('your jobs', 'x', loading),
        source('your recipes', 'y', loading),
        source('your ingredients', 'z', loading),
      ],
      'Prep',
    );

    expect(html).toContain('Loading your jobs, your recipes and your ingredients…');
  });

  it('carries the screen heading, so a bare message is never orphaned', () => {
    expect(render([source('your jobs', 'x', loading)], 'Prep')).toContain('<h1>Prep</h1>');
  });
});

describe('a failed screen says what, why, and what the failure said', () => {
  const html = (): string =>
    render(
      [
        source('your ingredients', 'the scanner matches what it reads against them', failed('Failed to fetch')),
      ],
      'Scan an invoice',
    );

  it('names the read and what it was for', () => {
    expect(html()).toContain(
      'Could not load your ingredients — the scanner matches what it reads against them.',
    );
  });

  it('carries the error detail that used to be thrown away', () => {
    expect(html()).toContain('(Failed to fetch)');
  });

  it('offers a retry, rather than leaving "reload the page" as the instruction', () => {
    expect(html()).toContain('<button type="button">Try again</button>');
  });

  it('is announced, so a screen reader is told rather than shown', () => {
    expect(html()).toContain('role="alert"');
  });

  it('reports EVERY failed read, not just the first one found', () => {
    // The old code did `.find(s => s.status === 'error')`. Two reads down means
    // two things to fix, and being told about one of them is how the second
    // becomes a surprise on the retry.
    const both = render(
      [
        source('your jobs', 'the plan comes from them', failed('Failed to fetch')),
        source('your recipes', 'batch sizes come from them', failed('503 Service Unavailable')),
      ],
      'Prep',
    );

    expect(both).toContain('Could not load your jobs');
    expect(both).toContain('Could not load your recipes');
    expect(both).toContain('(503 Service Unavailable)');
    // One button for the pair, not one each.
    expect([...both.matchAll(/Try again/g)]).toHaveLength(1);
  });

  it('FAILED BEATS LOADING — a broken screen is not a slow one', () => {
    const html = render(
      [
        source('your jobs', 'the plan comes from them', failed('Failed to fetch')),
        source('your recipes', 'y', loading),
      ],
      'Prep',
    );

    expect(html).toContain('Could not load your jobs');
    expect(html, 'the slow half hid the broken half').not.toContain('Loading');
  });

  it('an error with nothing to say says so, rather than inventing a cause', () => {
    // Rule 8 one layer down. `new Error('')` is real — a rejected fetch with no
    // body — and a plausible invented reason would be the same defect as the
    // greyed button.
    expect(render([source('your jobs', 'x', failed(''))], 'Prep')).toContain('(no reason given)');
  });
});

describe('inline, where it explains a control rather than replacing a screen', () => {
  it('renders no heading when no title is given', () => {
    // The scanners and Ask Sous keep their screen; the notice sits above the
    // control it is explaining.
    const html = render([source('your customers', 'a scanned name is matched against them', loading)]);

    expect(html).not.toContain('<h1>');
    expect(html).toContain('Loading your customers…');
  });

  it('still reports a failure in full inline', () => {
    const html = render([
      source('your customers', 'a scanned name is matched against them', failed('NetworkError')),
    ]);

    expect(html).not.toContain('<h1>');
    expect(html).toContain('Could not load your customers');
    expect(html).toContain('(NetworkError)');
    expect(html).toContain('Try again');
  });
});

/**
 * THE EIGHT SCREENS THAT GO THROUGH `RecordScreen`, read in their own words.
 *
 * Five of them — Customers, Properties, Suppliers, Rate card, Service
 * templates — were never converted individually. They improved as a side
 * effect of fixing the one shared component, which means nothing was ever
 * written specifically for them and nothing ever looked at their output. They
 * compiled green because a required prop was supplied, and a required prop can
 * be supplied with anything.
 *
 * So the `title` and `why` are READ OUT OF THE CALLER FILES and rendered
 * through the real renderer. What this asserts is the actual sentence each of
 * the eight screens puts in front of the owner — not that the wiring exists.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const callerSource = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../src/${path}`, import.meta.url)), 'utf8');

/** The props each caller hands `RecordScreen`, taken from the file itself. */
const propsOf = (path: string): { title: string; why: string } => {
  const text = callerSource(path);
  const title = /title="([^"]+)"/.exec(text);
  const why = /why="([^"]+)"/.exec(text);

  if (title === null || why === null) throw new Error(`${path} does not pass both title and why`);
  return { title: title[1] as string, why: why[1] as string };
};

const RECORD_SCREENS = [
  'features/jobs/Jobs.tsx',
  'features/setup/Customers.tsx',
  'features/setup/Properties.tsx',
  'features/setup/Suppliers.tsx',
  'features/setup/RateCard.tsx',
  'features/setup/ServiceTemplates.tsx',
  'features/setup/Recipes.tsx',
  'features/setup/Ingredients.tsx',
] as const;

describe.each(RECORD_SCREENS)('%s, as the owner reads it', (path) => {
  /*
   * `RecordScreen` composes `what` from the title — "Ingredients" becomes "your
   * ingredients" — so this builds the source the same way rather than being
   * told the answer.
   */
  const built = (state: DataSource['state']): readonly DataSource[] => {
    const { title, why } = propsOf(path);
    return [source(`your ${title.toLowerCase()}`, why, state)];
  };

  it('names the list, what it was for, and what the failure said', () => {
    const { title, why } = propsOf(path);
    const html = render(built(failed('Failed to fetch')), title);

    // The whole sentence, as one string. Asserted joined rather than in parts,
    // because the defect was a message whose parts were all individually fine.
    expect(html).toContain(`Could not load your ${title.toLowerCase()} — ${why}.`);
    // The error's own words — the half that four screens threw away.
    expect(html).toContain('Failed to fetch');
    // And a way out, on the screen, for a man who cannot reload a page easily.
    expect(html).toContain('Try again');
  });

  it('keeps its heading, so the error is not orphaned from its screen', () => {
    const { title } = propsOf(path);
    const html = render(built(failed('Failed to fetch')), title);

    // This REPLACES the screen, so without the heading he is looking at a bare
    // error with no idea which list it belongs to.
    expect(html).toContain(`<h1>${title}</h1>`);
  });

  it('says what it is waiting for while it waits', () => {
    const { title } = propsOf(path);
    const html = render(built(loading), title);

    expect(html).toContain(`Loading your ${title.toLowerCase()}…`);
    // NOT the word that was a lie on the dashboard for however long it sat
    // there after a failed read.
    expect(html).not.toContain('Could not load');
  });

  it('says nothing once the list has landed', () => {
    const { title } = propsOf(path);
    expect(render(built(ready), title)).toBe('');
  });

  it('reads as a sentence rather than a field dump', () => {
    const { title, why } = propsOf(path);

    /*
     * The anti-filler check. A required prop fed garbage is worse than no prop:
     * it compiles, it renders, and it tells him nothing — which is the exact
     * defect, reintroduced through the hole left for fixing it.
     *
     * So the clause has to be long enough to carry a consequence, start
     * lower-case because it follows a dash mid-sentence, and not end in a stop
     * because the composer adds one.
     */
    expect(why.length, `${path}: the why is too short to say what is lost`).toBeGreaterThan(29);
    expect(why.split(' ').length, `${path}: the why is not a clause`).toBeGreaterThan(5);
    expect(why[0], `${path}: the why starts a sentence it is not`).toBe(why[0]?.toLowerCase());
    expect(why.endsWith('.'), `${path}: the composer adds the full stop`).toBe(false);
    // And it is not just the screen's own name handed back.
    expect(why.toLowerCase()).not.toBe(title.toLowerCase());
  });
});

describe('the eight whys are eight reasons', () => {
  it('no two screens share one', () => {
    /*
     * The cheapest way to satisfy a required prop across eight files is to
     * paste the same clause into all of them, and it would pass every
     * assertion above. Eight identical reasons is one reason and seven lies
     * about which list failed.
     */
    const whys = RECORD_SCREENS.map((path) => propsOf(path).why);

    expect(new Set(whys).size, 'two screens give the same reason').toBe(whys.length);
  });

  it('each one is about its own screen', () => {
    // Pairwise: a clause written for Suppliers must not read correctly under
    // Recipes. Checked by requiring each why to be distinct from every other
    // after the screen names are stripped out, which catches a near-copy.
    const stripped = RECORD_SCREENS.map((path) => {
      const { title, why } = propsOf(path);
      return why.replaceAll(title.toLowerCase(), '').trim();
    });

    expect(new Set(stripped).size, 'two reasons differ only by the screen name').toBe(
      stripped.length,
    );
  });
});
