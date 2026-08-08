/**
 * Row <-> domain conversion.
 *
 * Pure functions, so they run in CI with no database. This is the only place a
 * database shape becomes a domain shape; repositories return domain types and the
 * row shape stops here.
 *
 * Three things get their care here:
 *
 *   MONEY. The database stores `numeric(10,2)` euros; the domain uses `Cents`, a
 *   branded integer. €20.00 becomes 2000 and back, rounded once at the boundary.
 *   Float euros are where money bugs start.
 *
 *   NULL. Every nullable column stays null. Never 0, never '' (Rule 8).
 *
 *   UNIONS. `job_dietaries` becomes AllocatedDietary | UnresolvedDietary, and
 *   `jobs.price`/`price_source` becomes JobPricing, so a price with no stated
 *   source is unrepresentable (Rule 11).
 */

import type {
  AllocatedDietary,
  Cents,
  ServiceTemplate,
  ServiceTemplateId,
  ServiceTemplateKind,
  ClientRate,
  ClientRateId,
  Course,
  Customer,
  CustomerId,
  GuestRef,
  Ingredient,
  IngredientId,
  IsoDate,
  IsoTime,
  IsoTimestamp,
  Job,
  JobDietary,
  JobDietaryId,
  JobDish,
  JobDishId,
  JobExtra,
  JobExtraId,
  JobGroupId,
  JobId,
  JobPricing,
  JobStatus,
  KitchenId,
  Property,
  PropertyId,
  PurchaseState,
  PurchaseStateId,
  PurchaseUnit,
  Recipe,
  RecipeComponent,
  RecipeConfidence,
  RecipeId,
  RecipeLineId,
  RecipeUnit,
  RecipeUnquantified,
  StockLevel,
  StockUnit,
  Supplier,
  SupplierId,
  UnresolvedDietary,
  YieldType,
} from '../engine/types';
import type {
  ClientRateRow,
  ServiceTemplateRow,
  CustomerRow,
  IngredientRow,
  JobDietaryRow,
  JobDishRow,
  JobExtraRow,
  JobRow,
  PropertyRow,
  RecipeIngredientRow,
  RecipeRow,
  RecipeUnquantifiedRow,
  PurchaseStateRow,
  StockRow,
  SupplierRow,
} from './rows';

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/** Euros from the database to whole cents. Null stays null — never 0. */
export const toCents = (euros: number | null): Cents | null =>
  euros === null ? null : (Math.round(euros * 100) as Cents);

/** Cents back to the euros the `numeric(10,2)` column expects. */
export const toEuros = (cents: Cents | null): number | null =>
  cents === null ? null : (cents as number) / 100;

// ---------------------------------------------------------------------------
// Places and people
// ---------------------------------------------------------------------------

export const propertyToDomain = (r: PropertyRow): Property => ({
  id: r.id as PropertyId,
  kitchenId: r.kitchen_id as KitchenId,
  name: r.name,
  eircode: r.eircode,
  address: r.address,
  accessNotes: r.access_notes,
  facilities: r.facilities,
});

export const propertyToRow = (p: Property): PropertyRow => ({
  id: p.id,
  kitchen_id: p.kitchenId,
  name: p.name,
  eircode: p.eircode,
  address: p.address,
  access_notes: p.accessNotes,
  facilities: p.facilities,
});

export const customerToDomain = (r: CustomerRow): Customer => ({
  id: r.id as CustomerId,
  kitchenId: r.kitchen_id as KitchenId,
  name: r.name,
  phone: r.phone,
  email: r.email,
  clientGroup: r.client_group,
  notes: r.notes,
});

export const customerToRow = (c: Customer): CustomerRow => ({
  id: c.id,
  kitchen_id: c.kitchenId,
  name: c.name,
  phone: c.phone,
  email: c.email,
  client_group: c.clientGroup,
  notes: c.notes,
});

export const supplierToDomain = (r: SupplierRow): Supplier => ({
  id: r.id as SupplierId,
  kitchenId: r.kitchen_id as KitchenId,
  name: r.name,
  notes: r.notes,
});

export const supplierToRow = (s: Supplier): SupplierRow => ({
  id: s.id,
  kitchen_id: s.kitchenId,
  name: s.name,
  notes: s.notes,
});

