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
  | 'no_components'
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

// ---------------------------------------------------------------------------
// rangeMoney
// ---------------------------------------------------------------------------

/**
 * A total plus the counts that qualify it.
 *
 * The two counts are named per figure — `priced`/`unpriced`, `costed`/`uncosted`,
 * `withMargin`/`withoutMargin` — because "3 jobs unpriced" reads at a glance where
 * "3 excluded" makes the reader go looking for what was excluded from what.
 */
interface Totalled {
  /**
   * Summed over the jobs that could be valued. Null when NONE could — never 0,
   * because zero is a real total meaning "earned nothing" (Rule 8).
   */
  readonly total: Cents | null;
  readonly counted: number;
  readonly excluded: number;
}

export interface RevenueTotal {
  readonly total: Cents | null;
  readonly priced: number;
  readonly unpriced: number;
}

export interface CostTotal {
  readonly total: Cents | null;
  readonly costed: number;
  readonly uncosted: number;
}

export interface MarginTotal {
  readonly total: Cents | null;
  readonly withMargin: number;
  readonly withoutMargin: number;
}

export interface RangeMoneyResult {
  /** Every job looked at, cancelled ones included (Rule 15). */
  readonly jobs: number;
  readonly revenue: RevenueTotal;
  readonly foodCost: CostTotal;
  /**
   * Over jobs where BOTH revenue and cost are known.
   *
   * Not `revenue.total − foodCost.total`: those two are summed over different
   * subsets whenever any job is priceable but not costable, so subtracting them
   * would produce a figure belonging to no actual set of jobs.
   */
  readonly margin: MarginTotal;
  /** What the cancellations would have been worth. Never mixed into the above. */
  readonly cancelled: { readonly jobs: number; readonly revenue: RevenueTotal };
  /** De-duplicated: twenty jobs missing one rate is one thing to fix. */
  readonly missing: readonly MissingInput[];
}

/**
 * Total a set of nullable figures, keeping the excluded count visible.
 *
 * The bargain this strikes: refusing to show anything because one job of twenty is
 * unpriced would make the screen useless, so a subtotal is allowed — but only
 * alongside the count of what it leaves out. A subtotal presented as a total is
 * exactly what Rule 11 forbids.
 */
function aggregate(values: readonly (Cents | null)[]): Totalled {
  const known = values.filter((v): v is Cents => v !== null);

  return {
    total: known.length === 0 ? null : (known.reduce((sum, v) => sum + (v as number), 0) as Cents),
    counted: known.length,
    excluded: values.length - known.length,
  };
}

const asRevenue = (t: Totalled): RevenueTotal => ({
  total: t.total,
  priced: t.counted,
  unpriced: t.excluded,
});

const asCost = (t: Totalled): CostTotal => ({
  total: t.total,
  costed: t.counted,
  uncosted: t.excluded,
});

const asMargin = (t: Totalled): MarginTotal => ({
  total: t.total,
  withMargin: t.counted,
  withoutMargin: t.excluded,
});

/**
 * Revenue, food cost and margin across a range of jobs.
 *
 * Every figure comes from `jobMargin`, which is itself `jobRevenue` and
 * `jobFoodCost` — so a range total cannot disagree with the per-job rows shown
 * beside it. Rule 5: one implementation of each step.
 *
 * Deliberately NOT a percentage. Whether margin is a percentage of price or of
 * cost is an open owner question, and the two differ substantially at catering
 * margins. Picking one here would put a number in front of the owner that he never
 * chose. See ARCHITECTURE.md, awaiting-owner.
 */
export function rangeMoney(
  jobs: readonly Job[],
  customers: readonly Customer[],
  rates: readonly ClientRate[],
  recipes: readonly Recipe[],
  ingredients: readonly Ingredient[],
): RangeMoneyResult {
  const customerById = new Map(customers.map((c) => [c.id, c]));

  const valued = jobs.map((job) => ({
    job,
    result: jobMargin(
      job,
      job.customerId === null ? undefined : customerById.get(job.customerId),
      rates,
      recipes,
      ingredients,
    ),
  }));

  // Rule 15 keeps cancelled jobs in the system; it does not mean counting them as
  // money earned. They are valued separately so the loss stays visible.
  const earned = valued.filter((v) => v.job.status !== 'cancelled');
  const cancelled = valued.filter((v) => v.job.status === 'cancelled');

  const seen = new Set<string>();
  const missing: MissingInput[] = [];
  for (const { result } of valued) {
    for (const m of result.missing) {
      const key = `${m.reason} ${m.detail}`;
      if (seen.has(key)) continue;
      seen.add(key);
      missing.push(m);
    }
  }

  return {
    jobs: jobs.length,
    revenue: asRevenue(aggregate(earned.map((v) => v.result.revenue))),
    foodCost: asCost(aggregate(earned.map((v) => v.result.foodCost))),
    // `jobMargin` already returns null unless both sides are known, so filtering
    // on it is what keeps the margin total over one coherent set of jobs.
    margin: asMargin(aggregate(earned.map((v) => v.result.margin))),
    cancelled: {
      jobs: cancelled.length,
      revenue: asRevenue(aggregate(cancelled.map((v) => v.result.revenue))),
    },
    missing,
  };
}
