/**
 * Reviewing a photographed recipe card.
 *
 * PURE, so it runs in Node with no camera and no network.
 *
 * THE SPINE OF THIS FILE: an ingredient whose quantity could not be read goes to
 * `unquantified` BY NAME. It never lands in a quantity field with a number
 * somebody guessed. Rule 8 is unambiguous about it, and a smudged "2" that
 * becomes a confident 2 kg is a shopping list that is wrong in a way nobody can
 * see.
 *
 * The routing is done HERE, deterministically, rather than asked of the model —
 * "which list does this belong in" is not a judgement to make against a bad
 * photograph.
 */

import { describe, expect, it } from 'vitest';
import { reviewRecipeCard, type RecipeCardRead } from '../../src/scan/recipeCard';
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

const owner = { ingredients: [ingredient('mince', 'beef mince'), ingredient('onion', 'onions')] };

const read = (over: Partial<RecipeCardRead> = {}): RecipeCardRead => ({
  name: 'Lasagne',
  course: 'main',
  yieldType: 'batch',
  portionsPerBatch: 9,
  batchUnit: 'tray',
  components: [{ name: 'beef mince', qty: 2, unit: 'kg' }],
  method: null,
  uncertain: [],
  ...over,
});

describe('RULE 8 — an unreadable quantity becomes an UNQUANTIFIED NAME', () => {
  it('routes a null quantity to unquantified, by name', () => {
    // The whole point. The ingredient is kept — he uses it — but with no number
    // attached to it at all.
    const review = reviewRecipeCard(
      read({ components: [{ name: 'seasoning', qty: null, unit: null }] }),
      owner,
    );

    expect(review.unquantified.map((u) => u.name)).toEqual(['seasoning']);
    expect(review.components).toEqual([]);
  });

  it('puts NO NUMBER anywhere near an unquantified component', () => {
    // Not zero, not the unit's default, not the previous line's figure.
    const review = reviewRecipeCard(
      read({ components: [{ name: 'seasoning', qty: null, unit: 'g' }] }),
      owner,
    );

    const serialised = JSON.stringify(review.unquantified);
    expect(serialised).not.toMatch(/\d/);
  });

  it('keeps the quantified ones quantified, in the same read', () => {
    const review = reviewRecipeCard(
      read({
        components: [
          { name: 'beef mince', qty: 2, unit: 'kg' },
          { name: 'seasoning', qty: null, unit: null },
        ],
      }),
      owner,
    );

    expect(review.components).toHaveLength(1);
    expect(review.components[0]?.qty).toBe(2);
    expect(review.unquantified).toHaveLength(1);
  });

  it('treats a quantity with no unit as unquantified too', () => {
    // "2" of what? A number with no unit cannot cross `units.ts`, so it is not a
    // quantity — it is a name with a stray digit beside it.
    const review = reviewRecipeCard(
      read({ components: [{ name: 'oregano', qty: 2, unit: null }] }),
      owner,
    );

    expect(review.unquantified.map((u) => u.name)).toEqual(['oregano']);
    expect(review.components).toEqual([]);
  });
});

