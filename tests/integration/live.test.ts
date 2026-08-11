/**
 * The tests that need a live Supabase and a signed-in session.
 *
 * Skipped when credentials are absent, so CI is unaffected and their absence is
 * visible rather than silent.
 *
 * THESE ARE THE ONLY PROOF OF THREE THINGS NOTHING IN CI CAN REACH:
 *
 *   1. the child triggers EXECUTE — `pg_trigger` proves they are armed, not that
 *      their body is correct
 *   2. `changed_by` holds the acting user — `auth.uid()` is null in the SQL editor
 *   3. RLS scopes reads — no repository filters `kitchen_id`, deliberately, so the
 *      policy is the single definition and nothing else checks it
 *
 * Each test creates its own data and deletes it. See README.md: do not point this
 * at a database holding real owner data.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db, Row } from '../../src/data/db';
import { buildBackup, EXPORTED_TABLES, importable } from '../../src/ui/backup';
import {
  ingredientRepository,
  jobRepository,
  recipeRepository,
  stockRepository,
} from '../../src/data/repositories';
import { outstandingShopping, requirementsForRange } from '../../src/engine/shopping';

/**
 * Read `.env.local` directly.
 *
 * Vite only loads VITE_-prefixed variables into `process.env`, so `CPK_TEST_*`
 * never arrive there — which is why this suite silently skipped even with the
 * values sitting in the file.
 *
 * They must NOT be renamed with a VITE_ prefix to fix that. Vite INLINES
 * VITE_-prefixed values into the client bundle at build time, so a password
 * called `VITE_CPK_TEST_PASSWORD` would be shipped to every browser that loads
 * the app. Reading the file here keeps the credentials test-only.
 */
