/**
 * Production planning: what gets made, on which day, in what quantity.
 *
 * This file is where the C3 contract stops being a comment and becomes behaviour.
 * `scaleRecipe` and `portionsToUnits` round batches UP, so summing per-job results
 * over-orders. `productionBuckets` consolidates portions across every job FIRST and
 * only then rounds, once per bucket.
 *
 * Three jobs of 1 lasagne portion is ONE tray, not three.
 */

import { applyBuffetSplit } from './rules';
import { portionsToUnits, type BatchRequirement } from './scaling';
import type { IsoDate, Job, JobId, Recipe, RecipeId } from './types';

export interface BucketAllocation {
  readonly jobId: JobId;
  readonly portions: number;
}

export interface ProductionBucket {
  readonly recipeId: RecipeId;
  readonly recipeName: string;
  readonly prepDate: IsoDate;
  /** Consolidated across every contributing job. */
  readonly portions: number;
  /** Batch recipes only. Null for per_person. */
  readonly batches: BatchRequirement | null;
  /** Each job's share, so a prep sheet can show it without re-deriving. */
  readonly allocations: readonly BucketAllocation[];
  /**
   * The earliest service date this bucket feeds. Used for slack in
   * `prioritisePrep` — the soonest thing it feeds is what constrains it.
   */
  readonly earliestServiceDate: IsoDate;
}

export type ProductionGapReason =
  | 'missing_recipe'
  | 'no_service_date'
  | 'no_portions'
  | 'no_portions_per_batch';

export interface ProductionGap {
  readonly reason: ProductionGapReason;
  readonly jobId: JobId;
  /**
   * The recipe the dropped work belongs to.
   *
   * `detail` is a sentence for the owner and must never be the thing another
   * module matches on. A caller needs to know WHICH recipe was dropped: an
   * ingredient with no requirement line because its recipe was dropped here, and
   * one no menu in the window mentions at all, are opposite answers that look
   * identical without this field. For `missing_recipe` it is the id that failed
   * to resolve, which is all there is — the recipe is absent by definition.
   */
  readonly recipeId: RecipeId;
  readonly detail: string;
}

export interface ProductionPlan {
  readonly buckets: readonly ProductionBucket[];
  readonly gaps: readonly ProductionGap[];
}

export interface PrepDay {
  readonly prepDate: IsoDate;
  readonly buckets: readonly ProductionBucket[];
}

// ---------------------------------------------------------------------------
// Calendar arithmetic
// ---------------------------------------------------------------------------

/**
 * Dates here are plain calendar dates, not instants, so everything goes through UTC
 * accessors. `Kitchen.timezone` is deliberately not consulted — mixing a timezone
 * into date-only arithmetic is how off-by-one-day bugs start, and the tests pin a
 * DST boundary to keep it that way.
 */
