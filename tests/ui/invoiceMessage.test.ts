/**
 * An unpriced invoice line says which thing was missing.
 *
 * THE REGRESSION THIS PINS was not a wrong number — it was a wrong sentence, and
 * it cost more than a wrong number would have. `reviewInvoice` gave an unmatched
 * ingredient the engine's `unreadable` state, and the screen rendered that as
 * "could not be read". So a scan whose numbers were read perfectly reported that
 * the photograph was illegible, on every line, and two days went into the camera,
 * the model, the schema and the parser before anyone read the branch.
 *
 * A message that describes the wrong condition is worse than no message: it does
 * not merely fail to help, it actively sends the reader somewhere else.
 *
 * So the property under test is DISTINCTNESS, checked pairwise across the whole
 * union rather than only for the pair that broke. Any two states sharing a
 * sentence is the same defect wearing different clothes.
 */

import { describe, expect, it } from 'vitest';
import { lineNote } from '../../src/ui/invoiceView';
import {
  reviewInvoice,
  type InvoiceRead,
  type NoIngredient,
  type UnpricedLine,
} from '../../src/scan/invoice';
import type {
  Cents,
  Ingredient,
  IngredientId,
  KitchenId,
  PurchaseUnit,
  RecipeUnit,
  StockUnit,
} from '../../src/engine/types';

/**
 * One sample of every unpriced outcome, in two TOTAL records.
 *
 * Total on purpose: `Record<Union['kind'], …>` will not compile until every
 * member has a sample, so a new outcome cannot be added without landing in the
 * distinctness check below. A suite that silently skips a new state is how the
 * next shared sentence would ship unnoticed.
 */
const BY_KIND: Record<UnpricedLine['kind'], UnpricedLine> = {
  no_ingredient: { kind: 'no_ingredient', reason: 'new' },
  unreadable: { kind: 'unreadable', missing: ['quantity'] },
  unconvertible: { kind: 'unconvertible', invoiceUnit: 'case', packUnit: 'kg' },
  no_pack: { kind: 'no_pack' },
};

/** And every reason within the unmatched case, which must also read differently. */
const BY_REASON: Record<NoIngredient['reason'], NoIngredient> = {
  new: { kind: 'no_ingredient', reason: 'new' },
  ambiguous: { kind: 'no_ingredient', reason: 'ambiguous' },
  missing: { kind: 'no_ingredient', reason: 'missing' },
};

const EVERY: readonly UnpricedLine[] = [
  ...Object.values(BY_REASON),
  ...Object.values(BY_KIND).filter((p) => p.kind !== 'no_ingredient'),
];

describe('no two unpriced states may read the same', () => {
  it('THE PAIR THAT BROKE — unmatched and unreadable say different things', () => {
    const unmatched = lineNote({ kind: 'no_ingredient', reason: 'new' });
    const unreadable = lineNote({ kind: 'unreadable', missing: ['quantity', 'lineTotal'] });

    expect(unmatched).not.toBe(unreadable);
  });

  it('the unmatched line does not claim anything was illegible', () => {
    // The specific false statement. The numbers may be perfectly clear.
    const note = lineNote({ kind: 'no_ingredient', reason: 'new' });

    expect(note).not.toMatch(/could not be read|could not read|unreadable|illegible/i);
    expect(note).toContain('not in your ingredients yet');
  });

  it('the unmatched line names the next move', () => {
    expect(lineNote({ kind: 'no_ingredient', reason: 'new' })).toContain('add it first');
  });

  it('every pair of states is distinct', () => {
    const notes = EVERY.map(lineNote);

    expect(new Set(notes).size).toBe(notes.length);
  });

  it('no state renders empty, which would read as no problem at all', () => {
    for (const price of EVERY) {
      expect(lineNote(price), JSON.stringify(price)).not.toBe('');
    }
  });
});

// ---------------------------------------------------------------------------
// The state itself, at the layer that assigns it
// ---------------------------------------------------------------------------

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

const read = (over: Partial<InvoiceRead> = {}): InvoiceRead => ({
  supplier: 'Musgrave',
  invoiceDate: '2026-08-20',
  lines: [{ description: 'flour', quantity: 5, unit: 'kg', lineTotalCents: 4500 }],
  uncertain: [],
  ...over,
});

describe('an unmatched ingredient is reported as unmatched', () => {
  it('THE ORIGINAL SYMPTOM — perfect numbers, empty ingredient book', () => {
    // Exactly the owner's scan: five lines the model read cleanly, against a
    // kitchen with no ingredients entered. Every line came back "could not be
    // read", which was true of nothing on the page.
    const review = reviewInvoice(
      read({
        lines: [
          { description: 'Beef mince', quantity: 5, unit: 'kg', lineTotalCents: 4500 },
          { description: 'Onions', quantity: 10, unit: 'kg', lineTotalCents: 1200 },
        ],
      }),
      { ingredients: [], suppliers: [] },
    );

    for (const line of review.lines) {
      expect(line.price.kind).toBe('no_ingredient');
      if (line.price.kind !== 'no_ingredient') continue;
      expect(line.price.reason).toBe('new');
      expect(lineNote(line.price)).toContain('not in your ingredients yet');
    }
  });

  it('an ambiguous name is not reported as new, nor as unreadable', () => {
    const review = reviewInvoice(
      read({ lines: [{ description: 'chicken', quantity: 2, unit: 'kg', lineTotalCents: 1800 }] }),
      {
        ingredients: [
          ingredient({ id: 'a' as IngredientId, name: 'chicken breast' }),
          ingredient({ id: 'b' as IngredientId, name: 'chicken thigh' }),
        ],
        suppliers: [],
      },
    );

    const price = review.lines[0]?.price;
    expect(price?.kind).toBe('no_ingredient');
    if (price?.kind !== 'no_ingredient') return;
    expect(price.reason).toBe('ambiguous');
  });

  it('a MATCHED ingredient with a genuinely unreadable total still says so', () => {
    // The other half. Fixing the false report must not silence the true one.
    const review = reviewInvoice(
      read({ lines: [{ description: 'flour', quantity: 5, unit: 'kg', lineTotalCents: null }] }),
      { ingredients: [ingredient()], suppliers: [] },
    );

    const price = review.lines[0]?.price;
    expect(price?.kind).toBe('unreadable');
    if (price?.kind !== 'unreadable') return;
    expect(lineNote(price)).toContain('lineTotal');
  });
});
