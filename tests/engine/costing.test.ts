/**
 * recipeFoodCost, recipePortionCost, jobFoodCost, jobRevenue, jobMargin.
 *
 * Worked numbers first, per CLAUDE.md section 5.
 *
 * The rule with the sharpest edge in this file: a recipe with five priced
 * ingredients and one unpriced costs NULL, not the sum of five. A partial sum is
 * worse than no number because it looks complete, and it always understates.
 *
 * Money is Cents throughout — a branded integer. No floating-point euros.
 */

import { describe, expect, it } from 'vitest';
import {
  jobFoodCost,
  jobMargin,
  jobRevenue,
  recipeFoodCost,
  recipePortionCost,
} from '../../src/engine/costing';
import {
  clientRate,
  dish,
  euros,
  extra,
  ingredientId,
  ingredientLine,
  lookupFor,
  makeCustomer,
  makeIngredient,
  makeJob,
  makeRecipe,
  purchaseUnit,
  stockUnit,
} from './factories';

/** 1 kg of flour costs EUR 2.00, so 400 g costs 80 cents. */
const flour = makeIngredient({
  id: ingredientId('flour'),
  name: 'flour',
  stockUnit: stockUnit('kg'),
  recipeUnit: 'g' as never,
  pack: { size: 1, unit: purchaseUnit('kg'), assumed: false },
  pricePerPack: euros(2),
});

/** 1 kg of butter costs EUR 10.00, so 100 g costs 100 cents. */
const butter = makeIngredient({
  id: ingredientId('butter'),
  name: 'butter',
  stockUnit: stockUnit('kg'),
  recipeUnit: 'g' as never,
  pack: { size: 1, unit: purchaseUnit('kg'), assumed: false },
  pricePerPack: euros(10),
});

const unpricedSalt = makeIngredient({
  id: ingredientId('salt'),
  name: 'salt',
  stockUnit: stockUnit('kg'),
  recipeUnit: 'g' as never,
  pack: { size: 1, unit: purchaseUnit('kg'), assumed: false },
  pricePerPack: null,
});

const line = (name: string, qty: number | null, unit: string | null) =>
  ingredientLine(name, qty, unit, { ingredientId: ingredientId(name) });

const scone = makeRecipe('Scone', {
  yieldType: 'per_person',
  sameDayOnly: true,
  components: [line('flour', 400, 'g'), line('butter', 100, 'g')],
});

const noRecipes = lookupFor([]);

describe('recipeFoodCost — priced', () => {
  it('costs one portion from the pack price', () => {
    // 400 g of EUR 2.00/kg flour = 80c;  100 g of EUR 10.00/kg butter = 100c.
    const result = recipeFoodCost(scone, 1, [flour, butter], noRecipes);

    expect(result.total).toBe(180);
    expect(result.missing).toEqual([]);
  });

  it('scales with portions', () => {
    const result = recipeFoodCost(scone, 10, [flour, butter], noRecipes);
    expect(result.total).toBe(1800);
  });

  it('costs the whole batches actually made, for a batch recipe', () => {
    // 9 per tray, 10 portions -> 2 trays. Cost follows the trays.
    const tray = makeRecipe('Tray', {
      yieldType: 'batch',
      portionsPerBatch: 9,
      sameDayOnly: true,
      components: [line('flour', 1000, 'g')],
    });
    const result = recipeFoodCost(tray, 10, [flour], noRecipes);

    // 2 trays x 1 kg x EUR 2.00 = 400c, not 10/9 x 200c.
    expect(result.total).toBe(400);
  });

  it('returns whole cents, never a float', () => {
    // 333 g of EUR 2.00/kg = 66.6c -> 67c, rounded once at the boundary.
    const odd = makeRecipe('Odd', {
      yieldType: 'per_person',
      sameDayOnly: true,
      components: [line('flour', 333, 'g')],
    });
    const result = recipeFoodCost(odd, 1, [flour], noRecipes);

    expect(result.total).toBe(67);
    expect(Number.isInteger(result.total)).toBe(true);
  });
});

