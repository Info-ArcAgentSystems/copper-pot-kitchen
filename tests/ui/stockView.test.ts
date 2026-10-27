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

/**
 * A FAILED STOCK READ MUST NEVER CLEAR A STOCK-TAKE.
 *
 * The hazard, in order:
 *
 *   1. the stock read fails
 *   2. `existingStock` is therefore undefined — the same value it holds when he
 *      has genuinely never counted the ingredient
 *   3. the On hand field falls back to '', so the form says "not counted"
 *   4. he saves something unrelated on the same record — a price, a pack size
 *   5. blank on-hand means "clear the row" under Rule 8
 *
 * Which would delete a real stock-take he never touched, because a read broke.
 *
 * Today it does not happen, and the reason is an accident: the clear is wrapped
 * in `if (existingStock !== undefined)`, which is false for the failed read for
 * the SAME wrong reason that made the field blank. Two bugs cancelling is not a
 * guarantee — restore `existingStock` from a stale read, or rewrite that
 * condition for any other purpose, and the stock-take goes.
 *
 * So the decision is a function of the read's STATE, not of a value that cannot
 * tell the two absences apart, and these tests are what hold it there.
 */

import { stockWrite } from '../../src/ui/stockView';

const counted = { value: 2, unit: 'kg' };

describe('stockWrite', () => {
  it('writes what he typed', () => {
    expect(stockWrite(ready, undefined, 5)).toEqual({ kind: 'set', value: 5 });
    // A counted zero is a real figure meaning "I looked and there is none".
    expect(stockWrite(ready, counted, 0)).toEqual({ kind: 'set', value: 0 });
  });

  it('clears a real row when he deliberately empties the field', () => {
    // Rule 8 in the other direction: he had a count, he blanked it, so the row
    // goes rather than becoming a zero he never said.
    expect(stockWrite(ready, counted, null)).toEqual({ kind: 'clear' });
  });

  it('writes nothing when there was nothing and he typed nothing', () => {
    expect(stockWrite(ready, undefined, null)).toEqual({ kind: 'none' });
  });

  it('NEVER clears when the read failed — the data-loss path', () => {
    // THE PIN. A blank field over a broken read is not him clearing anything;
    // it is the form not knowing. Both of these were one incidental if-guard
    // away from deleting a stock-take.
    expect(stockWrite(failed, undefined, null)).toEqual({ kind: 'none' });
    expect(stockWrite(failed, counted, null)).toEqual({ kind: 'none' });
    expect(stockWrite(loading, undefined, null)).toEqual({ kind: 'none' });
    expect(stockWrite(loading, counted, null)).toEqual({ kind: 'none' });
  });

  it('never clears on a failed read whatever the row says', () => {
    /*
     * Stated over every shape rather than the two above, because the defect was
     * precisely that one absence was standing in for another. If any
     * combination of a non-ready state produces a clear, this fails.
     */
    for (const state of [failed, loading]) {
      for (const held of [undefined, counted, { value: 0, unit: 'kg' }]) {
        expect(stockWrite(state, held, null).kind, 'cleared a stock row on a read that never landed').not.toBe('clear');
      }
    }
  });

  it('still saves a figure he typed while the read is broken', () => {
    /*
     * Not the same thing as clearing. A number in the field is him telling the
     * system what is on the shelf, and a broken read is no reason to discard
     * it — he is standing in front of the shelf.
     */
    expect(stockWrite(failed, undefined, 3)).toEqual({ kind: 'set', value: 3 });
  });
});
