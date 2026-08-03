/**
 * The narrow port every repository talks to.
 *
 * Repositories depend on this, never on `@supabase/supabase-js`. Two reasons, and
 * the second is the important one:
 *
 *   1. Repository logic can then be tested in CI against a fake that records the
 *      calls it receives, with no database.
 *   2. It keeps the Supabase client confined to `supabaseDb.ts` and `client.ts`.
 *      A component cannot quietly acquire a client and write around the
 *      repositories — and therefore around the audit trail.
 *
 * NOTHING HERE TAKES A kitchen_id. Scoping is RLS's job, resolved through
 * `my_kitchen_id()`. A hand-written filter would be a second copy of the policy,
 * free to drift from it, and it would mask a misconfigured policy rather than
 * expose one.
 */

export type Row = Record<string, unknown>;

export class DbError extends Error {
  readonly table: string;
  readonly operation: string;

  constructor(table: string, operation: string, message: string) {
    super(`${operation} on ${table} failed: ${message}`);
    this.name = 'DbError';
    this.table = table;
    this.operation = operation;
  }
}

export interface Db {
  /** Every row the caller may see. RLS decides what that is. */
  selectAll(table: string): Promise<Row[]>;

  /** Rows where `column` equals `value`. Used for parent/child joins, never for scoping. */
  selectWhere(table: string, column: string, value: string): Promise<Row[]>;

  selectWhereIn(table: string, column: string, values: readonly string[]): Promise<Row[]>;

  insert(table: string, rows: readonly Row[]): Promise<Row[]>;

  update(table: string, id: string, patch: Row): Promise<Row[]>;

  deleteWhere(table: string, column: string, value: string): Promise<void>;
}