describe('recipeFoodCost — Rule 8, never a partial sum', () => {
  const fiveAndOne = makeRecipe('FiveAndOne', {
    yieldType: 'per_person',
    sameDayOnly: true,
    components: [line('flour', 400, 'g'), line('butter', 100, 'g'), line('salt', 5, 'g')],
  });

  it('is NULL when one ingredient of several is unpriced', () => {
    const result = recipeFoodCost(fiveAndOne, 1, [flour, butter, unpricedSalt], noRecipes);

    expect(result.total).toBeNull();
  });

  it('does not leak the partial sum of the priced ingredients', () => {
    const result = recipeFoodCost(fiveAndOne, 1, [flour, butter, unpricedSalt], noRecipes);

    // 180 is the sum of the two priced lines. It must appear nowhere.
    expect(result.total).not.toBe(180);
    expect(JSON.stringify(result)).not.toContain('180');
  });

  it('names the unpriced ingredient in missing', () => {
    const result = recipeFoodCost(fiveAndOne, 1, [flour, butter, unpricedSalt], noRecipes);

    const m = result.missing.find((x) => x.reason === 'unpriced_ingredient');
    expect(m).toBeDefined();
    expect(m?.detail).toContain('salt');
  });

  it('lists EVERY problem, not just the first', () => {
    const noPack = makeIngredient({
      id: ingredientId('pepper'),
      name: 'pepper',
      stockUnit: stockUnit('kg'),
      recipeUnit: 'g' as never,
      pack: null,
      pricePerPack: euros(5),
    });
    const messy = makeRecipe('Messy', {
      yieldType: 'per_person',
      sameDayOnly: true,
      components: [line('flour', 400, 'g'), line('salt', 5, 'g'), line('pepper', 5, 'g')],
    });

    const result = recipeFoodCost(messy, 1, [flour, unpricedSalt, noPack], noRecipes);

    expect(result.total).toBeNull();
    expect(result.missing.map((m) => m.reason)).toContain('unpriced_ingredient');
    expect(result.missing.map((m) => m.reason)).toContain('no_pack_size');
  });

  it('is null when an ingredient has no record at all', () => {
    const orphan = makeRecipe('Orphan', {
      yieldType: 'per_person',
      sameDayOnly: true,
      components: [line('ghost', 10, 'g')],
    });
    const result = recipeFoodCost(orphan, 1, [flour], noRecipes);

    expect(result.total).toBeNull();
    expect(result.missing.map((m) => m.reason)).toContain('missing_ingredient');
  });

  it('is null when a component is unquantified', () => {
    const vague = makeRecipe('Vague', {
      yieldType: 'per_person',
      sameDayOnly: true,
      components: [line('flour', 400, 'g'), line('salt', null, null)],
    });
    const result = recipeFoodCost(vague, 1, [flour, unpricedSalt], noRecipes);

    expect(result.total).toBeNull();
    expect(result.missing.map((m) => m.reason)).toContain('unquantified');
  });
});

describe('recipePortionCost and jobFoodCost', () => {
  it('gives the per-portion cost of a batch recipe from one full batch', () => {
    // 9 per tray, 1 kg flour per tray at EUR 2.00 = 200c per tray = 22.22c per portion.
    const tray = makeRecipe('Tray', {
      yieldType: 'batch',
      portionsPerBatch: 9,
      sameDayOnly: true,
      components: [line('flour', 1000, 'g')],
    });

    expect(recipePortionCost(tray, [flour], noRecipes).total).toBe(22);
  });

  it('costs a job proportionally, not by whole batches', () => {
    // Two jobs can share a tray, so charging each a whole tray double-counts.
    const tray = makeRecipe('Tray', {
      yieldType: 'batch',
      portionsPerBatch: 9,
      sameDayOnly: true,
      components: [line('flour', 1000, 'g')],
    });
    const job = makeJob({ dishes: [dish('Tray', 10)] });

    // 10 x 22.22c = 222c, NOT 2 trays x 200c = 400c.
    expect(jobFoodCost(job, [tray], [flour]).total).toBe(222);
  });

  it('sums several dishes', () => {
    const job = makeJob({ dishes: [dish('Scone', 2), dish('Scone', 3)] });
    expect(jobFoodCost(job, [scone], [flour, butter]).total).toBe(900);
  });

  it('is null when any dish cannot be costed', () => {
    const salty = makeRecipe('Salty', {
      yieldType: 'per_person',
      sameDayOnly: true,
      components: [line('salt', 5, 'g')],
    });
    const job = makeJob({ dishes: [dish('Scone', 2), dish('Salty', 2)] });

    const result = jobFoodCost(job, [scone, salty], [flour, butter, unpricedSalt]);

    expect(result.total).toBeNull();
  });

  it('is null when a dish has no portions allocated', () => {
    const job = makeJob({ dishes: [dish('Scone', null)] });
    const result = jobFoodCost(job, [scone], [flour, butter]);

    expect(result.total).toBeNull();
    expect(result.missing.map((m) => m.reason)).toContain('no_portions');
  });

  it('is zero for a job with no dishes, which is a real answer', () => {
    expect(jobFoodCost(makeJob({}), [scone], [flour, butter]).total).toBe(0);
  });
});

