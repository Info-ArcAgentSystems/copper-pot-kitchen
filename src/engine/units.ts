/**
 * Rule 4 — conversion across the three unit systems.
 *
 *   recipe unit (150 g)  ->  stock unit (kg)  ->  purchase unit (1 kg pack)
 *
 * All conversion happens here. Nowhere else. Every quantity crosses this layer, and
 * CLAUDE.md names it the single most common source of silently wrong answers.
 *
 * The dimensional tables below are physics, not business data: no ingredient, price,
 * pack size or recipe appears in this file, so Rule 1 is not engaged. Anything that
 * is NOT dimensionally derivable — "each" to kg for eggs — requires the ingredient's
 * own owner-entered factor, and is refused when that factor is absent.
 *
 * Every function returns a Conversion union rather than a nullable number, so a
 * caller cannot accidentally treat an unresolved conversion as zero (Rule 8).
 */

import type { Ingredient, StockQuantity, RecipeQuantity, StockUnit } from './types';

export type UnresolvedReason =
  | 'no_recipe_unit'
  | 'no_conversion_factor'
  | 'unknown_unit'
  | 'incompatible_units'
  | 'no_pack_size';

export type Conversion<T> =
  | { readonly kind: 'converted'; readonly value: T }
  | { readonly kind: 'unresolved'; readonly reason: UnresolvedReason; readonly detail: string };

export interface PackRequirement {
  /** Whole packs, always rounded UP. You cannot buy 4.2 bags of flour. */
  readonly packs: number;
  /** What the rounding buys you beyond what was required. */
  readonly overage: StockQuantity;
}

// ---------------------------------------------------------------------------
// Dimensional tables — physics only
// ---------------------------------------------------------------------------

/** Grams in one unit of mass. */
const MASS: Readonly<Record<string, number>> = { g: 1, kg: 1000 };

/** Millilitres in one unit of volume. */
const VOLUME: Readonly<Record<string, number>> = { ml: 1, l: 1000, cl: 10 };

type Family = 'mass' | 'volume' | 'count';

const COUNT_UNITS = new Set(['each', 'unit', 'portion']);

function normalise(unit: string): string {
  return unit.trim().toLowerCase();
}

function familyOf(unit: string): Family | null {
  const u = normalise(unit);
  if (u in MASS) return 'mass';
  if (u in VOLUME) return 'volume';
  if (COUNT_UNITS.has(u)) return 'count';
  return null;
}

/** Base units (g / ml / item) in one of this unit. */
function baseFactor(unit: string): number | null {
  const u = normalise(unit);
  if (u in MASS) return MASS[u] as number;
  if (u in VOLUME) return VOLUME[u] as number;
  if (COUNT_UNITS.has(u)) return 1;
  return null;
}

/**
 * Quantities are stored as numeric(12,4). Rounding to 6 decimal places clears
 * floating-point noise (5 - 4.2 = 0.7999999999999998) while staying two orders of
 * magnitude finer than anything the database or a kitchen scale records.
 */
