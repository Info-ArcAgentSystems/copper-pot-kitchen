/**
 * "Add all new lines" — the rows, what is filled in, and what stops a row.
 *
 * THE CASE THIS EXISTS FOR. A real receipt had ten lines that were not in his
 * ingredients yet, each behind its own form. The checklist fills only what the
 * receipt says, and never how he counts a thing.
 */

import { describe, expect, it } from 'vitest';
import {
  packIsPrinted,
  rowProblem,
  rowToIngredient,
  startRows,
  type BulkRow,
} from '../../src/scan/bulkIngredients';
import type { Ingredient, IngredientId, KitchenId, StockUnit, SupplierId } from '../../src/engine/types';

const have = (name: string, stockUnit = 'kg'): Ingredient => ({
  id: name as IngredientId,
  kitchenId: 'k1' as KitchenId,
  name,
  category: null,
  stockUnit: stockUnit as StockUnit,
  recipeUnit: null,
  recipeUnitsPerStockUnit: null,
  pack: null,
  supplierId: null,
  pricePerPack: null,
  previousPrice: null,
  priceChecked: null,
  allergens: [],
});

const [rice, sausages] = startRows(['BASMATI RICE 1KG', 'SAUSAGES B&P']) as [BulkRow, BulkRow];

describe('startRows — only what the receipt says', () => {
  it('names each row from its line and fills the printed pack', () => {
    expect(rice).toMatchObject({ name: 'Basmati Rice 1KG', packSize: '1', packUnit: 'kg', include: true });
  });

  it('leaves the pack empty when the line prints no size', () => {
    expect(sausages).toMatchObject({ packSize: '', packUnit: '' });
  });

  it('never fills in how he counts it', () => {
    expect(rice.stockUnit).toBe('');
    expect(sausages.stockUnit).toBe('');
  });
});

describe('rowProblem — what stops a row', () => {
  it('needs a stock unit before anything else is enough', () => {
    expect(rowProblem(rice, [], [])).toMatch(/how you count it/);
    expect(rowProblem({ ...rice, stockUnit: 'kg' }, [], [])).toBeNull();
  });

  it('a printed 1 kg pack against a stock unit it cannot convert to is refused', () => {
    expect(rowProblem({ ...rice, stockUnit: 'L' }, [], [])).toMatch(/can’t be priced against L/);
  });

  it('clearing the pack lets the row through — it is added unpriced, not mispriced', () => {
    expect(rowProblem({ ...rice, stockUnit: 'L', packSize: '', packUnit: '' }, [], [])).toBeNull();
  });

  it('half a pack is a problem, not a guess', () => {
    expect(rowProblem({ ...sausages, stockUnit: 'each', packSize: '6' }, [], [])).toMatch(/both/);
  });

  it('refuses a name he already has, and two rows with one name', () => {
    expect(rowProblem({ ...rice, stockUnit: 'kg' }, [have('basmati rice 1kg')], [])).toMatch(/already one of your/);
    const twin = { ...sausages, name: 'Basmati Rice 1KG' };
    expect(rowProblem({ ...rice, stockUnit: 'kg' }, [], [twin])).toMatch(/same name/);
    expect(rowProblem({ ...rice, stockUnit: 'kg' }, [], [{ ...twin, include: false }])).toBeNull();
  });

  it('needs a name', () => {
    expect(rowProblem({ ...rice, name: '  ' }, [], [])).toMatch(/name/);
  });
});

describe('rowToIngredient — what gets written', () => {
  it('a printed pack is confirmed, with no price and no allergens', () => {
    const made = rowToIngredient({ ...rice, stockUnit: 'kg' }, 'k1' as KitchenId, 'sup' as SupplierId);
    expect(made).toMatchObject({
      name: 'Basmati Rice 1KG',
      stockUnit: 'kg',
      pack: { size: 1, unit: 'kg', assumed: false },
      supplierId: 'sup',
      pricePerPack: null,
      allergens: [],
    });
  });

  it('a pack he typed himself is his figure, but still assumed', () => {
    const made = rowToIngredient({ ...rice, stockUnit: 'kg', packSize: '2' }, 'k1' as KitchenId, null);
    expect(made.pack).toEqual({ size: 2, unit: 'kg', assumed: true });
    expect(packIsPrinted({ ...rice, packSize: '2' })).toBe(false);
    expect(packIsPrinted(rice)).toBe(true);
  });

  it('no pack, no pack', () => {
    expect(rowToIngredient({ ...sausages, stockUnit: 'each' }, 'k1' as KitchenId, null).pack).toBeNull();
  });
});