describe('jobRevenue — Rule 11', () => {
  const tranquillity = makeCustomer('Tranquillity');
  const rates = [
    clientRate('Tranquillity', 'Buffet', { perHead: 20 }),
    clientRate('Tranquillity', 'Bistro', { perHead: 40 }),
    clientRate('Other', 'Afternoon Tea', { perHead: 18 }),
    clientRate('Weddings', 'Canapes', { flatFee: 150 }),
    clientRate('Weddings', 'Dinner', { flatFee: 150, perHead: 12 }),
  ];

  const buffetFor = (guests: number | null, over = {}) =>
    makeJob({ serviceType: 'Buffet', guests, ...over });

  it('is guests x per-head rate', () => {
    // The HIST-2026-07-17-NUCELLA-BUFFET shape: 15 guests at EUR 20.
    expect(jobRevenue(buffetFor(15), tranquillity, rates).total).toBe(euros(300));
  });

  it('adds per-each extras at their quantity', () => {
    const job = makeJob({
      serviceType: 'Afternoon Tea',
      guests: 16,
      extras: [extra('Bistro steak surcharge', 10, 2)],
    });
    // 16 x 18 = 288, plus 2 x 10 = 20 -> 308.
    expect(jobRevenue(job, makeCustomer('Other'), rates).total).toBe(euros(308));
  });

  it('uses a flat fee when there is no per-head rate', () => {
    const job = makeJob({ serviceType: 'Canapes', guests: 30 });
    expect(jobRevenue(job, makeCustomer('Weddings'), rates).total).toBe(euros(150));
  });

  it('adds a flat fee and a per-head rate when both are set', () => {
    const job = makeJob({ serviceType: 'Dinner', guests: 10 });
    // 150 + 10 x 12 = 270.
    expect(jobRevenue(job, makeCustomer('Weddings'), rates).total).toBe(euros(270));
  });

  it('lets a manual override replace the whole figure, extras included', () => {
    const job = buffetFor(15, {
      pricing: { kind: 'override', amount: euros(320) },
      extras: [extra('Birthday cake', 40)],
    });
    const result = jobRevenue(job, tranquillity, rates);

    expect(result.total).toBe(euros(320));
    expect(result.isOverride).toBe(true);
  });

  it('keeps the computed figure visible alongside an override (Rule 11)', () => {
    const job = buffetFor(15, { pricing: { kind: 'override', amount: euros(320) } });
    const result = jobRevenue(job, tranquillity, rates);

    expect(result.total).toBe(euros(320));
    expect(result.computed).toBe(euros(300));
  });

  it('is NULL when no rate applies, not zero', () => {
    // The Tranquillity BBQ case: history shows EUR 320 but the rate card is empty.
    const job = makeJob({ serviceType: 'BBQ', guests: 16 });
    const result = jobRevenue(job, tranquillity, rates);

    expect(result.total).toBeNull();
    expect(result.total).not.toBe(0);
    expect(result.missing.map((m) => m.reason)).toContain('no_rate');
  });

  it('is null when the customer has no client group', () => {
    expect(jobRevenue(buffetFor(15), makeCustomer(null), rates).total).toBeNull();
  });

  it('is null when there is no customer at all', () => {
    expect(jobRevenue(buffetFor(15), undefined, rates).total).toBeNull();
  });

  it('is null when a per-head rate applies but the guest count is unknown', () => {
    const result = jobRevenue(buffetFor(null), tranquillity, rates);

    expect(result.total).toBeNull();
    expect(result.missing.map((m) => m.reason)).toContain('no_guest_count');
  });

  it('still pays a flat fee when guests are unknown', () => {
    const job = makeJob({ serviceType: 'Canapes', guests: null });
    expect(jobRevenue(job, makeCustomer('Weddings'), rates).total).toBe(euros(150));
  });

  it('is NULL when an extra is named but unpriced, never silently zero', () => {
    const job = buffetFor(15, { extras: [extra('Mystery surcharge', null)] });
    const result = jobRevenue(job, tranquillity, rates);

    expect(result.total).toBeNull();
    expect(result.missing.map((m) => m.reason)).toContain('unpriced_extra');
  });

  it('still honours an override when an extra is unpriced', () => {
    // The override IS the total, so an unpriced extra cannot block it.
    const job = buffetFor(15, {
      pricing: { kind: 'override', amount: euros(500) },
      extras: [extra('Mystery surcharge', null)],
    });

    expect(jobRevenue(job, tranquillity, rates).total).toBe(euros(500));
  });
});

