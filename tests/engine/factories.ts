/**
 * Minimal domain builders for engine tests.
 *
 * Test-only, per Rule 1. Nothing here is business data — no real recipe, price,
 * ingredient or customer appears. These are structural shells with neutral values,
 * so a test can state the one field it is actually about.
 *
 * If anything under `src/` ever imports this file, that is a bug.
 */

import type {
  AllocatedDietary,
  Cents,
  ClientRate,
  ClientRateId,
  Customer,
  CustomerId,
  GuestRef,
  JobExtra,
  JobExtraId,
  Ingredient,
  IngredientId,
  IsoDate,
  IsoTimestamp,
  Job,
  JobDietary,
  JobDish,
  JobDishId,
  JobId,
  KitchenId,
  PurchaseUnit,
  Recipe,
  RecipeId,
  RecipeIngredientLine,
  RecipeLineId,
  RecipeQuantity,
  RecipeSubRecipeLine,
  RecipeUnit,
  StockLevel,
  StockQuantity,
  StockUnit,
  UnresolvedDietary,
} from '../../src/engine/types';

const KITCHEN = 'kitchen-test' as KitchenId;

export const recipeUnit = (u: string): RecipeUnit => u as RecipeUnit;
export const stockUnit = (u: string): StockUnit => u as StockUnit;
export const purchaseUnit = (u: string): PurchaseUnit => u as PurchaseUnit;
export const guestRef = (g: string): GuestRef => g as GuestRef;

export const recipeQty = (value: number, unit: string): RecipeQuantity => ({
  value,
  unit: recipeUnit(unit),
});

export const stockQty = (value: number, unit: string): StockQuantity => ({
  value,
  unit: stockUnit(unit),
});

export function makeIngredient(over: Partial<Ingredient> = {}): Ingredient {
  return {
    id: 'ing-test' as IngredientId,
    kitchenId: KITCHEN,
    name: 'test ingredient',
    category: null,
    stockUnit: stockUnit('kg'),
    recipeUnit: null,
    recipeUnitsPerStockUnit: null,
    pack: null,
    supplierId: null,
    pricePerPack: null,
    previousPrice: null,
    priceChecked: null,
    allergens: [],
    ...over,
  };
}

export function stockLevel(
  ingredient: IngredientId,
  value: number,
  unit: string,
): StockLevel {
  return {
    kitchenId: KITCHEN,
    ingredientId: ingredient,
    onHand: stockQty(value, unit),
    useBy: null,
    countedAt: '2026-07-01T00:00:00Z' as IsoTimestamp,
  };
}

export function makeJob(over: Partial<Job> = {}): Job {
  return {
    id: 'job-test' as JobId,
    kitchenId: KITCHEN,
    customerId: null,
    propertyId: null,
    jobGroup: null,
    serviceDate: null,
    serviceTime: null,
    serviceType: null,
    guests: null,
    guestsConfirmed: false,
    meatEatingGuests: null,
    pricing: { kind: 'rate_card' },
    status: 'enquiry',
    notes: null,
    dishes: [],
    dietaries: [],
    extras: [],
    ...over,
  };
}

/** Whole cents. */
export const cents = (n: number): Cents => n as Cents;
/** Euros, expressed as cents. euros(20) is 2000. */
export const euros = (n: number): Cents => Math.round(n * 100) as Cents;

export function makeCustomer(clientGroup: string | null, over: Partial<Customer> = {}): Customer {
  return {
    id: 'cust-test' as CustomerId,
    kitchenId: KITCHEN,
    name: 'test customer',
    phone: null,
    email: null,
    clientGroup,
    notes: null,
    ...over,
  };
}

export function clientRate(
  clientGroup: string,
  serviceType: string,
  rates: { perHead?: number; flatFee?: number } = {},
): ClientRate {
  return {
    id: `rate-${clientGroup}-${serviceType}` as ClientRateId,
    kitchenId: KITCHEN,
    clientGroup,
    serviceType,
    ratePerHead: rates.perHead === undefined ? null : euros(rates.perHead),
    flatFee: rates.flatFee === undefined ? null : euros(rates.flatFee),
  };
}

let extraSeq = 0;

