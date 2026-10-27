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
