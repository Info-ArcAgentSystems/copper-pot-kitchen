/**
 * Reviewing a recipe found on the open web.
 *
 * PURE. The hardest flag-never-invent surface in the app, and it is worth being
 * precise about why: a photographed recipe card is one owner's handwriting in one
 * format, and the open web is every format at once. "2 kg beef mince", "1 onion",
 * "a splash of oil", "2 cups flour", "salt to taste" — each one a chance to
 * produce a confident number nobody wrote down, with no photograph to go back to
 * and check against.
 *
 * ---------------------------------------------------------------------------
 * TWO REFUSALS, BOTH STRUCTURAL RATHER THAN CHECKED.
 *
 * NO SOURCE URL, NO REVIEW. A model asked to find a recipe can answer from memory
 * instead of from a page, and at this layer the result is indistinguishable from
 * a real extraction — invention wearing the face of a citation. So a candidate
 * with no page to point at never becomes a review at all: `WebRecipeReview`
 * declares `sourceUrl: string`, not `string | null`, and the only constructor is
 * below. There is no shape for an unsourced recipe to take.
 *
 * NOTHING IS SCALED. This is someone else's portions. It is kept at the source's
 * own yield, and `scaleRecipe` does the rest LATER, once the owner has confirmed
 * the figures are worth trusting. A quantity adjusted on the way in would be this
 * layer computing — against a guest count that has nothing to do with the page it
 * came from.
 * ---------------------------------------------------------------------------
 *
 * NOTHING HERE REACHES THE DATABASE. A reviewed recipe is handed to the recipe
 * editor as a draft for the owner to save himself. A web recipe must never feed
 * shopping, prep or cost before he has looked at it, and `confidence` does not
 * enforce that today — nothing in the engine reads it. Not saving is the only
 * form of the guarantee that does not depend on a filter somebody has to add.
 */

import { matchByName } from '../engine/nameMatch';
import { courseWarnings } from './courseWarning';
import type {
  Ingredient,
  KitchenId,
  Recipe,
  RecipeLineId,
  RecipeUnit,
  RecipeId,
  YieldType,
} from '../engine/types';
import type { Gap, Resolved } from './jobSheet';

/**
 * What the model reported from the page.
 *
 * Note what is absent: anything about the owner's kitchen. No guest count, no
 * target portion count, no unit he happens to stock in. A field this layer could
 * scale toward is a field it will scale toward.
 */
export interface WebRecipeRead {
  readonly title: string | null;
  /** The page it came from. Null is refused — see the file comment. */
  readonly sourceUrl: string | null;
  readonly course: string | null;
  /** Read off the page — "serves 4". Never inferred from the quantities. */
  readonly yieldType: YieldType | null;
  readonly portionsPerBatch: number | null;
  readonly batchUnit: string | null;
  readonly ingredients: readonly {
    readonly name: string;
    readonly qty: number | null;
    readonly unit: string | null;
  }[];
  readonly uncertain: readonly { readonly field: string; readonly saw: string | null }[];
}

export interface ReviewedComponent {
  readonly read: string;
  readonly qty: number;
  readonly unit: RecipeUnit;
  readonly ingredient: Resolved<Ingredient>;
}

/**
 * An ingredient with NO quantity — kept by name.
 *
 * No `qty` field at all rather than a nullable one. There is nothing for a number
 * to occupy, so a later edit cannot quietly fill it in.
 */
export interface UnquantifiedComponent {
  readonly name: string;
  readonly ingredient: Resolved<Ingredient>;
  readonly reason: string;
}

export interface NewIngredient {
  readonly what: 'ingredient';
  readonly read: string;
}

export interface WebRecipeOwnerData {
  readonly ingredients: readonly Ingredient[];
}

