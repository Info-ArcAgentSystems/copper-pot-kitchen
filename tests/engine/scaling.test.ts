/**
 * scaleRecipe and portionsToUnits.
 *
 * Worked numbers first, per CLAUDE.md section 5. Two of the cases below are
 * CALC-CURRY-10 and CALC-LASAGNE-29 from the owner's golden pack, reproduced as
 * unit tests so the regression exists before the pack is wired in C6.
 *
 * The defect this file guards against: scaling a batch recipe linearly. 29 portions
 * of lasagne is 4 trays and 8 kg of mince. Linear scaling says 6.44 kg and
 * under-orders by a quarter, because you cannot make 3.2 trays.
 */

import { describe, expect, it } from 'vitest';
import { portionsToUnits, scaleRecipe } from '../../src/engine/scaling';
import { ingredientLine, lookupFor, makeRecipe, subRecipeLine } from './factories';

const noRecipes = lookupFor([]);

// A batch recipe: one tray yields 9 portions.
const lasagne = makeRecipe('Lasagne', {
  yieldType: 'batch',
  portionsPerBatch: 9,
  batchUnit: 'tray',
  components: [
    ingredientLine('mince', 2, 'kg'),
    ingredientLine('red sauce', 4, 'unit'),
    ingredientLine('white sauce', 2, 'unit'),
    ingredientLine('cheese', 100, 'g'),
  ],
});

// A per-person recipe.
const curry = makeRecipe('Chicken Curry', {
  yieldType: 'per_person',
  components: [
    ingredientLine('chicken breast', 150, 'g'),
    ingredientLine('curry sauce', 0.5, 'jar'),
    ingredientLine('rice', 100, 'g'),
  ],
});

const qtyOf = (result: ReturnType<typeof scaleRecipe>, name: string): number | undefined =>
  result.lines.find((l) => l.displayName === name)?.qty;

describe('portionsToUnits', () => {
  it('27 portions at 9 per tray is 3 trays with no surplus', () => {
    expect(portionsToUnits(27, 9)).toEqual({ batches: 3, capacity: 27, surplus: 0 });
  });

  it('29 portions at 9 per tray is 4 trays with surplus 7', () => {
    expect(portionsToUnits(29, 9)).toEqual({ batches: 4, capacity: 36, surplus: 7 });
  });

  it('rounds up from a single portion over a boundary', () => {
    expect(portionsToUnits(28, 9)).toEqual({ batches: 4, capacity: 36, surplus: 8 });
  });

  it('an exact batch has no surplus', () => {
    expect(portionsToUnits(9, 9)).toEqual({ batches: 1, capacity: 9, surplus: 0 });
  });

  it('one portion still costs a whole batch', () => {
    expect(portionsToUnits(1, 9)).toEqual({ batches: 1, capacity: 9, surplus: 8 });
  });

  it('zero portions needs no batches', () => {
    expect(portionsToUnits(0, 9)).toEqual({ batches: 0, capacity: 0, surplus: 0 });
  });

  it('returns null rather than dividing by a missing batch size', () => {
    expect(portionsToUnits(29, 0)).toBeNull();
    expect(portionsToUnits(29, -3)).toBeNull();
  });
});

describe('scaleRecipe — per-person', () => {
  it('scales linearly: CALC-CURRY-10', () => {
    const result = scaleRecipe(curry, 10, noRecipes);

    expect(qtyOf(result, 'chicken breast')).toBe(1500);
    expect(qtyOf(result, 'curry sauce')).toBe(5);
    expect(qtyOf(result, 'rice')).toBe(1000);
    expect(result.gaps).toEqual([]);
    expect(result.batches).toBeNull();
  });

  it('keeps the recipe unit on each line', () => {
    const result = scaleRecipe(curry, 10, noRecipes);
    expect(result.lines.find((l) => l.displayName === 'chicken breast')?.unit).toBe('g');
  });

  it('scales to zero portions without inventing quantities', () => {
    const result = scaleRecipe(curry, 0, noRecipes);
    expect(qtyOf(result, 'chicken breast')).toBe(0);
  });
});