function roundQuantity(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

const unresolved = <T>(reason: UnresolvedReason, detail: string): Conversion<T> => ({
  kind: 'unresolved',
  reason,
  detail,
});

/**
 * Convert between two units of the same dimension. Returns null when they are not
 * dimensionally comparable — the caller decides whether a factor can rescue it.
 */
function convertDimensional(value: number, from: string, to: string): number | null {
  const fromFamily = familyOf(from);
  const toFamily = familyOf(to);
  if (fromFamily === null || toFamily === null) return null;
  if (fromFamily !== toFamily) return null;

  const fromBase = baseFactor(from);
  const toBase = baseFactor(to);
  if (fromBase === null || toBase === null) return null;

  return roundQuantity((value * fromBase) / toBase);
}

// ---------------------------------------------------------------------------
// Recipe -> stock
// ---------------------------------------------------------------------------

/**
 * 150 g of chicken, counted on hand in kg, is 0.15 kg.
 *
 * Where the pair is not dimensional ("each" of eggs, stocked in kg) the ingredient's
 * `recipeUnitsPerStockUnit` is required. Absent, this refuses: an unresolved
 * conversion is surfaced rather than a plausible number invented (Rule 8). It never
 * assumes a factor of 1.
 */
export function recipeToStock(
  qty: RecipeQuantity,
  ingredient: Ingredient,
): Conversion<StockQuantity> {
  const from = normalise(qty.unit);
  const to = normalise(ingredient.stockUnit);

  const converted = (value: number): Conversion<StockQuantity> => ({
    kind: 'converted',
    value: { value, unit: ingredient.stockUnit },
  });

  if (from === to) return converted(roundQuantity(qty.value));

  const dimensional = convertDimensional(qty.value, from, to);
  if (dimensional !== null) return converted(dimensional);

  if (familyOf(from) === null) {
    return unresolved('unknown_unit', `recipe unit "${qty.unit}" is not a known unit`);
  }
  if (familyOf(to) === null) {
    return unresolved('unknown_unit', `stock unit "${ingredient.stockUnit}" is not a known unit`);
  }

  // Different dimensions. Only the ingredient's own factor can bridge this.
  const factor = ingredient.recipeUnitsPerStockUnit;
  if (factor === null) {
    return unresolved(
      'no_conversion_factor',
      `${ingredient.name}: no factor for "${qty.unit}" -> "${ingredient.stockUnit}"`,
    );
  }
  if (factor === 0) {
    return unresolved('no_conversion_factor', `${ingredient.name}: factor is zero`);
  }

  if (ingredient.recipeUnit === null) {
    return unresolved('no_recipe_unit', `${ingredient.name}: no recipe unit set`);
  }

  // The factor is defined in terms of the ingredient's declared recipe unit, so the
  // incoming quantity has to be expressed in that unit first.
  const declared = normalise(ingredient.recipeUnit);
  const inDeclared =
    from === declared ? qty.value : convertDimensional(qty.value, from, declared);

  if (inDeclared === null) {
    return unresolved(
      'incompatible_units',
      `${ingredient.name}: "${qty.unit}" cannot be expressed in "${ingredient.recipeUnit}"`,
    );
  }

  return converted(roundQuantity(inDeclared / factor));
}

// ---------------------------------------------------------------------------
// Stock -> stock
// ---------------------------------------------------------------------------

/**
 * Restate a stock quantity in a different stock unit — 500 g of flour as 0.5 kg.
 *
 * Dimensional where it can be; otherwise the ingredient's own factor, and only
 * when the source unit is the ingredient's declared recipe unit. Refuses rather
 * than adding numbers that are not comparable, which is the Rule 4 failure this
 * layer exists to prevent.
 */
export function stockToStock(
  qty: StockQuantity,
  to: StockUnit,
  ingredient: Ingredient,
): Conversion<StockQuantity> {
  const from = normalise(qty.unit);
  const target = normalise(to);

  if (from === target) {
    return { kind: 'converted', value: { value: roundQuantity(qty.value), unit: to } };
  }

  const dimensional = convertDimensional(qty.value, from, target);
  if (dimensional !== null) {
    return { kind: 'converted', value: { value: dimensional, unit: to } };
  }

  const factor = ingredient.recipeUnitsPerStockUnit;
  if (
    ingredient.recipeUnit !== null &&
    normalise(ingredient.recipeUnit) === from &&
    factor !== null &&
    factor > 0 &&
    normalise(ingredient.stockUnit) === target
  ) {
    return {
      kind: 'converted',
      value: { value: roundQuantity(qty.value / factor), unit: to },
    };
  }

  return unresolved(
    'incompatible_units',
    `${ingredient.name}: "${qty.unit}" cannot be restated as "${to}"`,
  );
}

// ---------------------------------------------------------------------------
// Stock -> purchase
// ---------------------------------------------------------------------------

/**
 * How much of one pack there is, expressed in the given stock unit.
 *
 * Dimensional first; failing that, the ingredient's own factor, which is the only
 * thing that can bridge a dozen eggs to a kilogram. The factor is defined in terms
 * of the recipe unit, so it applies only when the pack is measured in that unit.
 *
 * Null when there is no pack, or when the two units cannot be reconciled — never a
 * silent assumption of 1 (Rule 8).
 *
 * Shared by `stockToPacks` and by `costing.ts`, which needs it to derive a price
 * per stock unit. One definition, so pack maths cannot diverge (Rule 5).
 */
export function packSizeIn(ingredient: Ingredient, unit: StockUnit): number | null {
  const pack = ingredient.pack;
  if (pack === null || pack.size <= 0) return null;

  const packUnit = normalise(pack.unit);
  const target = normalise(unit);

  if (packUnit === target) return pack.size;

  const dimensional = convertDimensional(pack.size, packUnit, target);
  if (dimensional !== null) return dimensional;

  const factor = ingredient.recipeUnitsPerStockUnit;
  if (
    ingredient.recipeUnit !== null &&
    normalise(ingredient.recipeUnit) === packUnit &&
    factor !== null &&
    factor > 0
  ) {
    return roundQuantity(pack.size / factor);
  }

  return null;
}

/**
 * 4.2 kg with 1 kg packs is 5 packs, not 4.2. 17 eggs at 12 per pack is 2.
 *
 * Always rounds up, and reports the overage so the surplus is visible rather than
 * silently absorbed.
 */
export function stockToPacks(
  qty: StockQuantity,
  ingredient: Ingredient,
): Conversion<PackRequirement> {
  const pack = ingredient.pack;
  if (pack === null) {
    return unresolved('no_pack_size', `${ingredient.name}: no pack size set`);
  }
  if (pack.size <= 0) {
    return unresolved('no_pack_size', `${ingredient.name}: pack size is not positive`);
  }

  const stock: StockUnit = qty.unit;
  const packInStock = packSizeIn(ingredient, stock);

  if (packInStock === null || packInStock <= 0) {
    return unresolved(
      'incompatible_units',
      `${ingredient.name}: pack unit "${pack.unit}" cannot be expressed in stock unit "${stock}"`,
    );
  }

  const packs = Math.ceil(roundQuantity(qty.value / packInStock));
  const overage = roundQuantity(packs * packInStock - qty.value);

  return {
    kind: 'converted',
    value: { packs, overage: { value: overage, unit: stock } },
  };
}
