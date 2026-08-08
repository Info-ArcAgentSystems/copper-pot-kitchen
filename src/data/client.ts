/**
 * The Supabase client, and the adapter that turns it into the `Db` port.
 *
 * THIS IS THE ONLY FILE IN THE REPO THAT MAY IMPORT `@supabase/supabase-js`.
 * `tests/data/purity.test.ts` enforces that. Everything else goes through `Db`,
 * which is what keeps every write to a job on the audited path.
 *
 * No query here filters by `kitchen_id`. RLS resolves scope through
 * `my_kitchen_id()`; duplicating that in application code would create a second
 * definition free to drift, and would hide a broken policy instead of revealing it.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DbError, type Db, type Row } from './db';

export class MissingSupabaseConfigError extends Error {
  constructor(missing: readonly string[]) {
    super(
      `Supabase is not configured. Missing: ${missing.join(', ')}. ` +
        'Copy .env.example to .env.local and fill it in from the Supabase dashboard.',
    );
    this.name = 'MissingSupabaseConfigError';
  }
}

let cached: SupabaseClient | null = null;

/**
 * Fails loudly and by name when the environment is not configured, rather than
 * constructing a client that dies later with something unreadable.
 */
export function supabaseClient(): SupabaseClient {
  if (cached !== null) return cached;

  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const missing: string[] = [];
  if (!url) missing.push('VITE_SUPABASE_URL');
  if (!key) missing.push('VITE_SUPABASE_ANON_KEY');
  if (missing.length > 0) throw new MissingSupabaseConfigError(missing);

  cached = createClient(url, key);
  return cached;
}

/** Adapts a Supabase client to the `Db` port the repositories depend on. */
export function supabaseDb(client: SupabaseClient = supabaseClient()): Db {
  const rows = (
    table: string,
    operation: string,
    result: { data: unknown; error: { message: string } | null },
  ): Row[] => {
    if (result.error !== null) throw new DbError(table, operation, result.error.message);
    return (result.data ?? []) as Row[];
  };

  return {
    async selectAll(table) {
      return rows(table, 'select', await client.from(table).select('*'));
    },

    async selectWhere(table, column, value) {
      return rows(table, 'select', await client.from(table).select('*').eq(column, value));
    },

    async selectWhereIn(table, column, values) {
      if (values.length === 0) return [];
      return rows(table, 'select', await client.from(table).select('*').in(column, values));
    },

    async insert(table, newRows) {
      if (newRows.length === 0) return [];
      return rows(table, 'insert', await client.from(table).insert(newRows).select('*'));
    },

    async upsert(table, newRows, onConflict) {
      if (newRows.length === 0) return [];
      return rows(
        table,
        'upsert',
        await client.from(table).upsert(newRows, { onConflict }).select('*'),
      );
    },

    async update(table, id, patch) {
      return rows(
        table,
        'update',
        await client.from(table).update(patch).eq('id', id).select('*'),
      );
    },

    async deleteWhere(table, column, value) {
      const result = await client.from(table).delete().eq(column, value);
      if (result.error !== null) throw new DbError(table, 'delete', result.error.message);
    },

    async rpc(fn, args) {
      const result = await client.rpc(fn, args);
      if (result.error !== null) throw new DbError(fn, 'rpc', result.error.message);
      return result.data;
    },
  };
}
