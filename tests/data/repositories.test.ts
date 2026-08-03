/**
 * Repository logic, against a fake `Db` that records the calls it receives.
 *
 * This runs in CI with no database. What it can prove: the queries a repository
 * issues, that children are fetched in bulk rather than N+1, that domain types
 * come back, and that no call carries a kitchen_id.
 *
 * What it CANNOT prove, and what therefore lives in `tests/integration/`:
 * that RLS actually scopes the rows, and that the audit triggers fire. Those need
 * the live database.
 */

import { describe, expect, it } from 'vitest';
import type { Db, Row } from '../../src/data/db';
import {
  clientRateRepository,
  customerRepository,
  ingredientRepository,
  jobChangeRepository,
  jobRepository,
  propertyRepository,
  recipeRepository,
  stockRepository,
  supplierRepository,
} from '../../src/data/repositories';
import type { JobId, KitchenId, RecipeId } from '../../src/engine/types';

interface Call {
  op: string;
  table: string;
  column?: string;
  value?: unknown;
  payload?: unknown;
}

/** Records every call, and answers from a fixed set of tables. */
function fakeDb(tables: Record<string, Row[]> = {}): Db & { calls: Call[] } {
  const calls: Call[] = [];
  const rows = (t: string): Row[] => tables[t] ?? [];

  return {
    calls,
    async selectAll(table) {
      calls.push({ op: 'selectAll', table });
      return rows(table);
    },
    async selectWhere(table, column, value) {
      calls.push({ op: 'selectWhere', table, column, value });
      return rows(table).filter((r) => r[column] === value);
    },
    async selectWhereIn(table, column, values) {
      calls.push({ op: 'selectWhereIn', table, column, value: values });
      return rows(table).filter((r) => values.includes(r[column] as string));
    },
    async insert(table, newRows) {
      calls.push({ op: 'insert', table, payload: newRows });
      return [...newRows];
    },
    async update(table, id, patch) {
      calls.push({ op: 'update', table, value: id, payload: patch });
      return [patch];
    },
    async deleteWhere(table, column, value) {
      calls.push({ op: 'delete', table, column, value });
    },
  };
}

const KITCHEN = 'k1' as KitchenId;

describe('no repository scopes by kitchen_id', () => {
  it('never passes kitchen_id to the database', async () => {
    // RLS does the scoping. A hand-written filter would be a second copy of the
    // policy, and would hide a broken one.
    const db = fakeDb({
      recipes: [{ id: 'r1', kitchen_id: KITCHEN, name: 'x', course: null, yield_type: 'per_person', portions_per_batch: null, batch_unit: null, confidence: 'confirm', make_ahead_days: 0, same_day_only: true, freezable: false, onsite_finish: false, method: null, note: null }],
    });

    // EVERY repository, not a sample. An earlier version of this test exercised
    // three of them and would have missed a hand-filter added to a fourth.
    await recipeRepository(db).list();
    await ingredientRepository(db).list();
    await clientRateRepository(db).list();
    await propertyRepository(db).list();
    await customerRepository(db).list();
    await supplierRepository(db).list();
    await stockRepository(db).list();
    await jobRepository(db).list();
    await jobChangeRepository(db).forJob('j1' as JobId);

    expect(db.calls.length).toBeGreaterThan(8);

    for (const call of db.calls) {
      expect(call.column, `${call.op} on ${call.table} filtered by kitchen_id`).not.toBe(
        'kitchen_id',
      );
    }
  });
});

describe('recipeRepository', () => {
  const recipeRow: Row = {
    id: 'lasagne',
    kitchen_id: KITCHEN,
    name: 'Lasagne',
    course: 'main',
    yield_type: 'batch',
    portions_per_batch: 9,
    batch_unit: 'tray',
    confidence: 'locked',
    make_ahead_days: 1,
    same_day_only: false,
    freezable: true,
    onsite_finish: false,
    method: null,
    note: null,
  };

  it('assembles a recipe from three tables and returns a domain type', async () => {
    const db = fakeDb({
      recipes: [recipeRow],
      recipe_ingredients: [
        { id: 'l1', kitchen_id: KITCHEN, recipe_id: 'lasagne', ingredient_id: 'mince', sub_recipe_id: null, display_name: 'mince', qty: 2, qty_min: null, qty_max: null, unit: 'kg', position: 0 },
      ],
      recipe_unquantified: [
        { id: 'u1', kitchen_id: KITCHEN, recipe_id: 'lasagne', item: 'seasoning', reason: null },
      ],
    });

    const [recipe] = await recipeRepository(db).list();

    expect(recipe?.name).toBe('Lasagne');
    expect(recipe?.portionsPerBatch).toBe(9);
    expect(recipe?.components).toHaveLength(1);
    expect(recipe?.unquantified).toHaveLength(1);
  });

  it('fetches children in bulk rather than one query per recipe', async () => {
    const db = fakeDb({
      recipes: [recipeRow, { ...recipeRow, id: 'curry', name: 'Curry' }],
    });

    await recipeRepository(db).list();

    // Three reads total, not one per recipe.
    expect(db.calls).toHaveLength(3);
    expect(db.calls.filter((c) => c.op === 'selectWhereIn')).toHaveLength(2);
  });

  it('does not query children when there are no recipes', async () => {
    const db = fakeDb({ recipes: [] });
    expect(await recipeRepository(db).list()).toEqual([]);
    expect(db.calls).toHaveLength(1);
  });

  it('returns a recipe with no components rather than dropping it', async () => {
    const db = fakeDb({ recipes: [recipeRow] });
    const [recipe] = await recipeRepository(db).list();

    expect(recipe?.id).toBe('lasagne');
    expect(recipe?.components).toEqual([]);
  });

  it('returns null for an id that does not exist', async () => {
    const db = fakeDb({ recipes: [recipeRow] });
    expect(await recipeRepository(db).byId('ghost' as RecipeId)).toBeNull();
  });
});

