/**
 * changeImpact — what a proposed change would do.
 *
 * CLAUDE.md section 3: "It is a diff of two engine runs, never a separately
 * maintained calculation."
 *
 * ---------------------------------------------------------------------------
 * THIS FILE HOLDS NO ARITHMETIC OF ITS OWN.
 *
 * No Math.ceil, no unit conversion, no pack maths, no rate lookup. It builds an
 * after-state, runs the existing cascade against both states, and subtracts. That
 * is the entire design, and it is not a stylistic preference: a private copy of
 * any of that logic drifts from the engine the first time something downstream
 * changes, and then the preview lies on the screen the owner uses to decide
 * whether to accept the change.
 *
 * `impact.test.ts` enforces this by reading this source and failing if a rounding
 * or conversion call ever appears here.
 * ---------------------------------------------------------------------------
 */

import { jobFoodCost, jobRevenue, type MissingInput } from './costing';
import { productionBuckets, type ProductionPlan } from './production';
import { requirementsForRange, type RequirementsResult } from './shopping';
import type {
  Cents,
  ClientRate,
  Customer,
  Ingredient,
  IngredientId,
  IsoDate,
  Job,
  JobId,
  Recipe,
  RecipeId,
  StockUnit,
} from './types';

/** Anything about a job may change, except which job and which kitchen it is. */
export type JobChanges = Omit<Partial<Job>, 'id' | 'kitchenId'>;

export interface Delta {
  readonly before: number;
  readonly after: number;
  readonly delta: number;
}

export interface MoneyDelta {
  readonly before: Cents | null;
  readonly after: Cents | null;
  /** Null whenever either side is null — you cannot subtract from unknown (Rule 8). */
  readonly delta: Cents | null;
}

export interface IngredientImpact {
  readonly ingredientId: IngredientId;
  readonly name: string;
  readonly unit: StockUnit;
  readonly required: Delta;
  readonly packs: Delta | null;
}

export interface BatchImpact {
  readonly recipeId: RecipeId;
  readonly recipeName: string;
  readonly prepDate: IsoDate;
  readonly portions: Delta;
  readonly batches: Delta | null;
}

export interface ImpactResult {
  readonly ingredients: readonly IngredientImpact[];
  readonly batches: readonly BatchImpact[];
  readonly revenue: MoneyDelta;
  readonly foodCost: MoneyDelta;
  readonly margin: MoneyDelta;
  /** Gaps this change would open — Rule 8 made visible before saving, not after. */
  readonly gapsIntroduced: readonly string[];
  /** Gaps this change would close. */
  readonly gapsResolved: readonly string[];
}

export interface PricingContext {
  readonly customer?: Customer;
  readonly rates: readonly ClientRate[];
}

interface CascadeRun {
  readonly production: ProductionPlan;
  readonly requirements: RequirementsResult;
  readonly revenue: Cents | null;
  readonly foodCost: Cents | null;
}

/**
 * Run the whole cascade once. Every call here is to a function that already
 * exists; nothing is recomputed locally.
 */
function runCascade(
  jobs: readonly Job[],
  job: Job | undefined,
  recipes: readonly Recipe[],
  ingredients: readonly Ingredient[],
  pricing: PricingContext | undefined,
): CascadeRun {
  const production = productionBuckets(jobs, recipes);
  const requirements = requirementsForRange(jobs, recipes, ingredients);

  let revenue: Cents | null = null;
  let foodCost: Cents | null = null;

  if (job !== undefined) {
    if (pricing !== undefined) {
      revenue = jobRevenue(job, pricing.customer, pricing.rates).total;
    }
    foodCost = jobFoodCost(job, recipes, ingredients).total;
  }

  return { production, requirements, revenue, foodCost };
}

/** Subtraction is the only arithmetic in this file. */
const delta = (before: number, after: number): Delta => ({ before, after, delta: after - before });

const moneyDelta = (before: Cents | null, after: Cents | null): MoneyDelta => ({
  before,
  after,
  delta:
    before === null || after === null
      ? null
      : (((after as number) - (before as number)) as Cents),
});

const describeGaps = (
  requirements: RequirementsResult,
  missing: readonly MissingInput[],
): Set<string> =>
  new Set([
    ...requirements.gaps.map((g) => `${g.reason}: ${g.detail}`),
    ...missing.map((m) => `${m.reason}: ${m.detail}`),
  ]);