function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d);
  const shifted = new Date(t + days * 86_400_000);

  const yyyy = String(shifted.getUTCFullYear()).padStart(4, '0');
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd}` as IsoDate;
}

/** Whole days from `from` to `to`. Negative if `to` is earlier. */
function daysBetween(from: IsoDate, to: IsoDate): number {
  const parse = (d: IsoDate): number => {
    const [y, m, day] = d.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// prepDateFor
// ---------------------------------------------------------------------------

/**
 * Service date minus make-ahead days, or the service date itself when the recipe is
 * same-day only.
 *
 * `sameDayOnly` wins over a contradictory `makeAheadDays`: the schema permits both
 * to be set, and same-day is the harder constraint.
 *
 * Null when the job has no service date. Not today — Rule 8.
 */
export function prepDateFor(job: Job, recipe: Recipe): IsoDate | null {
  if (job.serviceDate === null) return null;
  if (recipe.sameDayOnly) return job.serviceDate;

  return addDays(job.serviceDate, -Math.max(0, recipe.makeAheadDays));
}

// ---------------------------------------------------------------------------
// productionBuckets
// ---------------------------------------------------------------------------

interface Accumulator {
  recipe: Recipe;
  prepDate: IsoDate;
  portions: number;
  earliestServiceDate: IsoDate;
  allocations: Map<JobId, number>;
}

/**
 * Group portions per recipe per prep date across all jobs, then round up.
 *
 * ---------------------------------------------------------------------------
 * ORDER OF OPERATIONS IS THE POINT:
 *   1. drop cancelled jobs
 *   2. resolve each dish's prep date
 *   3. SUM portions per (recipe, prep date)
 *   4. only then round to whole batches, once per bucket
 *
 * Step 4 must never run per job. `portionsToUnits` is imported from scaling.ts
 * rather than reimplemented, so there is exactly one rounding rule (Rule 5).
 * ---------------------------------------------------------------------------
 *
 * Cancelled jobs are excluded because you do not cook a cancelled job. They remain
 * in the system and in history untouched — Rule 15 is about not deleting or hiding
 * them, not about prepping them.
 */
export function productionBuckets(
  jobs: readonly Job[],
  recipes: readonly Recipe[],
): ProductionPlan {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const accumulators = new Map<string, Accumulator>();
  const gaps: ProductionGap[] = [];

  for (const job of jobs) {
    if (job.status === 'cancelled') continue;

    // Derive any unallocated portions from the guest count before anything else,
    // so prep, shopping and costing all see the same menu (Rule 5). Only fills
    // nulls, and only when the guest count is known — deriving from an unknown
    // would be the invention Rule 8 forbids.
    const dishes =
      job.guests === null ? job.dishes : applyBuffetSplit(job.guests, job.dishes, recipes);

    for (const d of dishes) {
      const recipe = byId.get(d.recipeId);
      if (recipe === undefined) {
        gaps.push({
          reason: 'missing_recipe',
          jobId: job.id,
          recipeId: d.recipeId,
          detail: `no recipe found for dish "${d.recipeId}"`,
        });
        continue;
      }

      if (d.portions === null) {
        gaps.push({
          reason: 'no_portions',
          jobId: job.id,
          recipeId: recipe.id,
          detail: `${recipe.name}: portions not allocated`,
        });
        continue;
      }

      const prepDate = prepDateFor(job, recipe);
      if (prepDate === null) {
        gaps.push({
          reason: 'no_service_date',
          jobId: job.id,
          recipeId: recipe.id,
          detail: `${recipe.name}: job has no service date, so no prep date`,
        });
        continue;
      }

      // job.serviceDate is non-null here — prepDateFor would have returned null.
      const serviceDate = job.serviceDate as IsoDate;
      // \u0000 as the separator: it cannot occur in a uuid or a date, so no pair
      // of real values can collide into one key. Written as an escape rather than
      // a literal NUL — a literal makes the file read as binary and grep then
      // skips it silently.
      const key = `${recipe.id}\u0000${prepDate}`;
      const existing = accumulators.get(key);

      if (existing === undefined) {
        accumulators.set(key, {
          recipe,
          prepDate,
          portions: d.portions,
          earliestServiceDate: serviceDate,
          allocations: new Map([[job.id, d.portions]]),
        });
      } else {
        existing.portions += d.portions;
        if (serviceDate < existing.earliestServiceDate) {
          existing.earliestServiceDate = serviceDate;
        }
        existing.allocations.set(
          job.id,
          (existing.allocations.get(job.id) ?? 0) + d.portions,
        );
      }
    }
  }

  const buckets: ProductionBucket[] = [];

  for (const acc of accumulators.values()) {
    let batches: BatchRequirement | null = null;

    if (acc.recipe.yieldType === 'batch') {
      // The consolidated total, exactly once.
      batches =
        acc.recipe.portionsPerBatch === null
          ? null
          : portionsToUnits(acc.portions, acc.recipe.portionsPerBatch);

      if (batches === null) {
        for (const jid of acc.allocations.keys()) {
          gaps.push({
            reason: 'no_portions_per_batch',
            jobId: jid,
            recipeId: acc.recipe.id,
            detail: `${acc.recipe.name}: batch recipe with no usable portions per batch`,
          });
        }
        continue;
      }
    }

    buckets.push({
      recipeId: acc.recipe.id,
      recipeName: acc.recipe.name,
      prepDate: acc.prepDate,
      portions: acc.portions,
      batches,
      allocations: [...acc.allocations].map(([id, portions]) => ({ jobId: id, portions })),
      earliestServiceDate: acc.earliestServiceDate,
    });
  }

  return { buckets, gaps };
}

// ---------------------------------------------------------------------------
// prepPlanByDay / prioritisePrep
// ---------------------------------------------------------------------------

/**
 * Regroup buckets into days, ascending, each day in priority order.
 *
 * Pure regrouping — no arithmetic, so there is no chance of a second rounding path.
 */
export function prepPlanByDay(plan: ProductionPlan): readonly PrepDay[] {
  const byDate = new Map<IsoDate, ProductionBucket[]>();

  for (const bucket of plan.buckets) {
    const day = byDate.get(bucket.prepDate);
    if (day === undefined) byDate.set(bucket.prepDate, [bucket]);
    else day.push(bucket);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([prepDate, buckets]) => ({ prepDate, buckets: prioritisePrep(buckets) }));
}

/**
 * Order prep work. A sort, not a filter — nothing is dropped, and the input array
 * is not mutated.
 *
 *   1. prep date, earliest first
 *   2. slack (service date − prep date), tightest first. Something made on the day
 *      it is served cannot be moved; something with two days of slack can.
 *   3. portions, largest first — the big work visible early
 *   4. recipe name, so the order is stable and tests are not flaky
 *
 * Steps 2–4 are a DOCUMENTED DEFAULT, not an owner decision. Paul has not said how
 * he sequences a prep day. See ARCHITECTURE.md.
 */
export function prioritisePrep(
  buckets: readonly ProductionBucket[],
): readonly ProductionBucket[] {
  const slack = (b: ProductionBucket): number =>
    daysBetween(b.prepDate, b.earliestServiceDate);

  return [...buckets].sort((a, b) => {
    if (a.prepDate !== b.prepDate) return a.prepDate < b.prepDate ? -1 : 1;

    const slackDiff = slack(a) - slack(b);
    if (slackDiff !== 0) return slackDiff;

    if (a.portions !== b.portions) return b.portions - a.portions;

    return a.recipeName < b.recipeName ? -1 : a.recipeName > b.recipeName ? 1 : 0;
  });
}
