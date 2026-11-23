/**
 * A receipt reads as one row per thing bought, with what he paid always shown.
 *
 * THE DEFECT THIS EXISTS FOR. A Tesco receipt scanned into an empty ingredient
 * book showed sixty rows of a bare name and "not in your ingredients yet":
 * every line's quantity and total had been read and then hidden, and four tubs
 * of the same sauce were four identical rows.
 */

import { describe, expect, it } from 'vitest';
import { reviewInvoice, type InvoiceRead } from '../../src/scan/invoice';
import { groupLines, groupWorking } from '../../src/ui/invoiceView';

const RECEIPT: InvoiceRead = {
  supplier: 'TESCO',
  invoiceDate: null,
  lines: [
    { description: 'BOLOGNESE SAUCE', quantity: 1, unit: null, lineTotalCents: 250 },
    { description: 'JUICE ORANGE FC 2L', quantity: 1, unit: null, lineTotalCents: 300 },
    { description: 'BOLOGNESE SAUCE', quantity: 1, unit: null, lineTotalCents: 250 },
    { description: 'BOLOGNESE SAUCE', quantity: 1, unit: null, lineTotalCents: null },
  ],
  uncertain: [],
};

const review = reviewInvoice(RECEIPT, { ingredients: [], suppliers: [] });

describe('every line keeps what was read, matched or not', () => {
  it('carries the quantity, unit and total onto an UNMATCHED line', () => {
    expect(review.lines[1]).toMatchObject({ quantity: 1, unit: null, lineTotalCents: 300 });
    expect(review.lines[1]?.price).toEqual({ kind: 'no_ingredient', reason: 'new' });
  });
});

describe('groupLines — identical receipt lines together, in receipt order', () => {
  const groups = groupLines(review.lines);

  it('makes one row per description, first appearance first', () => {
    expect(groups.map((g) => [g.description, g.lines.length])).toEqual([
      ['BOLOGNESE SAUCE', 3],
      ['JUICE ORANGE FC 2L', 1],
    ]);
  });

  it('adds up the totals only when every one was read', () => {
    const juice = groups[1]!;
    expect(juice.totalCents).toBe(300);

    // One unread total: no sum at all, rather than €5.00 that looks complete.
    expect(groups[0]!.totalCents).toBeNull();
  });

  it('sums two readable lines', () => {
    const two = groupLines(review.lines.slice(0, 3).filter((l) => l.description === 'BOLOGNESE SAUCE'));
    expect(two[0]?.totalCents).toBe(500);
    expect(groupWorking(two[0]!)).toBe('1 · €2.50 + 1 · €2.50 = €5.00');
  });

  it('shows the lines and says why there is no total when one is unreadable', () => {
    expect(groupWorking(groups[0]!)).toBe(
      '1 · €2.50 + 1 · €2.50 + 1 · total not read — no total, one line could not be read',
    );
  });

  it('shows a lone line as printed, with no sum', () => {
    expect(groupWorking(groups[1]!)).toBe('1 · €3.00');
  });

  it('leaves the review itself untouched — grouping is display only', () => {
    expect(review.lines).toHaveLength(4);
  });
});
