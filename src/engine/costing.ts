/**
 * Food cost, revenue and margin.
 *
 * The rule with the sharpest edge in the engine lives here: **any missing input
 * makes the whole figure null.** A recipe with five priced ingredients and one
 * unpriced costs null, not the sum of five. A partial sum is worse than no number,
 * because it looks complete and it always understates.
 *
 * Money is `Cents`, a branded integer. Intermediate arithmetic runs in FRACTIONAL
 * cents and is rounded exactly once, where a `Cents` value is returned — rounding
 * per line and then summing accumulates error.
 */

import { applyBuffetSplit } from './rules';
import { scaleRecipe } from './scaling';
import { packSizeIn, recipeToStock } from './units';
import type {
  Cents,
  ClientRate,
  Customer,
  Ingredient,
  Job,
  Recipe,
  RecipeId,
} from './types';

export type MissingReason =
  | 'unpriced_ingredient'
  | 'no_pack_size'
  | 'missing_ingredient'
  | 'missing_recipe'
  | 'unresolved_conversion'
  | 'unquantified'
  | 'named_unquantified'
  | 'missing_sub_recipe'
  | 'no_portions_per_batch'
  | 'no_portions'
  | 'cycle'
  | 'no_rate'
  | 'no_guest_count'
  | 'unpriced_extra';

export interface MissingInput {
  readonly reason: MissingReason;
  readonly detail: string;
}

export interface CostResult {
  /** Null whenever ANY input is missing. Never a partial sum. */
  readonly total: Cents | null;
  readonly missing: readonly MissingInput[];
}

export interface RevenueResult {
  readonly total: Cents | null;
  /** The rate-card figure, still derivable when an override is in force (Rule 11). */
  readonly computed: Cents | null;
  readonly isOverride: boolean;
  readonly missing: readonly MissingInput[];
}

export interface MarginResult {
  readonly revenue: Cents | null;
  readonly foodCost: Cents | null;
  /** Null if either side is null. Never "revenue minus zero". */
  readonly margin: Cents | null;
  readonly missing: readonly MissingInput[];
}

type RecipeLookup = (id: RecipeId) => Recipe | undefined;

/** Rounded once, at the boundary. */
const toCents = (fractional: number): Cents => Math.round(fractional) as Cents;

// ---------------------------------------------------------------------------
// Cost per stock unit
// ---------------------------------------------------------------------------

/**
 * Fractional cents per one stock unit of an ingredient.
 *
 * `pricePerPack ÷ packSizeInStockUnits`, with the pack reconciled to the stock unit
 * by `units.ts` — the same conversion the shopping list uses, so pack maths cannot
 * diverge between what you buy and what you cost (Rule 5).
 */
function costPerStockUnit(
  ingredient: Ingredient,
): { ok: true; value: number } | { ok: false; missing: MissingInput } {
  if (ingredient.pricePerPack === null) {
    return {
      ok: false,
      missing: {
        reason: 'unpriced_ingredient',
        detail: `${ingredient.name} has no price per pack`,
      },
    };
  }

  const packSize = packSizeIn(ingredient, ingredient.stockUnit);
  if (packSize === null || packSize <= 0) {
    return {
      ok: false,
      missing: {
        reason: 'no_pack_size',
        detail: `${ingredient.name}: pack size cannot be expressed in ${ingredient.stockUnit}`,
      },
    };
  }

  return { ok: true, value: ingredient.pricePerPack / packSize };
}

// ---------------------------------------------------------------------------
// recipeFoodCost
// ---------------------------------------------------------------------------

/**
 * What it costs to MAKE this many portions.
 *
 * Batch recipes scale to whole batches, so 10 portions of a 9-per-tray recipe costs
 * two trays — that is what actually gets bought and cooked. For a per-job share
 * that does not double-count a shared tray, use `recipePortionCost`.
 */
export function recipeFoodCost(
  recipe: Recipe,
  portions: number,
  ingredients: readonly Ingredient[],
  lookup: RecipeLookup,
): CostResult {
  const { fractional, missing } = recipeCostFractional(recipe, portions, ingredients, lookup);
  return { total: fractional === null ? null : toCents(fractional), missing };
}

/**
 * The same calculation in FRACTIONAL cents, unrounded.
 *
 * Everything internal composes through this rather than through the rounded
 * `Cents` result. Rounding a per-portion figure and then multiplying it back up
 * accumulates error: a tray costing 200c across 9 portions is 22.22c each, and
 * ten of those is 222c — but ten times a rounded 22c is 220c. Round once, last.
 */
