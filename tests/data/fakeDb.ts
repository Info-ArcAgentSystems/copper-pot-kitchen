/**
 * A `Db` that records every call and answers from fixed tables.
 *
 * Shared by the repository, crud and recipe-write tests. There were two copies
 * before `rpc` was added to the port and the compiler flagged both; a third was
 * about to appear, so it lives here now.
 *
 * What this can prove: the queries a repository issues, the payloads it sends,
 * and that no call names `kitchen_id` in a filter. What it cannot prove is that
 * RLS or a trigger behaves — those need `tests/integration/`.
 */

import type { Db, Row } from '../../src/data/db';

export interface Call {
  op: string;
  table: string;
  column?: string;
  value?: unknown;
  payload?: unknown;
}

export interface FakeDb extends Db {
  readonly calls: Call[];
}

export function fakeDb(
  tables: Record<string, Row[]> = {},
  rpcResult: unknown = null,
): FakeDb {
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
      return newRows.map((r) => ({ id: 'generated', ...r }));
    },
    async upsert(table, newRows, onConflict) {
      // `onConflict` goes in `value`, not `column`: the no-kitchen_id guard reads
      // `column` as "a filter this call scopes by", and a conflict target is not
      // that. `purchase_state`'s target legitimately NAMES kitchen_id.
      calls.push({ op: 'upsert', table, value: onConflict, payload: newRows });
      return newRows as Row[];
    },
    async update(table, id, patch) {
      calls.push({ op: 'update', table, value: id, payload: patch });
      return [{ id, ...patch }];
    },
    async deleteWhere(table, column, value) {
      calls.push({ op: 'delete', table, column, value });
    },
    async rpc(fn, args) {
      calls.push({ op: 'rpc', table: fn, payload: args });
      return rpcResult;
    },
  };
}
