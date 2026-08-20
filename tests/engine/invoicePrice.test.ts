/**
 * pricePerPackFromInvoice — the division the MODEL must never do.
 *
 * Rule 2, at its sharpest. An invoice line reads "5 kg — €45.00", and working out
 * €9.00 per kilo is exactly the sort of helpful arithmetic a model will perform
 * and occasionally get wrong. So the model reads two numbers off the page and
 * this function does the sum, with worked cases pinned here before it was written.
 *
 * The conversion goes through `packSizeIn`, the same bridge `stockToPacks` and
 * `costPerStockUnit` already use (Rule 5). That is what stops what you PAID
 * diverging from what you BUY and what you COST.
 */

import { describe, expect, it } from 'vitest';
import { pricePerPackFromInvoice } from '../../src/engine/costing';
import type {
  Cents,
  Ingredient,
  IngredientId,
  KitchenId,
  PurchaseUnit,
  RecipeUnit,
  StockUnit,
} from '../../src/engine/types';

const KITCHEN = 'k1' as KitchenId;

/** 1 kg packs, stocked in kg. The ordinary case. */
const flour = (over: Partial<Ingredient> = {}): Ingredient => ({
  id: 'flour' as IngredientId,
  kitchenId: KITCHEN,
  name: 'flour',
  category: null,
  stockUnit: 'kg' as StockUnit,
  recipeUnit: 'g' as RecipeUnit,
  recipeUnitsPerStockUnit: null,
  pack: { size: 1, unit: 'kg' as PurchaseUnit, assumed: false },
  supplierId: null,
  pricePerPack: null,
  previousPrice: null,
  priceChecked: null,
  allergens: [],
  ...over,
});

describe('the worked cases', () => {
  it('5 kg delivered for €45.00, 1 kg packs, is €9.00 a pack', () => {
    // 4500c ÷ 5 = 900c per kg. One kilo per pack, so 900c per pack.
    const result = pricePerPackFromInvoice(flour(), {
      quantity: 5,
      unit: 'kg' as StockUnit,
      lineTotal: 4500 as Cents,
    });

    expect(result.kind).toBe('priced');
    if (result.kind !== 'priced') return;
    expect(result.pricePerPack).toBe(900);
  });

  it('the SAME line against 2.5 kg packs is €22.50 a pack', () => {
    // Same €9.00 per kilo, but a pack now holds two and a half of them. This is
    // the case a per-unit price alone would get wrong.
    const result = pricePerPackFromInvoice(
      flour({ pack: { size: 2.5, unit: 'kg' as PurchaseUnit, assumed: false } }),
      { quantity: 5, unit: 'kg' as StockUnit, lineTotal: 4500 as Cents },
    );

    expect(result.kind).toBe('priced');
    if (result.kind !== 'priced') return;
    expect(result.pricePerPack).toBe(2250);
  });

  it('reports the per-unit figure too, so the owner can check the sum', () => {
    const result = pricePerPackFromInvoice(flour(), {
      quantity: 5,
      unit: 'kg' as StockUnit,
      lineTotal: 4500 as Cents,
    });

    if (result.kind !== 'priced') return;
    expect(result.pricePerUnit).toBe(900);
  });

  it('rounds to whole cents once, at the end', () => {
    // 1000c ÷ 3 is 333.33…; a pack price must be a real number of cents.
    const result = pricePerPackFromInvoice(flour(), {
      quantity: 3,
      unit: 'kg' as StockUnit,
      lineTotal: 1000 as Cents,
    });

    if (result.kind !== 'priced') return;
    expect(result.pricePerPack).toBe(333);
    expect(Number.isInteger(result.pricePerPack)).toBe(true);
  });

  it('converts a gram-priced line into a kilo pack', () => {
    // 500 g for €4.50 is 0.9c per gram, and a 1 kg pack holds 1000 of them: €9.00.
    // The conversion is `packSizeIn`'s, not this function's.
    const result = pricePerPackFromInvoice(flour(), {
      quantity: 500,
      unit: 'g' as StockUnit,
      lineTotal: 450 as Cents,
    });

    expect(result.kind).toBe('priced');
    if (result.kind !== 'priced') return;
    expect(result.pricePerPack).toBe(900);
  });
});