function recipeCostFractional(
  recipe: Recipe,
  portions: number,
  ingredients: readonly Ingredient[],
  lookup: RecipeLookup,
): { fractional: number | null; missing: MissingInput[] } {
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const missing: MissingInput[] = [];
  let fractional = 0;

  const scaled = scaleRecipe(recipe, portions, lookup);

  for (const gap of scaled.gaps) {
    missing.push({ reason: gap.reason, detail: gap.detail });
  }

  for (const line of scaled.lines) {
    const ingredient = byId.get(line.ingredientId);
    if (ingredient === undefined) {
      missing.push({
        reason: 'missing_ingredient',
        detail: `no ingredient record for "${line.displayName}"`,
      });
      continue;
    }

    if (line.unit === null) {
      missing.push({
        reason: 'unresolved_conversion',
        detail: `${ingredient.name}: quantity has no unit`,
      });
      continue;
    }

    const inStock = recipeToStock({ value: line.qty, unit: line.unit }, ingredient);
    if (inStock.kind === 'unresolved') {
      missing.push({
        reason: 'unresolved_conversion',
        detail: `${ingredient.name}: ${inStock.reason} — ${inStock.detail}`,
      });
      continue;
    }

    const unitCost = costPerStockUnit(ingredient);
    if (!unitCost.ok) {
      missing.push(unitCost.missing);
      continue;
    }

    fractional += inStock.value.value * unitCost.value;
  }

  // Any missing input at all voids the total. Rule 8.
  return { fractional: missing.length > 0 ? null : fractional, missing };
}

/** Cost of one portion in fractional cents. See `recipeCostFractional` on rounding. */
function portionCostFractional(
  recipe: Recipe,
  ingredients: readonly Ingredient[],
  lookup: RecipeLookup,
): { fractional: number | null; missing: MissingInput[] } {
  if (recipe.yieldType === 'per_person') {
    return recipeCostFractional(recipe, 1, ingredients, lookup);
  }

  const perBatch = recipe.portionsPerBatch;
  if (perBatch === null || perBatch <= 0) {
    return {
      fractional: null,
      missing: [
        {
          reason: 'no_portions_per_batch',
          detail: `${recipe.name}: batch recipe with no usable portions per batch`,
        },
      ],
    };
  }

  const batch = recipeCostFractional(recipe, perBatch, ingredients, lookup);
  if (batch.fractional === null) return batch;

  return { fractional: batch.fractional / perBatch, missing: [] };
}

/**
 * The cost of ONE portion.
 *
 * For a batch recipe this is the cost of a full batch divided by its yield, so it
 * is the true marginal cost of a cover rather than the cost of a whole tray.
 *
 * This is the rounded, display-facing figure. `jobFoodCost` does NOT multiply it —
 * it composes on the unrounded value, or ten portions of a 22.22c item would come
 * to 220c instead of 222c.
 */
export function recipePortionCost(
  recipe: Recipe,
  ingredients: readonly Ingredient[],
  lookup: RecipeLookup,
): CostResult {
  const { fractional, missing } = portionCostFractional(recipe, ingredients, lookup);
  return { total: fractional === null ? null : toCents(fractional), missing };
}

// ---------------------------------------------------------------------------
// jobFoodCost
// ---------------------------------------------------------------------------

/**
 * The food cost of one job.
 *
 * Proportional to portions, NOT whole batches. Batch rounding is consolidated
 * across jobs in `productionBuckets`, so two jobs can share a tray; charging each
 * of them a whole tray would double-count and per-job costs would not sum to what
 * was spent.
 *
 * The consequence is deliberate: **surplus from batch rounding is attributed to no
 * job.** Job costs sum to slightly less than the shopping spend, by exactly the
 * surplus. That is the right answer for margin, and the surplus belongs on a range
 * view rather than smuggled into a job.
 */
export function jobFoodCost(
  job: Job,
  recipes: readonly Recipe[],
  ingredients: readonly Ingredient[],
): CostResult {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const lookup = (id: RecipeId): Recipe | undefined => byId.get(id);

  const missing: MissingInput[] = [];
  let fractional = 0;

  // Same portion resolution the production side uses, from the same function, so
  // the cost of a job cannot disagree with what the prep sheet says to make.
  const dishes =
    job.guests === null ? job.dishes : applyBuffetSplit(job.guests, job.dishes, recipes);

  for (const d of dishes) {
    const recipe = byId.get(d.recipeId);
    if (recipe === undefined) {
      missing.push({
        reason: 'missing_recipe',
        detail: `no recipe found for dish "${d.recipeId}"`,
      });
      continue;
    }

    if (d.portions === null) {
      missing.push({
        reason: 'no_portions',
        detail: `${recipe.name}: portions not allocated`,
      });
      continue;
    }

    // Unrounded, so ten portions of a 22.22c item come to 222c and not 220c.
    const perPortion = portionCostFractional(recipe, ingredients, lookup);
    if (perPortion.fractional === null) {
      missing.push(...perPortion.missing);
      continue;
    }

    fractional += perPortion.fractional * d.portions;
  }

  return { total: missing.length > 0 ? null : toCents(fractional), missing };
}

