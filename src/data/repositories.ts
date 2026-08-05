/**
 * Repositories — the only way application code reaches the database.
 *
 * Each takes an injected `Db`, so the logic here is testable in CI against a fake
 * that records its calls. Each returns DOMAIN types; the row shape stops at the
 * mapper.
 *
 * NO REPOSITORY FILTERS BY kitchen_id. RLS resolves scope through
 * `my_kitchen_id()`. A hand-written filter would be a second copy of the policy,
 * free to drift, and it would mask a misconfigured policy instead of exposing one.
 * `tests/data/purity.test.ts` asserts the string does not appear in a filter here.
 *
 * ON THE AUDIT TRAIL
 * Rules 10 and 14 are enforced by database triggers, not by this file — see
 * `supabase/migrations/20260803000100_job_change_audit.sql`. Repository code
 * cannot be unbypassable, because anything holding a client can write around it.
 * The trigger is the guarantee; these functions are the ergonomics.
 */

import type { Db } from './db';
import { countReferences, crudRepository } from './crud';
import {
  clientRateToDomain,
  clientRateToRow,
  customerToDomain,
  customerToRow,
  ingredientToDomain,
  ingredientToRow,
  jobToDomain,
  jobToRow,
  pricingToRow,
  toEuros,
  propertyToDomain,
  propertyToRow,
  recipeToDomain,
  serviceTemplateToDomain,
  serviceTemplateToRow,
  stockToDomain,
  supplierToDomain,
  supplierToRow,
} from './mappers';
import type {
  ClientRateRow,
  CustomerRow,
  IngredientRow,
  JobChangeRow,
  JobDietaryRow,
  JobDishRow,
  JobExtraRow,
  JobRow,
  PropertyRow,
  RecipeIngredientRow,
  RecipeRow,
  RecipeUnquantifiedRow,
  ServiceTemplateRow,
  StockRow,
  SupplierRow,
} from './rows';
import type {
  ClientRate,
  Customer,
  Ingredient,
  Job,
  JobId,
  Property,
  Recipe,
  RecipeId,
  ServiceTemplate,
  StockLevel,
  Supplier,
} from '../engine/types';

const T = {
  kitchens: 'kitchens',
  kitchenMembers: 'kitchen_members',
  properties: 'properties',
  customers: 'customers',
  clientRates: 'client_rates',
  suppliers: 'suppliers',
  ingredients: 'ingredients',
  stock: 'stock',
  recipes: 'recipes',
  recipeIngredients: 'recipe_ingredients',
  recipeUnquantified: 'recipe_unquantified',
  jobs: 'jobs',
  jobDishes: 'job_dishes',
  jobDietaries: 'job_dietaries',
  jobExtras: 'job_extras',
  jobChanges: 'job_changes',
  serviceTemplates: 'service_templates',
} as const;

// ---------------------------------------------------------------------------
// Kitchen and membership
// ---------------------------------------------------------------------------

export interface KitchenMembership {
  readonly kitchenId: string;
  readonly kitchenName: string;
  readonly role: 'owner' | 'member' | 'support';
}

/**
 * Which kitchen the caller belongs to, and in what role.
 *
 * RLS scopes both tables, so no filter is needed here: `kitchen_members` returns
 * only the caller's own rows and `kitchens` only the one they may see.
 *
 * Rule 17 — support access must be REVOCABLE, taking effect immediately when the
 * membership row is deleted. So this is re-read rather than cached past sign-in,
 * and returns null when there is no membership. Null is a real state the UI must
 * distinguish from "not signed in": it means the account exists but has been
 * granted nothing, which is the rule working, not a failure.
 */
export const kitchenRepository = (db: Db) => ({
  async currentMembership(userId: string): Promise<KitchenMembership | null> {
    // Filtered by user_id, NOT taken as the first row. The `members_read` policy
    // is `using (kitchen_id = my_kitchen_id())`, so it returns every member of the
    // caller's kitchen — taking members[0] could hand back a colleague's row and
    // report a `support` developer as `owner`. The kitchen_id would be right and
    // the role silently wrong, which is precisely the field Rule 17 turns on.
    //
    // This is not kitchen scoping — RLS still does that. It is picking the
    // caller's own row out of the rows RLS already permitted.
    const members = (await db.selectWhere(T.kitchenMembers, 'user_id', userId)) as unknown as {
      kitchen_id: string;
      role: string;
    }[];
    const membership = members[0];
    if (membership === undefined) return null;

    const kitchens = (await db.selectAll(T.kitchens)) as unknown as {
      id: string;
      name: string;
    }[];
    const kitchen = kitchens.find((k) => k.id === membership.kitchen_id);

    return {
      kitchenId: membership.kitchen_id,
      kitchenName: kitchen?.name ?? 'Kitchen',
      role: membership.role as KitchenMembership['role'],
    };
  },
});