export interface WebRecipeReview {
  readonly title: string | null;
  /** NOT nullable. A review cannot exist without a page to point at. */
  readonly sourceUrl: string;
  readonly course: string | null;
  readonly yieldType: YieldType | null;
  readonly portionsPerBatch: number | null;
  readonly batchUnit: string | null;
  readonly components: readonly ReviewedComponent[];
  readonly unquantified: readonly UnquantifiedComponent[];
  readonly gaps: readonly Gap[];
  readonly newThings: readonly NewIngredient[];
  /** Consequences, not refusals. A course warning never blocks. */
  readonly warnings: readonly string[];
  readonly readyToSave: boolean;
}

export type WebRecipeOutcome =
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'reviewed'; readonly review: WebRecipeReview };

/**
 * A page the owner could actually open and check.
 *
 * Only http and https. A bare hostname, a book title or "see my notes" is not
 * something anyone can verify, which makes it worth exactly as much as no source
 * at all.
 */
function usableSource(raw: string | null): string | null {
  if (raw === null || raw.trim() === '') return null;

  try {
    const url = new URL(raw.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function resolve(name: string, ingredients: readonly Ingredient[]): Resolved<Ingredient> {
  const trimmed = name.trim();
  if (trimmed === '') return { kind: 'missing' };

  const matches = matchByName(ingredients, trimmed);

  if (matches.length === 0) return { kind: 'new', read: trimmed };
  if (matches.length > 1) {
    return { kind: 'ambiguous', read: trimmed, matches: matches.map((m) => m.name) };
  }

  return { kind: 'matched', record: matches[0] as Ingredient, read: trimmed };
}

export function reviewWebRecipe(
  read: WebRecipeRead,
  owner: WebRecipeOwnerData,
): WebRecipeOutcome {
  const sourceUrl = usableSource(read.sourceUrl);
  if (sourceUrl === null) {
    return {
      kind: 'refused',
      reason:
        'This came back with no source link, so there is no page to check it against. It has not been kept.',
    };
  }

  const gaps: Gap[] = [];
  const newThings: NewIngredient[] = [];
  const components: ReviewedComponent[] = [];
  const unquantified: UnquantifiedComponent[] = [];

  const sawFor = (field: string): string | null =>
    read.uncertain.find((u) => u.field === field)?.saw ?? null;

  // The yield is READ, never inferred. Defaulting to per-person would silently
  // multiply or divide every quantity on the page by the guest count, and the
  // error would be invisible.
  if (read.yieldType === null) {
    gaps.push({
      field: 'yieldType',
      label: 'Is this page quoting per person, or for one batch?',
      saw: sawFor('yieldType'),
    });
  }

  if (read.yieldType === 'batch' && read.portionsPerBatch === null) {
    gaps.push({
      field: 'portionsPerBatch',
      label: 'How many portions does this make?',
      saw: sawFor('portionsPerBatch'),
    });
  }

  for (const item of read.ingredients) {
    const ingredient = resolve(item.name, owner.ingredients);

    if (ingredient.kind === 'new') {
      newThings.push({ what: 'ingredient', read: ingredient.read });
    }
    if (ingredient.kind === 'ambiguous') {
      gaps.push({
        field: `ingredient:${item.name}`,
        label: `"${item.name}" matches ${ingredient.matches.join(', ')} — which is it?`,
        saw: item.name,
      });
    }

    /*
     * THE ROUTING, done here and deterministically rather than asked of the
     * model. A quantity needs BOTH a number and a unit: "1 onion" is a name with
     * a digit beside it, not a measurement, and calling it "1 each" would invent
     * a unit the page never used.
     *
     * Zero and negatives are grouped with unreadable deliberately. A page saying
     * 0 of something is either a parse error or a note, and neither is a
     * quantity to buy against.
     */
    const measured =
      item.qty !== null &&
      Number.isFinite(item.qty) &&
      item.qty > 0 &&
      item.unit !== null &&
      item.unit.trim() !== '';

    if (measured) {
      components.push({
        read: item.name.trim(),
        qty: item.qty as number,
        // Kept as the page wrote it — `cup`, `tbsp`, whatever. `units.ts` refuses
        // what it cannot convert, visibly, which is far better than a factor
        // invented here and silently wrong in every job using the recipe.
        unit: (item.unit as string).trim() as RecipeUnit,
        ingredient,
      });
      continue;
    }

    unquantified.push({
      name: item.name.trim(),
      ingredient,
      reason:
        item.qty === null
          ? 'no quantity given on the page'
          : item.unit === null || item.unit.trim() === ''
            ? 'a number with no unit, so it cannot be converted'
            : 'not a usable quantity',
    });
  }

  return {
    kind: 'reviewed',
    review: {
      title: read.title,
      sourceUrl,
      course: read.course,
      // Straight through. The source's own yield, unscaled.
      yieldType: read.yieldType,
      portionsPerBatch: read.portionsPerBatch,
      batchUnit: read.batchUnit,
      components,
      unquantified,
      gaps,
      newThings,
      warnings: courseWarnings(read.course, 'on this page'),
      // Warnings are deliberately absent from this. Blocking comes from gaps.
      readyToSave: gaps.length === 0,
    },
  };
}

// ---------------------------------------------------------------------------
// The draft handed to the recipe editor
// ---------------------------------------------------------------------------

/**
 * A reviewed page, shaped as a recipe for the OWNER TO SAVE HIMSELF.
 *
 * This is not a commit and there is deliberately no commit path for a web recipe.
 * `confidence` is a label — nothing in the engine reads it — so a draft written to
 * the database would feed shopping, prep and cost the moment it landed, which is
 * exactly what a web recipe must never do before he has looked at it. Not saving
 * is the only form of that guarantee that does not depend on a filter somebody
 * remembers to add.
 *
 * NO METHOD TEXT. Ingredient lists and quantities are facts. Instructions are
 * someone's writing, and copying them into a private database is reproduction.
 * The source link goes in `note` instead, so he can read the method where it was
 * published.
 *
 * AN UNMATCHED INGREDIENT KEEPS ITS NAME. A component whose ingredient is not in
 * his data cannot carry an `ingredientId`, so it cannot be a component — but
 * dropping it would quietly shorten the recipe. It goes to the unquantified list
 * by name, saying what to do about it.
 */
export function draftFromWebReview(review: WebRecipeReview): Recipe {
  const matched = review.components.filter(
    (c): c is ReviewedComponent & { ingredient: { kind: 'matched'; record: Ingredient } } =>
      c.ingredient.kind === 'matched',
  );

  const unmatchedComponents = review.components
    .filter((c) => c.ingredient.kind !== 'matched')
    .map((c) => ({
      id: '' as RecipeLineId,
      item: c.read,
      reason: 'not in your ingredients yet — add it, then import again to keep its quantity',
    }));

  return {
    id: '' as RecipeId,
    kitchenId: '' as KitchenId,
    name: review.title ?? '',
    course: (review.course as Recipe['course']) ?? null,
    yieldType: review.yieldType ?? 'per_person',
    // The SOURCE's own yield. Nothing is scaled on the way in; the engine scales
    // it later, once he has confirmed the figures are worth trusting.
    portionsPerBatch: review.portionsPerBatch,
    batchUnit: review.batchUnit,
    /*
     * `missing` when anything came through without a quantity, `confirm`
     * otherwise. Both render as an unresolved badge on the Recipes list, so a
     * web import is visibly untrusted until he says otherwise — which is the
     * strongest thing `confidence` can do, given nothing enforces it.
     */
    confidence: review.unquantified.length > 0 || unmatchedComponents.length > 0 ? 'missing' : 'confirm',
    makeAheadDays: 0,
    sameDayOnly: true,
    freezable: false,
    onsiteFinish: false,
    method: null,
    note: `Imported from ${review.sourceUrl}`,
    components: matched.map((c, position) => ({
      id: '' as RecipeLineId,
      kind: 'ingredient' as const,
      ingredientId: c.ingredient.record.id,
      displayName: c.read,
      qty: c.qty,
      unit: c.unit,
      position,
    })),
    unquantified: [
      ...review.unquantified.map((u) => ({
        id: '' as RecipeLineId,
        item: u.name,
        reason: u.reason,
      })),
      ...unmatchedComponents,
    ],
  };
}
