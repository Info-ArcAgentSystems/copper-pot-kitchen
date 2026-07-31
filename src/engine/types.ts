/**
 * Shared domain types for the Copper Pot Kitchen engine.
 *
 * This file has no imports and no logic. It erases entirely at runtime — the only
 * non-type declaration is the `brand` symbol, which exists solely to make the branded
 * types below nominal.
 *
 * Several of the non-negotiable rules in CLAUDE.md are enforced here rather than
 * remembered downstream:
 *
 *   Rule 4  — the three unit systems are separate branded types, so a stock quantity
 *             cannot be passed where a recipe quantity is expected. units.ts is the only
 *             place they can meet.
 *   Rule 8  — unknown is always `null`, never 0 and never a plausible substitute.
 *   Rule 13 — a recipe quantity is ONE number. There is no range type anywhere in here.
 *   Rule 16 — dietary records carry no count field, so category counts have no operand
 *             to be summed from.
 */

// ---------------------------------------------------------------------------
// Branded primitives
// ---------------------------------------------------------------------------

declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

export type KitchenId = Brand<string, 'KitchenId'>;
export type PropertyId = Brand<string, 'PropertyId'>;
export type CustomerId = Brand<string, 'CustomerId'>;
export type SupplierId = Brand<string, 'SupplierId'>;
export type IngredientId = Brand<string, 'IngredientId'>;
export type RecipeId = Brand<string, 'RecipeId'>;
export type RecipeLineId = Brand<string, 'RecipeLineId'>;
export type JobId = Brand<string, 'JobId'>;
export type JobGroupId = Brand<string, 'JobGroupId'>;
export type JobDishId = Brand<string, 'JobDishId'>;
export type JobDietaryId = Brand<string, 'JobDietaryId'>;
export type ClientRateId = Brand<string, 'ClientRateId'>;
export type JobExtraId = Brand<string, 'JobExtraId'>;

/** 'YYYY-MM-DD'. */
export type IsoDate = Brand<string, 'IsoDate'>;

/** 'HH:MM'. */
export type IsoTime = Brand<string, 'IsoTime'>;

/** RFC 3339 timestamp. */
export type IsoTimestamp = Brand<string, 'IsoTimestamp'>;

/**
 * Money, in whole cents. Never a float — food cost sums many lines and euro floats drift.
 * Never 0 as a stand-in for unknown: an unpriced thing is `null` (Rule 8).
 */
export type Cents = Brand<number, 'Cents'>;

// ---------------------------------------------------------------------------
// Rule 4 — three unit systems, held apart by the type system
// ---------------------------------------------------------------------------

/** How a recipe measures it: g, ml, each. */
export type RecipeUnit = Brand<string, 'RecipeUnit'>;

/** How it is counted on hand: kg, L, each, jar, box, bag, pack, loaf. */
export type StockUnit = Brand<string, 'StockUnit'>;

/** How a supplier sells it: the unit of a pack. */
export type PurchaseUnit = Brand<string, 'PurchaseUnit'>;

export interface RecipeQuantity {
  readonly value: number;
  readonly unit: RecipeUnit;
}

export interface StockQuantity {
  readonly value: number;
  readonly unit: StockUnit;
}

export interface PurchaseQuantity {
  readonly value: number;
  readonly unit: PurchaseUnit;
}

// ---------------------------------------------------------------------------
// Kitchen, places, people
// ---------------------------------------------------------------------------

export interface Kitchen {
  readonly id: KitchenId;
  readonly name: string;
  readonly currency: string;
  readonly timezone: string;
  readonly createdAt: IsoTimestamp;
}

export interface Property {
  readonly id: PropertyId;
  readonly kitchenId: KitchenId;
  readonly name: string;
  readonly eircode: string | null;
  readonly address: string | null;
  readonly accessNotes: string | null;
  readonly facilities: string | null;
}

