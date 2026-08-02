/**
 * Rule 4 — conversion across recipe / stock / purchase units.
 *
 * Worked numbers from BUILD_GUIDE C2. Written before the implementation, per
 * CLAUDE.md section 5.
 *
 * The point of this file is not that conversion works. It is that conversion
 * REFUSES when it cannot be derived, instead of returning a plausible number.
 */

import { describe, expect, it } from 'vitest';
import { recipeToStock, stockToPacks } from '../../src/engine/units';
import { makeIngredient, purchaseUnit, recipeQty, stockQty, stockUnit } from './factories';

describe('recipeToStock', () => {
  it('converts 150 g to 0.15 kg when the pair is dimensional', () => {
    const chicken = makeIngredient({ stockUnit: stockUnit('kg') });
    const result = recipeToStock(recipeQty(150, 'g'), chicken);

    expect(result).toEqual({
      kind: 'converted',
      value: { value: 0.15, unit: 'kg' },
    });
  });

  it('converts 250 ml to 0.25 L', () => {
    const stock = makeIngredient({ stockUnit: stockUnit('L') });
    const result = recipeToStock(recipeQty(250, 'ml'), stock);

    expect(result).toEqual({
      kind: 'converted',
      value: { value: 0.25, unit: 'L' },
    });
  });

  it('passes through unchanged when recipe and stock units already match', () => {
    const eggs = makeIngredient({ stockUnit: stockUnit('each') });
    const result = recipeToStock(recipeQty(17, 'each'), eggs);

    expect(result).toEqual({
      kind: 'converted',
      value: { value: 17, unit: 'each' },
    });
  });

  it('uses the ingredient factor when the pair is NOT dimensional', () => {
    // 20 eggs per kg. Owner-entered; nothing here assumes it.
    const eggs = makeIngredient({
      stockUnit: stockUnit('kg'),
      recipeUnit: 'each' as never,
      recipeUnitsPerStockUnit: 20,
    });
    const result = recipeToStock(recipeQty(10, 'each'), eggs);

    expect(result).toEqual({
      kind: 'converted',
      value: { value: 0.5, unit: 'kg' },
    });
  });

  it('REFUSES rather than guessing when each -> kg has no factor (Rule 8)', () => {
    const eggs = makeIngredient({
      stockUnit: stockUnit('kg'),
      recipeUnit: 'each' as never,
      recipeUnitsPerStockUnit: null,
    });
    const result = recipeToStock(recipeQty(10, 'each'), eggs);

    expect(result.kind).toBe('unresolved');
    if (result.kind === 'unresolved') {
      expect(result.reason).toBe('no_conversion_factor');
    }
  });

  it('never silently assumes a factor of 1', () => {
    const eggs = makeIngredient({
      stockUnit: stockUnit('kg'),
      recipeUnit: 'each' as never,
      recipeUnitsPerStockUnit: null,
    });
    const result = recipeToStock(recipeQty(10, 'each'), eggs);

    // The tempting wrong answer is 10 kg. It must not appear.
    expect(result).not.toEqual({
      kind: 'converted',
      value: { value: 10, unit: 'kg' },
    });
  });

  it('refuses an unknown unit rather than treating it as base', () => {
    const thing = makeIngredient({ stockUnit: stockUnit('kg') });
    const result = recipeToStock(recipeQty(3, 'splodge'), thing);

    expect(result.kind).toBe('unresolved');
  });
});

