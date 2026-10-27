/**
 * The on-hand column's words — all three states, in one exhaustive place.
 *
 * `src/ui/invoiceView.ts` exists because three different invoice outcomes all
 * rendered "could not be read", and the owner spent two days photographing a
 * perfectly legible invoice. This is the same shape of bug in the ingredients
 * list, and it gets the same shape of fix.
 *
 * The three states are genuinely different things:
 *
 *   a figure      he counted it, and this is what he found
 *   not counted   he has never counted it — Rule 8, absent is not zero
 *   not loaded    the read broke, and the kitchen is not what is at fault
 *
 * The third used to render as the second, because the lookup returned
 * `undefined` for both. Taking the `SourceState` rather than a boolean is what
 * makes that unrepresentable: there is no way to call this without having
 * decided whether the read landed.
 *
 * Pure. No React, no repositories.
 */

import type { SourceState } from './sourceState';

/** Just enough of a stock row to describe it. */
export interface OnHand {
  readonly value: number;
  readonly unit: string;
}

export function onHandNote(state: SourceState, held: OnHand | undefined): string {
  /*
   * The state decides FIRST, and a row that happens to be in hand does not
   * override it. A figure left over from an earlier successful read, shown
   * beside a broken one, is a number he would act on in a supermarket.
   */
  if (state.kind !== 'ready') return 'on hand not loaded';

  // Rule 4: the stored unit is carried, never rewritten. 2 kg is not 2 g.
  return held === undefined ? 'not counted' : `${held.value} ${held.unit} on hand`;
}

/**
 * What the save should do to the stock row — decided from the read's STATE.
 *
 * The clear was previously guarded by `existingStock !== undefined`, which is
 * false after a failed read for the same wrong reason that leaves the On hand
 * field blank. So a broken read plus an unrelated edit to the same ingredient —
 * a price, a pack size — did not delete his stock-take, but only because two
 * bugs cancelled. Restore `existingStock` from a stale read, or rewrite that
 * condition for any other purpose, and the stock-take goes.
 *
 * Taking the `SourceState` makes the protection deliberate: a blank field over
 * a read that never landed is the form not knowing, which is not the same thing
 * as him clearing a count, and there is no way to ask this question without
 * having said which of the two it is.
 *
 * A figure he TYPED is still written. He is standing in front of the shelf; a
 * broken read is no reason to throw away what he can see.
 */
export type StockWrite =
  | { readonly kind: 'none' }
  | { readonly kind: 'clear' }
  | { readonly kind: 'set'; readonly value: number };

export function stockWrite(
  state: SourceState,
  held: OnHand | undefined,
  typed: number | null,
): StockWrite {
  if (typed !== null) return { kind: 'set', value: typed };

  // Blank, and the read never landed: the form does not know what is on the
  // shelf, so it changes nothing.
  if (state.kind !== 'ready') return { kind: 'none' };

  // Blank over a read that DID land: Rule 8, he has removed the count, so the
  // row goes rather than becoming a zero he never said.
  return held === undefined ? { kind: 'none' } : { kind: 'clear' };
}
