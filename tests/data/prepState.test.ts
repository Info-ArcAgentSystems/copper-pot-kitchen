/**
 * The only write the prep screen makes.
 *
 * Same shape as `purchaseState.test.ts`, and the same load-bearing assertion: the
 * conflict target must match the unique constraint exactly, or a second tap
 * inserts a duplicate instead of updating and the line shows two ticks that
 * disagree.
 */

import { describe, expect, it } from 'vitest';
import { prepStateRepository } from '../../src/data/repositories';
import { fakeDb } from './fakeDb';
import type { IsoDate, KitchenId, RecipeId } from '../../src/engine/types';

const KITCHEN = 'k1' as KitchenId;
const LASAGNE = 'lasagne' as RecipeId;
const DAY = '2026-08-17' as IsoDate;

const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  kitchen_id: KITCHEN,
  recipe_id: LASAGNE,
  prep_date: DAY,
  done: true,
  updated_at: '2026-08-08T10:00:00Z',
  ...over,
});

describe('setDone', () => {
  it('upserts rather than inserting', async () => {
    const db = fakeDb();
    await prepStateRepository(db).setDone(KITCHEN, LASAGNE, DAY, true);

    expect(db.calls.filter((c) => c.op === 'upsert')).toHaveLength(1);
    expect(db.calls.some((c) => c.op === 'insert')).toBe(false);
  });

  it('THE ONE THAT MATTERS: the conflict target is the full unique key', async () => {
    const db = fakeDb();
    await prepStateRepository(db).setDone(KITCHEN, LASAGNE, DAY, true);

    expect(db.calls[0]?.value).toBe('kitchen_id,recipe_id,prep_date');
  });

  it('has NO window in the key, unlike purchase_state', async () => {
    // A prep tick belongs to a recipe on a day. Moving the screen's date range
    // does not change which ticks apply, where in Shopping it does.
    const db = fakeDb();
    await prepStateRepository(db).setDone(KITCHEN, LASAGNE, DAY, true);

    const target = db.calls[0]?.value as string;
    expect(target).not.toContain('window');
  });

  it('writes the prep date onto the row', async () => {
    const db = fakeDb();
    await prepStateRepository(db).setDone(KITCHEN, LASAGNE, DAY, true);

    const [written] = db.calls[0]?.payload as Record<string, unknown>[];
    expect(written?.['prep_date']).toBe(DAY);
    expect(written?.['recipe_id']).toBe(LASAGNE);
  });

  it('writes kitchen_id, because the with-check policy requires it', async () => {
    const db = fakeDb();
    await prepStateRepository(db).setDone(KITCHEN, LASAGNE, DAY, false);

    const [written] = db.calls[0]?.payload as Record<string, unknown>[];
    expect(written?.['kitchen_id']).toBe(KITCHEN);
  });

  it('RULE 6: persists NO computed figure — no batches, portions or surplus', async () => {
    // The whole rule in one assertion. A batch count written here is a stored plan
    // that can disagree with the jobs it came from.
    const db = fakeDb();
    await prepStateRepository(db).setDone(KITCHEN, LASAGNE, DAY, true);

    const [written] = db.calls[0]?.payload as Record<string, unknown>[];
    for (const forbidden of ['batches', 'portions', 'surplus', 'capacity', 'allocations', 'job_id']) {
      expect(written, `a computed value "${forbidden}" was persisted`).not.toHaveProperty(forbidden);
    }
  });

  it('unticking is a real state, written as false rather than deleted', async () => {
    const db = fakeDb();
    await prepStateRepository(db).setDone(KITCHEN, LASAGNE, DAY, false);

    const [written] = db.calls[0]?.payload as Record<string, unknown>[];
    expect(written?.['done']).toBe(false);
    expect(db.calls.some((c) => c.op === 'delete')).toBe(false);
  });
});

describe('forRange', () => {
  it('returns ticks whose prep date falls inside the range, inclusive', async () => {
    const db = fakeDb({
      prep_state: [
        row({ id: 'a', prep_date: '2026-08-16' }),
        row({ id: 'b', prep_date: '2026-08-17' }),
        row({ id: 'c', prep_date: '2026-08-20' }),
        row({ id: 'd', prep_date: '2026-08-21' }),
      ],
    });

    const ticks = await prepStateRepository(db).forRange(
      '2026-08-17' as IsoDate,
      '2026-08-20' as IsoDate,
    );

    expect(ticks.map((t) => t.id)).toEqual(['b', 'c']);
  });

  it('maps to the domain type', async () => {
    const db = fakeDb({ prep_state: [row()] });
    const [tick] = await prepStateRepository(db).forRange(DAY, DAY);

    expect(tick?.recipeId).toBe(LASAGNE);
    expect(tick?.prepDate).toBe(DAY);
    expect(tick?.done).toBe(true);
  });

  it('does not filter by kitchen_id — RLS scopes the read', async () => {
    const db = fakeDb({ prep_state: [row()] });
    await prepStateRepository(db).forRange(DAY, DAY);

    for (const call of db.calls) {
      expect(call.column).not.toBe('kitchen_id');
    }
  });

  it('returns nothing rather than throwing for an empty range', async () => {
    const db = fakeDb({ prep_state: [] });
    expect(await prepStateRepository(db).forRange(DAY, DAY)).toEqual([]);
  });
});