describe('stockToPacks', () => {
  it('rounds 4.2 kg into 1 kg packs UP to 5, with 0.8 kg overage', () => {
    const flour = makeIngredient({
      stockUnit: stockUnit('kg'),
      pack: { size: 1, unit: purchaseUnit('kg'), assumed: false },
    });
    const result = stockToPacks(stockQty(4.2, 'kg'), flour);

    expect(result).toEqual({
      kind: 'converted',
      value: { packs: 5, overage: { value: 0.8, unit: 'kg' } },
    });
  });

  it('rounds 17 eggs into dozens UP to 2 packs, with 7 overage', () => {
    const eggs = makeIngredient({
      stockUnit: stockUnit('each'),
      pack: { size: 12, unit: purchaseUnit('each'), assumed: false },
    });
    const result = stockToPacks(stockQty(17, 'each'), eggs);

    expect(result).toEqual({
      kind: 'converted',
      value: { packs: 2, overage: { value: 7, unit: 'each' } },
    });
  });

  it('does not round up when the quantity lands exactly on a pack boundary', () => {
    const flour = makeIngredient({
      stockUnit: stockUnit('kg'),
      pack: { size: 1, unit: purchaseUnit('kg'), assumed: false },
    });
    const result = stockToPacks(stockQty(4, 'kg'), flour);

    expect(result).toEqual({
      kind: 'converted',
      value: { packs: 4, overage: { value: 0, unit: 'kg' } },
    });
  });

  it('converts a pack size stated in a different dimensional unit', () => {
    // 500 g packs, stock counted in kg.
    const butter = makeIngredient({
      stockUnit: stockUnit('kg'),
      pack: { size: 500, unit: purchaseUnit('g'), assumed: false },
    });
    const result = stockToPacks(stockQty(1.2, 'kg'), butter);

    expect(result).toEqual({
      kind: 'converted',
      value: { packs: 3, overage: { value: 0.3, unit: 'kg' } },
    });
  });

  it('needs zero packs for zero quantity', () => {
    const flour = makeIngredient({
      stockUnit: stockUnit('kg'),
      pack: { size: 1, unit: purchaseUnit('kg'), assumed: false },
    });
    const result = stockToPacks(stockQty(0, 'kg'), flour);

    expect(result).toEqual({
      kind: 'converted',
      value: { packs: 0, overage: { value: 0, unit: 'kg' } },
    });
  });

  it('routes a dozen-egg pack through the owner factor when stock is in kg', () => {
    // Eggs are counted "each" in recipes but stocked by weight. A dozen is not
    // dimensionally comparable to a kilogram, so the owner's factor is the only
    // thing that can bridge it.
    //   17 each / 20 per kg  = 0.85 kg required
    //   12 each / 20 per kg  = 0.6 kg per pack
    //   ceil(0.85 / 0.6)     = 2 packs
    const eggs = makeIngredient({
      stockUnit: stockUnit('kg'),
      recipeUnit: 'each' as never,
      recipeUnitsPerStockUnit: 20,
      pack: { size: 12, unit: purchaseUnit('each'), assumed: false },
    });
    const result = stockToPacks(stockQty(0.85, 'kg'), eggs);

    expect(result).toEqual({
      kind: 'converted',
      value: { packs: 2, overage: { value: 0.35, unit: 'kg' } },
    });
  });

  it('still refuses that pack shape when the owner has given no factor', () => {
    const eggs = makeIngredient({
      stockUnit: stockUnit('kg'),
      recipeUnit: 'each' as never,
      recipeUnitsPerStockUnit: null,
      pack: { size: 12, unit: purchaseUnit('each'), assumed: false },
    });
    const result = stockToPacks(stockQty(0.85, 'kg'), eggs);

    expect(result.kind).toBe('unresolved');
  });

  it('does not use the factor when the pack unit is not the recipe unit', () => {
    // Factor is "each per kg". A pack measured in litres cannot borrow it.
    const odd = makeIngredient({
      stockUnit: stockUnit('kg'),
      recipeUnit: 'each' as never,
      recipeUnitsPerStockUnit: 20,
      pack: { size: 1, unit: purchaseUnit('L'), assumed: false },
    });

    expect(stockToPacks(stockQty(1, 'kg'), odd).kind).toBe('unresolved');
  });

  it('REFUSES when the ingredient has no pack size (Rule 8)', () => {
    const flour = makeIngredient({ stockUnit: stockUnit('kg'), pack: null });
    const result = stockToPacks(stockQty(4.2, 'kg'), flour);

    expect(result.kind).toBe('unresolved');
    if (result.kind === 'unresolved') {
      expect(result.reason).toBe('no_pack_size');
    }
  });

  it('REFUSES when pack unit and stock unit cannot be reconciled', () => {
    const odd = makeIngredient({
      stockUnit: stockUnit('kg'),
      pack: { size: 1, unit: purchaseUnit('each'), assumed: false },
      recipeUnitsPerStockUnit: null,
    });
    const result = stockToPacks(stockQty(4.2, 'kg'), odd);

    expect(result.kind).toBe('unresolved');
  });
});
