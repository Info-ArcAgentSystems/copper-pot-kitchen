/**
 * One CRUD factory for the shallow setup tables.
 *
 * Customers, properties, suppliers, rates and service templates all read, write
 * and delete identically. Five hand-written copies of the same four methods is
 * five places to fix a bug and four places to forget.
 *
 * Jobs and recipes are NOT built on this — their aggregates span several tables
 * and jobs carries audit semantics, so they stay hand-written where the
 * differences are visible.
 *
 * ON kitchen_id
 * `create` WRITES it, because the RLS with-check policy requires the row to name
 * the caller's kitchen — the integration suite proves an insert carrying any
 * other kitchen is rejected. That is not the same as FILTERING by it, which no
 * repository does and which `tests/data/purity.test.ts` forbids: reads are scoped
 * by `my_kitchen_id()` and duplicating that in application code would create a
 * second definition free to drift.
 */

import type { Db, Row } from './db';

export interface CrudRepository<TDomain> {
  list(): Promise<TDomain[]>;
  create(value: Omit<TDomain, 'id'> & { id?: string }): Promise<TDomain | null>;
  update(id: string, value: TDomain): Promise<TDomain | null>;
  remove(id: string): Promise<void>;
}

export function crudRepository<TDomain, TRow extends Row>(
  db: Db,
  table: string,
  toDomain: (row: TRow) => TDomain,
  toRow: (value: TDomain) => TRow,
): CrudRepository<TDomain> {
  const first = (rows: Row[]): TDomain | null =>
    rows.length === 0 ? null : toDomain(rows[0] as TRow);

  return {
    async list() {
      return ((await db.selectAll(table)) as TRow[]).map(toDomain);
    },

    async create(value) {
      const row = toRow(value as TDomain);
      // Let Postgres mint the id rather than sending a placeholder. A blank or
      // invented id would either fail the primary key or, worse, collide.
      const { id: _ignored, ...withoutId } = row;
      return first(await db.insert(table, [withoutId as Row]));
    },

    async update(id, value) {
      const row = toRow(value);
      // Neither the identity of the row nor the kitchen it belongs to is
      // patchable. Moving a record between kitchens is not an edit.
      const { id: _id, kitchen_id: _kitchenId, ...mutable } = row;
      return first(await db.update(table, id, mutable as Row));
    },

    async remove(id) {
      await db.deleteWhere(table, 'id', id);
    },
  };
}

/**
 * How many rows in `table` point at `id` through `column`.
 *
 * Used before a destructive action. Deleting a customer, property or supplier is
 * `on delete set null` in the schema, so anything referring to it silently loses
 * the reference — a job that loses its customer has no client group, and under
 * Rule 11 its revenue becomes null.
 *
 * The confirmation names that consequence instead of asking the owner to guess,
 * so counting has to happen before the delete, not after.
 */
export async function countReferences(
  db: Db,
  table: string,
  column: string,
  id: string,
): Promise<number> {
  return (await db.selectWhere(table, column, id)).length;
}
