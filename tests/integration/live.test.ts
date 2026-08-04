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
});

/**
 * Clean up by PATTERN, not by tracked ids.
 *
 * Three reasons, all learned the hard way on the first green run:
 *
 *   - One request, not one per job. Twelve sequential deletes at ~700ms each ran
 *     past vitest's 10s hook timeout and stopped partway, leaving rows behind.
 *   - Self-healing. A pattern delete also clears anything a previously failed run
 *     abandoned, so leftovers never accumulate.
 *   - Order. Jobs MUST go before recipes: `job_dishes.recipe_id` is
 *     `on delete restrict`, so a recipe with a dish still pointing at it refuses
 *     to delete. Deleting jobs first cascades those dishes away.
 *
 * Errors are surfaced rather than swallowed. A silent cleanup failure leaves data
 * in the owner's database and reports success, which is the worst combination.
 */
async function cleanUp(): Promise<void> {
  const jobs = await db.from('jobs').delete().eq('service_type', 'INTEGRATION TEST');
  if (jobs.error !== null) throw new Error(`cleanup failed on jobs: ${jobs.error.message}`);

  await db.from('customers').delete().like('name', 'INTEGRATION TEST%');
  await db.from('ingredients').delete().like('name', 'INTEGRATION TEST%');
  await db.from('client_rates').delete().eq('client_group', 'INTEGRATION TEST');
  await db.from('service_templates').delete().eq('service_type', 'INTEGRATION TEST');

  const recipes = await db.from('recipes').delete().like('name', 'INTEGRATION TEST%');
  if (recipes.error !== null) {
    throw new Error(`cleanup failed on recipes: ${recipes.error.message}`);
  }

  // Prove it, rather than assume it.
  const left = await db.from('jobs').select('id').eq('service_type', 'INTEGRATION TEST');
  if ((left.data ?? []).length > 0) {
    throw new Error(`cleanup left ${(left.data ?? []).length} job(s) behind`);
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
    expect((components.data?.[0] as { qty: string }).qty).toBe('2.0000');

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