function envFile(): Record<string, string> {
  try {
    const text = readFileSync(fileURLToPath(new URL('../../.env.local', import.meta.url)), 'utf8');
    const out: Record<string, string> = {};

    for (const line of text.split('\n')) {
      if (line.trim() === '' || line.trim().startsWith('#') || !line.includes('=')) continue;
      const [rawKey, ...rest] = line.split('=');
      // Tolerate quotes rather than failing with something that reads like a
      // wrong password.
      out[(rawKey ?? '').trim()] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}

const file = envFile();
/** A real environment variable wins, so CI can override the file. */
const from = (key: string): string => process.env[key] ?? file[key] ?? '';

const url = from('VITE_SUPABASE_URL');
const key = from('VITE_SUPABASE_ANON_KEY');
const email = from('CPK_TEST_EMAIL');
const password = from('CPK_TEST_PASSWORD');

const configured = url !== '' && key !== '' && email !== '' && password !== '';
const live = configured ? describe : describe.skip;

let db: SupabaseClient;
let userId = '';
let kitchenId = '';

async function makeJob(fields: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await db
    .from('jobs')
    .insert({ kitchen_id: kitchenId, service_type: 'INTEGRATION TEST', guests: 10, ...fields })
    .select('id')
    .single();

  if (error !== null) throw new Error(`could not create job: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * A READ-ONLY `Db` port over the live client.
 *
 * Not `supabaseDb` from `src/data/client.ts`, deliberately: that module reads
 * `import.meta.env`, which needs Vite's browser types, and `tsconfig.test.json`
 * excludes those on purpose so a test needing a browser global fails to compile.
 * Importing it would mean widening either the test types or the purity guard's
 * allow-list, to run a test that only ever reads.
 *
 * Every write method throws. This port exists to prove that rows written by the
 * suite come back in a shape the ENGINE accepts — the mappers against real data —
 * so a write arriving through it would mean the test had drifted from that.
 */
const readOnlyPort = (): Db => {
  const rows = async (table: string, run: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    const { data, error } = await run;
    if (error !== null) throw new Error(`${table}: ${error.message}`);
    return (data ?? []) as Row[];
  };

  const refuse = (op: string) => (): never => {
    throw new Error(`${op} is not available on the read-only integration port`);
  };

  return {
    selectAll: (table) => rows(table, db.from(table).select('*')),
    selectWhere: (table, column, value) => rows(table, db.from(table).select('*').eq(column, value)),
    selectWhereIn: async (table, column, values) =>
      values.length === 0 ? [] : rows(table, db.from(table).select('*').in(column, values)),
    insert: refuse('insert'),
    upsert: refuse('upsert'),
    update: refuse('update'),
    deleteWhere: refuse('delete'),
    rpc: refuse('rpc'),
  };
};

const changesFor = async (jobId: string): Promise<Record<string, unknown>[]> => {
  const { data, error } = await db
    .from('job_changes')
    .select('*')
    .eq('job_id', jobId)
    .order('changed_at', { ascending: true });

  if (error !== null) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
};

beforeAll(async () => {
  if (!configured) return;

  db = createClient(url, key);
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error !== null) throw new Error(`sign in failed: ${error.message}`);
  userId = data.user?.id ?? '';

  const membership = await db.from('kitchen_members').select('kitchen_id');
  if (membership.error !== null) throw new Error(membership.error.message);
  kitchenId = (membership.data?.[0] as { kitchen_id: string } | undefined)?.kitchen_id ?? '';
  if (kitchenId === '') throw new Error('signed-in user has no kitchen_members row');

  // Clean at BOTH ends, not just the end. A run that dies hard — a crash, a
  // ctrl-C, a hook timeout — never reaches afterAll, and the next run then fails
  // on a leftover rather than on anything it did itself. That is precisely how the
  // orphaned ingredient above presented.
  await cleanUp();
}, 30_000);

/**
 * Clean up by PATTERN, not by tracked ids.
 *
 * Four reasons, all learned the hard way on a run that went red:
 *
 *   - One request, not one per job. Twelve sequential deletes at ~700ms each ran
 *     past vitest's 10s hook timeout and stopped partway, leaving rows behind.
 *   - Self-healing. A pattern delete also clears anything a previously failed run
 *     abandoned, so leftovers never accumulate.
 *   - ORDER, which is the whole difficulty. Two `on delete restrict` edges point
 *     backwards, so parents must go first and free their children:
 *
 *         jobs         first — `job_dishes.recipe_id` restricts, so a recipe with
 *                      a dish pointing at it refuses to delete
 *         recipes      next  — `recipe_ingredients.ingredient_id` restricts, so an
 *                      ingredient with a recipe line pointing at it refuses too
 *         ingredients  last
 *
 *     Ingredients used to be deleted BEFORE recipes, and the resulting error was
 *     swallowed. The orphan then survived to break the following run on the unique
 *     (kitchen_id, name) constraint — a failure that looks nothing like its cause.
 *   - Errors are surfaced, never swallowed. A silent cleanup failure leaves data in
 *     the owner's database and reports success, the worst of both.
 */
async function cleanUp(): Promise<void> {
  const step = async (label: string, run: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await run;
    if (error !== null) throw new Error(`cleanup failed on ${label}: ${error.message}`);
  };

  await step('jobs', db.from('jobs').delete().eq('service_type', 'INTEGRATION TEST'));
  await step('recipes', db.from('recipes').delete().like('name', 'INTEGRATION TEST%'));
  await step('ingredients', db.from('ingredients').delete().like('name', 'INTEGRATION TEST%'));
  await step('customers', db.from('customers').delete().like('name', 'INTEGRATION TEST%'));
  await step('client_rates', db.from('client_rates').delete().eq('client_group', 'INTEGRATION TEST'));
  await step(
    'service_templates',
    db.from('service_templates').delete().eq('service_type', 'INTEGRATION TEST'),
  );
  // Suppliers AFTER ingredients: `ingredients.supplier_id` is `on delete set
  // null`, so the order is not forced, but deleting the referrer first keeps the
  // sequence readable as parent-to-child throughout.
  //
  // These were missing until the backup tests started creating suppliers, and the
  // leftover then broke the NEXT run on the unique (kitchen_id, name) constraint —
  // the same failure the orphaned ingredient produced, for the same reason: a test
  // created data the cleanup did not know about.
  await step('suppliers', db.from('suppliers').delete().like('name', 'INTEGRATION TEST%'));
  await step('properties', db.from('properties').delete().like('name', 'INTEGRATION TEST%'));

  // Prove it, rather than assume it. Ingredients are checked as well as jobs now,
  // because an ingredient is exactly what survived last time.
  const jobsLeft = await db.from('jobs').select('id').eq('service_type', 'INTEGRATION TEST');
  if ((jobsLeft.data ?? []).length > 0) {
    throw new Error(`cleanup left ${(jobsLeft.data ?? []).length} job(s) behind`);
  }

  const ingredientsLeft = await db
    .from('ingredients')
    .select('id')
    .like('name', 'INTEGRATION TEST%');
  if ((ingredientsLeft.data ?? []).length > 0) {
    throw new Error(`cleanup left ${(ingredientsLeft.data ?? []).length} ingredient(s) behind`);
  }

  const suppliersLeft = await db
    .from('suppliers')
    .select('id')
    .like('name', 'INTEGRATION TEST%');
  if ((suppliersLeft.data ?? []).length > 0) {
    throw new Error(`cleanup left ${(suppliersLeft.data ?? []).length} supplier(s) behind`);
  }
}

afterAll(async () => {
  if (!configured) return;
  await cleanUp();
  await db.auth.signOut();
}, 30_000);

live('RLS scoping', () => {
  it('returns only this kitchen’s rows, with no kitchen_id filter in the query', async () => {
    // This is the guarantee no repository duplicates. If the policy is wrong,
    // nothing else in the codebase would notice.
    const { data, error } = await db.from('jobs').select('kitchen_id');

    expect(error).toBeNull();
    for (const row of (data ?? []) as { kitchen_id: string }[]) {
      expect(row.kitchen_id).toBe(kitchenId);
    }
  });

  it('rejects an insert carrying another kitchen_id', async () => {
    const { error } = await db
      .from('jobs')
      .insert({ kitchen_id: '00000000-0000-0000-0000-000000000000', service_type: 'X' });

    expect(error, 'the with-check policy should have refused this').not.toBeNull();
  });

  it('resolves exactly one DISTINCT kitchen for the caller', async () => {
    // my_kitchen_id() takes `limit 1`, so scoping is ambiguous only if the caller
    // can see rows for MORE THAN ONE kitchen. Several rows for one kitchen is
    // normal and correct — `members_read` is `using (kitchen_id = my_kitchen_id())`,
    // so an owner plus a support developer is two rows, one kitchen.
    //
    // Asserting a row count of 1 here would have failed the moment a second person
    // was added, which is the setup this suite is run under.
    const { data } = await db.from('kitchen_members').select('kitchen_id');
    const distinct = new Set((data ?? []).map((r) => (r as { kitchen_id: string }).kitchen_id));

    expect(distinct.size).toBe(1);
  });

  it('sees only its own kitchen in kitchen_members', async () => {
    const { data } = await db.from('kitchen_members').select('kitchen_id');
    for (const row of (data ?? []) as { kitchen_id: string }[]) {
      expect(row.kitchen_id).toBe(kitchenId);
    }
  });
});

live('audit triggers — jobs', () => {
  it('writes exactly one row per changed field', async () => {
    const jobId = await makeJob({ guests: 15 });
    await db.from('jobs').update({ guests: 20 }).eq('id', jobId);

    const changes = await changesFor(jobId);
    const guests = changes.filter((c) => c['field'] === 'guests');

    expect(guests).toHaveLength(1);
    expect(guests[0]?.['old_value']).toBe('15');
    expect(guests[0]?.['new_value']).toBe('20');
  });

  it('writes nothing for an update that changes nothing', async () => {
    const jobId = await makeJob({ guests: 15 });
    await db.from('jobs').update({ guests: 15 }).eq('id', jobId);

    expect(await changesFor(jobId)).toHaveLength(0);
  });

  it('THE ONE THE SQL EDITOR COULD NOT SHOW: changed_by is the signed-in user', async () => {
    const jobId = await makeJob({ guests: 15 });
    await db.from('jobs').update({ guests: 16 }).eq('id', jobId);

    const [change] = await changesFor(jobId);
    expect(change?.['changed_by']).toBe(userId);
  });

  it('logs a manual price as an override, not an ordinary edit (Rule 11)', async () => {
    const jobId = await makeJob();
    await db.from('jobs').update({ price: 320, price_source: 'manual' }).eq('id', jobId);

    const fields = (await changesFor(jobId)).map((c) => c['field']);
    expect(fields).toContain('price_override');
    expect(fields).not.toContain('price');
  });

  it('logs a rate-card price as an ordinary price change', async () => {
    const jobId = await makeJob();
    await db.from('jobs').update({ price: 300, price_source: 'rate_card' }).eq('id', jobId);

    expect((await changesFor(jobId)).map((c) => c['field'])).toContain('price');
  });

  it('records source as ui by default', async () => {
    const jobId = await makeJob({ guests: 15 });
    await db.from('jobs').update({ guests: 17 }).eq('id', jobId);

    expect((await changesFor(jobId))[0]?.['source']).toBe('ui');
  });
});

live('audit triggers — children (armed, never fired until now)', () => {
  let recipeId = '';

  beforeAll(async () => {
    const { data, error } = await db
      .from('recipes')
      .insert({
        kitchen_id: kitchenId,
        name: `INTEGRATION TEST ${Date.now()}`,
        yield_type: 'per_person',
      })
      .select('id')
      .single();

    if (error !== null) throw new Error(`could not create recipe: ${error.message}`);
    recipeId = (data as { id: string }).id;
  });

  // No afterAll here on purpose: deleting the recipe before the jobs are gone is
  // blocked by job_dishes.recipe_id's `on delete restrict`. The file-level
  // cleanUp() removes it after the jobs, in the right order.

  it('job_dishes_audit fires on insert', async () => {
    const jobId = await makeJob();
    await db
      .from('job_dishes')
      .insert({ kitchen_id: kitchenId, job_id: jobId, recipe_id: recipeId, portions: 10 });

    expect((await changesFor(jobId)).map((c) => c['field'])).toContain('job_dishes.added');
  });

  it('job_dishes_audit fires on delete, keeping the old value', async () => {
    const jobId = await makeJob();
    const { data } = await db
      .from('job_dishes')
      .insert({ kitchen_id: kitchenId, job_id: jobId, recipe_id: recipeId, portions: 10 })
      .select('id')
      .single();

    await db.from('job_dishes').delete().eq('id', (data as { id: string }).id);

    const removed = (await changesFor(jobId)).find((c) => c['field'] === 'job_dishes.removed');
    expect(removed).toBeDefined();
    expect(String(removed?.['old_value'])).toContain('"portions": 10');
  });

  it('job_dietaries_audit fires', async () => {
    const jobId = await makeJob();
    await db.from('job_dietaries').insert({
      kitchen_id: kitchenId,
      job_id: jobId,
      diet_type: 'vegetarian',
      guest_ref: 'g1',
      guests_unresolved: false,
    });

    expect((await changesFor(jobId)).map((c) => c['field'])).toContain('job_dietaries.added');
  });

  it('job_extras_audit fires', async () => {
    const jobId = await makeJob();
    await db
      .from('job_extras')
      .insert({ kitchen_id: kitchenId, job_id: jobId, label: 'test extra', amount_each: 10 });

    expect((await changesFor(jobId)).map((c) => c['field'])).toContain('job_extras.added');
  });

  it('attributes a child change to the signed-in user too', async () => {
    const jobId = await makeJob();
    await db
      .from('job_dishes')
      .insert({ kitchen_id: kitchenId, job_id: jobId, recipe_id: recipeId, portions: 5 });

    expect((await changesFor(jobId))[0]?.['changed_by']).toBe(userId);
  });
});

live('deleting a job', () => {
  it('a job WITH children can be deleted at all', async () => {
    // Regression guard. The child audit triggers originally made this impossible:
    // the cascade fired an insert into job_changes for a job that had just been
    // deleted, and job_changes_job_id_fkey rejected it. A job with no children
    // deleted fine, so it only appeared once the triggers were exercised end to
    // end. See 20260803000200_audit_allow_job_delete.sql.
    const jobId = await makeJob();
    await db
      .from('job_dietaries')
      .insert({ kitchen_id: kitchenId, job_id: jobId, diet_type: 'vegan',
                guest_ref: 'g1', guests_unresolved: false });

    const { error } = await db.from('jobs').delete().eq('id', jobId);
    expect(error, 'a job with a dietary should be deletable').toBeNull();

    const { data } = await db.from('jobs').select('id').eq('id', jobId);
    expect(data ?? []).toHaveLength(0);
  });
});

live('setup CRUD through the repositories (batch 1 screens)', () => {
  // Exercises the shared crud factory against the real database and the real RLS
  // policies — the path every setup screen writes through. The unit tests prove
  // the factory issues the right calls; only this proves the policies accept them.
  it('creates, reads back, updates and deletes a customer', async () => {
    const created = await db
      .from('customers')
      .insert({ kitchen_id: kitchenId, name: 'INTEGRATION TEST customer', client_group: 'Tranquillity' })
      .select('*')
      .single();
    expect(created.error, 'insert should be accepted by the with-check policy').toBeNull();

    const id = (created.data as { id: string }).id;

    const read = await db.from('customers').select('*').eq('id', id).single();
    expect((read.data as { client_group: string }).client_group).toBe('Tranquillity');

    const updated = await db
      .from('customers')
      .update({ client_group: 'Visit Carlingford' })
      .eq('id', id)
      .select('*')
      .single();
    expect((updated.data as { client_group: string }).client_group).toBe('Visit Carlingford');

    const removed = await db.from('customers').delete().eq('id', id);
    expect(removed.error).toBeNull();

    const gone = await db.from('customers').select('id').eq('id', id);
    expect(gone.data ?? []).toHaveLength(0);
  });

  it('counts the jobs referencing a customer, which is what the delete warning shows', async () => {
    const customer = await db
      .from('customers')
      .insert({ kitchen_id: kitchenId, name: 'INTEGRATION TEST referenced' })
      .select('id')
      .single();
    const customerId = (customer.data as { id: string }).id;

    await makeJob({ customer_id: customerId });

    const refs = await db.from('jobs').select('id').eq('customer_id', customerId);
    expect((refs.data ?? []).length).toBe(1);

    await db.from('jobs').delete().eq('customer_id', customerId);
    await db.from('customers').delete().eq('id', customerId);
  });

  it('accepts a rate with NEITHER figure set — unpriced, not free (Rule 11)', async () => {
    const created = await db
      .from('client_rates')
      .insert({
        kitchen_id: kitchenId,
        client_group: 'INTEGRATION TEST',
        service_type: 'Unpriced',
        rate_per_head: null,
        flat_fee: null,
      })
      .select('*')
      .single();

    expect(created.error, 'a rate with no figures must be storable').toBeNull();
    const row = created.data as { id: string; rate_per_head: number | null; flat_fee: number | null };
    // Null, not 0. Zero would mean free; null means the owner has not said.
    expect(row.rate_per_head).toBeNull();
    expect(row.flat_fee).toBeNull();

    await db.from('client_rates').delete().eq('id', row.id);
  });

  it('stores a service template', async () => {
    const created = await db
      .from('service_templates')
      .insert({ kitchen_id: kitchenId, service_type: 'INTEGRATION TEST', item: 'tongs', kind: 'equipment' })
      .select('*')
      .single();

    expect(created.error).toBeNull();
    await db.from('service_templates').delete().eq('id', (created.data as { id: string }).id);
  });
});

live('save_recipe RPC (batch 2)', () => {
  // The unit tests pin the payload. Only this proves the function exists, runs
  // `security invoker` so RLS applies, and lands all three tables atomically.
  it('saves a recipe with a component and an unquantified item in one call', async () => {
    const ingredient = await db
      .from('ingredients')
      .insert({ kitchen_id: kitchenId, name: 'INTEGRATION TEST mince', stock_unit: 'kg' })
      .select('id')
      .single();
    expect(ingredient.error).toBeNull();
    const ingredientId = (ingredient.data as { id: string }).id;

    const saved = await db.rpc('save_recipe', {
      p_recipe: {
        id: null,
        name: 'INTEGRATION TEST lasagne',
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
      },
      p_components: [
        {
          ingredient_id: ingredientId,
          sub_recipe_id: null,
          display_name: 'mince',
          qty: 2,
          unit: 'kg',
          position: 0,
        },
      ],
      p_unquantified: [{ item: 'seasoning', reason: 'never measured' }],
    });

    expect(saved.error, 'save_recipe should be callable by a signed-in owner').toBeNull();
    const recipeId = saved.data as string;
    expect(recipeId).toBeTruthy();

    // All three tables landed.
    const header = await db.from('recipes').select('*').eq('id', recipeId).single();
    expect((header.data as { portions_per_batch: number }).portions_per_batch).toBe(9);

    const components = await db.from('recipe_ingredients').select('*').eq('recipe_id', recipeId);
    expect(components.data ?? []).toHaveLength(1);

    // `numeric(12,4)` comes back as a JSON NUMBER, not the string '2.0000' this
    // assertion originally guessed at. Worth pinning rather than loosening: the
    // engine multiplies this value, and `RecipeIngredientRow.qty` is typed
    // `number | null` with the mapper passing it straight through — so a string
    // here would be a silent '2' * 10 concatenation waiting to happen.
    const qty = (components.data?.[0] as { qty: unknown }).qty;
    expect(typeof qty, 'qty must arrive as a number the engine can multiply').toBe('number');
    expect(qty).toBe(2);

    const unq = await db.from('recipe_unquantified').select('*').eq('recipe_id', recipeId);
    expect(unq.data ?? []).toHaveLength(1);

    // A second save REPLACES the lines rather than appending.
    await db.rpc('save_recipe', {
      p_recipe: { id: recipeId, name: 'INTEGRATION TEST lasagne', yield_type: 'batch', portions_per_batch: 9 },
      p_components: [],
      p_unquantified: [],
    });
    const after = await db.from('recipe_ingredients').select('*').eq('recipe_id', recipeId);
    expect(after.data ?? []).toHaveLength(0);

    await db.from('recipes').delete().eq('id', recipeId);
    await db.from('ingredients').delete().eq('id', ingredientId);
  });

  it('refuses a recipe belonging to another kitchen', async () => {
    // The function resolves kitchen_id from my_kitchen_id(), so a forged id in
    // the payload cannot redirect the write.
    const { error } = await db.rpc('save_recipe', {
      p_recipe: { id: '00000000-0000-0000-0000-000000000000', name: 'x', yield_type: 'per_person' },
      p_components: [],
      p_unquantified: [],
    });

    expect(error, 'editing a recipe outside this kitchen should fail').not.toBeNull();
  });
});

live('save_job RPC (batch 3)', () => {
  // The unit tests pin the payload shape. Only this proves the function exists,
  // runs `security invoker` so RLS applies and auth.uid() is the real user, and
  // lands four tables atomically.
  it('saves a job with a dish, an extra and BOTH dietary kinds in one call', async () => {
    const recipe = await db.rpc('save_recipe', {
      p_recipe: {
        id: null,
        name: 'INTEGRATION TEST curry',
        yield_type: 'per_person',
        confidence: 'locked',
      },
      p_components: [],
      p_unquantified: [],
    });
    expect(recipe.error).toBeNull();
    const recipeId = recipe.data as string;

    const saved = await db.rpc('save_job', {
      p_job: {
        id: null,
        service_type: 'INTEGRATION TEST',
        service_date: '2026-07-22',
        guests: 17,
        guests_confirmed: false,
        status: 'confirmed',
        price_source: 'rate_card',
      },
      p_dishes: [{ recipe_id: recipeId, portions: null, note: null, position: 0 }],
      p_dietaries: [
        // Two guests, one requirement each — two rows, never a count of 2.
        { diet_type: 'vegetarian', severity: 'moderate', guest_ref: 'g1', excludes_meat: true, guests_unresolved: false },
        { diet_type: 'coeliac', severity: 'severe', guest_ref: 'g1', excludes_meat: false, guests_unresolved: false },
        // And the Rule 12 kind: the owner's words, unparsed.
        {
          diet_type: 'vegetarian',
          severity: 'moderate',
          guests_unresolved: true,
          unresolved_note: 'a few vegetarians',
        },
      ],
      p_extras: [{ label: 'Steak surcharge', amount_each: 15, quantity: 4, position: 0 }],
    });

    expect(saved.error, 'save_job should be callable by a signed-in owner').toBeNull();
    const jobId = saved.data as string;
    expect(jobId).toBeTruthy();

    const header = await db.from('jobs').select('*').eq('id', jobId).single();
    expect((header.data as { guests: number }).guests).toBe(17);
    // kitchen_id came from my_kitchen_id(), never from the payload.
    expect((header.data as { kitchen_id: string }).kitchen_id).toBe(kitchenId);

    const dishes = await db.from('job_dishes').select('*').eq('job_id', jobId);
    expect(dishes.data ?? []).toHaveLength(1);
    // Null portions survived as null. A zero would mean "make none of this dish".
    expect((dishes.data?.[0] as { portions: number | null }).portions).toBeNull();

    const dietaries = await db.from('job_dietaries').select('*').eq('job_id', jobId);
    expect(dietaries.data ?? []).toHaveLength(3);

    const unresolved = (dietaries.data ?? []).find(
      (d) => (d as { guests_unresolved: boolean }).guests_unresolved,
    );
    expect((unresolved as { unresolved_note: string }).unresolved_note).toBe('a few vegetarians');

    // Rule 16, at the storage layer: two rows share one guest ref, so a row count
    // says 2 and the distinct guest refs say 1. Only the second is a headcount.
    const refs = (dietaries.data ?? [])
      .map((d) => (d as { guest_ref: string | null }).guest_ref)
      .filter((r): r is string => r !== null);
    expect(refs).toHaveLength(2);
    expect(new Set(refs).size).toBe(1);

    const extras = await db.from('job_extras').select('*').eq('job_id', jobId);
    expect(extras.data ?? []).toHaveLength(1);
    expect((extras.data?.[0] as { quantity: number }).quantity).toBe(4);

    // A second save REPLACES the children rather than appending.
    const again = await db.rpc('save_job', {
      p_job: { id: jobId, service_type: 'INTEGRATION TEST', guests: 23, status: 'confirmed' },
      p_dishes: [],
      p_dietaries: [],
      p_extras: [],
    });
    expect(again.error).toBeNull();
    expect((await db.from('job_dishes').select('id').eq('job_id', jobId)).data ?? []).toHaveLength(0);

    // And the guest change was logged by the trigger, inside the same transaction.
    const changes = await changesFor(jobId);
    expect(changes.some((c) => c['field'] === 'guests' && c['new_value'] === '23')).toBe(true);
    expect(changes.every((c) => c['changed_by'] === userId)).toBe(true);

    await db.from('jobs').delete().eq('id', jobId);
    await db.from('recipes').delete().eq('id', recipeId);
  });

  it('refuses a job belonging to another kitchen', async () => {
    const { error } = await db.rpc('save_job', {
      p_job: { id: '00000000-0000-0000-0000-000000000000', service_type: 'INTEGRATION TEST' },
      p_dishes: [],
      p_dietaries: [],
      p_extras: [],
    });

    expect(error, 'editing a job outside this kitchen should fail').not.toBeNull();
  });

  it('RULE 15: a cancelled job can still be corrected, and the correction is logged', async () => {
    const created = await db.rpc('save_job', {
      p_job: { id: null, service_type: 'INTEGRATION TEST', guests: 12, status: 'cancelled' },
      p_dishes: [],
      p_dietaries: [],
      p_extras: [],
    });
    expect(created.error).toBeNull();
    const jobId = created.data as string;

    // Status is a state, not a lock — no path refuses this.
    const corrected = await db.rpc('save_job', {
      p_job: { id: jobId, service_type: 'INTEGRATION TEST', guests: 14, status: 'cancelled' },
      p_dishes: [],
      p_dietaries: [],
      p_extras: [],
    });
    expect(corrected.error, 'a cancelled job must stay correctable').toBeNull();

    const changes = await changesFor(jobId);
    const guests = changes.filter((c) => c['field'] === 'guests');
    expect(guests).toHaveLength(1);
    expect(guests[0]?.['old_value']).toBe('12');
    expect(guests[0]?.['new_value']).toBe('14');

    await db.from('jobs').delete().eq('id', jobId);
  });
});

live('purchase_state — Rule 6 (batch 4c)', () => {
  // The unit tests pin the upsert payload. Only this proves the constraint is
  // really there and that the conflict target matches it — the difference between
  // updating a tick and silently creating a second one.
  const FROM = '2026-08-10';
  const TO = '2026-08-17';

  const makeIngredient = async (): Promise<string> => {
    const { data, error } = await db
      .from('ingredients')
      .insert({ kitchen_id: kitchenId, name: 'INTEGRATION TEST mince', stock_unit: 'kg' })
      .select('id')
      .single();
    if (error !== null) throw new Error(`could not create ingredient: ${error.message}`);
    return (data as { id: string }).id;
  };

  it('THE ONE THAT MATTERS: re-ticking UPDATES rather than duplicating', async () => {
    const ingredientId = await makeIngredient();

    const upsert = (qty: number, done: boolean) =>
      db
        .from('purchase_state')
        .upsert(
          {
            kitchen_id: kitchenId,
            ingredient_id: ingredientId,
            window_from: FROM,
            window_to: TO,
            qty_bought: qty,
            unit: 'kg',
            done,
          },
          { onConflict: 'kitchen_id,ingredient_id,window_from,window_to' },
        )
        .select('*');

    const first = await upsert(2, false);
    expect(first.error).toBeNull();

    const second = await upsert(3, true);
    expect(second.error, 'the conflict target must match the unique constraint').toBeNull();

    // ONE row, not two. A duplicate would be subtracted from the requirement
    // twice, producing a list that under-buys while looking correct.
    const rows = await db
      .from('purchase_state')
      .select('*')
      .eq('ingredient_id', ingredientId);

    expect(rows.data ?? []).toHaveLength(1);
    expect((rows.data?.[0] as { qty_bought: number }).qty_bought).toBe(3);
    expect((rows.data?.[0] as { done: boolean }).done).toBe(true);

    await db.from('purchase_state').delete().eq('ingredient_id', ingredientId);
    await db.from('ingredients').delete().eq('id', ingredientId);
  });

  it('a different WINDOW is a different tick, not an update of this one', async () => {
    // "Bought 2 kg for this weekend" is not "bought 2 kg for next weekend". The
    // window is part of the row's identity, which is why it is in the unique key.
    const ingredientId = await makeIngredient();

    const write = (to: string, qty: number) =>
      db.from('purchase_state').upsert(
        {
          kitchen_id: kitchenId,
          ingredient_id: ingredientId,
          window_from: FROM,
          window_to: to,
          qty_bought: qty,
          unit: 'kg',
          done: false,
        },
        { onConflict: 'kitchen_id,ingredient_id,window_from,window_to' },
      );

    expect((await write(TO, 2)).error).toBeNull();
    expect((await write('2026-08-24', 5)).error).toBeNull();

    const rows = await db.from('purchase_state').select('*').eq('ingredient_id', ingredientId);
    expect(rows.data ?? []).toHaveLength(2);

    await db.from('purchase_state').delete().eq('ingredient_id', ingredientId);
    await db.from('ingredients').delete().eq('id', ingredientId);
  });

  it('RLS scopes it, and rejects a row naming another kitchen', async () => {
    const { error } = await db.from('purchase_state').insert({
      kitchen_id: '00000000-0000-0000-0000-000000000000',
      ingredient_id: '00000000-0000-0000-0000-000000000000',
      window_from: FROM,
      window_to: TO,
    });

    expect(error, 'the with-check policy should have refused this').not.toBeNull();
  });
});

live('prep_state — Rule 6 (batch 4d)', () => {
  const DAY = '2026-08-17';

  const makeRecipe = async (): Promise<string> => {
    const { data, error } = await db.rpc('save_recipe', {
      p_recipe: {
        id: null,
        name: 'INTEGRATION TEST lasagne',
        yield_type: 'batch',
        portions_per_batch: 9,
        confidence: 'locked',
      },
      p_components: [],
      p_unquantified: [],
    });
    if (error !== null) throw new Error(`could not create recipe: ${error.message}`);
    return data as string;
  };

  it('re-ticking UPDATES rather than duplicating', async () => {
    const recipeId = await makeRecipe();

    const tick = (done: boolean) =>
      db
        .from('prep_state')
        .upsert(
          { kitchen_id: kitchenId, recipe_id: recipeId, prep_date: DAY, done },
          { onConflict: 'kitchen_id,recipe_id,prep_date' },
        )
        .select('*');

    expect((await tick(true)).error).toBeNull();
    expect((await tick(false)).error, 'the conflict target must match the constraint').toBeNull();

    const rows = await db.from('prep_state').select('*').eq('recipe_id', recipeId);

    // ONE row. Two would show a line ticked and unticked at the same time.
    expect(rows.data ?? []).toHaveLength(1);
    expect((rows.data?.[0] as { done: boolean }).done).toBe(false);

    await db.from('prep_state').delete().eq('recipe_id', recipeId);
    await db.from('recipes').delete().eq('id', recipeId);
  });

  it('the same recipe on a DIFFERENT DAY is a separate tick', async () => {
    // Two prep days is two pieces of work. One tick must not strike both through.
    const recipeId = await makeRecipe();

    const tick = (day: string) =>
      db.from('prep_state').upsert(
        { kitchen_id: kitchenId, recipe_id: recipeId, prep_date: day, done: true },
        { onConflict: 'kitchen_id,recipe_id,prep_date' },
      );

    expect((await tick(DAY)).error).toBeNull();
    expect((await tick('2026-08-18')).error).toBeNull();

    const rows = await db.from('prep_state').select('*').eq('recipe_id', recipeId);
    expect(rows.data ?? []).toHaveLength(2);

    await db.from('prep_state').delete().eq('recipe_id', recipeId);
    await db.from('recipes').delete().eq('id', recipeId);
  });

  it('RLS rejects a tick naming another kitchen', async () => {
    const { error } = await db.from('prep_state').insert({
      kitchen_id: '00000000-0000-0000-0000-000000000000',
      recipe_id: '00000000-0000-0000-0000-000000000000',
      prep_date: DAY,
    });

    expect(error, 'the with-check policy should have refused this').not.toBeNull();
  });
});

live('packing_state — Rule 6 (batch 4e)', () => {
  it('re-ticking UPDATES rather than duplicating', async () => {
    const jobId = await makeJob({ guests: 12 });
    const key = 'food:00000000-0000-0000-0000-000000000001';

    const tick = (done: boolean) =>
      db
        .from('packing_state')
        .upsert(
          { kitchen_id: kitchenId, job_id: jobId, item: key, done },
          { onConflict: 'kitchen_id,job_id,item' },
        )
        .select('*');

    expect((await tick(true)).error).toBeNull();
    expect((await tick(false)).error, 'the conflict target must match the constraint').toBeNull();

    const rows = await db.from('packing_state').select('*').eq('job_id', jobId);
    expect(rows.data ?? []).toHaveLength(1);
    expect((rows.data?.[0] as { done: boolean }).done).toBe(false);
  });

  it('the namespaced key keeps food and equipment apart', async () => {
    // The collision the key exists to prevent: a recipe and an equipment item can
    // legitimately share a name. Two keys, two rows, two independent ticks.
    const jobId = await makeJob({ guests: 12 });

    const write = (item: string) =>
      db.from('packing_state').upsert(
        { kitchen_id: kitchenId, job_id: jobId, item, done: true },
        { onConflict: 'kitchen_id,job_id,item' },
      );

    expect((await write('food:chafing')).error).toBeNull();
    expect((await write('equipment:chafing')).error).toBeNull();

    const rows = await db.from('packing_state').select('*').eq('job_id', jobId);
    expect(rows.data ?? []).toHaveLength(2);
  });

  it('RLS rejects a tick naming another kitchen', async () => {
    const { error } = await db.from('packing_state').insert({
      kitchen_id: '00000000-0000-0000-0000-000000000000',
      job_id: '00000000-0000-0000-0000-000000000000',
      item: 'food:x',
    });

    expect(error, 'the with-check policy should have refused this').not.toBeNull();
  });
});

live('backup, restore and clear (Phase 5)', () => {
  /**
   * THE ONLY INTEGRATION TEST THAT DESTROYS AND RESTORES.
   *
   * `clear_kitchen()` deletes EVERYTHING for the signed-in kitchen, not just the
   * INTEGRATION TEST rows. README.md already says not to point this suite at a
   * database holding real owner data; this test is the reason that warning has
   * teeth.
   *
   * It protects itself: it exports first, and restores that export at the end, so
   * a kitchen that did hold data gets it back. But a failure between the two would
   * still leave it cleared, so the warning stands rather than being softened.
   */
  it('exports, clears and restores without losing anything', async () => {
    const supplierName = 'INTEGRATION TEST supplier';
    const created = await db
      .from('suppliers')
      .insert({ kitchen_id: kitchenId, name: supplierName })
      .select('id')
      .single();
    expect(created.error).toBeNull();

    /**
     * EVERY exported table, from the app's own list — not a hand-picked subset.
     *
     * The first version of this test read five tables, cleared all nineteen, and
     * restored five. It passed for as long as nothing in the kitchen referenced
     * the missing fourteen, then failed on `jobs_property_id_fkey` the moment a
     * job had a property: properties were cleared and never restored.
     *
     * Worse than the failure: while it passed, it was DESTROYING the other
     * fourteen tables on every run — properties, rates, templates, stock, the
     * tick tables — and reporting success. Driving it from EXPORTED_TABLES means
     * the test cannot drift from what the app actually backs up.
     */
    const before: Record<string, unknown[]> = {};
    for (const table of EXPORTED_TABLES) {
      const read = await db.from(table).select('*');
      expect(read.error, `could not read ${table}`).toBeNull();
      before[table] = read.data ?? [];
    }

    expect((before['suppliers'] ?? []).some((r) => (r as { name: string }).name === supplierName)).toBe(true);

    const cleared = await db.rpc('clear_kitchen');
    expect(cleared.error, 'clear_kitchen should be callable by the owner').toBeNull();

    const afterClear = await db.from('suppliers').select('id');
    expect(afterClear.data ?? []).toHaveLength(0);

    // Through the app's own path: `importable` strips job_changes, so the audit
    // trail is exported but never written back (Rule 10).
    const payload = importable(
      buildBackup('Copper Pot', before as Record<string, Row[]>, new Date().toISOString()),
    );

    const restored = await db.rpc('import_kitchen', { p_backup: payload });
    expect(restored.error, 'import_kitchen should accept its own export').toBeNull();

    const afterRestore = await db.from('suppliers').select('*');
    expect(
      (afterRestore.data ?? []).some((r) => (r as { name: string }).name === supplierName),
      'the supplier should have come back',
    ).toBe(true);

    // Every table restored to the count it went in at — job_changes excepted,
    // since it is deliberately not written back.
    for (const table of EXPORTED_TABLES) {
      if (table === 'job_changes') continue;
      const read = await db.from(table).select('id');
      expect((read.data ?? []).length, `${table} count changed across the round trip`).toBe(
        (before[table] ?? []).length,
      );
    }

    await db.from('suppliers').delete().eq('name', supplierName);
  }, 90_000);

  it('REFUSES a backup naming a table it does not know, before deleting anything', async () => {
    // The important refusal: validation happens before the clear, so a bad file
    // cannot empty the kitchen on its way to failing.
    const supplierName = 'INTEGRATION TEST survivor';
    await db.from('suppliers').insert({ kitchen_id: kitchenId, name: supplierName });

    const { error } = await db.rpc('import_kitchen', {
      p_backup: { invented_table: [{ id: 'x' }] },
    });

    // Asserting the REASON, not merely that something failed. "not null" alone
    // passes when the function does not exist at all — a vacuous green that would
    // report this guard as working before the migration had even been applied.
    expect(error, 'an unknown table should be refused').not.toBeNull();
    expect(
      error?.message ?? '',
      'must fail because of the unknown table, not because the function is missing',
    ).toContain('invented_table');

    // And the kitchen is untouched.
    const still = await db.from('suppliers').select('id').eq('name', supplierName);
    expect(still.data ?? [], 'the clear must not have run').toHaveLength(1);

    await db.from('suppliers').delete().eq('name', supplierName);
  });

  it('forces kitchen_id to the caller, ignoring what the file says', async () => {
    // An edited or foreign backup must not be able to redirect the write.
    const { error } = await db.rpc('import_kitchen', {
      p_backup: {
        suppliers: [
          {
            id: '00000000-0000-0000-0000-0000000000ff',
            kitchen_id: '00000000-0000-0000-0000-000000000000',
            name: 'INTEGRATION TEST forged',
          },
        ],
      },
    });
    expect(error).toBeNull();

    const written = await db.from('suppliers').select('*').eq('name', 'INTEGRATION TEST forged');
    expect(written.data ?? []).toHaveLength(1);
    expect((written.data?.[0] as { kitchen_id: string }).kitchen_id).toBe(kitchenId);

    await db.from('suppliers').delete().eq('name', 'INTEGRATION TEST forged');
  });
});

live('on-hand stock (Phase 4g)', () => {
  const makeIngredient = async (name: string): Promise<string> => {
    const { data, error } = await db
      .from('ingredients')
      .insert({ kitchen_id: kitchenId, name, stock_unit: 'kg', recipe_unit: 'kg' })
      .select('id')
      .single();
    if (error !== null) throw new Error(`could not create ingredient: ${error.message}`);
    return (data as { id: string }).id;
  };

  it('round-trips a figure, updates it, and CLEARS to absent rather than zero', async () => {
    const ingredientId = await makeIngredient('INTEGRATION TEST mince');

    const set = (qty: number) =>
      db.from('stock').upsert(
        { kitchen_id: kitchenId, ingredient_id: ingredientId, qty, unit: 'kg' },
        { onConflict: 'kitchen_id,ingredient_id' },
      );

    expect((await set(2.5)).error).toBeNull();

    let rows = await db.from('stock').select('*').eq('ingredient_id', ingredientId);
    expect(rows.data ?? []).toHaveLength(1);
    expect(Number((rows.data?.[0] as { qty: number }).qty)).toBe(2.5);

    // A recount UPDATES rather than duplicating.
    expect((await set(4)).error).toBeNull();
    rows = await db.from('stock').select('*').eq('ingredient_id', ingredientId);
    expect(rows.data ?? []).toHaveLength(1);
    expect(Number((rows.data?.[0] as { qty: number }).qty)).toBe(4);

    // Zero is a REAL figure — "I counted, there is none" — and stays a row.
    expect((await set(0)).error).toBeNull();
    rows = await db.from('stock').select('*').eq('ingredient_id', ingredientId);
    expect(rows.data ?? [], 'a counted zero must survive as a row').toHaveLength(1);

    // Clearing DELETES. "Not counted" is the absence of a row, not a zero.
    await db.from('stock').delete().eq('ingredient_id', ingredientId);
    rows = await db.from('stock').select('*').eq('ingredient_id', ingredientId);
    expect(rows.data ?? []).toHaveLength(0);

    await db.from('ingredients').delete().eq('id', ingredientId);
  }, 60_000);

  it('THE CLAIM: stock actually reduces the outstanding shopping line', async () => {
    // The whole point of the change. Everything below is read back OUT of the
    // database and run through the real engine, so it proves the path end to end
    // rather than proving the repository in isolation.
    const ingredientId = await makeIngredient('INTEGRATION TEST flour');

    const recipe = await db.rpc('save_recipe', {
      p_recipe: {
        id: null,
        name: 'INTEGRATION TEST bread',
        yield_type: 'per_person',
        confidence: 'locked',
      },
      // 1 kg per portion, so 4 portions needs 4 kg — round numbers keep the
      // assertion about stock rather than about rounding.
      p_components: [
        {
          ingredient_id: ingredientId,
          sub_recipe_id: null,
          display_name: 'flour',
          qty: 1,
          unit: 'kg',
          position: 0,
        },
      ],
      p_unquantified: [],
    });
    expect(recipe.error).toBeNull();
    const recipeId = recipe.data as string;

    const job = await db.rpc('save_job', {
      p_job: {
        id: null,
        service_type: 'INTEGRATION TEST',
        service_date: '2026-08-20',
        guests: 4,
        status: 'confirmed',
      },
      p_dishes: [{ recipe_id: recipeId, portions: 4, note: null, position: 0 }],
      p_dietaries: [],
      p_extras: [],
    });
    expect(job.error).toBeNull();
    const jobId = job.data as string;

    // Read everything back through the repositories and run the real cascade.
    const port = readOnlyPort();
    const outstandingFor = async (): Promise<number | undefined> => {
      const jobs = (await jobRepository(port).list()).filter((j) => j.id === jobId);
      const recipes = await recipeRepository(port).list();
      const ingredients = await ingredientRepository(port).list();
      const stock = await stockRepository(port).list();

      const requirements = requirementsForRange(jobs, recipes, ingredients);
      const lines = outstandingShopping(requirements.lines, stock, [], ingredients);

      return lines.find((l) => l.ingredientId === ingredientId)?.outstanding.value;
    };

    // No stock: the full 4 kg is outstanding.
    expect(await outstandingFor(), 'with no stock the whole amount is outstanding').toBe(4);

    // 3 kg on the shelf: 1 kg outstanding.
    await db.from('stock').upsert(
      { kitchen_id: kitchenId, ingredient_id: ingredientId, qty: 3, unit: 'kg' },
      { onConflict: 'kitchen_id,ingredient_id' },
    );
    expect(await outstandingFor(), '4 required − 3 on hand should leave 1').toBe(1);

    // Fully stocked: nothing outstanding, and the line drops off the list.
    await db.from('stock').upsert(
      { kitchen_id: kitchenId, ingredient_id: ingredientId, qty: 4, unit: 'kg' },
      { onConflict: 'kitchen_id,ingredient_id' },
    );
    expect(await outstandingFor(), 'a fully stocked item needs nothing bought').toBe(0);

    await db.from('jobs').delete().eq('id', jobId);
    await db.from('stock').delete().eq('ingredient_id', ingredientId);
    await db.from('recipes').delete().eq('id', recipeId);
    await db.from('ingredients').delete().eq('id', ingredientId);
  }, 90_000);
});

live('the audit trail cannot be tampered with from the app', () => {
  it('a direct update outside any repository is STILL logged', async () => {
    // The point of using a trigger rather than repository code: this write does not
    // go near src/data, and it is logged anyway.
    const jobId = await makeJob({ guests: 15 });
    await db.from('jobs').update({ notes: 'written outside the repository' }).eq('id', jobId);

    expect((await changesFor(jobId)).map((c) => c['field'])).toContain('notes');
  });
});

describe('integration suite wiring', () => {
  it('reports whether it ran', () => {
    if (!configured) {
      // eslint-disable-next-line no-console
      console.info(
        'integration tests SKIPPED — set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, ' +
          'CPK_TEST_EMAIL and CPK_TEST_PASSWORD to run them',
      );
    }
    expect(true).toBe(true);
  });
});