describe('scaleRecipe — batch', () => {
  it('CALC-LASAGNE-29: 29 portions is 4 trays and 8 kg of mince', () => {
    const result = scaleRecipe(lasagne, 29, noRecipes);

    expect(result.batches).toEqual({ batches: 4, capacity: 36, surplus: 7 });
    expect(qtyOf(result, 'mince')).toBe(8);
    expect(qtyOf(result, 'red sauce')).toBe(16);
    expect(qtyOf(result, 'white sauce')).toBe(8);
    expect(qtyOf(result, 'cheese')).toBe(400);
  });

  it('does NOT scale linearly', () => {
    const result = scaleRecipe(lasagne, 29, noRecipes);
    // 29/9 * 2 = 6.444..., the wrong answer that under-orders.
    expect(qtyOf(result, 'mince')).not.toBeCloseTo(6.444, 2);
  });

  it('27 portions is 3 trays and 6 kg', () => {
    const result = scaleRecipe(lasagne, 27, noRecipes);

    expect(result.batches).toEqual({ batches: 3, capacity: 27, surplus: 0 });
    expect(qtyOf(result, 'mince')).toBe(6);
    expect(qtyOf(result, 'cheese')).toBe(300);
  });

  it('reports a gap when a batch recipe has no batch size', () => {
    const broken = makeRecipe('Broken', {
      yieldType: 'batch',
      portionsPerBatch: null,
      components: [ingredientLine('mince', 2, 'kg')],
    });
    const result = scaleRecipe(broken, 29, noRecipes);

    expect(result.gaps.map((g) => g.reason)).toContain('no_portions_per_batch');
    expect(result.lines).toEqual([]);
  });
});

describe('scaleRecipe — the consolidate-then-scale contract', () => {
  it('demonstrates why it must be called once per consolidated total', () => {
    // Two jobs wanting 10 portions each.
    const consolidated = scaleRecipe(lasagne, 20, noRecipes);
    const perJob = scaleRecipe(lasagne, 10, noRecipes);

    // Consolidated: 20/9 -> 3 trays. Per job: 10/9 -> 2 trays, twice, = 4.
    expect(consolidated.batches?.batches).toBe(3);
    expect(perJob.batches?.batches).toBe(2);
    expect((perJob.batches?.batches ?? 0) * 2).toBe(4);

    // Scaling per job and summing over-orders by a whole tray. Consolidate first.
    expect((perJob.batches?.batches ?? 0) * 2).toBeGreaterThan(
      consolidated.batches?.batches ?? 0,
    );
  });
});

