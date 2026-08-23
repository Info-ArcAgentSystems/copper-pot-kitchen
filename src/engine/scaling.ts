/**
 * Recipe scaling.
 *
 * Two functions: turning portions into whole production units, and turning a recipe
 * plus a portion count into an ingredient list.
 *
 * The defect this file exists to prevent: scaling a batch recipe linearly. 29
 * portions of lasagne at 9 per tray is 4 trays and 8 kg of mince. Linear scaling
 * says 6.44 kg and under-orders by a quarter, because you cannot make 3.2 trays.
 */

import type {
  IngredientId,
  Recipe,
  RecipeId,
  RecipeUnit,
} from './types';

export interface BatchRequirement {
  /** Whole batches, always rounded UP. */
  readonly batches: number;
  /** What those batches actually produce. */
  readonly capacity: number;
  /** capacity − required. Reported, never hidden. */
  readonly surplus: number;
}

export interface ScaledLine {
  readonly ingredientId: IngredientId;
  readonly displayName: string;
  readonly qty: number;
  readonly unit: RecipeUnit | null;
}

export type ScaleGapReason =
  | 'unquantified'
  | 'named_unquantified'
  | 'missing_sub_recipe'
  | 'no_portions_per_batch'
  | 'no_components'
  | 'cycle';

export interface ScaleGap {
  readonly reason: ScaleGapReason;
  readonly recipeId: RecipeId;
  readonly detail: string;
}

export interface ScaledRecipe {
  readonly lines: readonly ScaledLine[];
  readonly gaps: readonly ScaleGap[];
  /** Batch recipes only. Null for per_person. */
  readonly batches: BatchRequirement | null;
}

/** Where recipes come from. A plain function, so the engine stays pure. */
export type RecipeLookup = (id: RecipeId) => Recipe | undefined;

/**
 * 27 portions at 9 per tray is 3 trays. 29 is 4 trays, with 7 portions of surplus.
 *
 * Never fractional — you cannot make 3.2 trays. Returns null rather than dividing
 * when there is no usable batch size; the caller surfaces that as a gap instead of
 * inventing a number (Rule 8).
 */
export function portionsToUnits(
  portionsRequired: number,
  portionsPerBatch: number,
): BatchRequirement | null {
  if (!Number.isFinite(portionsPerBatch) || portionsPerBatch <= 0) return null;
  if (!Number.isFinite(portionsRequired) || portionsRequired <= 0) {
    return { batches: 0, capacity: 0, surplus: 0 };
  }

  const batches = Math.ceil(portionsRequired / portionsPerBatch);
  const capacity = batches * portionsPerBatch;

  return { batches, capacity, surplus: capacity - portionsRequired };
}

/**
 * Scale a recipe to a portion count, recursing through sub-recipes.
 *
 * ---------------------------------------------------------------------------
 * CALL THIS ONCE PER CONSOLIDATED PORTION TOTAL. NEVER ONCE PER JOB.
 *
 * Batch recipes round up inside this function, so scaling per job and summing
 * over-orders: two jobs of 10 portions of lasagne is 3 trays consolidated
 * (20 / 9 -> 3) but 4 if each is rounded separately (10 / 9 -> 2, twice).
 *
 * Consolidate portions first, then scale once. That ordering is what Rule 5
 * means by one recalculation path. `scaling.test.ts` demonstrates the divergence
 * so the reason stays executable rather than folklore.
 * ---------------------------------------------------------------------------
 *
 * A sub-recipe line's `qty` is PORTIONS of the sub-recipe, per portion or per batch
 * of the parent depending on the parent's yield type.
 *
 * Unquantified lines become gaps and produce no line at all. A line reading 0 would
 * look like a real answer and silently under-order (Rule 8).
 */
export function scaleRecipe(
  recipe: Recipe,
  portions: number,
  lookup: RecipeLookup,
): ScaledRecipe {
  const lines: ScaledLine[] = [];
  const gaps: ScaleGap[] = [];

  const batches = scaleInto(recipe, portions, lookup, lines, gaps, new Set());

  return { lines: consolidate(lines), gaps, batches };
}

/**
 * Walks one recipe, appending to the shared line and gap accumulators.
 *
 * `path` holds the recipes currently open above this one, so a cycle is detected
 * without also rejecting a diamond — the same sub-recipe reached down two separate
 * branches is legitimate and must contribute twice.
 */
