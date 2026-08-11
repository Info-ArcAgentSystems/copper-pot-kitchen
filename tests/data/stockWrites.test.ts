/**
 * Writing on-hand stock.
 *
 * The middle term of `required − stock − purchased`. It had no writer at all
 * until now, so the subtraction ran against an empty set and the shopping list
 * ordered things already on the shelf.
 *
 * The load-bearing assertion is the Rule 8 one: blank DELETES the row rather than
 * writing 0. Both would make the list order the full amount, so getting it wrong
 * would be invisible in the shopping list — which is exactly why it needs a test
 * rather than a comment.
 */

import { describe, expect, it } from 'vitest';
import { stockRepository } from '../../src/data/repositories';
import { fakeDb } from './fakeDb';
import type { IngredientId, KitchenId, StockUnit } from '../../src/engine/types';

const KITCHEN = 'k1' as KitchenId;
const MINCE = 'mince' as IngredientId;
const kg = 'kg' as StockUnit;

const row = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  kitchen_id: KITCHEN,
  ingredient_id: MINCE,
  qty: 2.5,
  unit: 'kg',
  use_by: null,
  counted_at: '2026-08-09T10:00:00Z',
  ...over,
});

describe('setOnHand', () => {
  it('upserts rather than inserting, so a recount updates', async () => {
    const db = fakeDb();
    await stockRepository(db).setOnHand(KITCHEN, MINCE, 2.5, kg);

    expect(db.calls.filter((c) => c.op === 'upsert')).toHaveLength(1);
    expect(db.calls.some((c) => c.op === 'insert')).toBe(false);
  });

  it('THE CONFLICT TARGET is the full unique key', async () => {
    // Naming fewer columns inserts a duplicate instead of updating, and two stock
    // rows for one ingredient would both be subtracted — an under-order that
    // looks like a correct list.
    const db = fakeDb();
    await stockRepository(db).setOnHand(KITCHEN, MINCE, 2.5, kg);

    expect(db.calls[0]?.value).toBe('kitchen_id,ingredient_id');
  });

  it('RULE 4: writes the unit it was given, with no unit input of its own', async () => {
    // The caller passes the INGREDIENT's stock unit. A unit chosen beside the
    // quantity on a form is how 2 kg becomes 2 g.
    const db = fakeDb();
    await stockRepository(db).setOnHand(KITCHEN, MINCE, 2.5, 'g' as StockUnit);

    const [written] = db.calls[0]?.payload as Record<string, unknown>[];
    expect(written?.['unit']).toBe('g');
  });

  it('records when it was counted, so a stale figure can be spotted', async () => {
    const db = fakeDb();
    await stockRepository(db).setOnHand(KITCHEN, MINCE, 2.5, kg);

    const [written] = db.calls[0]?.payload as Record<string, unknown>[];
    expect(written?.['counted_at']).toBeDefined();
  });

  it('writes kitchen_id, because the with-check policy requires it', async () => {
    const db = fakeDb();
    await stockRepository(db).setOnHand(KITCHEN, MINCE, 2.5, kg);

    const [written] = db.calls[0]?.payload as Record<string, unknown>[];
    expect(written?.['kitchen_id']).toBe(KITCHEN);
  });

  it('RULE 8: zero is a REAL figure and is written as one', async () => {
    // "I counted, there is none" is a statement. It is not the same as not having
    // counted, and it must survive as a row.
    const db = fakeDb();
    await stockRepository(db).setOnHand(KITCHEN, MINCE, 0, kg);

    const [written] = db.calls[0]?.payload as Record<string, unknown>[];
    expect(written?.['qty']).toBe(0);
    expect(db.calls.some((c) => c.op === 'delete')).toBe(false);
  });

  it('keeps a fractional quantity rather than rounding it', async () => {
    const db = fakeDb();
    await stockRepository(db).setOnHand(KITCHEN, MINCE, 2.75, kg);

    const [written] = db.calls[0]?.payload as Record<string, unknown>[];
    expect(written?.['qty']).toBe(2.75);
  });
});

describe('clearOnHand — RULE 8, the one that matters', () => {
  it('DELETES the row rather than writing zero', async () => {
    // Both make the shopping list order the full amount, so getting this wrong
    // would never show up there. They are different statements: "not counted" and
    // "counted, none left".
    const db = fakeDb();
    await stockRepository(db).clearOnHand(MINCE);

    const call = db.calls.find((c) => c.op === 'delete');
    expect(call?.table).toBe('stock');
    expect(call?.column).toBe('ingredient_id');
    expect(call?.value).toBe(MINCE);
  });

  it('writes no row at all', async () => {
    const db = fakeDb();
    await stockRepository(db).clearOnHand(MINCE);

    expect(db.calls.some((c) => c.op === 'upsert' || c.op === 'insert')).toBe(false);
  });
});

describe('list', () => {
  it('maps to the domain type with the quantity in its unit', async () => {
    const db = fakeDb({ stock: [row()] });
    const [level] = await stockRepository(db).list();

    expect(level?.onHand.value).toBe(2.5);
    expect(level?.onHand.unit).toBe('kg');
    expect(level?.ingredientId).toBe(MINCE);
  });

  it('keeps a stored zero as zero, distinct from absent', async () => {
    const db = fakeDb({ stock: [row({ qty: 0 })] });
    const [level] = await stockRepository(db).list();

    expect(level?.onHand.value).toBe(0);
    expect(level).toBeDefined();
  });

  it('does not filter by kitchen_id — RLS scopes the read', async () => {
    const db = fakeDb({ stock: [row()] });
    await stockRepository(db).list();

    for (const call of db.calls) {
      expect(call.column).not.toBe('kitchen_id');
    }
  });
});