export const clientRateToDomain = (r: ClientRateRow): ClientRate => ({
  id: r.id as ClientRateId,
  kitchenId: r.kitchen_id as KitchenId,
  clientGroup: r.client_group,
  serviceType: r.service_type,
  ratePerHead: toCents(r.rate_per_head),
  flatFee: toCents(r.flat_fee),
});

export const clientRateToRow = (c: ClientRate): ClientRateRow => ({
  id: c.id,
  kitchen_id: c.kitchenId,
  client_group: c.clientGroup,
  service_type: c.serviceType,
  rate_per_head: toEuros(c.ratePerHead),
  flat_fee: toEuros(c.flatFee),
});

// ---------------------------------------------------------------------------
// Ingredients and stock
// ---------------------------------------------------------------------------

export const ingredientToDomain = (r: IngredientRow): Ingredient => ({
  id: r.id as IngredientId,
  kitchenId: r.kitchen_id as KitchenId,
  name: r.name,
  category: r.category,
  stockUnit: r.stock_unit as StockUnit,
  recipeUnit: r.recipe_unit === null ? null : (r.recipe_unit as RecipeUnit),
  recipeUnitsPerStockUnit: r.recipe_units_per_stock_unit,
  // A pack needs both a size and a unit to mean anything. Half of one is not a
  // pack, and assuming the other half would be inventing data (Rule 8).
  pack:
    r.pack_size === null || r.pack_unit === null
      ? null
      : { size: r.pack_size, unit: r.pack_unit as PurchaseUnit, assumed: r.pack_assumed },
  supplierId: r.supplier_id === null ? null : (r.supplier_id as SupplierId),
  pricePerPack: toCents(r.price_per_pack),
  previousPrice: toCents(r.previous_price),
  priceChecked: r.price_checked === null ? null : (r.price_checked as IsoDate),
  allergens: r.allergens ?? [],
});

export const ingredientToRow = (i: Ingredient): IngredientRow => ({
  id: i.id,
  kitchen_id: i.kitchenId,
  name: i.name,
  category: i.category,
  stock_unit: i.stockUnit,
  recipe_unit: i.recipeUnit,
  recipe_units_per_stock_unit: i.recipeUnitsPerStockUnit,
  pack_size: i.pack?.size ?? null,
  pack_unit: i.pack?.unit ?? null,
  pack_assumed: i.pack?.assumed ?? true,
  supplier_id: i.supplierId,
  price_per_pack: toEuros(i.pricePerPack),
  previous_price: toEuros(i.previousPrice),
  price_checked: i.priceChecked,
  allergens: [...i.allergens],
});

export const stockToDomain = (r: StockRow): StockLevel => ({
  kitchenId: r.kitchen_id as KitchenId,
  ingredientId: r.ingredient_id as IngredientId,
  onHand: { value: r.qty, unit: r.unit as StockUnit },
  useBy: r.use_by === null ? null : (r.use_by as IsoDate),
  countedAt: r.counted_at as IsoTimestamp,
});

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

const COURSES = new Set(['breakfast', 'main', 'side', 'dessert']);

/**
 * `recipes.course` is free text in the schema but a closed union in the domain,
 * because `rules.ts` and `checks.ts` branch on it. An unrecognised value becomes
 * null rather than being coerced into a course it might not be.
 */
const toCourse = (value: string | null): Course | null =>
  value !== null && COURSES.has(value) ? (value as Course) : null;

/**
 * Rule 13 — `qty_min` and `qty_max` exist in the schema and are deliberately NOT
 * mapped. A recipe quantity is one number; there is no range type in the domain,
 * and picking an end of a range would be inventing owner data.
 */
export const recipeComponentToDomain = (r: RecipeIngredientRow): RecipeComponent | null => {
  const base = {
    id: r.id as RecipeLineId,
    displayName: r.display_name,
    position: r.position,
    qty: r.qty,
    unit: r.unit === null ? null : (r.unit as RecipeUnit),
  };

  if (r.sub_recipe_id !== null) {
    return { ...base, kind: 'sub_recipe', subRecipeId: r.sub_recipe_id as RecipeId };
  }
  if (r.ingredient_id !== null) {
    return { ...base, kind: 'ingredient', ingredientId: r.ingredient_id as IngredientId };
  }
  // The schema's XOR check makes this unreachable; a row that is neither is
  // dropped rather than guessed at.
  return null;
};

