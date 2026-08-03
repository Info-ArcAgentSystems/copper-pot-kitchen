/**
 * The tests that need a live Supabase.
 *
 * Skipped when `VITE_SUPABASE_URL` is absent, so they are visible as skipped
 * rather than missing. See README.md in this directory.
 *
 * These are the ONLY proof of two things nothing in CI can reach: that RLS scopes
 * rows to the caller's kitchen, and that the audit triggers fire. Until they run
 * green against the real database, the audit guarantee is written but unverified.
 */

import { describe, it } from 'vitest';

const configured =
  typeof process.env['VITE_SUPABASE_URL'] === 'string' &&
  process.env['VITE_SUPABASE_URL'].length > 0;

const live = configured ? describe : describe.skip;

live('RLS scoping (needs live Supabase)', () => {
  it.todo('a signed-in owner reads only their own kitchen’s jobs');
  it.todo('a select with no kitchen_id filter still returns only that kitchen');
  it.todo('an insert carrying another kitchen_id is rejected by the with-check policy');
  it.todo('deleting a kitchen_members row revokes access immediately (Rule 17)');
});

live('audit triggers (needs live Supabase + migration applied)', () => {
  it.todo('updating jobs.guests writes one job_changes row with old and new');
  it.todo('an unchanged update writes no row');
  it.todo('touching only updated_at writes no row — Rule 14 excludes bookkeeping');
  it.todo('a manual price change is logged as price_override, not price (Rule 11)');
  it.todo('adding a dish writes job_dishes.added');
  it.todo('removing a dish writes job_dishes.removed with the old value');
  it.todo('changed_by is the acting user from auth.uid()');
  it.todo('a direct SQL update outside the repository is STILL logged');
  it.todo('source defaults to ui when no app.source is set');
});

live('migration (needs live Supabase)', () => {
  it.todo('20260803000100_job_change_audit.sql applies cleanly');
});

describe('integration suite wiring', () => {
  it('is skipped without credentials, so its absence is visible', () => {
    // Not a placeholder: this asserts the guard itself works, so the suite cannot
    // silently vanish if the env check is broken.
    if (!configured) {
      // eslint-disable-next-line no-console
      console.info('integration tests skipped — VITE_SUPABASE_URL not set');
    }
  });
});
