/**
 * Reviewing a recipe found on the open web.
 *
 * PURE, so it runs in Node with no network. THE HARDEST TEST OF
 * FLAG-NEVER-INVENT in the app, and it is worth being precise about why.
 *
 * A photographed recipe card is one owner's handwriting in one format. The open
 * web is every format: "2 kg beef mince", "1 onion", "a splash of oil", "2 cups
 * flour", "salt to taste". Every one of those is a chance to produce a confident
 * number nobody wrote down, and unlike a smudged card there is no photograph to
 * go back to — the wrong figure would look exactly as authoritative as a right
 * one.
 *
 * ---------------------------------------------------------------------------
 * TWO REFUSALS THIS FILE EXISTS TO PIN.
 *
 * 1. NO SOURCE URL, NO REVIEW. A model asked to find a recipe can answer from
 *    memory instead of from a page, and the result is indistinguishable at this
 *    layer from a real extraction — invention wearing the face of a citation. A
 *    candidate carrying no page to point at is refused outright, and the review
 *    type makes that structural: `sourceUrl` is a plain `string`, so a review
 *    without one cannot be constructed at all.
 *
 * 2. NOTHING IS SCALED AT IMPORT. The recipe is someone else's portions. It is
 *    kept at the source's own yield and the ENGINE scales it later, once the
 *    owner has confirmed it. A quantity adjusted on the way in would be this
 *    layer computing, and it would be computing against a guest count that has
 *    nothing to do with the page it came from.
 * ---------------------------------------------------------------------------
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { reviewWebRecipe, type WebRecipeRead } from '../../src/scan/webRecipe';
import type {
  Ingredient,
  IngredientId,
  KitchenId,
  PurchaseUnit,
  RecipeUnit,
  StockUnit,
} from '../../src/engine/types';

const KITCHEN = 'k1' as KitchenId;

const ingredient = (id: string, name: string): Ingredient => ({
  id: id as IngredientId,
  kitchenId: KITCHEN,
  name,
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
});

const owner = {
  ingredients: [ingredient('mince', 'beef mince'), ingredient('onion', 'onions')],
};

const read = (over: Partial<WebRecipeRead> = {}): WebRecipeRead => ({
  title: 'Classic Beef Lasagne',
  sourceUrl: 'https://example.com/beef-lasagne',
  course: 'main',
  yieldType: 'batch',
  portionsPerBatch: 4,
  batchUnit: 'dish',
  ingredients: [{ name: 'beef mince', qty: 2, unit: 'kg' }],
  uncertain: [],
  ...over,
});

/** Narrows to the reviewed case, failing loudly rather than silently skipping. */
const reviewed = (r: WebRecipeRead, o = owner) => {
  const outcome = reviewWebRecipe(r, o);
  if (outcome.kind !== 'reviewed') {
    throw new Error(`expected a review, got refused: ${outcome.reason}`);
  }
  return outcome.review;
};

// ---------------------------------------------------------------------------

describe('NO SOURCE URL, NO REVIEW', () => {
  it('refuses a candidate carrying no source at all', () => {
    // The model-from-memory case. Nothing downstream could tell it apart from a
    // real extraction, so it is stopped here where it still can be.
    const outcome = reviewWebRecipe(read({ sourceUrl: null }), owner);

    expect(outcome.kind).toBe('refused');
  });

  it('refuses an empty or whitespace source', () => {
    expect(reviewWebRecipe(read({ sourceUrl: '' }), owner).kind).toBe('refused');
    expect(reviewWebRecipe(read({ sourceUrl: '   ' }), owner).kind).toBe('refused');
  });

  it('refuses something that is not a web address', () => {
    // "somewhere on the internet" is not a page anyone can open and check.
    for (const notAUrl of ['a cookbook', 'see my notes', 'example.com', 'ftp://x/y']) {
      expect(reviewWebRecipe(read({ sourceUrl: notAUrl }), owner).kind, notAUrl).toBe('refused');
    }
  });

  it('says WHY, so the screen is not left guessing', () => {
    const outcome = reviewWebRecipe(read({ sourceUrl: null }), owner);
    if (outcome.kind !== 'refused') throw new Error('expected a refusal');

    expect(outcome.reason).toMatch(/source|where|link/i);
  });

  it('accepts http and https', () => {
    expect(reviewWebRecipe(read({ sourceUrl: 'http://example.com/r' }), owner).kind).toBe(
      'reviewed',
    );
    expect(reviewWebRecipe(read({ sourceUrl: 'https://example.com/r' }), owner).kind).toBe(
      'reviewed',
    );
  });

  it('carries the source through to the review, for the owner to open', () => {
    expect(reviewed(read()).sourceUrl).toBe('https://example.com/beef-lasagne');
  });
});

