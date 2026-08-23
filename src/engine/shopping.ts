/**
 * Shopping requirements.
 *
 * The first place all three unit systems meet in one pipeline:
 *
 *   recipe unit (400 g)  ->  stock unit (0.4 kg)  ->  purchase unit (1 kg packs)
 *
 * Rule 4 calls that crossing the single most common source of silently wrong
 * answers, so every step of it goes through units.ts and nothing here does its own
 * conversion or its own rounding.
 *
 * Two defects this file is shaped to prevent:
 *   - rounding packs per item instead of per consolidated total, which buys a spare
 *     kilo of flour every week;
 *   - computing packs from the REQUIRED amount rather than the OUTSTANDING one,
 *     which re-buys what is already in the store cupboard.
 */

import { productionBuckets } from './production';
import { scaleRecipe, type ScaleGap } from './scaling';
import {
  recipeToStock,
  stockToPacks,
  stockToStock,
  type Conversion,
  type PackRequirement,
  type UnresolvedReason,
} from './units';
import type {
  Ingredient,
  IngredientId,
  Job,
  Recipe,
  RecipeId,
  StockLevel,
  StockQuantity,
  StockUnit,
  SupplierId,
} from './types';

export interface RequirementLine {
  readonly ingredientId: IngredientId;
  readonly name: string;
  /** Consolidated across the whole range, in the ingredient's stock unit. */
  readonly required: StockQuantity;
  /** Null when the pack size is unknown — the quantity still stands. */
  readonly packs: PackRequirement | null;
  readonly supplierId: SupplierId | null;
}

export type RequirementGapReason =
  | ScaleGap['reason']
  | 'missing_recipe'
  | 'no_service_date'
  | 'no_portions'
  | 'missing_ingredient'
  | 'unresolved_conversion'
  | 'no_pack_size';

export interface RequirementGap {
  readonly reason: RequirementGapReason;
  /**
   * WHAT THIS GAP IS ABOUT, as ids rather than prose.
   *
   * `detail` is a sentence written for the owner. It reads well and it is not
   * something another module can safely match on — so a caller needing to know
   * which recipe or which ingredient a gap concerned had no option but to parse
   * it, or to treat every gap in the window as relevant to every question.
   *
   * That is the gap in the gaps that let Ask Sous answer "no beef mince needed"
   * for a confirmed job whose lasagne lists 4 kg of it. The `no_portions` gap was
   * present and correct; nothing could tie it to the ingredient it dropped.
   *
   * Both are nullable but always present. An optional field drifts — half the
   * construction sites set it and nobody notices which half.
   */
  readonly recipeId: RecipeId | null;
  readonly ingredientId: IngredientId | null;
  readonly detail: string;
}

export interface RequirementsResult {
  readonly lines: readonly RequirementLine[];
  readonly gaps: readonly RequirementGap[];
}

export interface PurchasedQuantity {
  readonly ingredientId: IngredientId;
  readonly qty: StockQuantity;
}

export interface OutstandingLine {
  readonly ingredientId: IngredientId;
  readonly name: string;
  readonly required: StockQuantity;
  readonly onHand: StockQuantity;
  readonly purchased: StockQuantity;
  /** required − onHand − purchased, clamped at zero. */
  readonly outstanding: StockQuantity;
  /** Reported separately so `outstanding` is never negative. Null when there is none. */
  readonly surplus: StockQuantity | null;
  /** Packs for the OUTSTANDING amount, not the required one. */
  readonly packs: PackRequirement | null;
  /**
   * How many stock or purchase rows could not be restated in this line's unit and
   * were therefore left out of the subtraction. Non-zero means `outstanding` is an
   * over-estimate and the owner needs to look — silently dropping stock is not the
   * same as having none (Rule 8).
   */
  readonly unreconciled: number;
}

// ---------------------------------------------------------------------------
// toPurchaseUnits
// ---------------------------------------------------------------------------

/**
 * Whole packs for a quantity in stock units, rounded up, with the overage.
 *
 * Delegates to `stockToPacks` and does no arithmetic of its own. The worked numbers
 * are identical, and Rule 5 forbids a second version of a step — this function
 * exists to give shopping the name the contract uses, not to round anything.
 */
export function toPurchaseUnits(
  qtyBase: number,
  unitBase: StockUnit,
  ingredient: Ingredient,
): Conversion<PackRequirement> {
  return stockToPacks({ value: qtyBase, unit: unitBase }, ingredient);
}

// ---------------------------------------------------------------------------
// requirementsForRange
// ---------------------------------------------------------------------------

