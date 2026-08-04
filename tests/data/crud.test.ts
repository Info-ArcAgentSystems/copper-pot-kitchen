/**
 * The shared CRUD factory.
 *
 * Runs against the same fake `Db` the repository tests use — no database.
 *
 * The two behaviours worth pinning: `create` must WRITE kitchen_id (the RLS
 * with-check policy rejects a row that names another kitchen, as the integration
 * suite proves), while nothing may FILTER by it (reads are scoped by
 * `my_kitchen_id()`, and a hand-written filter would be a second definition free
 * to drift). Those look similar and are opposites.
 */

import { describe, expect, it } from 'vitest';
import { countReferences, crudRepository } from '../../src/data/crud';
import type { Db, Row } from '../../src/data/db';
import { fakeDb, type FakeDb } from './fakeDb';
import { serviceTemplateToDomain, serviceTemplateToRow } from '../../src/data/mappers';
import type { ServiceTemplateRow } from '../../src/data/rows';
import type { KitchenId, ServiceTemplate } from '../../src/engine/types';

const KITCHEN = 'k1' as KitchenId;

const templateRow: Row = {
  id: 't1',
  kitchen_id: KITCHEN,
  service_type: 'BBQ',
  item: 'tongs',
  kind: 'equipment',
  position: 0,
};

/**
 * The row an insert actually sent.
 *
 * Asserts the call happened rather than indexing into a possible undefined — a
 * missing insert should fail saying so, not with a TypeError from `[0]`.
 */
function insertedRow(db: FakeDb): Row {
  const call = db.calls.find((c) => c.op === 'insert');
  expect(call, 'no insert was issued').toBeDefined();

  const rows = call?.payload as Row[];
  expect(rows, 'insert carried no rows').toHaveLength(1);
  return rows[0] as Row;
}

const repo = (db: Db) =>
  crudRepository<ServiceTemplate, ServiceTemplateRow>(
    db,
    'service_templates',
    serviceTemplateToDomain,
    serviceTemplateToRow,
  );

const template: ServiceTemplate = {
  id: 't1' as ServiceTemplate['id'],
  kitchenId: KITCHEN,
  serviceType: 'BBQ',
  item: 'tongs',
  kind: 'equipment',
  position: 0,
};

describe('list', () => {
  it('returns domain types, not rows', async () => {
    const [item] = await repo(fakeDb({ service_templates: [templateRow] })).list();

    expect(item?.serviceType).toBe('BBQ');
    expect(item).not.toHaveProperty('service_type');
  });

  it('is empty for an empty table — Rule 1, nothing is seeded', async () => {
    expect(await repo(fakeDb()).list()).toEqual([]);
  });
});

describe('create', () => {
  it('WRITES kitchen_id, because the with-check policy requires it', async () => {
    const db = fakeDb();
    await repo(db).create(template);

    expect(insertedRow(db)['kitchen_id']).toBe(KITCHEN);
  });

  it('lets the database mint the id rather than sending a placeholder', async () => {
    // An empty or invented id either fails the primary key or, worse, collides.
    const db = fakeDb();
    await repo(db).create({ ...template, id: '' as ServiceTemplate['id'] });

    expect(insertedRow(db)).not.toHaveProperty('id');
  });

  it('returns the created record as a domain type', async () => {
    const created = await repo(fakeDb()).create(template);
    expect(created?.item).toBe('tongs');
  });
});

describe('update', () => {
  it('patches neither the id nor the kitchen', async () => {
    // Moving a record between kitchens is not an edit.
    const db = fakeDb({ service_templates: [templateRow] });
    await repo(db).update('t1', { ...template, item: 'long tongs' });

    const patch = db.calls.find((c) => c.op === 'update')?.payload as Row;
    expect(patch['item']).toBe('long tongs');
    expect(patch).not.toHaveProperty('id');
    expect(patch).not.toHaveProperty('kitchen_id');
  });

  it('targets the row by id', async () => {
    const db = fakeDb({ service_templates: [templateRow] });
    await repo(db).update('t1', template);

    expect(db.calls.find((c) => c.op === 'update')?.value).toBe('t1');
  });
});

describe('remove', () => {
  it('deletes by id', async () => {
    const db = fakeDb({ service_templates: [templateRow] });
    await repo(db).remove('t1');

    const call = db.calls.find((c) => c.op === 'delete');
    expect(call?.column).toBe('id');
    expect(call?.value).toBe('t1');
  });
});

describe('scoping', () => {
  it('never FILTERS by kitchen_id, in any operation', async () => {
    // RLS scopes reads. A hand-written filter would be a second copy of the
    // policy, and would hide a broken one.
    const db = fakeDb({ service_templates: [templateRow] });
    const r = repo(db);

    await r.list();
    await r.create(template);
    await r.update('t1', template);
    await r.remove('t1');

    for (const call of db.calls) {
      expect(call.column, `${call.op} filtered by kitchen_id`).not.toBe('kitchen_id');
    }
  });
});

describe('countReferences', () => {
  it('counts rows pointing at an id', async () => {
    const db = fakeDb({
      jobs: [
        { id: 'j1', customer_id: 'c1' },
        { id: 'j2', customer_id: 'c1' },
        { id: 'j3', customer_id: 'c2' },
      ],
    });

    expect(await countReferences(db, 'jobs', 'customer_id', 'c1')).toBe(2);
    expect(await countReferences(db, 'jobs', 'customer_id', 'c9')).toBe(0);
  });
});