// ---------------------------------------------------------------------------
// Simple aggregates
// ---------------------------------------------------------------------------

/**
 * The five shallow setup tables, all on the shared factory.
 *
 * They read, write and delete identically, so five hand-written copies would be
 * five places to fix a bug. Jobs and recipes stay hand-written: their aggregates
 * span several tables and jobs carries audit semantics.
 */
export const propertyRepository = (db: Db) =>
  crudRepository<Property, PropertyRow>(db, T.properties, propertyToDomain, propertyToRow);

export const customerRepository = (db: Db) =>
  crudRepository<Customer, CustomerRow>(db, T.customers, customerToDomain, customerToRow);

export const clientRateRepository = (db: Db) =>
  crudRepository<ClientRate, ClientRateRow>(
    db, T.clientRates, clientRateToDomain, clientRateToRow,
  );

export const supplierRepository = (db: Db) =>
  crudRepository<Supplier, SupplierRow>(db, T.suppliers, supplierToDomain, supplierToRow);

export const serviceTemplateRepository = (db: Db) =>
  crudRepository<ServiceTemplate, ServiceTemplateRow>(
    db, T.serviceTemplates, serviceTemplateToDomain, serviceTemplateToRow,
  );

/**
 * What points at a record, counted BEFORE it is deleted.
 *
 * Deleting a customer, property or supplier is `on delete set null`, so anything
 * referring to it silently loses the reference. A job that loses its customer has
 * no client group, and under Rule 11 its revenue becomes null — it stops being
 * priceable. The confirmation names that, so the count has to exist first.
 */
export const referenceCounts = (db: Db) => ({
  async forCustomer(id: string) {
    return [{ label: 'job', count: await countReferences(db, T.jobs, 'customer_id', id) }];
  },
  async forProperty(id: string) {
    return [{ label: 'job', count: await countReferences(db, T.jobs, 'property_id', id) }];
  },
  async forSupplier(id: string) {
    return [
      {
        label: 'ingredient',
        count: await countReferences(db, T.ingredients, 'supplier_id', id),
      },
    ];
  },
});

export const ingredientRepository = (db: Db) =>
  crudRepository<Ingredient, IngredientRow>(
    db, T.ingredients, ingredientToDomain, ingredientToRow,
  );

export const stockRepository = (db: Db) => ({
  async list(): Promise<StockLevel[]> {
    return (await db.selectAll(T.stock) as unknown as StockRow[]).map(stockToDomain);
  },
});

// ---------------------------------------------------------------------------
// Recipes — an aggregate across three tables
// ---------------------------------------------------------------------------

