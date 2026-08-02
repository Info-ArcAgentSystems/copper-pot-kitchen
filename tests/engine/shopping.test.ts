/**
 * requirementsForRange, toPurchaseUnits, outstandingShopping.
 *
 * Worked numbers first, per CLAUDE.md section 5.
 *
 * This is where all three unit systems meet: recipes measure in g and "each",
 * stock is counted in kg, suppliers sell packs. Rule 4 calls this the single most
 * common source of silently wrong answers.
 *
 * Two defects guarded here:
 *   - rounding packs per item instead of per consolidated total, which buys a
 *     spare kilo of flour every week;
 *   - computing packs from the REQUIRED amount rather than the OUTSTANDING one,
 *     which re-buys everything already in the store cupboard.
 */

import { describe, expect, it } from 'vitest';
import {
  outstandingShopping,
  requirementsForRange,
  toPurchaseUnits,
} from '../../src/engine/shopping';
import {
  dish,
  ingredientId,
  ingredientLine,
  isoDate,
  jobId,
  makeIngredient,
  makeJob,
  makeRecipe,
  purchaseUnit,
  stockLevel,
  stockQty,
  stockUnit,
} from './factories';

const flour = makeIngredient({
  id: ingredientId('flour'),
  name: 'flour',
  stockUnit: stockUnit('kg'),
  recipeUnit: 'g' as never,
  pack: { size: 1, unit: purchaseUnit('kg'), assumed: false },
});

const eggs = makeIngredient({
  id: ingredientId('eggs'),
  name: 'eggs',
  stockUnit: stockUnit('kg'),
  recipeUnit: 'each' as never,
  recipeUnitsPerStockUnit: 20,
  pack: { size: 12, unit: purchaseUnit('each'), assumed: false },
});

const jobOn = (id: string, date: string, dishes: ReturnType<typeof dish>[]) =>
  makeJob({ id: jobId(id), serviceDate: isoDate(date), dishes });

describe('toPurchaseUnits', () => {
  it('4.2 kg into 1 kg packs is 5 packs with 0.8 kg overage', () => {
    const result = toPurchaseUnits(4.2, stockUnit('kg'), flour);

    expect(result).toEqual({
      kind: 'converted',
      value: { packs: 5, overage: { value: 0.8, unit: 'kg' } },
    });
  });

  it('does not round up on an exact boundary', () => {
    expect(toPurchaseUnits(4, stockUnit('kg'), flour)).toEqual({
      kind: 'converted',
      value: { packs: 4, overage: { value: 0, unit: 'kg' } },
    });
  });

  it('17 eggs into dozens is 2 packs, routed through the owner factor', () => {
    // Eggs are stocked in kg, so "a dozen" only becomes comparable through the
    // owner-entered 20-per-kg factor. Nothing here is a dimensional guess.
    //   17 each / 20 = 0.85 kg;  12 each / 20 = 0.6 kg;  ceil(0.85/0.6) = 2
    const result = toPurchaseUnits(0.85, stockUnit('kg'), eggs);

    expect(result).toEqual({
      kind: 'converted',
      value: { packs: 2, overage: { value: 0.35, unit: 'kg' } },
    });
  });

  it('refuses rather than guessing when there is no pack size', () => {
    const unpacked = makeIngredient({ stockUnit: stockUnit('kg'), pack: null });
    const result = toPurchaseUnits(4.2, stockUnit('kg'), unpacked);

    expect(result.kind).toBe('unresolved');
    if (result.kind === 'unresolved') expect(result.reason).toBe('no_pack_size');
  });
});