export interface Customer {
  readonly id: CustomerId;
  readonly kitchenId: KitchenId;
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
  /** Drives rate lookup together with a job's serviceType (Rule 11). */
  readonly clientGroup: string | null;
  readonly notes: string | null;
}

export interface Supplier {
  readonly id: SupplierId;
  readonly kitchenId: KitchenId;
  readonly name: string;
  readonly notes: string | null;
}

// ---------------------------------------------------------------------------
// Rule 11 — pricing
// ---------------------------------------------------------------------------

export interface ClientRate {
  readonly id: ClientRateId;
  readonly kitchenId: KitchenId;
  readonly clientGroup: string;
  readonly serviceType: string;
  /** Optional. Both may be null — that is an unpriced rate, not a free one. */
  readonly ratePerHead: Cents | null;
  readonly flatFee: Cents | null;
}

/** A named surcharge line item. Never folded into the rate. */
export interface JobExtra {
  readonly id: JobExtraId;
  readonly jobId: JobId;
  readonly label: string;
  /** null = named but unpriced. Rule 8: null, never 0. */
  readonly amountEach: Cents | null;
  readonly quantity: number;
}

/**
 * How a job's revenue is arrived at.
 *
 * A union rather than a nullable price plus a source string, so that a price with no
 * stated source is unrepresentable and an override always announces itself as one
 * (Rule 11). The computed figure is deliberately not stored beside the override — the
 * engine recomputes it from the rate card, and a stored copy would be a second source of
 * truth that drifts (Rule 5).
 */
export type JobPricing =
  | { readonly kind: 'rate_card' }
  | { readonly kind: 'override'; readonly amount: Cents };

// ---------------------------------------------------------------------------
// Ingredients and stock
// ---------------------------------------------------------------------------

export interface PackDefinition {
  readonly size: number;
  readonly unit: PurchaseUnit;
  /** True until the owner confirms it. Surfaced, never silently trusted. */
  readonly assumed: boolean;
}

export interface Ingredient {
  readonly id: IngredientId;
  readonly kitchenId: KitchenId;
  readonly name: string;
  readonly category: string | null;
  readonly stockUnit: StockUnit;
  readonly pack: PackDefinition | null;
  readonly supplierId: SupplierId | null;
  /** null = unpriced. Rule 8: never 0 as a stand-in. */
  readonly pricePerPack: Cents | null;
  readonly previousPrice: Cents | null;
  readonly priceChecked: IsoDate | null;
  readonly allergens: readonly string[];
}

