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

import type { Cents } from '../engine/types';
import type { NoIngredient, ReviewedLine, UnpricedLine } from '../scan/invoice';
import { formatMoney } from './form';

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
      return price.invoiceUnit === ''
        ? `no unit on the receipt, and your pack is ${price.packUnit}`
        : `invoiced in ${price.invoiceUnit}, stocked in ${price.packUnit} — enter this price by hand`;
    case 'disagrees':
      return `these lines work out to different prices per pack (${price.packPrices
        .map((c) => formatMoney(c, ''))
        .join(', ')}) — check the receipt; not saved`;
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

/**
 * Receipt lines with the same printed description, together.
 *
 * A supermarket receipt prints one line per item scanned, so four tubs of the
 * same sauce are four identical lines. Shown one by one they made a sixty-row
 * wall of repeated names; grouped, he reads one row per thing he bought.
 *
 * DISPLAY ONLY. The review's lines are untouched and each is still priced and
 * saved on its own; nothing here feeds a price.
 */
export interface LineGroup {
  readonly description: string;
  readonly lines: readonly ReviewedLine[];
  /**
   * The printed line totals added up — or NULL when any one of them could not
   * be read. A sum missing a line would look complete and be wrong.
   */
  readonly totalCents: number | null;
}

export function groupLines(lines: readonly ReviewedLine[]): readonly LineGroup[] {
  const order: string[] = [];
  const byDescription = new Map<string, ReviewedLine[]>();

  for (const line of lines) {
    const existing = byDescription.get(line.description);
    if (existing === undefined) {
      order.push(line.description);
      byDescription.set(line.description, [line]);
    } else {
      existing.push(line);
    }
  }

  return order.map((description) => {
    const group = byDescription.get(description) ?? [];
    const totals = group.map((l) => l.lineTotalCents);
    return {
      description,
      lines: group,
      totalCents: totals.every((t): t is number => t !== null)
        ? totals.reduce((sum, t) => sum + t, 0)
        : null,
    };
  });
}

/** One line's numbers as printed: "2 kg · €9.00", or what could not be read. */
function lineAsPrinted(line: ReviewedLine): string {
  const amount =
    line.quantity === null ? 'quantity not read' : `${line.quantity}${line.unit === null ? '' : ` ${line.unit}`}`;
  return `${amount} · ${formatMoney(line.lineTotalCents as Cents | null, 'total not read')}`;
}

/**
 * What the receipt said for a group, with the working shown when there is a
 * sum: "1 · €1.50 + 1 · €1.50 = €3.00". A group with an unreadable total shows
 * its lines and no sum.
 */
export function groupWorking(group: LineGroup): string {
  const parts = group.lines.map(lineAsPrinted).join(' + ');
  if (group.lines.length < 2) return parts;
  return group.totalCents === null
    ? `${parts} — no total, one line could not be read`
    : `${parts} = ${formatMoney(group.totalCents as Cents, '')}`;
}