describe('jobMargin', () => {
  const tranquillity = makeCustomer('Tranquillity');
  const rates = [clientRate('Tranquillity', 'Buffet', { perHead: 20 })];

  it('is revenue minus food cost', () => {
    const job = makeJob({
      serviceType: 'Buffet',
      guests: 15,
      dishes: [dish('Scone', 15)],
    });
    const result = jobMargin(job, tranquillity, rates, [scone], [flour, butter]);

    // 30000c revenue - 15 x 180c = 2700c food cost -> 27300c.
    expect(result.revenue).toBe(30000);
    expect(result.foodCost).toBe(2700);
    expect(result.margin).toBe(27300);
  });

  it('THE TRAP: margin is NULL when food cost is null, not revenue minus zero', () => {
    const salty = makeRecipe('Salty', {
      yieldType: 'per_person',
      sameDayOnly: true,
      components: [line('salt', 5, 'g')],
    });
    const job = makeJob({ serviceType: 'Buffet', guests: 15, dishes: [dish('Salty', 15)] });

    const result = jobMargin(job, tranquillity, rates, [salty], [unpricedSalt]);

    expect(result.revenue).toBe(30000);
    expect(result.foodCost).toBeNull();
    expect(result.margin).toBeNull();
    // 30000 would be "revenue minus zero" and would look like a healthy margin.
    expect(result.margin).not.toBe(30000);
  });

  it('is null when revenue is null even though food cost is known', () => {
    const job = makeJob({ serviceType: 'BBQ', guests: 15, dishes: [dish('Scone', 15)] });
    const result = jobMargin(job, tranquillity, rates, [scone], [flour, butter]);

    expect(result.revenue).toBeNull();
    expect(result.foodCost).toBe(2700);
    expect(result.margin).toBeNull();
  });

  it('merges missing from both sides into one list', () => {
    const job = makeJob({ serviceType: 'BBQ', guests: 15, dishes: [dish('Ghost', 5)] });
    const result = jobMargin(job, tranquillity, rates, [], [flour]);

    const reasons = result.missing.map((m) => m.reason);
    expect(reasons).toContain('no_rate');
    expect(reasons).toContain('missing_recipe');
  });

  it('can be negative when the food costs more than the job earns', () => {
    const cheapRate = [clientRate('Tranquillity', 'Buffet', { perHead: 1 })];
    const job = makeJob({ serviceType: 'Buffet', guests: 1, dishes: [dish('Scone', 1)] });

    const result = jobMargin(job, tranquillity, cheapRate, [scone], [flour, butter]);

    // 100c revenue - 180c cost. A loss is a real answer and must not be clamped.
    expect(result.margin).toBe(-80);
  });
});