export const recipeRepository = (db: Db) => ({
  /**
   * Every recipe, with its components and unquantified items.
   *
   * Three reads rather than N+1: the children are fetched in bulk and grouped in
   * memory. A recipe with no components is still a recipe, so it appears with an
   * empty list rather than being dropped.
   */
  async list(): Promise<Recipe[]> {
    const recipes = (await db.selectAll(T.recipes)) as unknown as RecipeRow[];
    if (recipes.length === 0) return [];

    const ids = recipes.map((r) => r.id);
    const components = (await db.selectWhereIn(
      T.recipeIngredients,
      'recipe_id',
      ids,
    )) as unknown as RecipeIngredientRow[];
    const unquantified = (await db.selectWhereIn(
      T.recipeUnquantified,
      'recipe_id',
      ids,
    )) as unknown as RecipeUnquantifiedRow[];

    return recipes.map((r) =>
      recipeToDomain(
        r,
        components.filter((c) => c.recipe_id === r.id),
        unquantified.filter((u) => u.recipe_id === r.id),
      ),
    );
  },

  async byId(id: RecipeId): Promise<Recipe | null> {
    const all = await this.list();
    return all.find((r) => r.id === id) ?? null;
  },

  /**
   * Save a recipe and its lines through the `save_recipe` RPC.
   *
   * NOT a sequence of writes from here. A recipe spans three tables and
   * supabase-js has no transactions, so delete-then-insert from the client can
   * leave a recipe with NO components — which `scaleRecipe` would turn into
   * silence rather than a gap. The function does all three writes in one
   * transaction, and runs `security invoker` so RLS still applies.
   *
   * `kitchen_id` is resolved inside the function from `my_kitchen_id()`, not sent
   * from here, so a client cannot write into another kitchen even by mistake.
   */
  async save(recipe: Recipe): Promise<RecipeId> {
    const header = {
      id: recipe.id === '' ? null : recipe.id,
      name: recipe.name,
      course: recipe.course,
      yield_type: recipe.yieldType,
      portions_per_batch: recipe.portionsPerBatch,
      batch_unit: recipe.batchUnit,
      confidence: recipe.confidence,
      make_ahead_days: recipe.makeAheadDays,
      same_day_only: recipe.sameDayOnly,
      freezable: recipe.freezable,
      onsite_finish: recipe.onsiteFinish,
      method: recipe.method,
      note: recipe.note,
    };

    const components = recipe.components.map((c, position) => ({
      // The schema's XOR check: a line is an ingredient OR a sub-recipe, never
      // both. The domain union already guarantees it; this preserves it.
      ingredient_id: c.kind === 'ingredient' ? c.ingredientId : null,
      sub_recipe_id: c.kind === 'sub_recipe' ? c.subRecipeId : null,
      display_name: c.displayName,
      // Rule 13: one number. There is no qty_min/qty_max here and never will be.
      qty: c.qty,
      unit: c.unit,
      position,
    }));

    const unquantified = recipe.unquantified.map((u) => ({
      item: u.item,
      reason: u.reason,
    }));

    return (await db.rpc('save_recipe', {
      p_recipe: header,
      p_components: components,
      p_unquantified: unquantified,
    })) as RecipeId;
  },

  async remove(id: RecipeId): Promise<void> {
    // Children cascade from recipes. A recipe used as a sub-recipe elsewhere is
    // `on delete restrict`, so the database refuses rather than silently
    // orphaning the parent — the screen counts references first and says so.
    await db.deleteWhere(T.recipes, 'id', id);
  },
});

// ---------------------------------------------------------------------------
// Jobs — the audited aggregate
// ---------------------------------------------------------------------------

/** What a caller may change on a job. Not `id` or `kitchenId`. */
export type JobPatch = Partial<
  Pick<
    Job,
    | 'customerId'
    | 'propertyId'
    | 'jobGroup'
    | 'serviceDate'
    | 'serviceTime'
    | 'serviceType'
    | 'guests'
    | 'guestsConfirmed'
    | 'meatEatingGuests'
    | 'pricing'
    | 'status'
    | 'notes'
  >
>;