describe('jobRepository', () => {
  const jobRow: Row = {
    id: 'j1',
    kitchen_id: KITCHEN,
    customer_id: null,
    property_id: null,
    job_group: null,
    service_date: '2026-07-18',
    service_time: null,
    service_type: 'Buffet',
    guests: 16,
    guests_confirmed: true,
    meat_eating_guests: null,
    price: null,
    price_source: null,
    status: 'confirmed',
    notes: null,
  };

  const withJob = () =>
    fakeDb({
      jobs: [jobRow],
      job_dishes: [
        { id: 'd1', kitchen_id: KITCHEN, job_id: 'j1', recipe_id: 'lasagne', portions: 16, note: null, position: 0 },
      ],
      job_dietaries: [
        { id: 'v1', kitchen_id: KITCHEN, job_id: 'j1', diet_type: 'vegan', severity: 'moderate', guest_ref: 'g1', excludes_meat: true, guests_unresolved: false, unresolved_note: null, details: null, assigned_recipe_id: null },
      ],
      job_extras: [],
    });

  it('assembles a job with its menu, dietaries and extras', async () => {
    const [job] = await jobRepository(withJob()).list();

    expect(job?.guests).toBe(16);
    expect(job?.dishes).toHaveLength(1);
    expect(job?.dietaries).toHaveLength(1);
    expect(job?.dietaries[0]?.kind).toBe('allocated');
    expect(job?.pricing.kind).toBe('rate_card');
  });

  it('writes no job_changes row of its own', async () => {
    // The trigger does it, inside the same transaction. Doing it here as well
    // would double-log, and doing it INSTEAD would be bypassable.
    const db = withJob();
    await jobRepository(db).update('j1' as JobId, { guests: 20 });

    expect(db.calls.some((c) => c.table === 'job_changes')).toBe(false);
  });

  it('patches only the mutable columns, never id or kitchen_id', async () => {
    const db = withJob();
    await jobRepository(db).update('j1' as JobId, { guests: 20 });

    const patch = db.calls.find((c) => c.op === 'update')?.payload as Row;
    expect(patch['guests']).toBe(20);
    expect(patch).not.toHaveProperty('id');
    expect(patch).not.toHaveProperty('kitchen_id');
  });

  it('leaves unchanged fields at their current values', async () => {
    const db = withJob();
    await jobRepository(db).update('j1' as JobId, { guests: 20 });

    const patch = db.calls.find((c) => c.op === 'update')?.payload as Row;
    expect(patch['service_type']).toBe('Buffet');
    expect(patch['status']).toBe('confirmed');
  });

  it('records an override as a manual price (Rule 11)', async () => {
    const db = withJob();
    await jobRepository(db).update('j1' as JobId, {
      pricing: { kind: 'override', amount: 32000 as never },
    });

    const patch = db.calls.find((c) => c.op === 'update')?.payload as Row;
    expect(patch['price']).toBe(320);
    expect(patch['price_source']).toBe('manual');
  });

  it('returns null for a job that does not exist, and does not write', async () => {
    const db = withJob();
    expect(await jobRepository(db).update('ghost' as JobId, { guests: 1 })).toBeNull();
    expect(db.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('replaces the menu by delete-then-insert, both of which the trigger audits', async () => {
    const db = withJob();
    const [job] = await jobRepository(db).list();
    if (job === undefined) throw new Error('no job');

    await jobRepository(db).replaceDishes(job, []);

    const deletes = db.calls.filter((c) => c.op === 'delete' && c.table === 'job_dishes');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.column).toBe('job_id');
  });
});

describe('jobChangeRepository', () => {
  it('reads the trail newest first', async () => {
    const db = fakeDb({
      job_changes: [
        { id: '1', kitchen_id: KITCHEN, job_id: 'j1', field: 'guests', old_value: '15', new_value: '16', changed_by: 'u1', changed_at: '2026-07-01T10:00:00Z', source: 'ui' },
        { id: '2', kitchen_id: KITCHEN, job_id: 'j1', field: 'eircode', old_value: 'A00 X000', new_value: 'A91 RY71', changed_by: 'u1', changed_at: '2026-07-02T10:00:00Z', source: 'ui' },
      ],
    });

    const trail = await jobChangeRepository(db).forJob('j1' as JobId);

    expect(trail.map((t) => t.field)).toEqual(['eircode', 'guests']);
    // The prior value stays traceable — CHANGE-VISIT-CARLINGFORD-EIRCODE.
    expect(trail[0]?.oldValue).toBe('A00 X000');
  });

  it('exposes no way to write or delete an entry', () => {
    const repo = jobChangeRepository(fakeDb());
    expect(Object.keys(repo)).toEqual(['forJob']);
  });
});
