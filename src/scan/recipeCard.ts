/**
 * Reviewing a photographed recipe card.
 *
 * PURE — no React, no network, no camera. Everything the scanner decides is
 * decided here, where it can be tested against a fixture rather than a photograph.
 *
 * THE ONE RULE THIS FILE EXISTS TO KEEP: an ingredient whose quantity could not
 * be read goes to `unquantified` BY NAME. It never reaches a quantity field with
 * a number attached.
 *
 * The routing is done here, deterministically, rather than asked of the model.
 * "Which list does this belong in?" is not a judgement to put to a bad
 * photograph — a smudged "2" that becomes a confident 2 kg is a shopping list
 * wrong in a way nobody can see until the delivery arrives.
 *
 * Ingredients are MATCHED against the owner's data, never created. One matcher
 * (`engine/nameMatch.ts`), shared with Ask Sous, so the two cannot disagree about
 * whether something already exists.
 */

import { matchByName } from '../engine/nameMatch';
import { courseDerivable } from '../engine/rules';
import type { Ingredient, RecipeUnit, YieldType } from '../engine/types';
import type { Gap, Resolved } from './jobSheet';

/** What the model reported. Every field is what it READ, or null. */
export interface RecipeCardRead {
  readonly name: string | null;
  readonly course: string | null;
  /** Read off the card — "serves 20" or "per person". Never inferred. */
  readonly yieldType: YieldType | null;
  /** Only when the card states it. Never derived by dividing. */
  readonly portionsPerBatch: number | null;
  readonly batchUnit: string | null;
  readonly components: readonly {
    readonly name: string;
    readonly qty: number | null;
    readonly unit: string | null;
  }[];
  readonly method: string | null;
  readonly uncertain: readonly { readonly field: string; readonly saw: string | null }[];
}

/** A component with a quantity the camera actually read. */
export interface ReviewedComponent {
  readonly read: string;
  readonly qty: number;
  readonly unit: RecipeUnit;
  readonly ingredient: Resolved<Ingredient>;
}

/**
 * A component with NO quantity — kept by name.
 *
 * Deliberately has no `qty` field at all, rather than a nullable one. There is
 * nothing for a number to occupy, which is the strongest form the rule can take:
 * a later edit cannot accidentally fill it in.
 */
export interface UnquantifiedComponent {
  readonly name: string;
  readonly ingredient: Resolved<Ingredient>;
  /** Why it has no quantity, in words, so the owner can judge it. */
  readonly reason: string;
}

export interface RecipeCardOwnerData {
  readonly ingredients: readonly Ingredient[];
}

export interface NewIngredient {
  readonly what: 'ingredient';
  readonly read: string;
}

export interface RecipeCardReview {
  readonly name: string | null;
  readonly course: string | null;
  readonly yieldType: YieldType | null;
  readonly portionsPerBatch: number | null;
  readonly batchUnit: string | null;
  readonly components: readonly ReviewedComponent[];
  readonly unquantified: readonly UnquantifiedComponent[];
  readonly method: string | null;
  readonly gaps: readonly Gap[];
  readonly newThings: readonly NewIngredient[];
  /**
   * Consequences of what was read, NOT reasons to refuse it.
   *
   * A gap means "this cannot be saved". A warning means "this saves fine, and
   * here is what it will do". They are opposite instructions, and
   * `tests/scan/recipeCard.test.ts` asserts no sentence is ever both.
   *
   * The distinction is load-bearing rather than tidy. A recipe with no course is
   * legal; it simply cannot have its portions derived from a guest count, and the
   * review screen has no course picker — so blocking here would refuse a
   * legitimate recipe from a screen offering no way to fix it.
   */
  readonly warnings: readonly string[];
  /**
   * Unquantified components do NOT block this. Rule 8 treats them as a normal
   * state — a recipe carrying "seasoning" with no figure is complete and honest,
   * not half-entered.
   *
   * Neither do `warnings`. Blocking comes from `gaps`, and only from `gaps`.
   */
  readonly readyToSave: boolean;
}

/** Matched, new, ambiguous or missing — the same four the job sheet uses. */
function resolve(name: string, ingredients: readonly Ingredient[]): Resolved<Ingredient> {
  const trimmed = name.trim();
  if (trimmed === '') return { kind: 'missing' };

  const matches = matchByName(ingredients, trimmed);

  if (matches.length === 0) return { kind: 'new', read: trimmed };
  if (matches.length > 1) {
    // Never picks. A guess about which ingredient a card meant is a wrong
    // quantity in every job that later uses the recipe.
    return { kind: 'ambiguous', read: trimmed, matches: matches.map((m) => m.name) };
  }

  return { kind: 'matched', record: matches[0] as Ingredient, read: trimmed };
}

