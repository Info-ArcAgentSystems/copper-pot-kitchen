/**
 * THE SILENT DISABLED STATE — the defect this module exists to make
 * unrepresentable.
 *
 * Four scanners gated their photo buttons on `status === 'ready'` over two or
 * three repository reads. A read that FAILED left `ready` false for the rest of
 * the session, so the buttons sat at opacity 0.6 with no message on the screen
 * and the reason — which `useAsync` had captured and held — discarded. The
 * feature looked broken rather than saying what was wrong. ScanJobSheet reads
 * three repositories, so it had three ways in.
 *
 * It is the same shape as the invoice's "could not be read" and the swallowed
 * OpenAI body: a statement that is true, useless, and sitting next to the
 * answer.
 *
 * So readiness becomes a value rather than a boolean, and a non-ready value
 * CANNOT exist without words for it. The assertions below are the contract:
 *
 *   loading  → names what is still coming
 *   failed   → names what failed, why it matters, and the error's own message
 *   ready    → only when every read landed
 *
 * `failed` BEATS `loading`, which is the case worth stating out loud: with one
 * read errored and another still in flight, reporting "loading" would reproduce
 * the original defect exactly — a true word that hides a dead screen.
 */

import { describe, expect, it } from 'vitest';
import { sourceState, type DataSource } from '../../src/ui/sourceState';
import type { AsyncState } from '../../src/ui/useAsync';

const loading: AsyncState<unknown> = { status: 'loading' };
const ready: AsyncState<unknown> = { status: 'ready', data: [] };
const failed = (message: string): AsyncState<unknown> => ({
  status: 'error',
  error: new Error(message),
});

/** A source with a counter standing in for the component's `reload`. */
const source = (
  what: string,
  state: AsyncState<unknown>,
  onReload: () => void = () => {},
): DataSource => ({
  what,
  why: `the scanner needs ${what}`,
  state,
  reload: onReload,
});

const INGREDIENTS = 'your ingredients';

describe('every read landed', () => {
  it('is ready', () => {
    expect(sourceState([source(INGREDIENTS, ready)])).toEqual({ kind: 'ready' });
  });

  it('is ready with nothing to wait for', () => {
    // A gate over no sources waits for nothing. Stated rather than left to
    // whatever a loop over an empty array happens to do.
    expect(sourceState([])).toEqual({ kind: 'ready' });
  });
});

describe('still loading', () => {
  it('names the one read that is still coming', () => {
    const state = sourceState([source(INGREDIENTS, loading)]);

    expect(state).toEqual({ kind: 'loading', message: 'Loading your ingredients…' });
  });

  it('names all three, as a sentence rather than a list of codes', () => {
    const state = sourceState([
      source('your customers', loading),
      source('your properties', loading),
      source('your recipes', loading),
    ]);

    expect(state.kind).toBe('loading');
    if (state.kind !== 'loading') return;
    expect(state.message).toBe('Loading your customers, your properties and your recipes…');
  });

  it('names only what is OUTSTANDING, not what already arrived', () => {
    const state = sourceState([
      source('your customers', ready),
      source('your properties', loading),
      source('your recipes', ready),
    ]);

    expect(state.kind).toBe('loading');
    if (state.kind !== 'loading') return;
    expect(state.message).toBe('Loading your properties…');
  });
});

describe('a read failed', () => {
  it('says which one, what it is for, and what the failure said', () => {
    const state = sourceState([
      {
        what: INGREDIENTS,
        why: 'the scanner needs them to match what it reads',
        state: failed('Failed to fetch'),
        reload: () => {},
      },
    ]);

    expect(state.kind).toBe('failed');
    if (state.kind !== 'failed') return;
    expect(state.failures).toHaveLength(1);
    expect(state.failures[0]?.message).toBe(
      'Could not load your ingredients — the scanner needs them to match what it reads.',
    );
    // The reason was available. It is never thrown away.
    expect(state.failures[0]?.detail).toBe('Failed to fetch');
  });

  it('reports every failure, in the order the screen declared them', () => {
    const state = sourceState([
      source('your ingredients', failed('one')),
      source('your suppliers', failed('two')),
    ]);

    expect(state.kind).toBe('failed');
    if (state.kind !== 'failed') return;
    expect(state.failures.map((f) => f.what)).toEqual(['your ingredients', 'your suppliers']);
    expect(state.failures.map((f) => f.detail)).toEqual(['one', 'two']);
  });

  it('BEATS loading — a failure never hides behind a sibling still in flight', () => {
    const state = sourceState([
      source('your customers', failed('Failed to fetch')),
      source('your properties', loading),
      source('your recipes', ready),
    ]);

    expect(state.kind).toBe('failed');
    if (state.kind !== 'failed') return;
    expect(state.failures.map((f) => f.what)).toEqual(['your customers']);
  });

  it('says so when the failure itself said nothing, rather than showing empty brackets', () => {
    // Rule 8 in miniature: an absent reason is reported as absent, not papered
    // over with a plausible one.
    const state = sourceState([source(INGREDIENTS, failed('   '))]);

    expect(state.kind).toBe('failed');
    if (state.kind !== 'failed') return;
    expect(state.failures[0]?.detail).toBe('no reason given');
  });
});

describe('the retry', () => {
  it('re-runs the reads that failed', () => {
    let customers = 0;
    let properties = 0;

    const state = sourceState([
      source('your customers', failed('one'), () => {
        customers += 1;
      }),
      source('your properties', failed('two'), () => {
        properties += 1;
      }),
    ]);

    expect(state.kind).toBe('failed');
    if (state.kind !== 'failed') return;
    state.retry();

    expect(customers).toBe(1);
    expect(properties).toBe(1);
  });

  it('leaves a read that is still in flight alone', () => {
    let reloads = 0;

    const state = sourceState([
      source('your customers', failed('one')),
      source('your properties', loading, () => {
        reloads += 1;
      }),
    ]);

    if (state.kind !== 'failed') throw new Error('expected failed');
    state.retry();

    expect(reloads).toBe(0);
  });
});

/**
 * EXHAUSTIVE over three reads — the shape of ScanJobSheet, the most exposed
 * screen. 27 combinations, and the two claims that matter in every one of them:
 * ready requires all three, and ANY error is reported as an error.
 */
describe('over every combination of three reads', () => {
  const states: readonly { readonly name: string; readonly state: AsyncState<unknown> }[] = [
    { name: 'ready', state: ready },
    { name: 'loading', state: loading },
    { name: 'error', state: failed('boom') },
  ];

  for (const a of states) {
    for (const b of states) {
      for (const c of states) {
        const names = [a.name, b.name, c.name];

        it(`${names.join(' / ')}`, () => {
          const state = sourceState([
            source('your customers', a.state),
            source('your properties', b.state),
            source('your recipes', c.state),
          ]);

          const anyError = names.includes('error');
          const allReady = names.every((n) => n === 'ready');

          expect(state.kind).toBe(anyError ? 'failed' : allReady ? 'ready' : 'loading');

          // Whatever the mix, a non-ready state always carries words.
          if (state.kind === 'loading') expect(state.message).not.toBe('');
          if (state.kind === 'failed') {
            expect(state.failures.length).toBeGreaterThan(0);
            for (const failure of state.failures) {
              expect(failure.message).not.toBe('');
              expect(failure.detail).not.toBe('');
            }
          }
        });
      }
    }
  }
});