describe('requirementsForRange — consolidate BEFORE converting to packs', () => {
  const bread = makeRecipe('Bread', {
    yieldType: 'per_person',
    sameDayOnly: true,
    components: [ingredientLine('flour', 400, 'g', { ingredientId: ingredientId('flour') })],
  });

  it('THE GUARD: 0.4 kg on three days is 2 packs, not 3', () => {
    // Three separate prep days, one portion each: 400 g + 400 g + 400 g = 1.2 kg.
    // Consolidated -> ceil(1.2) = 2 packs. Per item -> 1 + 1 + 1 = 3.
    const jobs = [
      jobOn('a', '2026-07-20', [dish('Bread', 1)]),
      jobOn('b', '2026-07-21', [dish('Bread', 1)]),
      jobOn('c', '2026-07-22', [dish('Bread', 1)]),
    ];

    const { lines } = requirementsForRange(jobs, [bread], [flour]);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.required).toEqual({ value: 1.2, unit: 'kg' });
    expect(lines[0]?.packs?.packs).toBe(2);
  });

  it('consolidates one ingredient across different recipes', () => {
    const cake = makeRecipe('Cake', {
      yieldType: 'per_person',
      sameDayOnly: true,
      components: [ingredientLine('flour', 600, 'g', { ingredientId: ingredientId('flour') })],
    });
    const jobs = [jobOn('a', '2026-07-22', [dish('Bread', 1), dish('Cake', 1)])];

    const { lines } = requirementsForRange(jobs, [bread, cake], [flour]);

    // 400 g + 600 g = 1 kg exactly, on one line.
    expect(lines).toHaveLength(1);
    expect(lines[0]?.required).toEqual({ value: 1, unit: 'kg' });
    expect(lines[0]?.packs?.packs).toBe(1);
  });

  it('buys for whole batches, because that is what gets made', () => {
    // 29 portions of a 9-per-tray recipe is 4 trays. Ingredients follow the trays.
    const lasagne = makeRecipe('Lasagne', {
      yieldType: 'batch',
      portionsPerBatch: 9,
      sameDayOnly: true,
      components: [ingredientLine('flour', 500, 'g', { ingredientId: ingredientId('flour') })],
    });
    const jobs = [jobOn('a', '2026-07-22', [dish('Lasagne', 29)])];

    const { lines } = requirementsForRange(jobs, [lasagne], [flour]);

    // 4 trays x 500 g = 2 kg, not 29/9 x 500 g = 1.611 kg.
    expect(lines[0]?.required).toEqual({ value: 2, unit: 'kg' });
  });

  it('crosses recipe units into stock units via the ingredient factor', () => {
    const omelette = makeRecipe('Omelette', {
      yieldType: 'per_person',
      sameDayOnly: true,
      components: [ingredientLine('eggs', 17, 'each', { ingredientId: ingredientId('eggs') })],
    });
    const jobs = [jobOn('a', '2026-07-22', [dish('Omelette', 1)])];

    const { lines } = requirementsForRange(jobs, [omelette], [eggs]);

    expect(lines[0]?.required).toEqual({ value: 0.85, unit: 'kg' });
    expect(lines[0]?.packs?.packs).toBe(2);
  });

  it('excludes cancelled jobs, inheriting the rule from productionBuckets', () => {
    const jobs = [
      jobOn('live', '2026-07-22', [dish('Bread', 1)]),
      makeJob({
        id: jobId('dead'),
        serviceDate: isoDate('2026-07-22'),
        status: 'cancelled',
        dishes: [dish('Bread', 10)],
      }),
    ];

    const { lines } = requirementsForRange(jobs, [bread], [flour]);

    expect(lines[0]?.required).toEqual({ value: 0.4, unit: 'kg' });
  });

  it('is empty for no jobs', () => {
    expect(requirementsForRange([], [bread], [flour]).lines).toEqual([]);
  });
});

describe('requirementsForRange — gaps, never a zero line', () => {
  it('gaps an unquantified component instead of buying none of it', () => {
    const vague = makeRecipe('Vague', {
      yieldType: 'per_person',
      sameDayOnly: true,
      components: [
        ingredientLine('flour', 400, 'g', { ingredientId: ingredientId('flour') }),
        ingredientLine('spice', null, null, { ingredientId: ingredientId('spice') }),
      ],
    });
    const spice = makeIngredient({ id: ingredientId('spice'), name: 'spice' });
    const jobs = [jobOn('a', '2026-07-22', [dish('Vague', 1)])];

    const { lines, gaps } = requirementsForRange(jobs, [vague], [flour, spice]);

    expect(gaps.map((g) => g.reason)).toContain('unquantified');
    expect(lines.find((l) => l.name === 'spice')).toBeUndefined();
    expect(lines.find((l) => l.name === 'flour')?.required.value).toBe(0.4);
  });

  it('gaps an ingredient that has no record', () => {
    const orphan = makeRecipe('Orphan', {
      yieldType: 'per_person',
      sameDayOnly: true,
      components: [ingredientLine('ghost', 100, 'g', { ingredientId: ingredientId('ghost') })],
    });
    const jobs = [jobOn('a', '2026-07-22', [dish('Orphan', 1)])];

    const { lines, gaps } = requirementsForRange(jobs, [orphan], [flour]);

    expect(gaps.map((g) => g.reason)).toContain('missing_ingredient');
    expect(lines).toEqual([]);
  });

  it('gaps an unresolvable conversion and keeps the reason', () => {
    // "each" of an ingredient stocked in kg, with no factor.
    const noFactor = makeIngredient({
      id: ingredientId('mystery'),
      name: 'mystery',
      stockUnit: stockUnit('kg'),
      recipeUnit: 'each' as never,
      recipeUnitsPerStockUnit: null,
    });
    const recipe = makeRecipe('R', {
      yieldType: 'per_person',
      sameDayOnly: true,
      components: [
        ingredientLine('mystery', 3, 'each', { ingredientId: ingredientId('mystery') }),
      ],
    });
    const jobs = [jobOn('a', '2026-07-22', [dish('R', 1)])];

    const { lines, gaps } = requirementsForRange(jobs, [recipe], [noFactor]);

    const gap = gaps.find((g) => g.reason === 'unresolved_conversion');
    expect(gap).toBeDefined();
    expect(gap?.detail).toContain('no_conversion_factor');
    expect(lines).toEqual([]);
  });

  it('carries the recipe-missing gap through from productionBuckets', () => {
    const jobs = [jobOn('a', '2026-07-22', [dish('Nonexistent', 4)])];
    const { gaps } = requirementsForRange(jobs, [], [flour]);

    expect(gaps.map((g) => g.reason)).toContain('missing_recipe');
  });

  it('still lists an ingredient with no pack size, gapping only the pack count', () => {
    const unpacked = makeIngredient({
      id: ingredientId('flour'),
      name: 'flour',
      stockUnit: stockUnit('kg'),
      recipeUnit: 'g' as never,
      pack: null,
    });
    const bread = makeRecipe('Bread', {
      yieldType: 'per_person',
      sameDayOnly: true,
      components: [ingredientLine('flour', 400, 'g', { ingredientId: ingredientId('flour') })],
    });
    const jobs = [jobOn('a', '2026-07-22', [dish('Bread', 1)])];

    const { lines, gaps } = requirementsForRange(jobs, [bread], [unpacked]);

    // You still need 0.4 kg of flour; you just cannot say how many packs.
    expect(lines[0]?.required).toEqual({ value: 0.4, unit: 'kg' });
    expect(lines[0]?.packs).toBeNull();
    expect(gaps.map((g) => g.reason)).toContain('no_pack_size');
  });
});