/**
 * Diff two full engine runs.
 *
 * A guest-count change moves revenue but not ingredients: `JobDish.portions` is
 * explicit and nothing derives it from `job.guests` yet. `applyBuffetSplit` is the
 * unbuilt half of `rules.ts`, and until it lands this is the honest answer rather
 * than a guess. Recorded in ARCHITECTURE.md and pinned by a test.
 */
export function changeImpact(
  jobs: readonly Job[],
  recipes: readonly Recipe[],
  ingredients: readonly Ingredient[],
  jobId: JobId,
  changes: JobChanges,
  pricing?: PricingContext,
): ImpactResult {
  const target = jobs.find((j) => j.id === jobId);
  const changed = target === undefined ? undefined : { ...target, ...changes };

  // The only thing this file constructs.
  const afterJobs =
    changed === undefined ? jobs : jobs.map((j) => (j.id === jobId ? changed : j));

  const before = runCascade(jobs, target, recipes, ingredients, pricing);
  const after = runCascade(afterJobs, changed, recipes, ingredients, pricing);

  // --- ingredients ---------------------------------------------------------

  const ingredientIds = new Set<IngredientId>([
    ...before.requirements.lines.map((l) => l.ingredientId),
    ...after.requirements.lines.map((l) => l.ingredientId),
  ]);

  const ingredientImpacts: IngredientImpact[] = [];

  for (const id of ingredientIds) {
    const b = before.requirements.lines.find((l) => l.ingredientId === id);
    const a = after.requirements.lines.find((l) => l.ingredientId === id);
    const present = a ?? b;
    if (present === undefined) continue;

    // A line on only one side reads as 4 -> 0, not as an absence to notice.
    const packsBefore = b?.packs?.packs ?? null;
    const packsAfter = a?.packs?.packs ?? null;

    ingredientImpacts.push({
      ingredientId: id,
      name: present.name,
      unit: present.required.unit,
      required: delta(b?.required.value ?? 0, a?.required.value ?? 0),
      packs:
        packsBefore === null && packsAfter === null
          ? null
          : delta(packsBefore ?? 0, packsAfter ?? 0),
    });
  }

  // --- batches -------------------------------------------------------------

  const bucketKey = (recipe: RecipeId, prepDate: IsoDate): string => `${recipe} ${prepDate}`;
  const keys = new Set<string>([
    ...before.production.buckets.map((x) => bucketKey(x.recipeId, x.prepDate)),
    ...after.production.buckets.map((x) => bucketKey(x.recipeId, x.prepDate)),
  ]);

  const batchImpacts: BatchImpact[] = [];

  for (const key of keys) {
    const b = before.production.buckets.find((x) => bucketKey(x.recipeId, x.prepDate) === key);
    const a = after.production.buckets.find((x) => bucketKey(x.recipeId, x.prepDate) === key);
    const present = a ?? b;
    if (present === undefined) continue;

    const batchesBefore = b?.batches?.batches ?? null;
    const batchesAfter = a?.batches?.batches ?? null;

    batchImpacts.push({
      recipeId: present.recipeId,
      recipeName: present.recipeName,
      prepDate: present.prepDate,
      portions: delta(b?.portions ?? 0, a?.portions ?? 0),
      batches:
        batchesBefore === null && batchesAfter === null
          ? null
          : delta(batchesBefore ?? 0, batchesAfter ?? 0),
    });
  }

  // --- money ---------------------------------------------------------------

  const revenue = moneyDelta(before.revenue, after.revenue);
  const foodCost = moneyDelta(before.foodCost, after.foodCost);
  const margin = moneyDelta(
    before.revenue === null || before.foodCost === null
      ? null
      : (((before.revenue as number) - (before.foodCost as number)) as Cents),
    after.revenue === null || after.foodCost === null
      ? null
      : (((after.revenue as number) - (after.foodCost as number)) as Cents),
  );

  // --- gaps ----------------------------------------------------------------

  const beforeGaps = describeGaps(
    before.requirements,
    target === undefined ? [] : jobFoodCost(target, recipes, ingredients).missing,
  );
  const afterGaps = describeGaps(
    after.requirements,
    changed === undefined ? [] : jobFoodCost(changed, recipes, ingredients).missing,
  );

  return {
    ingredients: ingredientImpacts,
    batches: batchImpacts,
    revenue,
    foodCost,
    margin,
    gapsIntroduced: [...afterGaps].filter((g) => !beforeGaps.has(g)),
    gapsResolved: [...beforeGaps].filter((g) => !afterGaps.has(g)),
  };
}