describe('ingredients are matched, never created', () => {
  it('matches one already in his data', () => {
    const review = reviewRecipeCard(read(), owner);

    expect(review.components[0]?.ingredient.kind).toBe('matched');
  });

  it('matches regardless of case and spacing', () => {
    const review = reviewRecipeCard(
      read({ components: [{ name: '  BEEF MINCE ', qty: 2, unit: 'kg' }] }),
      owner,
    );

    expect(review.components[0]?.ingredient.kind).toBe('matched');
  });

  it('FLAGS one that is not, rather than creating it', () => {
    const review = reviewRecipeCard(
      read({ components: [{ name: 'ricotta', qty: 500, unit: 'g' }] }),
      owner,
    );

    expect(review.components[0]?.ingredient.kind).toBe('new');
    expect(review.newThings).toContainEqual({ what: 'ingredient', read: 'ricotta' });
  });

  it('flags an unquantified ingredient as new as well', () => {
    // Being unquantified does not make it exempt — it still has to exist before
    // the recipe can reference it.
    const review = reviewRecipeCard(
      read({ components: [{ name: 'ricotta', qty: null, unit: null }] }),
      owner,
    );

    expect(review.newThings).toContainEqual({ what: 'ingredient', read: 'ricotta' });
  });

  it('does not resolve an ambiguous name', () => {
    const two = {
      ingredients: [ingredient('a', 'chicken breast'), ingredient('b', 'chicken thigh')],
    };
    const review = reviewRecipeCard(
      read({ components: [{ name: 'chicken', qty: 1, unit: 'kg' }] }),
      two,
    );

    expect(review.components[0]?.ingredient.kind).toBe('ambiguous');
    expect(review.gaps.some((g) => g.field.includes('chicken'))).toBe(true);
  });
});

describe('the yield is READ, never inferred', () => {
  it('keeps a batch yield and the portions the card stated', () => {
    const review = reviewRecipeCard(read(), owner);

    expect(review.yieldType).toBe('batch');
    expect(review.portionsPerBatch).toBe(9);
  });

  it('keeps a per-person yield', () => {
    const review = reviewRecipeCard(
      read({ yieldType: 'per_person', portionsPerBatch: null, batchUnit: null }),
      owner,
    );

    expect(review.yieldType).toBe('per_person');
    expect(review.portionsPerBatch).toBeNull();
  });

  it('GAPS an unreadable yield rather than defaulting to per person', () => {
    // A default here silently halves or decuples every quantity in the recipe.
    const review = reviewRecipeCard(read({ yieldType: null }), owner);

    expect(review.yieldType).toBeNull();
    expect(review.gaps.some((g) => g.field === 'yieldType')).toBe(true);
    expect(review.readyToSave).toBe(false);
  });

  it('GAPS a batch recipe whose portions-per-batch was not stated', () => {
    // Batch with no portions is a tray of something that scales to nothing —
    // `portionsToUnits` cannot divide by it.
    const review = reviewRecipeCard(read({ portionsPerBatch: null }), owner);

    expect(review.gaps.some((g) => g.field === 'portionsPerBatch')).toBe(true);
  });

  it('does not demand portions-per-batch from a per-person recipe', () => {
    const review = reviewRecipeCard(
      read({ yieldType: 'per_person', portionsPerBatch: null }),
      owner,
    );

    expect(review.gaps.some((g) => g.field === 'portionsPerBatch')).toBe(false);
  });
});

describe('what makes it ready to save', () => {
  it('is ready when the card read cleanly and everything is known', () => {
    expect(reviewRecipeCard(read(), owner).readyToSave).toBe(true);
  });

  it('is NOT ready while a name is unresolved', () => {
    expect(reviewRecipeCard(read({ name: null }), owner).readyToSave).toBe(false);
  });

  it('IS ready with unquantified components — they are a normal state', () => {
    // Rule 8 keeps unquantified items as first-class. A recipe with "seasoning"
    // and no figure is complete and honest, not half-entered.
    const review = reviewRecipeCard(
      read({
        components: [
          { name: 'beef mince', qty: 2, unit: 'kg' },
          { name: 'seasoning', qty: null, unit: null },
        ],
      }),
      owner,
    );

    expect(review.readyToSave).toBe(true);
  });

  it('surfaces what the camera could not read', () => {
    const review = reviewRecipeCard(
      read({ name: null, uncertain: [{ field: 'name', saw: 'La?agne' }] }),
      owner,
    );

    expect(review.gaps.some((g) => g.saw === 'La?agne')).toBe(true);
  });
});