// ---------------------------------------------------------------------------
// jobRevenue — Rule 11
// ---------------------------------------------------------------------------

/** Sum the per-each extras. Any unpriced extra voids the figure (Rule 8). */
function extrasTotal(job: Job): { value: number; missing: MissingInput[] } {
  const missing: MissingInput[] = [];
  let value = 0;

  for (const e of job.extras) {
    if (e.amountEach === null) {
      missing.push({
        reason: 'unpriced_extra',
        detail: `extra "${e.label}" is named but has no amount`,
      });
      continue;
    }
    value += e.amountEach * e.quantity;
  }

  return { value, missing };
}

/**
 * What the job earns.
 *
 *   override        -> the typed figure IS the revenue, extras included
 *   otherwise       -> flat fee + guests × per-head + extras
 *   no rate at all  -> null, NOT zero (Rule 11)
 *
 * The computed rate-card figure stays available on `computed` even when an override
 * is in force, so a screen can show both without a second calculation (Rule 11).
 */
export function jobRevenue(
  job: Job,
  customer: Customer | undefined,
  rates: readonly ClientRate[],
): RevenueResult {
  const missing: MissingInput[] = [];

  const group = customer?.clientGroup ?? null;
  const rate =
    group === null || job.serviceType === null
      ? undefined
      : rates.find((r) => r.clientGroup === group && r.serviceType === job.serviceType);

  const extras = extrasTotal(job);

  // The rate-card figure, computed whether or not an override is in force.
  let computed: Cents | null = null;

  if (rate === undefined) {
    missing.push({
      reason: 'no_rate',
      detail:
        group === null
          ? 'job has no customer or the customer has no client group'
          : `no rate for (${group}, ${job.serviceType ?? 'no service type'})`,
    });
  } else if (rate.ratePerHead === null && rate.flatFee === null) {
    missing.push({
      reason: 'no_rate',
      detail: `rate for (${group}, ${job.serviceType}) has neither a per-head rate nor a flat fee`,
    });
  } else if (rate.ratePerHead !== null && job.guests === null) {
    missing.push({
      reason: 'no_guest_count',
      detail: 'a per-head rate applies but the guest count is unknown',
    });
  } else {
    const perHead = rate.ratePerHead === null ? 0 : rate.ratePerHead * (job.guests ?? 0);
    const flat = rate.flatFee ?? 0;
    if (extras.missing.length === 0) computed = toCents(flat + perHead + extras.value);
  }

  if (job.pricing.kind === 'override') {
    // The override replaces the computed price outright — extras included.
    // An unpriced extra therefore cannot block it, and the rate-card figure is
    // reported alongside for display, not added.
    return { total: job.pricing.amount, computed, isOverride: true, missing: [] };
  }

  missing.push(...extras.missing);

  return {
    total: missing.length > 0 ? null : computed,
    computed,
    isOverride: false,
    missing,
  };
}

// ---------------------------------------------------------------------------
// jobMargin
// ---------------------------------------------------------------------------

/**
 * Revenue minus food cost.
 *
 * Null if EITHER side is null. The trap this guards: a €300 job with an uncostable
 * menu must not report a €300 margin by treating food cost as zero. That reads as a
 * healthy job and is exactly backwards.
 *
 * A negative margin is a real answer and is not clamped — a loss is information.
 */
export function jobMargin(
  job: Job,
  customer: Customer | undefined,
  rates: readonly ClientRate[],
  recipes: readonly Recipe[],
  ingredients: readonly Ingredient[],
): MarginResult {
  const revenue = jobRevenue(job, customer, rates);
  const foodCost = jobFoodCost(job, recipes, ingredients);

  const margin =
    revenue.total === null || foodCost.total === null
      ? null
      : (((revenue.total as number) - (foodCost.total as number)) as Cents);

  return {
    revenue: revenue.total,
    foodCost: foodCost.total,
    margin,
    missing: [...revenue.missing, ...foodCost.missing],
  };
}