describe('NOTHING IS SCALED AT IMPORT', () => {
  it('keeps the source recipe at its own yield', () => {
    // A page serving 4 is imported serving 4, whatever any job needs. The engine
    // scales later, once the owner has confirmed the figures are right.
    const review = reviewed(read({ portionsPerBatch: 4 }));

    expect(review.portionsPerBatch).toBe(4);
  });

  it('keeps every quantity exactly as the page stated it', () => {
    const review = reviewed(read({ ingredients: [{ name: 'beef mince', qty: 2, unit: 'kg' }] }));

    expect(review.components[0]?.qty).toBe(2);
    expect(review.components[0]?.unit).toBe('kg');
  });

  it('THE TYPE HAS NO PLACE TO PUT A TARGET PORTION COUNT', () => {
    // A field the layer could scale toward is a field it will scale toward. The
    // same discipline as the invoice schema having no price-per-pack field.
    const source = readFileSync(
      fileURLToPath(new URL('../../src/scan/webRecipe.ts', import.meta.url)),
      'utf8',
    );
    const decl = source.slice(source.indexOf('export interface WebRecipeRead'));
    const body = decl.slice(0, decl.indexOf('}\n\n'));

    expect(body).not.toContain('guests');
    expect(body).not.toContain('scaleTo');
    expect(body).not.toContain('portionsWanted');
    expect(body).not.toContain('targetPortions');
  });

  it('does no arithmetic of its own', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../src/scan/webRecipe.ts', import.meta.url)),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    for (const forbidden of ['Math.round', 'Math.ceil', 'Math.floor', 'scaleRecipe', 'recipeToStock', 'portionsToUnits']) {
      expect(source, `webRecipe.ts uses ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('THE ROUTING — every messy form the open web produces', () => {
  it('"2 kg beef mince" is a quantity', () => {
    const review = reviewed(read({ ingredients: [{ name: 'beef mince', qty: 2, unit: 'kg' }] }));

    expect(review.components).toHaveLength(1);
    expect(review.unquantified).toHaveLength(0);
  });

  it('"1 onion" is UNQUANTIFIED — a number with no unit cannot cross units.ts', () => {
    // The temptation is to call this "1 each". That invents a unit the page never
    // used, and an onion is not a stock unit anybody counted.
    const review = reviewed(read({ ingredients: [{ name: 'onions', qty: 1, unit: null }] }));

    expect(review.components).toHaveLength(0);
    expect(review.unquantified.map((u) => u.name)).toEqual(['onions']);
  });

  it('"a splash of oil" is UNQUANTIFIED, by name', () => {
    const review = reviewed(read({ ingredients: [{ name: 'olive oil', qty: null, unit: null }] }));

    expect(review.unquantified[0]?.name).toBe('olive oil');
    // No quantity field to fill in later, which is the strongest form of the rule.
    expect(review.unquantified[0]).not.toHaveProperty('qty');
  });

  it('"salt to taste" is kept, not dropped', () => {
    // Dropping it would make the recipe look complete when it is not.
    const review = reviewed(read({ ingredients: [{ name: 'salt', qty: null, unit: null }] }));

    expect(review.unquantified.map((u) => u.name)).toContain('salt');
  });

  it('"2 cups flour" is KEPT with its own unit, for units.ts to refuse later', () => {
    // The scanner does not know a cup. Neither does units.ts without the owner's
    // factor — and refusing there, visibly, is right. Guessing a factor here
    // would put a wrong quantity into every job using the recipe.
    const review = reviewed(read({ ingredients: [{ name: 'flour', qty: 2, unit: 'cup' }] }));

    expect(review.components[0]?.unit).toBe('cup');
    expect(review.components[0]?.qty).toBe(2);
  });

  it('a zero or negative quantity is unquantified, not a real figure', () => {
    const review = reviewed(
      read({
        ingredients: [
          { name: 'beef mince', qty: 0, unit: 'kg' },
          { name: 'onions', qty: -1, unit: 'kg' },
        ],
      }),
    );

    expect(review.components).toHaveLength(0);
    expect(review.unquantified).toHaveLength(2);
  });

  it('says why each unquantified item has no number', () => {
    const review = reviewed(
      read({
        ingredients: [
          { name: 'olive oil', qty: null, unit: null },
          { name: 'onions', qty: 1, unit: null },
        ],
      }),
    );

    expect(review.unquantified[0]?.reason).toMatch(/no quantity/i);
    expect(review.unquantified[1]?.reason).toMatch(/unit/i);
  });
});

describe('ingredients are MATCHED, never created', () => {
  it('matches one already in his data, however the page cased it', () => {
    const review = reviewed(read({ ingredients: [{ name: 'Beef Mince', qty: 2, unit: 'kg' }] }));

    expect(review.components[0]?.ingredient.kind).toBe('matched');
  });

  it('FLAGS an unknown ingredient as new', () => {
    const review = reviewed(read({ ingredients: [{ name: 'ricotta', qty: 500, unit: 'g' }] }));

    expect(review.newThings).toContainEqual({ what: 'ingredient', read: 'ricotta' });
  });

  it('does not resolve an ambiguous name', () => {
    const two = {
      ingredients: [
        ingredient('a', 'chicken breast'),
        ingredient('b', 'chicken thigh'),
      ],
    };
    const review = reviewed(read({ ingredients: [{ name: 'chicken', qty: 2, unit: 'kg' }] }), two);

    expect(review.gaps.some((g) => g.field.startsWith('ingredient:'))).toBe(true);
  });
});

describe('course warns, never blocks — the same rule the card scanner uses', () => {
  it('warns when the page states no course, and stays usable', () => {
    const review = reviewed(read({ course: null }));

    expect(review.warnings).toHaveLength(1);
    expect(review.readyToSave).toBe(true);
  });

  it('warns on breakfast too', () => {
    expect(reviewed(read({ course: 'breakfast' })).warnings).toHaveLength(1);
  });

  it('is silent for a main', () => {
    expect(reviewed(read({ course: 'main' })).warnings).toHaveLength(0);
  });

  it('a warning never appears as a gap', () => {
    const review = reviewed(read({ course: null }));
    const labels = new Set(review.gaps.map((g) => g.label));

    for (const w of review.warnings) expect(labels.has(w)).toBe(false);
  });
});

describe('the yield is READ, never inferred', () => {
  it('an unreadable yield is a gap, not a default of per-person', () => {
    // Defaulting would silently multiply or divide every quantity on the page by
    // the guest count, and the error is invisible.
    const review = reviewed(read({ yieldType: null }));

    expect(review.gaps.some((g) => g.field === 'yieldType')).toBe(true);
    expect(review.readyToSave).toBe(false);
  });

  it('a batch with no portions per batch is a gap', () => {
    const review = reviewed(read({ yieldType: 'batch', portionsPerBatch: null }));

    expect(review.gaps.some((g) => g.field === 'portionsPerBatch')).toBe(true);
  });
});