export const recipeUnquantifiedToDomain = (r: RecipeUnquantifiedRow): RecipeUnquantified => ({
  id: r.id as RecipeLineId,
  item: r.item,
  reason: r.reason,
});

export const recipeToDomain = (
  r: RecipeRow,
  components: readonly RecipeIngredientRow[],
  unquantified: readonly RecipeUnquantifiedRow[],
): Recipe => ({
  id: r.id as RecipeId,
  kitchenId: r.kitchen_id as KitchenId,
  name: r.name,
  course: toCourse(r.course),
  yieldType: r.yield_type as YieldType,
  portionsPerBatch: r.portions_per_batch,
  batchUnit: r.batch_unit,
  confidence: r.confidence as RecipeConfidence,
  makeAheadDays: r.make_ahead_days,
  sameDayOnly: r.same_day_only,
  freezable: r.freezable,
  onsiteFinish: r.onsite_finish,
  method: r.method,
  note: r.note,
  components: components
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(recipeComponentToDomain)
    .filter((c): c is RecipeComponent => c !== null),
  unquantified: unquantified.map(recipeUnquantifiedToDomain),
});

export const recipeToRow = (r: Recipe): RecipeRow => ({
  id: r.id,
  kitchen_id: r.kitchenId,
  name: r.name,
  course: r.course,
  yield_type: r.yieldType,
  portions_per_batch: r.portionsPerBatch,
  batch_unit: r.batchUnit,
  confidence: r.confidence,
  make_ahead_days: r.makeAheadDays,
  same_day_only: r.sameDayOnly,
  freezable: r.freezable,
  onsite_finish: r.onsiteFinish,
  method: r.method,
  note: r.note,
});

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/**
 * Rule 11 — a price with no stated source is unrepresentable in the domain.
 *
 * A manual figure is an override; anything else derives from the rate card, and
 * the engine recomputes it rather than trusting a stored copy.
 */
export const pricingToDomain = (r: JobRow): JobPricing => {
  const amount = toCents(r.price);
  return r.price_source === 'manual' && amount !== null
    ? { kind: 'override', amount }
    : { kind: 'rate_card' };
};

export const pricingToRow = (
  p: JobPricing,
): Pick<JobRow, 'price' | 'price_source'> =>
  p.kind === 'override'
    ? { price: toEuros(p.amount), price_source: 'manual' }
    : { price: null, price_source: 'rate_card' };

export const jobDishToDomain = (r: JobDishRow): JobDish => ({
  id: r.id as JobDishId,
  jobId: r.job_id as JobId,
  recipeId: r.recipe_id as RecipeId,
  portions: r.portions,
  note: r.note,
  position: r.position,
});

export const jobDishToRow = (d: JobDish, kitchenId: KitchenId): JobDishRow => ({
  id: d.id,
  kitchen_id: kitchenId,
  job_id: d.jobId,
  recipe_id: d.recipeId,
  portions: d.portions,
  note: d.note,
  position: d.position,
});

/**
 * Rule 16 and Rule 12 — a row lands in exactly one variant.
 *
 * `guests_unresolved` is the discriminant. An unresolved requirement keeps the
 * owner's verbatim wording and carries no number at all; an allocated one names
 * its guest. The database check constraint enforces the same split, so a row that
 * satisfies neither is a schema violation rather than something to paper over.
 */
export const dietaryToDomain = (r: JobDietaryRow): JobDietary => {
  const base = {
    id: r.id as JobDietaryId,
    jobId: r.job_id as JobId,
    dietType: r.diet_type,
    severity: r.severity as AllocatedDietary['severity'],
    excludesMeat: r.excludes_meat,
    details: r.details,
    assignedRecipeId:
      r.assigned_recipe_id === null ? null : (r.assigned_recipe_id as RecipeId),
  };

  if (r.guests_unresolved) {
    const unresolved: UnresolvedDietary = {
      ...base,
      kind: 'unresolved',
      originalWording: r.unresolved_note ?? '',
    };
    return unresolved;
  }

  const allocated: AllocatedDietary = {
    ...base,
    kind: 'allocated',
    guest: (r.guest_ref ?? '') as GuestRef,
  };
  return allocated;
};

