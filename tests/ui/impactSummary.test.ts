/**
 * Formatting an impact diff into readable lines.
 *
 * Pure, so it runs in Node with no DOM. The component that renders these is a
 * thin wrapper; the behaviour worth testing is here.
 *
 * Two defects guarded:
 *   - a money delta from unknown reading as an increase
 *   - a guest change that moves no food showing nothing at all, which looks like
 *     a broken preview rather than a correct one
 */

import { describe, expect, it } from 'vitest';
import {
  explainNoFoodChange,
  hasImpact,
  moneyLine,
  quantityLines,
} from '../../src/ui/impactSummary';
import type { ImpactResult } from '../../src/engine/impact';
import type { Cents, IngredientId, IsoDate, RecipeId, StockUnit } from '../../src/engine/types';

const c = (n: number): Cents => n as Cents;

const impact = (over: Partial<ImpactResult> = {}): ImpactResult => ({
  ingredients: [],
  batches: [],
  revenue: { before: null, after: null, delta: null },
  foodCost: { before: null, after: null, delta: null },
  margin: { before: null, after: null, delta: null },
  gapsIntroduced: [],
  gapsResolved: [],
  ...over,
});

const ingredient = (before: number, after: number) => ({
  ingredientId: 'mince' as IngredientId,
  name: 'mince',
  unit: 'kg' as StockUnit,
  required: { before, after, delta: after - before },
  packs: null,
});

const batch = (before: number, after: number) => ({
  recipeId: 'lasagne' as RecipeId,
  recipeName: 'Lasagne',
  prepDate: '2026-07-22' as IsoDate,
  portions: { before: 18, after: 23, delta: 5 },
  batches: { before, after, delta: after - before },
});

describe('quantity lines', () => {
  it('shows the batch movement the cascade produced', () => {
    // 18 -> 23 guests is 2 trays -> 3. The number comes from changeImpact; this
    // only formats it.
    const [line] = quantityLines(impact({ batches: [batch(2, 3)] }));

    expect(line?.label).toBe('Lasagne — batches');
    expect(line?.before).toBe('2');
    expect(line?.after).toBe('3');
    expect(line?.direction).toBe('up');
  });

  it('shows an ingredient movement with its unit', () => {
    const lines = quantityLines(impact({ ingredients: [ingredient(4, 6)] }));

    expect(lines[0]?.before).toBe('4 kg');
    expect(lines[0]?.after).toBe('6 kg');
  });

  it('omits anything that did not move', () => {
    expect(quantityLines(impact({ ingredients: [ingredient(4, 4)] }))).toEqual([]);
  });

  it('marks a reduction as down', () => {
    const [line] = quantityLines(impact({ ingredients: [ingredient(6, 4)] }));
    expect(line?.direction).toBe('down');
  });

  it('trims float noise rather than showing 4.000000001 kg', () => {
    const [line] = quantityLines(impact({ ingredients: [ingredient(0, 0.1 + 0.2)] }));
    expect(line?.after).toBe('0.3 kg');
  });
});

describe('money lines — null-safe', () => {
  it('shows a straightforward increase', () => {
    const line = moneyLine('Revenue', { before: c(36000), after: c(46000), delta: c(10000) });

    expect(line?.before).toBe('€360.00');
    expect(line?.after).toBe('€460.00');
    expect(line?.direction).toBe('up');
  });

  it('THE GUARD: unknown becoming a figure is not an increase', () => {
    // There is no increase from an unknown. Showing "+€360" would invent one.
    const line = moneyLine('Revenue', { before: null, after: c(36000), delta: null });

    expect(line?.before).toBe('unknown');
    expect(line?.after).toBe('€360.00');
    expect(line?.direction).toBe('same');
  });

  it('shows a figure becoming unknown', () => {
    const line = moneyLine('Revenue', { before: c(36000), after: null, delta: null });

    expect(line?.before).toBe('€360.00');
    expect(line?.after).toBe('unknown');
  });

  it('never renders an unknown as €0.00', () => {
    const line = moneyLine('Revenue', { before: null, after: c(36000), delta: null });
    expect(line?.before).not.toContain('0.00');
  });

  it('omits a row where both sides are unknown', () => {
    expect(moneyLine('Revenue', { before: null, after: null, delta: null })).toBeNull();
  });

  it('omits a row that did not change', () => {
    expect(moneyLine('Revenue', { before: c(100), after: c(100), delta: c(0) })).toBeNull();
  });
});

describe('explaining a guest change that moved no food', () => {
  it('says WHY when every dish has portions typed in', () => {
    // Silence here reads as a broken preview. It is actually correct: the owner's
    // numbers win over the guest count.
    const message = explainNoFoodChange(true, 0, true);

    expect(message).toContain('portions set by hand');
    expect(message).toContain('Clear a dish');
  });

  it('says so differently when nothing on the menu scales', () => {
    expect(explainNoFoodChange(true, 0, false)).toContain('nothing on this menu scales');
  });

  it('says nothing when food DID change', () => {
    expect(explainNoFoodChange(true, 3, true)).toBeNull();
  });

  it('says nothing when the guest count was not what changed', () => {
    expect(explainNoFoodChange(false, 0, true)).toBeNull();
  });
});

describe('hasImpact', () => {
  it('is false for a change that moves nothing', () => {
    expect(hasImpact(impact())).toBe(false);
  });

  it('is true when a quantity moved', () => {
    expect(hasImpact(impact({ ingredients: [ingredient(4, 6)] }))).toBe(true);
  });

  it('is true when only money moved', () => {
    expect(
      hasImpact(impact({ revenue: { before: c(100), after: c(200), delta: c(100) } })),
    ).toBe(true);
  });

  it('is true when the change would open a gap, even with no quantity movement', () => {
    // Adding a dish with an unquantified component should be visible BEFORE
    // saving, not discovered on the shopping list afterwards.
    expect(hasImpact(impact({ gapsIntroduced: ['unquantified: seasoning'] }))).toBe(true);
  });
});