export interface StockLevel {
  readonly kitchenId: KitchenId;
  readonly ingredientId: IngredientId;
  readonly onHand: StockQuantity;
  readonly useBy: IsoDate | null;
  readonly countedAt: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Recipes — Rule 13
// ---------------------------------------------------------------------------

export type YieldType = 'per_person' | 'batch';

export type RecipeConfidence = 'locked' | 'confirm' | 'missing';

export type Course = 'breakfast' | 'main' | 'side' | 'dessert';

interface RecipeLineBase {
  readonly id: RecipeLineId;
  readonly displayName: string;
  readonly position: number;
  /**
   * Rule 13 — ONE number. There is no range type, no min/max pair, no "about".
   * null means unquantified (Rule 8): not zero, and not a guess.
   */
  readonly qty: number | null;
  readonly unit: RecipeUnit | null;
}

export interface RecipeIngredientLine extends RecipeLineBase {
  readonly kind: 'ingredient';
  readonly ingredientId: IngredientId;
}

export interface RecipeSubRecipeLine extends RecipeLineBase {
  readonly kind: 'sub_recipe';
  readonly subRecipeId: RecipeId;
}

/** Mirrors the schema's XOR check: a line is one or the other, never both, never neither. */
export type RecipeComponent = RecipeIngredientLine | RecipeSubRecipeLine;

/** A named component with no locked quantity. Shopping shows it as "check this yourself". */
export interface RecipeUnquantified {
  readonly id: RecipeLineId;
  readonly item: string;
  readonly reason: string | null;
}

export interface Recipe {
  readonly id: RecipeId;
  readonly kitchenId: KitchenId;
  readonly name: string;
  readonly course: Course | null;
  readonly yieldType: YieldType;
  readonly portionsPerBatch: number | null;
  readonly batchUnit: string | null;
  readonly confidence: RecipeConfidence;
  readonly makeAheadDays: number;
  readonly sameDayOnly: boolean;
  readonly freezable: boolean;
  readonly onsiteFinish: boolean;
  readonly method: string | null;
  readonly note: string | null;
  readonly components: readonly RecipeComponent[];
  readonly unquantified: readonly RecipeUnquantified[];
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export type JobStatus =
  | 'enquiry'
  | 'confirmed'
  | 'in_prep'
  | 'delivered'
  | 'invoiced'
  | 'paid'
  | 'cancelled';

/**
 * Rule 15 — "completed" is a derived subset, not a stored status. The schema's check
 * constraint has no 'completed' value and none was invented here.
 */
export type CompletedJobStatus = Extract<JobStatus, 'delivered' | 'invoiced' | 'paid'>;

export type ClosedJobStatus = CompletedJobStatus | 'cancelled';

export interface JobDish {
  readonly id: JobDishId;
  readonly jobId: JobId;
  readonly recipeId: RecipeId;
  /** null = not yet allocated. Rule 8: null rather than 0, which would read as "none". */
  readonly portions: number | null;
  readonly note: string | null;
  readonly position: number;
}

export interface Job {
  readonly id: JobId;
  readonly kitchenId: KitchenId;
  readonly customerId: CustomerId | null;
  readonly propertyId: PropertyId | null;
  readonly jobGroup: JobGroupId | null;
  readonly serviceDate: IsoDate | null;
  readonly serviceTime: IsoTime | null;
  /** Owner-defined free text. Not a union — the owner names their own service types. */
  readonly serviceType: string | null;
  /** Rule 8 — null, never a guess. */
  readonly guests: number | null;
  readonly guestsConfirmed: boolean;
  readonly pricing: JobPricing;
  readonly status: JobStatus;
  readonly notes: string | null;
  readonly dishes: readonly JobDish[];
  readonly dietaries: readonly JobDietary[];
  readonly extras: readonly JobExtra[];
}

// ---------------------------------------------------------------------------
// Rule 16 — dietaries, with no count to sum
// ---------------------------------------------------------------------------

export type DietarySeverity = 'info' | 'moderate' | 'severe';

/**
 * Identifies one guest within one job. Not a person record — the kitchen stores no guest
 * identities. It exists so that two requirements can be attributed to the SAME guest:
 * coeliac and vegetarian is one person, not two (Rule 16).
 */
export type GuestRef = Brand<string, 'GuestRef'>;

interface DietaryBase {
  readonly id: JobDietaryId;
  readonly jobId: JobId;
  /** Free text. The owner names their own categories. */
  readonly dietType: string;
  readonly severity: DietarySeverity;
  readonly details: string | null;
  readonly assignedRecipeId: RecipeId | null;
}

/**
 * A requirement attributed to one guest slot. Counting means counting DISTINCT guest
 * refs, which is correct whether or not a guest holds more than one requirement.
 */
export interface AllocatedDietary extends DietaryBase {
  readonly kind: 'allocated';
  readonly guest: GuestRef;
}

/**
 * Rule 12 — "a few vegetarians". The requirement is recorded; the headcount is not.
 * There is deliberately no number on this variant: that absence is the whole point. Its
 * presence on a job blocks exact purchase quantities until the owner replaces it with
 * allocated records.
 */
export interface UnresolvedDietary extends DietaryBase {
  readonly kind: 'unresolved';
  /** The owner's words, verbatim. Never parsed into a number. */
  readonly originalWording: string;
}

/**
 * Rule 16 — neither variant carries a count. Summing dietary categories is not merely
 * discouraged here, it has no operand.
 */
export type JobDietary = AllocatedDietary | UnresolvedDietary;