describe('scaleRecipe — sub-recipes', () => {
  it('recurses, treating sub-recipe qty as portions', () => {
    const sauce = makeRecipe('sauce', {
      yieldType: 'per_person',
      components: [ingredientLine('tomato', 50, 'g')],
    });
    const pasta = makeRecipe('pasta', {
      yieldType: 'per_person',
      components: [ingredientLine('penne', 100, 'g'), subRecipeLine('sauce', 2)],
    });

    // 4 portions of pasta -> 8 portions of sauce -> 400 g tomato.
    const result = scaleRecipe(pasta, 4, lookupFor([sauce, pasta]));

    expect(qtyOf(result, 'penne')).toBe(400);
    expect(qtyOf(result, 'tomato')).toBe(400);
  });

  it('consolidates an ingredient reached both directly and via a sub-recipe', () => {
    const sauce = makeRecipe('sauce', {
      yieldType: 'per_person',
      components: [ingredientLine('butter', 10, 'g')],
    });
    const dish = makeRecipe('dish', {
      yieldType: 'per_person',
      components: [ingredientLine('butter', 5, 'g'), subRecipeLine('sauce', 1)],
    });

    const result = scaleRecipe(dish, 10, lookupFor([sauce, dish]));

    // 50 g direct + 100 g through the sauce = one line of 150 g.
    expect(result.lines.filter((l) => l.displayName === 'butter')).toHaveLength(1);
    expect(qtyOf(result, 'butter')).toBe(150);
  });

  it('keeps the same ingredient in different units on separate lines', () => {
    // scaleRecipe has no Ingredient records, so it cannot convert. units.ts does that.
    const dish = makeRecipe('dish', {
      components: [
        ingredientLine('milk', 100, 'ml'),
        ingredientLine('milk', 1, 'L', { id: 'other' as never }),
      ],
    });
    const result = scaleRecipe(dish, 2, noRecipes);

    expect(result.lines.filter((l) => l.displayName === 'milk')).toHaveLength(2);
  });

  it('reports a gap for a missing sub-recipe but still scales the rest', () => {
    const dish = makeRecipe('dish', {
      components: [ingredientLine('flour', 100, 'g'), subRecipeLine('ghost', 1)],
    });
    const result = scaleRecipe(dish, 2, lookupFor([dish]));

    expect(result.gaps.map((g) => g.reason)).toContain('missing_sub_recipe');
    expect(qtyOf(result, 'flour')).toBe(200);
  });

  it('terminates on a cycle instead of overflowing the stack', () => {
    const a = makeRecipe('a', { components: [subRecipeLine('b', 1)] });
    const b = makeRecipe('b', { components: [subRecipeLine('a', 1)] });

    const result = scaleRecipe(a, 1, lookupFor([a, b]));

    expect(result.gaps.map((g) => g.reason)).toContain('cycle');
  });

  it('allows the same sub-recipe twice on different branches', () => {
    // Not a cycle: a diamond. Both branches must contribute.
    const base = makeRecipe('base', { components: [ingredientLine('salt', 1, 'g')] });
    const left = makeRecipe('left', { components: [subRecipeLine('base', 1)] });
    const right = makeRecipe('right', { components: [subRecipeLine('base', 1)] });
    const top = makeRecipe('top', {
      components: [subRecipeLine('left', 1), subRecipeLine('right', 1)],
    });

    const result = scaleRecipe(top, 1, lookupFor([base, left, right, top]));

    expect(result.gaps).toEqual([]);
    expect(qtyOf(result, 'salt')).toBe(2);
  });
});

describe('scaleRecipe — Rule 8, unquantified is never zero', () => {
  it('reports an unquantified line as a gap and omits it from the lines', () => {
    const dish = makeRecipe('dish', {
      components: [ingredientLine('flour', 100, 'g'), ingredientLine('mystery spice', null, null)],
    });
    const result = scaleRecipe(dish, 3, noRecipes);

    expect(result.gaps.map((g) => g.reason)).toContain('unquantified');
    expect(qtyOf(result, 'flour')).toBe(300);
    // The tempting wrong answer: a line reading 0, which would silently under-order.
    expect(result.lines.find((l) => l.displayName === 'mystery spice')).toBeUndefined();
  });

  it('surfaces named unquantified components as gaps', () => {
    const dish = makeRecipe('dish', {
      components: [ingredientLine('flour', 100, 'g')],
      unquantified: [
        { id: 'u1' as never, item: 'seasoning to taste', reason: 'never measured' },
      ],
    });
    const result = scaleRecipe(dish, 3, noRecipes);

    const gap = result.gaps.find((g) => g.reason === 'named_unquantified');
    expect(gap).toBeDefined();
    expect(gap?.detail).toContain('seasoning to taste');
  });

  it('surfaces unquantified components of a SUB-recipe too', () => {
    const sauce = makeRecipe('sauce', {
      components: [],
      unquantified: [{ id: 'u2' as never, item: 'herbs', reason: null }],
    });
    const dish = makeRecipe('dish', { components: [subRecipeLine('sauce', 1)] });

    const result = scaleRecipe(dish, 1, lookupFor([sauce, dish]));

    expect(result.gaps.some((g) => g.detail.includes('herbs'))).toBe(true);
  });
});