/**
 * Consolidated ingredient totals for a set of jobs, plus a gaps list.
 *
 * ---------------------------------------------------------------------------
 * ORDER OF OPERATIONS, same discipline as C4 one link further down the cascade:
 *   1. productionBuckets  — consolidate portions per recipe per prep date
 *   2. scaleRecipe        — ONCE per bucket, so batch recipes scale to whole
 *                           batches. You buy for what you MAKE: 39 portions of
 *                           lasagne is 5 trays, so buy mince for 5 trays.
 *   3. recipeToStock      — cross into stock units, via the owner's factor where
 *                           the pair is not dimensional
 *   4. consolidate        — across EVERY bucket in the range. You shop once even
 *                           though prep dates differ.
 *   5. toPurchaseUnits    — ONCE per ingredient, on the consolidated total.
 *
 * Step 5 must follow step 4. Rounding per item instead buys 3 packs of flour for
 * 0.4 kg on three days, where 1.2 kg consolidated needs 2.
 * ---------------------------------------------------------------------------
 *
 * An ingredient that cannot be quantified appears in `gaps` and NOT in `lines`, so
 * nothing ever reads as "buy zero" (Rule 8).
 */
export function requirementsForRange(
  jobs: readonly Job[],
  recipes: readonly Recipe[],
  ingredients: readonly Ingredient[],
): RequirementsResult {
  const recipeById = new Map(recipes.map((r) => [r.id, r]));
  const ingredientById = new Map(ingredients.map((i) => [i.id, i]));
  const lookup = (id: Recipe['id']): Recipe | undefined => recipeById.get(id);

  const gaps: RequirementGap[] = [];
  const totals = new Map<IngredientId, { ingredient: Ingredient; value: number }>();

  const plan = productionBuckets(jobs, recipes);

  for (const gap of plan.gaps) {
    gaps.push({
      reason: gap.reason,
      recipeId: gap.recipeId,
      ingredientId: null,
      detail: gap.detail,
    });
  }

  for (const bucket of plan.buckets) {
    const recipe = recipeById.get(bucket.recipeId);
    if (recipe === undefined) continue; // productionBuckets already gapped it.

    // Once per bucket, on the consolidated portion total.
    const scaled = scaleRecipe(recipe, bucket.portions, lookup);

    for (const gap of scaled.gaps) {
      // `ScaleGap` already carries the recipe it came from, including for a
      // sub-recipe reached below the bucket's own — which is the one that matters,
      // not the bucket's.
      gaps.push({
        reason: gap.reason,
        recipeId: gap.recipeId,
        ingredientId: null,
        detail: gap.detail,
      });
    }

    for (const line of scaled.lines) {
      const ingredient = ingredientById.get(line.ingredientId);
      if (ingredient === undefined) {
        gaps.push({
          reason: 'missing_ingredient',
          recipeId: bucket.recipeId,
          ingredientId: line.ingredientId,
          detail: `no ingredient record for "${line.displayName}"`,
        });
        continue;
      }

      if (line.unit === null) {
        gaps.push({
          reason: 'unresolved_conversion',
          recipeId: bucket.recipeId,
          ingredientId: ingredient.id,
          detail: `${ingredient.name}: quantity has no unit`,
        });
        continue;
      }

      const inStock = recipeToStock({ value: line.qty, unit: line.unit }, ingredient);
      if (inStock.kind === 'unresolved') {
        gaps.push({
          reason: 'unresolved_conversion',
          recipeId: bucket.recipeId,
          ingredientId: ingredient.id,
          detail: `${ingredient.name}: ${inStock.reason} — ${inStock.detail}`,
        });
        continue;
      }

      const running = totals.get(ingredient.id);
      if (running === undefined) {
        totals.set(ingredient.id, { ingredient, value: inStock.value.value });
      } else {
        running.value = round(running.value + inStock.value.value);
      }
    }
  }

  const lines: RequirementLine[] = [];

  for (const { ingredient, value } of totals.values()) {
    // Once per ingredient, on the consolidated total.
    const packs = toPurchaseUnits(value, ingredient.stockUnit, ingredient);

    if (packs.kind === 'unresolved') {
      gaps.push({
        // No recipe: this is consolidated across every bucket that contributed,
        // so naming one of them would be arbitrary.
        reason: packs.reason === 'no_pack_size' ? 'no_pack_size' : 'unresolved_conversion',
        recipeId: null,
        ingredientId: ingredient.id,
        detail: `${ingredient.name}: ${packs.reason} — ${packs.detail}`,
      });
    }

    lines.push({
      ingredientId: ingredient.id,
      name: ingredient.name,
      required: { value, unit: ingredient.stockUnit },
      packs: packs.kind === 'converted' ? packs.value : null,
      supplierId: ingredient.supplierId,
    });
  }

  return { lines, gaps };
}

// ---------------------------------------------------------------------------
// outstandingShopping
// ---------------------------------------------------------------------------