export const dietaryToRow = (d: JobDietary, kitchenId: KitchenId): JobDietaryRow => ({
  id: d.id,
  kitchen_id: kitchenId,
  job_id: d.jobId,
  diet_type: d.dietType,
  severity: d.severity,
  guest_ref: d.kind === 'allocated' ? d.guest : null,
  excludes_meat: d.excludesMeat,
  guests_unresolved: d.kind === 'unresolved',
  unresolved_note: d.kind === 'unresolved' ? d.originalWording : null,
  details: d.details,
  assigned_recipe_id: d.assignedRecipeId,
});

export const jobExtraToDomain = (r: JobExtraRow): JobExtra => ({
  id: r.id as JobExtraId,
  jobId: r.job_id as JobId,
  label: r.label,
  amountEach: toCents(r.amount_each),
  quantity: r.quantity,
});

export const jobExtraToRow = (
  e: JobExtra,
  kitchenId: KitchenId,
  position: number,
): JobExtraRow => ({
  id: e.id,
  kitchen_id: kitchenId,
  job_id: e.jobId,
  label: e.label,
  amount_each: toEuros(e.amountEach),
  quantity: e.quantity,
  position,
});

export const jobToDomain = (
  r: JobRow,
  dishes: readonly JobDishRow[],
  dietaries: readonly JobDietaryRow[],
  extras: readonly JobExtraRow[],
): Job => ({
  id: r.id as JobId,
  kitchenId: r.kitchen_id as KitchenId,
  customerId: r.customer_id === null ? null : (r.customer_id as CustomerId),
  propertyId: r.property_id === null ? null : (r.property_id as PropertyId),
  jobGroup: r.job_group === null ? null : (r.job_group as JobGroupId),
  serviceDate: r.service_date === null ? null : (r.service_date as IsoDate),
  serviceTime: r.service_time === null ? null : (r.service_time as IsoTime),
  serviceType: r.service_type,
  guests: r.guests,
  guestsConfirmed: r.guests_confirmed,
  meatEatingGuests: r.meat_eating_guests,
  pricing: pricingToDomain(r),
  status: r.status as JobStatus,
  notes: r.notes,
  dishes: dishes.slice().sort((a, b) => a.position - b.position).map(jobDishToDomain),
  dietaries: dietaries.map(dietaryToDomain),
  extras: extras.slice().sort((a, b) => a.position - b.position).map(jobExtraToDomain),
});

/** The job row only. Children are written by their own repositories. */
export const jobToRow = (j: Job): JobRow => ({
  id: j.id,
  kitchen_id: j.kitchenId,
  customer_id: j.customerId,
  property_id: j.propertyId,
  job_group: j.jobGroup,
  service_date: j.serviceDate,
  service_time: j.serviceTime,
  service_type: j.serviceType,
  guests: j.guests,
  guests_confirmed: j.guestsConfirmed,
  meat_eating_guests: j.meatEatingGuests,
  status: j.status,
  notes: j.notes,
  ...pricingToRow(j.pricing),
});

// ---------------------------------------------------------------------------
// Service templates
// ---------------------------------------------------------------------------

export const serviceTemplateToDomain = (r: ServiceTemplateRow): ServiceTemplate => ({
  id: r.id as ServiceTemplateId,
  kitchenId: r.kitchen_id as KitchenId,
  serviceType: r.service_type,
  item: r.item,
  kind: r.kind as ServiceTemplateKind,
  position: r.position,
});

export const serviceTemplateToRow = (t: ServiceTemplate): ServiceTemplateRow => ({
  id: t.id,
  kitchen_id: t.kitchenId,
  service_type: t.serviceType,
  item: t.item,
  kind: t.kind,
  position: t.position,
});

// ---------------------------------------------------------------------------
// Purchase state — Rule 6's single exception
// ---------------------------------------------------------------------------

export const purchaseStateToDomain = (r: PurchaseStateRow): PurchaseState => ({
  id: r.id as PurchaseStateId,
  kitchenId: r.kitchen_id as KitchenId,
  ingredientId: r.ingredient_id as IngredientId,
  windowFrom: r.window_from as IsoDate,
  windowTo: r.window_to as IsoDate,
  // The unit is nullable in the schema but meaningless without one, so it falls
  // back to the ingredient's own stock unit at the point of use rather than being
  // guessed here. `qty_bought` defaults to 0 in the column, and 0 bought is a real
  // statement — it is not the "unknown" that Rule 8 protects.
  qtyBought: { value: r.qty_bought, unit: (r.unit ?? '') as StockUnit },
  done: r.done,
  updatedAt: r.updated_at as IsoTimestamp,
});
