/**
 * The only write the shopping screen makes.
 *
 * Rule 6: the list is derived and never stored. What persists is the owner's tick,
 * and this pins the shape of it against the fake `Db`.
 *
 * The conflict target is the load-bearing assertion. `purchase_state` is unique on
 * (kitchen_id, ingredient_id, window_from, window_to); naming fewer columns would
 * INSERT a second row instead of updating the first, and the duplicate would then
 * be subtracted twice from the outstanding figure — an under-buy that looks like a
 * correct list.
 */

import { describe, expect, it } from 'vitest';
import { purchaseStateRepository } from '../../src/data/repositories';
import { fakeDb } from './fakeDb';
import type { IngredientId, IsoDate, KitchenId, StockUnit } from '../../src/engine/types';

const KITCHEN = 'k1' as KitchenId;
const MINCE = 'mince' as IngredientId;
const FROM = '2026-08-10' as IsoDate;
const TO = '2026-08-17' as IsoDate;
const kg = 'kg' as StockUnit;

const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  kitchen_id: KITCHEN,
  ingredient_id: MINCE,
  window_from: FROM,
  window_to: TO,
  qty_bought: 2,
  unit: 'kg',
  done: false,
  updated_at: '2026-08-08T10:00:00Z',
  ...over,
});

describe('setBought', () => {
  it('upserts rather than inserting, so a second tap updates', async () => {
    const db = fakeDb();
    await purchaseStateRepository(db).setBought(KITCHEN, MINCE, FROM, TO, {
      qtyBought: 2,
      unit: kg,
      done: true,
    });

    expect(db.calls.filter((c) => c.op === 'upsert')).toHaveLength(1);
    expect(db.calls.some((c) => c.op === 'insert')).toBe(false);
  });

  it('THE ONE THAT MATTERS: the conflict target is the full unique key', async () => {
    // Drop any column from this and the upsert stops matching the constraint, so
    // it inserts a duplicate. Two rows for one ingredient in one window are then
    // both subtracted, and the list quietly under-buys.
    const db = fakeDb();
    await purchaseStateRepository(db).setBought(KITCHEN, MINCE, FROM, TO, {
      qtyBought: 2,
      unit: kg,
      done: false,
    });

    expect(db.calls[0]?.value).toBe('kitchen_id,ingredient_id,window_from,window_to');
  });

  it('writes the window onto the row — the tick belongs to these dates', async () => {
    const db = fakeDb();
    await purchaseStateRepository(db).setBought(KITCHEN, MINCE, FROM, TO, {
      qtyBought: 2,
      unit: kg,
      done: false,
    });

    const [written] = db.calls[0]?.payload as Record<string, unknown>[];
    expect(written?.['window_from']).toBe(FROM);
    expect(written?.['window_to']).toBe(TO);
  });

  it('writes kitchen_id, because the with-check policy requires it', async () => {
    // Writing it is not the same as FILTERING by it. Reads are scoped by RLS.
    const db = fakeDb();
    await purchaseStateRepository(db).setBought(KITCHEN, MINCE, FROM, TO, {
      qtyBought: 0,
      unit: kg,
      done: true,
    });

    const [written] = db.calls[0]?.payload as Record<string, unknown>[];
    expect(written?.['kitchen_id']).toBe(KITCHEN);
  });

  it('RULE 6: stores nothing about the LIST — no name, quantity, pack or supplier', async () => {
    // The whole rule in one assertion. The moment a computed figure is written
    // here, there is a stored list that can go stale, and the cascade stops being
    // automatic.
    const db = fakeDb();
    await purchaseStateRepository(db).setBought(KITCHEN, MINCE, FROM, TO, {
      qtyBought: 2,
      unit: kg,
      done: true,
    });

    const [written] = db.calls[0]?.payload as Record<string, unknown>[];
    for (const forbidden of ['name', 'required', 'outstanding', 'packs', 'supplier_id', 'on_hand']) {
      expect(written, `a computed value "${forbidden}" was persisted`).not.toHaveProperty(forbidden);
    }
  });

  it('records 0 bought as a real value, not as unknown', async () => {
    // Unticking back to zero is a statement: "I have not bought this". The column
    // is `not null default 0`, and 0 here is not the Rule 8 unknown.
    const db = fakeDb();
    await purchaseStateRepository(db).setBought(KITCHEN, MINCE, FROM, TO, {
      qtyBought: 0,
      unit: kg,
      done: false,
    });

    const [written] = db.calls[0]?.payload as Record<string, unknown>[];
    expect(written?.['qty_bought']).toBe(0);
  });
});

describe('forWindow', () => {
  it('returns only the ticks for that exact window', async () => {
    // A tick for a different window is a different fact, not a stale version of
    // this one. "Bought 2 kg for this weekend" is not "bought 2 kg for next".
    const db = fakeDb({
      purchase_state: [row(), row({ id: 'p2', window_to: '2026-08-24' })],
    });

    const ticks = await purchaseStateRepository(db).forWindow(FROM, TO);

    expect(ticks).toHaveLength(1);
    expect(ticks[0]?.id).toBe('p1');
  });

  it('maps to the domain type with the quantity in its unit', async () => {
    const db = fakeDb({ purchase_state: [row({ qty_bought: 2.5 })] });
    const [tick] = await purchaseStateRepository(db).forWindow(FROM, TO);

    expect(tick?.qtyBought.value).toBe(2.5);
    expect(tick?.qtyBought.unit).toBe('kg');
    expect(tick?.done).toBe(false);
  });

  it('does not filter by kitchen_id — RLS scopes the read', async () => {
    const db = fakeDb({ purchase_state: [row()] });
    await purchaseStateRepository(db).forWindow(FROM, TO);

    for (const call of db.calls) {
      expect(call.column).not.toBe('kitchen_id');
    }
  });

  it('returns nothing rather than throwing when the window has no ticks', async () => {
    const db = fakeDb({ purchase_state: [] });
    expect(await purchaseStateRepository(db).forWindow(FROM, TO)).toEqual([]);
  });
});