/**
 * What still needs buying: required − on hand − already purchased.
 *
 * Clamped at zero. When stock and purchases exceed the requirement the excess is
 * reported as `surplus`, never as a negative `outstanding` — a negative would
 * silently offset another line the moment anything summed them.
 *
 * Packs are recomputed from the OUTSTANDING amount. 4.2 kg required with 4 kg on
 * hand is 0.2 kg outstanding and one pack, not five.
 */
export function outstandingShopping(
  requirements: readonly RequirementLine[],
  stock: readonly StockLevel[],
  purchased: readonly PurchasedQuantity[],
  ingredients: readonly Ingredient[],
): readonly OutstandingLine[] {
  const ingredientById = new Map(ingredients.map((i) => [i.id, i]));

  return requirements.map((req) => {
    const ingredient = ingredientById.get(req.ingredientId);
    const unit = req.required.unit;

    const held = sumInto(
      stock.filter((s) => s.ingredientId === req.ingredientId).map((s) => s.onHand),
      unit,
      ingredient,
    );
    const boughtSum = sumInto(
      purchased.filter((p) => p.ingredientId === req.ingredientId).map((p) => p.qty),
      unit,
      ingredient,
    );

    const onHand = held.total;
    const bought = boughtSum.total;
    const net = round(req.required.value - onHand - bought);
    const outstanding = Math.max(0, net);
    const surplus = net < 0 ? round(-net) : null;

    let packs: PackRequirement | null = null;
    if (ingredient !== undefined) {
      const converted = toPurchaseUnits(outstanding, unit, ingredient);
      if (converted.kind === 'converted') packs = converted.value;
    }

    return {
      ingredientId: req.ingredientId,
      name: req.name,
      required: req.required,
      onHand: { value: onHand, unit },
      purchased: { value: bought, unit },
      outstanding: { value: outstanding, unit },
      surplus: surplus === null ? null : { value: surplus, unit },
      packs,
      unreconciled: held.unreconciled + boughtSum.unreconciled,
    };
  });
}

/**
 * Total a set of quantities into one unit.
 *
 * Anything that will not convert is NOT added — adding 500 of something to 5 kg
 * because both are numbers is exactly the Rule 4 failure this layer exists to
 * prevent. It is counted instead, so the caller can surface that the figure is
 * incomplete rather than quietly treating unconvertible stock as absent.
 */
function sumInto(
  quantities: readonly StockQuantity[],
  unit: StockUnit,
  ingredient: Ingredient | undefined,
): { total: number; unreconciled: number } {
  let total = 0;
  let unreconciled = 0;

  for (const q of quantities) {
    if (q.unit === unit) {
      total += q.value;
      continue;
    }

    if (ingredient === undefined) {
      unreconciled += 1;
      continue;
    }

    const converted = stockToStock(q, unit, ingredient);
    if (converted.kind === 'converted') total += converted.value.value;
    else unreconciled += 1;
  }

  return { total: round(total), unreconciled };
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export type { UnresolvedReason };

// ---------------------------------------------------------------------------
// blocksQuantity
// ---------------------------------------------------------------------------

/**
 * A TOTAL map over the reasons, not a switch with a default.
 *
 * Same discipline as `GAP_ROUTING` in src/ui/gapRouting.ts, and deliberately a
 * SECOND map rather than a reuse of it: that one answers "which screen fixes
 * this", this one answers "does a number exist". They overlap and are not the
 * same question — `no_pack_size` needs fixing in Ingredients and does not stop
 * him buying 0.4 kg of flour.
 *
 * A reason added to the engine and not classified here stops the build.
 */
const BLOCKS_QUANTITY: Record<RequirementGapReason, boolean> = {
  // The cascade dropped something. There is no figure at all.
  missing_recipe: true,
  missing_sub_recipe: true,
  no_components: true,
  no_portions_per_batch: true,
  cycle: true,
  missing_ingredient: true,
  unresolved_conversion: true,
  no_service_date: true,
  no_portions: true,

  // The figure stands; something beside it was never measured. These are the
  // "check this yourself" items, and they are PERMANENT for the recipe that has
  // them — treating them as blockers would mean a job whose card says "salt and
  // pepper" could never read as ready, which trains him to ignore the signal.
  unquantified: false,
  named_unquantified: false,
  no_pack_size: false,
};

/**
 * Did this gap PREVENT a quantity, or merely annotate one that exists?
 *
 * Callers asking "is this ready" need the difference. `outstandingShopping`
 * counts lines still to buy, and a DROPPED line counts zero there — so a job
 * whose dish left the cascade reads as having nothing left to buy. Absence
 * presented as completeness is the same defect as a guessed number (Rule 8).
 */
export function blocksQuantity(gap: RequirementGap): boolean {
  return BLOCKS_QUANTITY[gap.reason];
}