/** A named surcharge line. `amountEach: null` means named but unpriced. */
export function extra(label: string, amountEach: number | null, quantity = 1): JobExtra {
  extraSeq += 1;
  return {
    id: `extra-${extraSeq}` as JobExtraId,
    jobId: 'job-test' as JobId,
    label,
    amountEach: amountEach === null ? null : euros(amountEach),
    quantity,
  };
}

export const recipeId = (id: string): RecipeId => id as RecipeId;
export const ingredientId = (id: string): IngredientId => id as IngredientId;
export const jobId = (id: string): JobId => id as JobId;
export const isoDate = (d: string): IsoDate => d as IsoDate;

let dishSeq = 0;

/**
 * A dish on a job. `portions: null` means not yet allocated — Rule 8, never zero.
 *
 * `jobId` here is decorative: productionBuckets attributes allocations from the
 * enclosing Job, not from the dish row.
 */
export function dish(recipe: string, portions: number | null): JobDish {
  dishSeq += 1;
  return {
    id: `dish-${dishSeq}` as JobDishId,
    jobId: jobId('job-test'),
    recipeId: recipeId(recipe),
    portions,
    note: null,
    position: dishSeq,
  };
}

let lineSeq = 0;

/** An ingredient line. `qty: null` means unquantified — Rule 8, never zero. */
export function ingredientLine(
  ingredient: string,
  qty: number | null,
  unit: string | null,
  over: Partial<RecipeIngredientLine> = {},
): RecipeIngredientLine {
  lineSeq += 1;
  return {
    kind: 'ingredient',
    id: `line-${lineSeq}` as RecipeLineId,
    displayName: ingredient,
    position: lineSeq,
    qty,
    unit: unit === null ? null : recipeUnit(unit),
    ingredientId: ingredientId(ingredient),
    ...over,
  };
}

/** A sub-recipe line. `qty` is PORTIONS of the sub-recipe. */
export function subRecipeLine(
  sub: string,
  qty: number | null,
  over: Partial<RecipeSubRecipeLine> = {},
): RecipeSubRecipeLine {
  lineSeq += 1;
  return {
    kind: 'sub_recipe',
    id: `line-${lineSeq}` as RecipeLineId,
    displayName: sub,
    position: lineSeq,
    qty,
    unit: null,
    subRecipeId: recipeId(sub),
    ...over,
  };
}

export function makeRecipe(name: string, over: Partial<Recipe> = {}): Recipe {
  return {
    id: recipeId(name),
    kitchenId: KITCHEN,
    name,
    course: null,
    yieldType: 'per_person',
    portionsPerBatch: null,
    batchUnit: null,
    confidence: 'confirm',
    makeAheadDays: 0,
    sameDayOnly: true,
    freezable: false,
    onsiteFinish: false,
    method: null,
    note: null,
    components: [],
    unquantified: [],
    ...over,
  };
}

/** Builds the `lookup` argument scaleRecipe takes, from a list of recipes. */
export function lookupFor(recipes: readonly Recipe[]) {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  return (id: RecipeId): Recipe | undefined => byId.get(id);
}

let dietarySeq = 0;

/** A requirement pinned to one guest. Two calls with the same guest = one person. */
export function allocated(
  guest: string,
  over: Partial<AllocatedDietary> = {},
): JobDietary {
  dietarySeq += 1;
  const record: AllocatedDietary = {
    kind: 'allocated',
    id: `diet-${dietarySeq}` as AllocatedDietary['id'],
    jobId: 'job-test' as JobId,
    dietType: 'test-diet',
    severity: 'moderate',
    excludesMeat: false,
    details: null,
    assignedRecipeId: null,
    guest: guestRef(guest),
    ...over,
  };
  return record;
}

/** "A few vegetarians" — recorded, never counted. */
export function unresolved(
  originalWording: string,
  over: Partial<UnresolvedDietary> = {},
): JobDietary {
  dietarySeq += 1;
  const record: UnresolvedDietary = {
    kind: 'unresolved',
    id: `diet-${dietarySeq}` as UnresolvedDietary['id'],
    jobId: 'job-test' as JobId,
    dietType: 'test-diet',
    severity: 'moderate',
    excludesMeat: false,
    details: null,
    assignedRecipeId: null,
    originalWording,
    ...over,
  };
  return record;
}