describe('outstandingShopping', () => {
  const line = (required: number) => ({
    ingredientId: ingredientId('flour'),
    name: 'flour',
    required: stockQty(required, 'kg'),
    packs: null,
    supplierId: null,
  });

  const onHand = (value: number, unit = 'kg') =>
    stockLevel(ingredientId('flour'), value, unit);
  const bought = (value: number, unit = 'kg') => ({
    ingredientId: ingredientId('flour'),
    qty: stockQty(value, unit),
  });

  it('subtracts stock from what is required', () => {
    const [out] = outstandingShopping([line(5)], [onHand(2)], [], [flour]);

    expect(out?.outstanding).toEqual({ value: 3, unit: 'kg' });
    expect(out?.surplus).toBeNull();
  });

  it('subtracts what has already been bought', () => {
    const [out] = outstandingShopping([line(5)], [onHand(2)], [bought(3)], [flour]);

    expect(out?.outstanding).toEqual({ value: 0, unit: 'kg' });
  });

  it('clamps at zero and reports surplus separately, never a negative', () => {
    const [out] = outstandingShopping([line(5)], [onHand(6)], [], [flour]);

    expect(out?.outstanding).toEqual({ value: 0, unit: 'kg' });
    expect(out?.surplus).toEqual({ value: 1, unit: 'kg' });
    // A negative outstanding would silently offset another line if anything summed them.
    expect(out?.outstanding.value).toBeGreaterThanOrEqual(0);
  });

  it('counts stock and purchases together toward surplus', () => {
    const [out] = outstandingShopping([line(5)], [onHand(4)], [bought(3)], [flour]);

    expect(out?.outstanding.value).toBe(0);
    expect(out?.surplus).toEqual({ value: 2, unit: 'kg' });
  });

  it('needs the full amount when there is nothing on hand', () => {
    const [out] = outstandingShopping([line(5)], [], [], [flour]);
    expect(out?.outstanding).toEqual({ value: 5, unit: 'kg' });
  });

  it('THE GUARD: packs come from the OUTSTANDING amount, not the required one', () => {
    // 4.2 kg required, 4 kg already on hand. You need 0.2 kg -> ONE pack.
    // Reusing the required-side pack count would say 5 and re-buy the lot.
    const [out] = outstandingShopping([line(4.2)], [onHand(4)], [], [flour]);

    expect(out?.outstanding).toEqual({ value: 0.2, unit: 'kg' });
    expect(out?.packs?.packs).toBe(1);
  });

  it('reconciles stock recorded in a different unit', () => {
    // 500 g on hand against a 5 kg requirement.
    const [out] = outstandingShopping([line(5)], [onHand(500, 'g')], [], [flour]);

    expect(out?.outstanding).toEqual({ value: 4.5, unit: 'kg' });
  });

  it('needs no packs when nothing is outstanding', () => {
    const [out] = outstandingShopping([line(5)], [onHand(5)], [], [flour]);

    expect(out?.packs?.packs).toBe(0);
  });

  it('reports stock it could not reconcile instead of silently ignoring it', () => {
    // Flour stocked in kg; someone recorded a count of "each". That cannot be
    // restated as kilograms, so it must not be subtracted — but the owner has to
    // know the outstanding figure is an over-estimate.
    const [out] = outstandingShopping([line(5)], [onHand(3, 'each')], [], [flour]);

    expect(out?.outstanding).toEqual({ value: 5, unit: 'kg' });
    expect(out?.unreconciled).toBe(1);
  });

  it('reports nothing unreconciled when every unit lines up', () => {
    const [out] = outstandingShopping([line(5)], [onHand(2), onHand(500, 'g')], [], [flour]);

    expect(out?.outstanding).toEqual({ value: 2.5, unit: 'kg' });
    expect(out?.unreconciled).toBe(0);
  });
});