describe('RULE 8 — four refusals, each its own state', () => {
  it('refuses an unreadable quantity rather than assuming one', () => {
    const result = pricePerPackFromInvoice(flour(), {
      quantity: null,
      unit: 'kg' as StockUnit,
      lineTotal: 4500 as Cents,
    });

    expect(result.kind).toBe('unreadable');
    if (result.kind !== 'unreadable') return;
    expect(result.missing).toContain('quantity');
  });

  it('refuses an unreadable total', () => {
    const result = pricePerPackFromInvoice(flour(), {
      quantity: 5,
      unit: 'kg' as StockUnit,
      lineTotal: null,
    });

    expect(result.kind).toBe('unreadable');
    if (result.kind !== 'unreadable') return;
    expect(result.missing).toContain('lineTotal');
  });

  it('REFUSES a zero quantity rather than producing Infinity', () => {
    // The division that would otherwise sail through and put Infinity, or a
    // silently-coerced number, into the ingredient's price.
    const result = pricePerPackFromInvoice(flour(), {
      quantity: 0,
      unit: 'kg' as StockUnit,
      lineTotal: 4500 as Cents,
    });

    expect(result.kind).toBe('unreadable');
    if (result.kind !== 'unreadable') return;
    expect(result.missing).toContain('quantity');
  });

  it('SURFACES a unit that will not convert, rather than guessing', () => {
    // A case of something against a kg pack. There is no honest factor between
    // them, and inventing one would put a wrong price into every recipe using it.
    const result = pricePerPackFromInvoice(flour(), {
      quantity: 4,
      unit: 'case' as StockUnit,
      lineTotal: 4500 as Cents,
    });

    expect(result.kind).toBe('unconvertible');
    if (result.kind !== 'unconvertible') return;
    expect(result.invoiceUnit).toBe('case');
    expect(result.packUnit).toBe('kg');
  });

  it('surfaces an ingredient with no pack size at all', () => {
    // Nothing to convert INTO. Distinct from a unit mismatch, and fixed
    // somewhere different.
    const result = pricePerPackFromInvoice(flour({ pack: null }), {
      quantity: 5,
      unit: 'kg' as StockUnit,
      lineTotal: 4500 as Cents,
    });

    expect(result.kind).toBe('no_pack');
  });

  it('refuses a negative total rather than storing a negative price', () => {
    // A credit note line. Real, but not a price, and it must not become one.
    const result = pricePerPackFromInvoice(flour(), {
      quantity: 5,
      unit: 'kg' as StockUnit,
      lineTotal: -4500 as Cents,
    });

    expect(result.kind).toBe('unreadable');
  });

  it('uses the owner’s each→kg factor when the pack needs it', () => {
    // Eggs: bought by the dozen, stocked in kg. `packSizeIn` bridges it only
    // through the factor the owner entered — never a guess of 1.
    const eggs = flour({
      id: 'eggs' as IngredientId,
      name: 'eggs',
      recipeUnit: 'each' as RecipeUnit,
      recipeUnitsPerStockUnit: 20,
      pack: { size: 12, unit: 'each' as PurchaseUnit, assumed: false },
    });

    const result = pricePerPackFromInvoice(eggs, {
      quantity: 2,
      unit: 'kg' as StockUnit,
      lineTotal: 1000 as Cents,
    });

    // 1000c ÷ 2 kg = 500c per kg; a 12-egg pack is 12/20 = 0.6 kg; 500 × 0.6 = 300c.
    expect(result.kind).toBe('priced');
    if (result.kind !== 'priced') return;
    expect(result.pricePerPack).toBe(300);
  });
});
