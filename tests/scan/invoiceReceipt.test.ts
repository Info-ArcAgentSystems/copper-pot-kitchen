/**
 * Supermarket receipts: repeated lines, counts with no unit, and lines that
 * disagree.
 *
 * THE DEFECT THIS EXISTS FOR. An Aldi receipt read "JUICE ORANGE FC 2L" as 2 L
 * at €2.79 on one line and 4 L at €2.79 on the next. Against a 2 L pack those
 * work out to €2.79 and €1.40, and the save wrote every priced line in turn —
 * whichever came last silently became the price.
 */

import { describe, expect, it } from 'vitest';
import { commitScannedPrices } from '../../src/scan/commit';
import { reviewInvoice, type InvoiceRead } from '../../src/scan/invoice';
import type { Db } from '../../src/data/db';
import type {
  Cents,
  Ingredient,
  IngredientId,
  KitchenId,
  PurchaseUnit,
  StockUnit,
} from '../../src/engine/types';

const juice: Ingredient = {
  id: 'juice' as IngredientId,
  kitchenId: 'k1' as KitchenId,
  name: 'Juice Orange FC 2L',
  category: null,
  stockUnit: 'L' as StockUnit,
  recipeUnit: null,
  recipeUnitsPerStockUnit: null,
  pack: { size: 2, unit: 'L' as PurchaseUnit, assumed: false },
  supplierId: null,
  pricePerPack: null,
  previousPrice: null,
  priceChecked: null,
  allergens: [],
};

const owner = { ingredients: [juice], suppliers: [] };

const receipt = (lines: InvoiceRead['lines']): InvoiceRead => ({
  supplier: 'Aldi Stores (Ireland) Ltd',
  invoiceDate: null,
  lines,
  uncertain: [],
});

describe('lines for one ingredient that disagree are never saved', () => {
  const misread = receipt([
    { description: 'JUICE ORANGE FC 2L', quantity: 2, unit: 'L', lineTotalCents: 279 },
    { description: 'JUICE ORANGE FC 2L', quantity: 4, unit: 'L', lineTotalCents: 279 },
  ]);
  const review = reviewInvoice(misread, owner);

  it('marks EVERY line of that ingredient, naming both prices', () => {
    expect(review.lines.map((l) => l.price)).toEqual([
      { kind: 'disagrees', packPrices: [279, 140] },
      { kind: 'disagrees', packPrices: [279, 140] },
    ]);
  });

  it('prices nothing for it, and says why', () => {
    expect(review.priceableCount).toBe(0);
    expect(review.readyToSave).toBe(false);
    expect(review.needsManualHandling.join(' ')).toContain('different prices per pack');
  });
});

describe('repeated lines that AGREE are one price, written once', () => {
  const twice = receipt([
    { description: 'JUICE ORANGE FC 2L', quantity: 2, unit: 'L', lineTotalCents: 279 },
    { description: 'JUICE ORANGE FC 2L', quantity: 2, unit: 'L', lineTotalCents: 279 },
  ]);
  const review = reviewInvoice(twice, owner);

  it('counts one ingredient, not two lines', () => {
    expect(review.priceableCount).toBe(1);
    expect(review.readyToSave).toBe(true);
  });

  it('writes the ingredient ONCE', async () => {
    const updates: string[] = [];
    const db = {
      async update(_table: string, id: string, patch: Record<string, unknown>) {
        updates.push(id);
        return [{ id, ...patch }];
      },
    } as unknown as Db;

    const result = await commitScannedPrices(db, review, '2026-11-23');

    expect(result).toEqual({ ok: true, updated: 1 });
    expect(updates).toEqual(['juice']);
  });
});

describe('a receipt count with no unit is priced only on his word', () => {
  const count = receipt([{ description: 'JUICE ORANGE FC 2L', quantity: 1, unit: null, lineTotalCents: 279 }]);

  it('is refused by default — nothing says the item IS his 2 L pack', () => {
    const review = reviewInvoice(count, owner);
    expect(review.lines[0]?.price).toEqual({ kind: 'unconvertible', invoiceUnit: '', packUnit: 'L' });
    expect(review.readyToSave).toBe(false);
  });

  it('prices one pack per item once he says so: 1 × €2.79 is €2.79 a 2 L pack', () => {
    const review = reviewInvoice(count, owner, new Set(['JUICE ORANGE FC 2L']));
    expect(review.lines[0]?.price).toEqual({
      kind: 'priced',
      pricePerPack: 279 as Cents,
      pricePerUnit: 140 as Cents,
    });
  });

  it('prices two items on one line at the price of one pack each', () => {
    const two = receipt([{ description: 'JUICE ORANGE FC 2L', quantity: 2, unit: null, lineTotalCents: 558 }]);
    const review = reviewInvoice(two, owner, new Set(['JUICE ORANGE FC 2L']));
    expect(review.lines[0]?.price).toMatchObject({ kind: 'priced', pricePerPack: 279 });
  });

  it('never applies to a line that printed a unit of its own', () => {
    const printed = receipt([{ description: 'JUICE ORANGE FC 2L', quantity: 3, unit: 'L', lineTotalCents: 450 }]);
    const review = reviewInvoice(printed, owner, new Set(['JUICE ORANGE FC 2L']));
    // 3 L for €4.50 is €1.50 a litre, €3.00 a 2 L pack — the printed unit wins.
    expect(review.lines[0]?.price).toMatchObject({ kind: 'priced', pricePerPack: 300 });
  });
});

describe('a line needing hand entry no longer blocks the rest', () => {
  it('saves the priced line and lists the other', () => {
    const review = reviewInvoice(
      receipt([
        { description: 'JUICE ORANGE FC 2L', quantity: 2, unit: 'L', lineTotalCents: 279 },
        { description: 'Juice orange fc 2l crate', quantity: 1, unit: 'case', lineTotalCents: 1500 },
      ]),
      { ingredients: [juice, { ...juice, id: 'crate' as IngredientId, name: 'Juice orange fc 2l crate' }], suppliers: [] },
    );

    expect(review.needsManualHandling.length).toBeGreaterThan(0);
    expect(review.readyToSave).toBe(true);
  });
});