/**
 * A COURSE THE CARD DID NOT STATE.
 *
 * The scanner created the recipe that started all this: a lasagne with
 * `course: null`, because nothing on the card said "main". Downstream,
 * `applyBuffetSplit` could not fill the dish's blank portions, `productionBuckets`
 * dropped it, and a confirmed job for 20 guests produced no beef mince at all.
 *
 * WHY THIS WARNS RATHER THAN BLOCKS. `gaps` sets `readyToSave: false`, and the
 * review screen has no course picker — a gap here would make a perfectly legal
 * recipe permanently unsaveable with no way to fix it from the screen showing the
 * refusal. A recipe with no course is legitimate. It simply has a consequence, and
 * the consequence is what the owner was never told.
 *
 * So the warning has to be genuinely non-blocking, and that is the property most
 * likely to erode: the easiest way to "strengthen" this later is to push it into
 * `gaps`, which would break saving. Hence the assertions on `readyToSave`.
 */
describe('a card with no course warns, and still saves', () => {
  it('WARNS when the card states no course', () => {
    const review = reviewRecipeCard(read({ course: null }), owner);

    expect(review.warnings).toHaveLength(1);
    expect(review.warnings[0]).toMatch(/course/i);
  });

  it('names the consequence, not just the absence', () => {
    // "No course was read" alone is a fact about the photograph. What the owner
    // needs is what it will DO — the thing nobody told him for two days.
    const [warning = ''] = reviewRecipeCard(read({ course: null }), owner).warnings;

    expect(warning).toMatch(/prep/i);
    expect(warning).toMatch(/shopping/i);
    expect(warning).toMatch(/cost/i);
  });

  it('DOES NOT BLOCK — the recipe is still saveable', () => {
    const review = reviewRecipeCard(read({ course: null }), owner);

    expect(review.readyToSave).toBe(true);
    expect(review.gaps).toHaveLength(0);
  });

  it('WARNS on breakfast too — the other non-derivable course', () => {
    // The case a null-only check would miss. Breakfast is a choice the owner
    // records, not a division, so its portions cannot be derived either.
    const review = reviewRecipeCard(read({ course: 'breakfast' }), owner);

    expect(review.warnings).toHaveLength(1);
    expect(review.readyToSave).toBe(true);
  });

  it('says something DIFFERENT for breakfast than for no course', () => {
    // Same consequence, different cause. One sentence for both would tell the
    // owner with a breakfast card to go and set a course it already has.
    const none = reviewRecipeCard(read({ course: null }), owner).warnings[0];
    const breakfast = reviewRecipeCard(read({ course: 'breakfast' }), owner).warnings[0];

    expect(none).not.toBe(breakfast);
  });

  it.each(['main', 'side', 'dessert'])('is SILENT for a %s', (course) => {
    // A warning that fires on the normal case is one he learns to scroll past.
    expect(reviewRecipeCard(read({ course }), owner).warnings).toHaveLength(0);
  });
});

/**
 * THE DISTINCTNESS GUARD.
 *
 * A warning and a gap are opposite instructions: one says "save this and tidy it
 * after", the other says "this cannot be saved". The same sentence appearing as
 * both would mean the owner cannot tell which he is being given — the identical
 * defect as the invoice screen printing "could not be read" for an ingredient it
 * had simply never heard of.
 */
describe('warnings and gaps never say the same thing', () => {
  it('no warning text appears as a gap label, on any course', () => {
    for (const course of ['main', 'side', 'dessert', 'breakfast', null]) {
      // A card with a real gap AND a warning at once, so both lists are populated
      // and a collision has somewhere to show up.
      const review = reviewRecipeCard(read({ course, yieldType: null }), owner);
      const labels = new Set(review.gaps.map((g) => g.label));

      for (const warning of review.warnings) {
        expect(labels.has(warning), `course ${String(course)}: "${warning}"`).toBe(false);
      }
    }
  });

  it('a warning never makes the recipe unsaveable on its own', () => {
    // The blocking must come from gaps and only from gaps.
    const review = reviewRecipeCard(read({ course: null }), owner);

    expect(review.warnings.length).toBeGreaterThan(0);
    expect(review.readyToSave).toBe(review.gaps.length === 0);
  });
});
