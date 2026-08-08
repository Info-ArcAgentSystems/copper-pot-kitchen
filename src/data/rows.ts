/**
 * Database row shapes, hand-written to match `schema.sql`.
 *
 * Not generated: `supabase gen types` needs a linked project, and a hand-written
 * set keeps the file reviewable against the schema it mirrors.
 *
 * `numeric` columns arrive from PostgREST as JavaScript numbers, so money is euros
 * here and becomes `Cents` at the mapper boundary — never before.
 */

export type PropertyRow = {
  id: string;
  kitchen_id: string;
  name: string;
  eircode: string | null;
  address: string | null;
  access_notes: string | null;
  facilities: string | null;
}

export type CustomerRow = {
  id: string;
  kitchen_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  client_group: string | null;
  notes: string | null;
}

export type ClientRateRow = {
  id: string;
  kitchen_id: string;
  client_group: string;
  service_type: string;
  rate_per_head: number | null;
  flat_fee: number | null;
}

export type SupplierRow = {
  id: string;
  kitchen_id: string;
  name: string;
  notes: string | null;
}

export type IngredientRow = {
  id: string;
  kitchen_id: string;
  name: string;
  category: string | null;
  stock_unit: string;
  recipe_unit: string | null;
  recipe_units_per_stock_unit: number | null;
  pack_size: number | null;
  pack_unit: string | null;
  pack_assumed: boolean;
  supplier_id: string | null;
  price_per_pack: number | null;
  previous_price: number | null;
  price_checked: string | null;
  allergens: string[] | null;
}

export type StockRow = {
  id: string;
  kitchen_id: string;
  ingredient_id: string;
  qty: number;
  unit: string;
  use_by: string | null;
  counted_at: string;
}

export type RecipeRow = {
  id: string;
  kitchen_id: string;
  name: string;
  course: string | null;
  yield_type: string;
  portions_per_batch: number | null;
  batch_unit: string | null;
  confidence: string;
  make_ahead_days: number;
  same_day_only: boolean;
  freezable: boolean;
  onsite_finish: boolean;
  method: string | null;
  note: string | null;
}

export type RecipeIngredientRow = {
  id: string;
  kitchen_id: string;
  recipe_id: string;
  ingredient_id: string | null;
  sub_recipe_id: string | null;
  display_name: string;
  qty: number | null;
  /** Rule 13 — present in the schema, deliberately NOT mapped. See mappers/recipe.ts. */
  qty_min: number | null;
  qty_max: number | null;
  unit: string | null;
  position: number;
}

export type RecipeUnquantifiedRow = {
  id: string;
  kitchen_id: string;
  recipe_id: string;
  item: string;
  reason: string | null;
}

export type JobRow = {
  id: string;
  kitchen_id: string;
  customer_id: string | null;
  property_id: string | null;
  job_group: string | null;
  service_date: string | null;
  service_time: string | null;
  service_type: string | null;
  guests: number | null;
  guests_confirmed: boolean;
  meat_eating_guests: number | null;
  price: number | null;
  price_source: string | null;
  status: string;
  notes: string | null;
}

export type JobDishRow = {
  id: string;
  kitchen_id: string;
  job_id: string;
  recipe_id: string;
  portions: number | null;
  note: string | null;
  position: number;
}

export type JobDietaryRow = {
  id: string;
  kitchen_id: string;
  job_id: string;
  diet_type: string;
  severity: string;
  guest_ref: string | null;
  excludes_meat: boolean;
  guests_unresolved: boolean;
  unresolved_note: string | null;
  details: string | null;
  assigned_recipe_id: string | null;
}

export type JobExtraRow = {
  id: string;
  kitchen_id: string;
  job_id: string;
  label: string;
  amount_each: number | null;
  quantity: number;
  position: number;
}

export type JobChangeRow = {
  id: string;
  kitchen_id: string;
  job_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  changed_at: string;
  source: string | null;
}

export type ServiceTemplateRow = {
  id: string;
  kitchen_id: string;
  service_type: string;
  item: string;
  kind: string;
  position: number;
}

/**
 * The ONLY thing about a shopping list that is stored (Rule 6).
 *
 * Identity is (kitchen_id, ingredient_id, window_from, window_to) — a tick belongs
 * to a date window, not to an ingredient. "Bought 2 kg for this weekend" is not
 * "bought 2 kg for next weekend", so the window is part of what the row means.
 */
export type PurchaseStateRow = {
  id: string;
  kitchen_id: string;
  ingredient_id: string;
  window_from: string;
  window_to: string;
  qty_bought: number;
  unit: string | null;
  done: boolean;
  updated_at: string;
}
