/**
 * "NOT COUNTED" MEANS HE NEVER COUNTED IT. It cannot also mean the read broke.
 *
 * The ingredients list renders an on-hand figure per row, and it had two
 * states where it needed three:
 *
 *   a stock row exists      → "2 kg on hand"
 *   NO stock row            → "not counted"   — Rule 8: absent is not zero
 *   the stock read FAILED   → "not counted"   — which is a lie
 *
 * The third collapsed into the second because `onHandFor` returned `undefined`
 * for both. One failed read therefore told him every shelf in the kitchen was
 * uncounted — directly beneath a comment reading "Rule 8 on the list too: not
 * counted reads differently from none".
 *
 * This is the same defect as the invoice's "could not be read", which meant an
 * illegible photograph, an unmatched name and an impossible conversion all at
 * once. It got the same fix: ONE exhaustive function, one sentence per state,
 * and a test that no two states can ever render the same words.
 */

import { describe, expect, it } from 'vitest';
import { onHandNote } from '../../src/ui/stockView';
import type { SourceState } from '../../src/ui/sourceState';

const ready: SourceState = { kind: 'ready' };
const loading: SourceState = { kind: 'loading', message: 'Loading what you have on hand…' };
const failed: SourceState = {
  kind: 'failed',
  failures: [
    {
      what: 'what you have on hand',
      why: 'without it this list cannot tell an uncounted shelf from an empty one',
      message: 'Could not load what you have on hand — …',
      detail: 'Failed to fetch',
    },
  ],
  retry: () => undefined,
};

describe('onHandNote', () => {
  it('reports a counted shelf with its own unit', () => {
    // The stored unit is carried, never rewritten: Rule 4. 2 kg is not 2 g.
    expect(onHandNote(ready, { value: 2, unit: 'kg' })).toBe('2 kg on hand');
    expect(onHandNote(ready, { value: 0, unit: 'kg' })).toBe('0 kg on hand');
  });

  it('distinguishes a counted zero from no count at all', () => {
    // He walked the shelf and found none, versus he never walked it. The
    // shopping list treats these differently, so the column must too.
    expect(onHandNote(ready, { value: 0, unit: 'kg' })).not.toBe(onHandNote(ready, undefined));
    expect(onHandNote(ready, undefined)).toBe('not counted');
  });

  it('never says "not counted" when the read did not land', () => {
    // THE BUG. Both of these used to be 'not counted'.
    expect(onHandNote(failed, undefined)).not.toBe('not counted');
    expect(onHandNote(loading, undefined)).not.toBe('not counted');
  });

  it('says what is actually true when the read did not land', () => {
    expect(onHandNote(failed, undefined)).toBe('on hand not loaded');
    expect(onHandNote(loading, undefined)).toBe('on hand not loaded');
  });

  it('ignores a stale row once the read has failed', () => {
    /*
     * A figure held over from a previous successful read, shown while the
     * current one is broken, is a number he would act on. The state decides,
     * not the leftover data.
     */
    expect(onHandNote(failed, { value: 2, unit: 'kg' })).toBe('on hand not loaded');
    expect(onHandNote(loading, { value: 2, unit: 'kg' })).toBe('on hand not loaded');
  });

  it('gives every state its own words', () => {
    const notes = [
      onHandNote(ready, { value: 2, unit: 'kg' }),
      onHandNote(ready, undefined),
      onHandNote(failed, undefined),
    ];

    // The invariant, stated as an invariant rather than trusted to three
    // assertions above: no two of the states collapse into one sentence.
    expect(new Set(notes).size, 'two states render the same text').toBe(notes.length);
  });
});
