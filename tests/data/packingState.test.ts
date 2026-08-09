/**
 * The only write the packing screen makes.
 *
 * Third of three tick tables, and the same load-bearing assertion each time: the
 * conflict target must match the unique constraint exactly, or a second tap
 * inserts a duplicate instead of updating.
 */

import { describe, expect, it } from 'vitest';
import { packingStateRepository } from '../../src/data/repositories';
import { fakeDb } from './fakeDb';
import type { JobId, KitchenId } from '../../src/engine/types';

const KITCHEN = 'k1' as KitchenId;
const JOB = 'j1' as JobId;
const KEY = 'food:lasagne';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  kitchen_id: KITCHEN,
  job_id: JOB,
  item: KEY,
  done: true,
  ...over,
});

describe('setDone', () => {
  it('upserts rather than inserting', async () => {
    const db = fakeDb();
    await packingStateRepository(db).setDone(KITCHEN, JOB, KEY, true);

    expect(db.calls.filter((c) => c.op === 'upsert')).toHaveLength(1);
    expect(db.calls.some((c) => c.op === 'insert')).toBe(false);
  });

  it('THE ONE THAT MATTERS: the conflict target is the full unique key', async () => {
    const db = fakeDb();
    await packingStateRepository(db).setDone(KITCHEN, JOB, KEY, true);

    expect(db.calls[0]?.value).toBe('kitchen_id,job_id,item');
  });

  it('stores the namespaced KEY, not a label', async () => {
    // The whole point of the key: a bare label would collide a recipe and an
    // equipment item sharing a name into one tick.
    const db = fakeDb();
    await packingStateRepository(db).setDone(KITCHEN, JOB, 'equipment:t1', true);

    const [written] = db.calls[0]?.payload as Record<string, unknown>[];
    expect(written?.['item']).toBe('equipment:t1');
  });

  it('scopes the tick to one job', async () => {
    const db = fakeDb();
    await packingStateRepository(db).setDone(KITCHEN, JOB, KEY, true);

    const [written] = db.calls[0]?.payload as Record<string, unknown>[];
    expect(written?.['job_id']).toBe(JOB);
  });

  it('writes kitchen_id, because the with-check policy requires it', async () => {
    const db = fakeDb();
    await packingStateRepository(db).setDone(KITCHEN, JOB, KEY, false);

    const [written] = db.calls[0]?.payload as Record<string, unknown>[];
    expect(written?.['kitchen_id']).toBe(KITCHEN);
  });

  it('RULE 6: persists no portions, no label, no quantity — only the key', async () => {
    const db = fakeDb();
    await packingStateRepository(db).setDone(KITCHEN, JOB, KEY, true);

    const [written] = db.calls[0]?.payload as Record<string, unknown>[];
    for (const forbidden of ['portions', 'label', 'quantity', 'recipe_name', 'guests']) {
      expect(written, `a computed value "${forbidden}" was persisted`).not.toHaveProperty(forbidden);
    }
  });

  it('unticking is written as false rather than deleted', async () => {
    const db = fakeDb();
    await packingStateRepository(db).setDone(KITCHEN, JOB, KEY, false);

    const [written] = db.calls[0]?.payload as Record<string, unknown>[];
    expect(written?.['done']).toBe(false);
    expect(db.calls.some((c) => c.op === 'delete')).toBe(false);
  });
});

describe('forJobs', () => {
  it('reads every job’s ticks in ONE query, not one per job', async () => {
    const db = fakeDb({ packing_state: [row(), row({ id: 'p2', job_id: 'j2' })] });

    await packingStateRepository(db).forJobs([JOB, 'j2' as JobId]);

    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]?.op).toBe('selectWhereIn');
  });

  it('maps to the domain type, calling the column what it is', async () => {
    const db = fakeDb({ packing_state: [row()] });
    const [tick] = await packingStateRepository(db).forJobs([JOB]);

    expect(tick?.itemKey).toBe(KEY);
    expect(tick?.jobId).toBe(JOB);
    expect(tick?.done).toBe(true);
  });

  it('does not touch the database at all for an empty job list', async () => {
    // `in ()` with no values is a query that can only return nothing.
    const db = fakeDb({ packing_state: [row()] });

    expect(await packingStateRepository(db).forJobs([])).toEqual([]);
    expect(db.calls).toHaveLength(0);
  });

  it('does not filter by kitchen_id — RLS scopes the read', async () => {
    const db = fakeDb({ packing_state: [row()] });
    await packingStateRepository(db).forJobs([JOB]);

    for (const call of db.calls) {
      expect(call.column).not.toBe('kitchen_id');
    }
  });
});