function scaleInto(
  recipe: Recipe,
  portions: number,
  lookup: RecipeLookup,
  lines: ScaledLine[],
  gaps: ScaleGap[],
  path: ReadonlySet<RecipeId>,
): BatchRequirement | null {
  // Named components with no locked quantity — the "check this yourself" section.
  // They surface whether or not anything else about the recipe scales.
  for (const item of recipe.unquantified) {
    gaps.push({
      reason: 'named_unquantified',
      recipeId: recipe.id,
      detail:
        item.reason === null
          ? `${recipe.name}: "${item.item}" has no quantity`
          : `${recipe.name}: "${item.item}" has no quantity (${item.reason})`,
    });
  }

  let multiplier: number;
  let batches: BatchRequirement | null = null;

  if (recipe.yieldType === 'batch') {
    if (recipe.portionsPerBatch === null) {
      gaps.push({
        reason: 'no_portions_per_batch',
        recipeId: recipe.id,
        detail: `${recipe.name}: batch recipe with no portions per batch`,
      });
      return null;
    }

    batches = portionsToUnits(portions, recipe.portionsPerBatch);
    if (batches === null) {
      gaps.push({
        reason: 'no_portions_per_batch',
        recipeId: recipe.id,
        detail: `${recipe.name}: portions per batch is not a positive number`,
      });
      return null;
    }

    // Quantities on a batch recipe are per batch, and you make whole batches.
    multiplier = batches.batches;
  } else {
    multiplier = portions;
  }

  // A recipe with nothing in it scales to nothing, and would otherwise contribute
  // silently zero to a shopping list — no lines AND no gaps, which reads as "this
  // dish needs nothing". That is the silent under-ordering Rule 8 exists to stop.
  //
  // It should be unreachable: `save_recipe` writes the header and its lines in one
  // transaction. This is the guard for when it is not.
  if (recipe.components.length === 0 && recipe.unquantified.length === 0) {
    gaps.push({
      reason: 'no_components',
      recipeId: recipe.id,
      detail: `${recipe.name}: has no components at all`,
    });
  }

  const nextPath = new Set(path).add(recipe.id);

  for (const component of recipe.components) {
    if (component.qty === null) {
      gaps.push({
        reason: 'unquantified',
        recipeId: recipe.id,
        detail: `${recipe.name}: "${component.displayName}" has no quantity`,
      });
      continue;
    }

    if (component.kind === 'ingredient') {
      lines.push({
        ingredientId: component.ingredientId,
        displayName: component.displayName,
        qty: round(component.qty * multiplier),
        unit: component.unit,
      });
      continue;
    }

    if (path.has(component.subRecipeId)) {
      gaps.push({
        reason: 'cycle',
        recipeId: recipe.id,
        detail: `${recipe.name}: "${component.displayName}" is already being scaled above it`,
      });
      continue;
    }

    const sub = lookup(component.subRecipeId);
    if (sub === undefined) {
      gaps.push({
        reason: 'missing_sub_recipe',
        recipeId: recipe.id,
        detail: `${recipe.name}: no recipe found for "${component.displayName}"`,
      });
      continue;
    }

    // The line's qty is portions of the sub-recipe, per unit of the parent.
    scaleInto(sub, component.qty * multiplier, lookup, lines, gaps, nextPath);
  }

  return batches;
}

/**
 * Sum lines sharing an ingredient AND a unit.
 *
 * Different units stay separate on purpose: this function has no `Ingredient`
 * records and so cannot convert. Conversion is units.ts's job and nowhere else
 * (Rule 4).
 */
function consolidate(lines: readonly ScaledLine[]): ScaledLine[] {
  const byKey = new Map<string, ScaledLine>();

  for (const line of lines) {
    // \u0000 as the separator, for the reason given in production.ts: no real
    // id or unit can contain it, and an escape keeps the file greppable.
    const key = `${line.ingredientId}\u0000${line.unit ?? ''}`;
    const existing = byKey.get(key);

    byKey.set(
      key,
      existing === undefined ? line : { ...existing, qty: round(existing.qty + line.qty) },
    );
  }

  return [...byKey.values()];
}

/**
 * Clears floating-point noise (0.1 * 3 = 0.30000000000000004) at a precision two
 * orders of magnitude finer than the numeric(12,4) the database stores.
 */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// ingredientsUsedBy
// ---------------------------------------------------------------------------

/**
 * Every ingredient a recipe touches, transitively through sub-recipes.
 *
 * A REACHABILITY question, not a quantity one — it does no arithmetic and returns
 * no numbers, so it is not a second version of any step in the Rule 5 cascade.
 *
 * WHY IT EXISTS: "there is no requirement line for X" has two completely different
 * causes — nothing uses X, or something uses X and the engine could not quantify
 * it. `requirementsForRange` reports the second as a gap, but a caller looking only
 * at `lines` cannot tell them apart, and Ask Sous was answering "no beef mince
 * needed" for a confirmed job whose lasagne listed 4 kg of it.
 *
 * QUANTITIES ARE DELIBERATELY IGNORED. A component with `qty: null` produces no
 * scaled line and still uses the ingredient — that is the case most likely to leave
 * no line at all, so skipping it would reintroduce the exact denial this function
 * exists to prevent.
 *
 * A missing sub-recipe contributes nothing: what it used is unknowable, and
 * inventing a guess is Rule 8. The caller still has `missing_sub_recipe` from
 * `scaleRecipe` to surface.
 */
export function ingredientsUsedBy(
  recipe: Recipe,
  lookup: RecipeLookup,
): ReadonlySet<IngredientId> {
  const found = new Set<IngredientId>();
  collectInto(recipe, lookup, found, new Set());
  return found;
}

/**
 * `path` holds the recipes open above this one, the same discipline `scaleInto`
 * uses: a cycle stops, a diamond does not. A diamond reached twice adds the same
 * id to a Set twice, which is the identity operation — unlike scaling, where both
 * branches must contribute to the total.
 */
function collectInto(
  recipe: Recipe,
  lookup: RecipeLookup,
  found: Set<IngredientId>,
  path: ReadonlySet<RecipeId>,
): void {
  const nextPath = new Set(path).add(recipe.id);

  for (const component of recipe.components) {
    if (component.kind === 'ingredient') {
      found.add(component.ingredientId);
      continue;
    }

    if (path.has(component.subRecipeId)) continue;

    const sub = lookup(component.subRecipeId);
    if (sub === undefined) continue;

    collectInto(sub, lookup, found, nextPath);
  }
}
