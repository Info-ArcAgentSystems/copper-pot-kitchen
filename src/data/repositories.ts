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
import {
  clientRateToDomain,
  customerToDomain,
  dietaryToRow,
  ingredientToDomain,
  jobDishToRow,
  jobExtraToRow,
  jobToDomain,
  jobToRow,
  propertyToDomain,
  recipeToDomain,
  stockToDomain,
  supplierToDomain,
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
  StockRow,
  SupplierRow,
} from './rows';
import type {
  ClientRate,
  Customer,
  Ingredient,
  Job,
  JobDietary,
  JobDish,
  JobExtra,
  JobId,
  Property,
  Recipe,
  RecipeId,
  StockLevel,
  Supplier,
} from '../engine/types';

const T = {
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
} as const;

// ---------------------------------------------------------------------------
// Simple aggregates
// ---------------------------------------------------------------------------

export const propertyRepository = (db: Db) => ({
  async list(): Promise<Property[]> {
    return (await db.selectAll(T.properties) as unknown as PropertyRow[]).map(propertyToDomain);
  },
});

export const customerRepository = (db: Db) => ({
  async list(): Promise<Customer[]> {
    return (await db.selectAll(T.customers) as unknown as CustomerRow[]).map(customerToDomain);
  },
});

export const clientRateRepository = (db: Db) => ({
  async list(): Promise<ClientRate[]> {
    return (await db.selectAll(T.clientRates) as unknown as ClientRateRow[]).map(
      clientRateToDomain,
    );
  },
});

export const supplierRepository = (db: Db) => ({
  async list(): Promise<Supplier[]> {
    return (await db.selectAll(T.suppliers) as unknown as SupplierRow[]).map(supplierToDomain);
  },
});

export const ingredientRepository = (db: Db) => ({
  async list(): Promise<Ingredient[]> {
    return (await db.selectAll(T.ingredients) as unknown as IngredientRow[]).map(
      ingredientToDomain,
    );
  },
});

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

  /** Replace the menu. Removals and additions are both audited by the trigger. */
  async replaceDishes(job: Job, dishes: readonly JobDish[]): Promise<void> {
    await db.deleteWhere(T.jobDishes, 'job_id', job.id);
    await db.insert(
      T.jobDishes,
      dishes.map((d) => jobDishToRow({ ...d, jobId: job.id }, job.kitchenId)),
    );
  },

  async replaceDietaries(job: Job, dietaries: readonly JobDietary[]): Promise<void> {
    await db.deleteWhere(T.jobDietaries, 'job_id', job.id);
    await db.insert(
      T.jobDietaries,
      dietaries.map((d) => dietaryToRow({ ...d, jobId: job.id }, job.kitchenId)),
    );
  },

  async replaceExtras(job: Job, extras: readonly JobExtra[]): Promise<void> {
    await db.deleteWhere(T.jobExtras, 'job_id', job.id);
    await db.insert(
      T.jobExtras,
      extras.map((e, i) => jobExtraToRow({ ...e, jobId: job.id }, job.kitchenId, i)),
    );
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