export const jobRepository = (db: Db) => ({
  async list(): Promise<Job[]> {
    const jobs = (await db.selectAll(T.jobs)) as unknown as JobRow[];
    if (jobs.length === 0) return [];

    const ids = jobs.map((j) => j.id);
    const dishes = (await db.selectWhereIn(T.jobDishes, 'job_id', ids)) as unknown as JobDishRow[];
    const dietaries = (await db.selectWhereIn(
      T.jobDietaries,
      'job_id',
      ids,
    )) as unknown as JobDietaryRow[];
    const extras = (await db.selectWhereIn(
      T.jobExtras,
      'job_id',
      ids,
    )) as unknown as JobExtraRow[];

    return jobs.map((j) =>
      jobToDomain(
        j,
        dishes.filter((d) => d.job_id === j.id),
        dietaries.filter((d) => d.job_id === j.id),
        extras.filter((e) => e.job_id === j.id),
      ),
    );
  },

  async byId(id: JobId): Promise<Job | null> {
    const all = await this.list();
    return all.find((j) => j.id === id) ?? null;
  },

  /**
   * Update a job.
   *
   * The audit row is NOT written here. The `jobs_audit` trigger writes one row per
   * changed field inside the same transaction as the update, which is what makes
   * it unbypassable and atomic. Writing it here as well would double-log.
   */
  async update(id: JobId, patch: JobPatch): Promise<Job | null> {
    const current = await this.byId(id);
    if (current === null) return null;

    const merged = { ...current, ...patch };
    const row = jobToRow(merged);

    // Only the mutable columns. `id` and `kitchen_id` are never patched.
    const { id: _id, kitchen_id: _kitchenId, ...mutable } = row;
    await db.update(T.jobs, id, mutable);

    return this.byId(id);
  },

  /**
   * Save a job and its dishes, dietaries and extras through `save_job`.
   *
   * One RPC, one transaction. Four separate round trips would leave a
   * half-edited job on failure — but the worse consequence is the audit trail:
   * the child triggers fire per statement, so a scattered save records one edit
   * as several unrelated changes. Rules 10 and 14 want the trail to read like
   * what actually happened.
   *
   * The triggers still fire inside the transaction, so nothing goes unlogged.
   * `kitchen_id` is resolved by the function from `my_kitchen_id()`, never sent
   * from here.
   */
  async save(job: Job): Promise<JobId> {
    const header = {
      id: job.id === '' ? null : job.id,
      customer_id: job.customerId,
      property_id: job.propertyId,
      job_group: job.jobGroup,
      service_date: job.serviceDate,
      service_time: job.serviceTime,
      service_type: job.serviceType,
      guests: job.guests,
      guests_confirmed: job.guestsConfirmed,
      meat_eating_guests: job.meatEatingGuests,
      status: job.status,
      notes: job.notes,
      ...pricingToRow(job.pricing),
    };

    const dishes = job.dishes.map((d, position) => ({
      recipe_id: d.recipeId,
      // Null is meaningful: applyBuffetSplit derives portions from the guest
      // count. Zero would mean "make none of this dish".
      portions: d.portions,
      note: d.note,
      position,
    }));

    // Rule 16: no count field exists on either variant, so none is sent. Two
    // guests with the same requirement are two rows.
    const dietaries = job.dietaries.map((x) => ({
      diet_type: x.dietType,
      severity: x.severity,
      guest_ref: x.kind === 'allocated' ? x.guest : null,
      excludes_meat: x.excludesMeat,
      guests_unresolved: x.kind === 'unresolved',
      // Rule 12: verbatim, never parsed.
      unresolved_note: x.kind === 'unresolved' ? x.originalWording : null,
      details: x.details,
      assigned_recipe_id: x.assignedRecipeId,
    }));

    const extras = job.extras.map((e, position) => ({
      label: e.label,
      amount_each: toEuros(e.amountEach),
      quantity: e.quantity,
      position,
    }));

    return (await db.rpc('save_job', {
      p_job: header,
      p_dishes: dishes,
      p_dietaries: dietaries,
      p_extras: extras,
    })) as JobId;
  },

  async remove(id: JobId): Promise<void> {
    // Children and job_changes cascade. The child audit triggers skip logging
    // when the parent is going too — see 20260803000200.
    await db.deleteWhere(T.jobs, 'id', id);
  },
});

// ---------------------------------------------------------------------------
// The audit trail — read only
// ---------------------------------------------------------------------------

export interface JobChange {
  readonly id: string;
  readonly jobId: JobId;
  readonly field: string;
  readonly oldValue: string | null;
  readonly newValue: string | null;
  readonly changedBy: string | null;
  readonly changedAt: string;
  readonly source: string | null;
}

/**
 * Read-only on purpose. Rule 10 says the trail is not optional; letting
 * application code write or delete entries would make it decorative.
 */
export const jobChangeRepository = (db: Db) => ({
  async forJob(jobId: JobId): Promise<JobChange[]> {
    const rows = (await db.selectWhere(
      T.jobChanges,
      'job_id',
      jobId,
    )) as unknown as JobChangeRow[];

    return rows
      .map((r) => ({
        id: r.id,
        jobId: r.job_id as JobId,
        field: r.field,
        oldValue: r.old_value,
        newValue: r.new_value,
        changedBy: r.changed_by,
        changedAt: r.changed_at,
        source: r.source,
      }))
      .sort((a, b) => (a.changedAt < b.changedAt ? 1 : -1));
  },
});
