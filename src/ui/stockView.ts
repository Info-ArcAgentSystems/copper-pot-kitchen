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