export function reviewRecipeCard(
  read: RecipeCardRead,
  owner: RecipeCardOwnerData,
): RecipeCardReview {
  const gaps: Gap[] = [];
  const newThings: NewIngredient[] = [];
  const components: ReviewedComponent[] = [];
  const unquantified: UnquantifiedComponent[] = [];

  const sawFor = (field: string): string | null =>
    read.uncertain.find((u) => u.field === field)?.saw ?? null;

  if (read.name === null || read.name.trim() === '') {
    gaps.push({ field: 'name', label: 'What the recipe is called', saw: sawFor('name') });
  }

  // The yield is READ, never inferred. Defaulting to per-person would silently
  // divide every quantity on the card by the guest count, or multiply it — the
  // error is invisible and enormous.
  if (read.yieldType === null) {
    gaps.push({
      field: 'yieldType',
      label: 'Are these quantities per person, or for one batch?',
      saw: sawFor('yieldType'),
    });
  }

  // A batch recipe with no portions per batch cannot be scaled at all —
  // `portionsToUnits` has nothing to divide by.
  if (read.yieldType === 'batch' && read.portionsPerBatch === null) {
    gaps.push({
      field: 'portionsPerBatch',
      label: 'How many portions does one batch make?',
      saw: sawFor('portionsPerBatch'),
    });
  }

  for (const component of read.components) {
    const ingredient = resolve(component.name, owner.ingredients);

    if (ingredient.kind === 'new') {
      newThings.push({ what: 'ingredient', read: ingredient.read });
    }
    if (ingredient.kind === 'ambiguous') {
      gaps.push({
        field: `ingredient:${component.name}`,
        label: `"${component.name}" matches ${ingredient.matches.join(', ')} — which is it?`,
        saw: component.name,
      });
    }

    // THE ROUTING. A quantity needs BOTH a number and a unit: "2" of nothing
    // cannot cross `units.ts`, so it is a name with a stray digit beside it, not
    // a quantity.
    const hasQuantity =
      component.qty !== null &&
      Number.isFinite(component.qty) &&
      component.qty > 0 &&
      component.unit !== null &&
      component.unit.trim() !== '';

    if (hasQuantity) {
      components.push({
        read: component.name,
        qty: component.qty as number,
        unit: (component.unit as string).trim() as RecipeUnit,
        ingredient,
      });
      continue;
    }

    unquantified.push({
      name: component.name.trim(),
      ingredient,
      reason:
        component.qty === null
          ? 'no quantity on the card'
          : 'a number with no unit, so it cannot be converted',
    });
  }

  return {
    name: read.name,
    course: read.course,
    yieldType: read.yieldType,
    portionsPerBatch: read.portionsPerBatch,
    batchUnit: read.batchUnit,
    components,
    unquantified,
    method: read.method,
    gaps,
    newThings,
    warnings: courseWarnings(read.course),
    // Warnings are deliberately absent from this. See `warnings` on the type.
    readyToSave: gaps.length === 0,
  };
}

/**
 * What a non-derivable course will cost him, said before he saves it.
 *
 * THE RECIPE THAT STARTED THIS came off this scanner with `course: null`, because
 * nothing on the card said "main". `applyBuffetSplit` could then not fill the
 * dish's blank portions on a confirmed job for 20 guests, `productionBuckets`
 * dropped it, and the beef mince it needed never appeared on any shopping list.
 * Every screen downstream was correct and every one of them was silent.
 *
 * Asks `courseDerivable` rather than testing for null, so the breakfast case —
 * which fails identically and is easy to forget — is covered by construction.
 *
 * Two sentences, not one: the consequence is shared but the cause is not, and
 * telling an owner whose card says "Breakfast" to go and set a course would send
 * him to look at a field that is already filled in.
 */
function courseWarnings(course: string | null): readonly string[] {
  if (courseDerivable(course)) return [];

  const consequence =
    'the guest count cannot fill in its portions, so every job using it needs a portions figure typed in — otherwise the dish is left off prep, shopping and cost.';

  return course === null || course.trim() === ''
    ? [`No course was read off the card. Set one in Recipes after saving: without it, ${consequence}`]
    : [`This was read as a ${course}. A ${course} is a choice rather than an even split, so ${consequence}`];
}
