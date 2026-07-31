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
  GuestRef,
  Ingredient,
  IngredientId,
  Job,
  JobDietary,
  JobId,
  KitchenId,
  PurchaseUnit,
  RecipeQuantity,
  RecipeUnit,
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
