/**
 * Reviewing a photographed supplier invoice.
 *
 * PURE. The arithmetic under test lives in `engine/costing.ts` and is already
 * pinned by `tests/engine/invoicePrice.test.ts`; what this file checks is that the
 * review layer CALLS it rather than doing its own sum, and that every refusal it
 * returns reaches the owner instead of being smoothed over.
 *
 * The line that matters: the model reads two numbers off the page, and the code
 * divides them. A price-per-pack the model reported would be a figure nobody
 * checked.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { reviewInvoice, type InvoiceRead } from '../../src/scan/invoice';
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

const ingredient = (over: Partial<Ingredient> = {}): Ingredient => ({
  id: 'flour' as IngredientId,
  kitchenId: KITCHEN,
  name: 'flour',
  category: null,
  stockUnit: 'kg' as StockUnit,
  recipeUnit: 'g' as RecipeUnit,
  recipeUnitsPerStockUnit: null,
  pack: { size: 1, unit: 'kg' as PurchaseUnit, assumed: false },
  supplierId: null,
  pricePerPack: 800 as Cents,
  previousPrice: null,
  priceChecked: null,
  allergens: [],
  ...over,
});

const owner = { ingredients: [ingredient()], suppliers: [] };

const read = (over: Partial<InvoiceRead> = {}): InvoiceRead => ({
  supplier: 'Musgrave',
  invoiceDate: '2026-08-20',
  lines: [{ description: 'flour', quantity: 5, unit: 'kg', lineTotal: 4500 }],
  uncertain: [],
  ...over,
});

describe('the price is DERIVED, not read', () => {
  it('prices a line from the total and the quantity', () => {
    // €45.00 over 5 kg into 1 kg packs. The sum is the engine's.
    const review = reviewInvoice(read(), owner);

    expect(review.lines[0]?.price.kind).toBe('priced');
    if (review.lines[0]?.price.kind !== 'priced') return;
    expect(review.lines[0].price.pricePerPack).toBe(900);
  });

  it('shows the per-unit figure beside it, so the arithmetic is checkable', () => {
    const review = reviewInvoice(read(), owner);

    if (review.lines[0]?.price.kind !== 'priced') return;
    expect(review.lines[0].price.pricePerUnit).toBe(900);
  });

  it('carries the OLD price alongside, so a jump is visible before saving', () => {
    // 800c becoming 900c is a 12% rise. Showing only the new figure hides it.
    const review = reviewInvoice(read(), owner);

    expect(review.lines[0]?.previousPrice).toBe(800);
  });

  it('THE MODEL IS NEVER ASKED FOR A PRICE PER PACK', () => {
    // The read type has no field for one. A field a model could fill by dividing
    // is a field it will fill by dividing.
    const source = readFileSync(
      fileURLToPath(new URL('../../src/scan/invoice.ts', import.meta.url)),
      'utf8',
    );
    const readType = source.slice(source.indexOf('export interface InvoiceRead'));
    const decl = readType.slice(0, readType.indexOf('}\n\n'));

    expect(decl).not.toContain('pricePerPack');
    expect(decl).not.toContain('pricePerUnit');
    expect(decl).not.toContain('unitPrice');
  });

  it('does its own division nowhere', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../src/scan/invoice.ts', import.meta.url)),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    expect(source).not.toMatch(/lineTotal\s*\//);
    expect(source).not.toMatch(/\/\s*quantity/);
  });
});

describe('RULE 8 — every refusal reaches the owner', () => {
  it('SURFACES a unit that will not convert, rather than guessing', () => {
    // A case of flour against a kg pack. There is no honest factor, and inventing
    // one puts a wrong price into every recipe using it.
    const review = reviewInvoice(
      read({ lines: [{ description: 'flour', quantity: 4, unit: 'case', lineTotal: 4500 }] }),
      owner,
    );

    expect(review.lines[0]?.price.kind).toBe('unconvertible');
    expect(review.needsManualHandling).toHaveLength(1);
    expect(review.readyToSave).toBe(false);
  });

  it('names both units in the manual-handling note', () => {
    const review = reviewInvoice(
      read({ lines: [{ description: 'flour', quantity: 4, unit: 'case', lineTotal: 4500 }] }),
      owner,
    );

    const note = review.needsManualHandling[0] ?? '';
    expect(note).toContain('case');
    expect(note).toContain('kg');
  });

  it('refuses an unreadable total rather than pricing at zero', () => {
    const review = reviewInvoice(
      read({ lines: [{ description: 'flour', quantity: 5, unit: 'kg', lineTotal: null }] }),
      owner,
    );

    expect(review.lines[0]?.price.kind).toBe('unreadable');
    expect(review.readyToSave).toBe(false);
  });

  it('refuses a zero quantity rather than storing Infinity', () => {
    const review = reviewInvoice(
      read({ lines: [{ description: 'flour', quantity: 0, unit: 'kg', lineTotal: 4500 }] }),
      owner,
    );

    expect(review.lines[0]?.price.kind).toBe('unreadable');
  });

  it('surfaces an ingredient with no pack size, distinctly', () => {
    const review = reviewInvoice(read(), {
      ingredients: [ingredient({ pack: null })],
      suppliers: [],
    });

    expect(review.lines[0]?.price.kind).toBe('no_pack');
  });
});

describe('ingredients are matched, never created', () => {
  it('matches one already in his data', () => {
    expect(reviewInvoice(read(), owner).lines[0]?.ingredient.kind).toBe('matched');
  });

  it('FLAGS an unknown line as new, and does not price it', () => {
    // No ingredient means no pack, so there is nothing to convert into. Pricing
    // it would mean inventing the pack as well.
    const review = reviewInvoice(
      read({ lines: [{ description: 'semolina', quantity: 2, unit: 'kg', lineTotal: 900 }] }),
      owner,
    );

    expect(review.lines[0]?.ingredient.kind).toBe('new');
    expect(review.newThings).toContainEqual({ what: 'ingredient', read: 'semolina' });
    expect(review.lines[0]?.price.kind).not.toBe('priced');
  });

  it('does not resolve an ambiguous description', () => {
    const two = {
      ingredients: [
        ingredient({ id: 'a' as IngredientId, name: 'chicken breast' }),
        ingredient({ id: 'b' as IngredientId, name: 'chicken thigh' }),
      ],
      suppliers: [],
    };
    const review = reviewInvoice(
      read({ lines: [{ description: 'chicken', quantity: 2, unit: 'kg', lineTotal: 1800 }] }),
      two,
    );

    expect(review.lines[0]?.ingredient.kind).toBe('ambiguous');
    expect(review.readyToSave).toBe(false);
  });
});

describe('what can be saved', () => {
  it('is ready when every line priced cleanly', () => {
    expect(reviewInvoice(read(), owner).readyToSave).toBe(true);
  });

  it('counts how many lines would actually update a price', () => {
    const review = reviewInvoice(
      read({
        lines: [
          { description: 'flour', quantity: 5, unit: 'kg', lineTotal: 4500 },
          { description: 'semolina', quantity: 2, unit: 'kg', lineTotal: 900 },
        ],
      }),
      owner,
    );

    expect(review.priceableCount).toBe(1);
  });

  it('is not ready when nothing on the invoice could be priced', () => {
    const review = reviewInvoice(
      read({ lines: [{ description: 'semolina', quantity: 2, unit: 'kg', lineTotal: 900 }] }),
      owner,
    );

    expect(review.readyToSave).toBe(false);
  });
});
