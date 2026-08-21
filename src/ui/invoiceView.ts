/**
 * How an unpriced invoice line reads, in the owner's terms.
 *
 * PURE, and separate from the screen on purpose: this is the layer the two-day
 * bug lived in. Every unpriced outcome used to funnel through a chain of ternaries
 * ending in a bare `else`, and the `else` said "could not be read" — so a state
 * that had nothing to do with reading inherited a sentence about the photograph.
 *
 * Two properties keep that from recurring, and both are tested:
 *
 *   1. EXHAUSTIVE. No default branch. A new outcome fails to compile rather than
 *      quietly adopting a neighbour's sentence.
 *   2. DISTINCT. No two outcomes may produce the same text. Sharing a sentence is
 *      how the owner loses the ability to tell states apart — which is exactly
 *      what happened, and the reason a message bug cost more than a wrong number
 *      would have.
 *
 * Each sentence names what to DO about it. "Could not be read" failed that too:
 * it described a condition and left the next move unstated.
 */

import type { NoIngredient, UnpricedLine } from '../scan/invoice';

/** Why the ingredient did not resolve. Each fixes differently. */
function unmatchedNote(reason: NoIngredient['reason']): string {
  switch (reason) {
    case 'new':
      return 'not in your ingredients yet — add it first';
    case 'ambiguous':
      return 'matches more than one of your ingredients — say which';
    case 'missing':
      return 'no name on this line, so nothing to match';
    default: {
      const unhandled: never = reason;
      return unhandled;
    }
  }
}

export function lineNote(price: UnpricedLine): string {
  switch (price.kind) {
    case 'no_ingredient':
      return unmatchedNote(price.reason);
    case 'unreadable':
      // The numbers themselves. Named, because "the total" and "the quantity"
      // are photographed differently and fixed differently.
      return `could not read the ${price.missing.join(' and ')} on this line`;
    case 'unconvertible':
      return `invoiced in ${price.invoiceUnit}, stocked in ${price.packUnit} — enter this price by hand`;
    case 'no_pack':
      return 'no pack size recorded — set one in Ingredients';
    default: {
      // Unreachable while the union is covered. A new member lands here and the
      // assignment fails to compile.
      const unhandled: never = price;
      return unhandled;
    }
  }
}
