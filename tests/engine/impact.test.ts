/**
 * changeImpact.
 *
 * CLAUDE.md section 3: "It is a diff of two engine runs, never a separately
 * maintained calculation."
 *
 * The reason is concrete. A hand-maintained impact preview drifts from the engine
 * the first time anything downstream changes, and then it lies — quietly, on the
 * screen the owner uses to decide whether to accept a change.
 *
 * The proof case is a batch boundary. 18 -> 19 portions of a 9-per-tray lasagne
 * moves mince from 4 kg to 6 kg: +2 kg. A linear extrapolation says +0.222 kg,
 * nine times off and in the direction that under-orders. Only an implementation
 * that re-runs the whole cascade gets it right.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { changeImpact } from '../../src/engine/impact';
import { requirementsForRange } from '../../src/engine/shopping';
import {
  clientRate,
  dish,
  euros,
  ingredientId,
  ingredientLine,
  isoDate,
  jobId,
  makeCustomer,
  makeIngredient,
  makeJob,
  makeRecipe,
  purchaseUnit,
  stockUnit,
} from './factories';

const mince = makeIngredient({
  id: ingredientId('mince'),
  name: 'mince',
  stockUnit: stockUnit('kg'),
  recipeUnit: 'kg' as never,
  pack: { size: 1, unit: purchaseUnit('kg'), assumed: false },
  pricePerPack: euros(8),
});

const cheese = makeIngredient({
  id: ingredientId('cheese'),
  name: 'cheese',
  stockUnit: stockUnit('kg'),
  recipeUnit: 'g' as never,
  pack: { size: 1, unit: purchaseUnit('kg'), assumed: false },
  pricePerPack: euros(12),
});

/** 9 portions per tray, 2 kg of mince per tray. */
const lasagne = makeRecipe('Lasagne', {
  course: 'main',
  yieldType: 'batch',
  portionsPerBatch: 9,
  sameDayOnly: true,
  components: [
    ingredientLine('mince', 2, 'kg', { ingredientId: ingredientId('mince') }),
  ],
});

const gratin = makeRecipe('Gratin', {
  course: 'side',
  yieldType: 'per_person',
  sameDayOnly: true,
  components: [
    ingredientLine('cheese', 50, 'g', { ingredientId: ingredientId('cheese') }),
  ],
});

const recipes = [lasagne, gratin];
const ingredients = [mince, cheese];

const jobWith = (portions: number, over = {}) =>
  makeJob({
    id: jobId('j1'),
    serviceDate: isoDate('2026-07-22'),
    serviceType: 'Buffet',
    guests: 18,
    dishes: [dish('Lasagne', portions)],
    ...over,
  });

const mincedIn = (result: ReturnType<typeof changeImpact>) =>
  result.ingredients.find((i) => i.name === 'mince');

describe('changeImpact — the batch boundary', () => {
  it('THE PROOF: 18 -> 19 portions moves mince by +2 kg, not +0.222', () => {
    const before = [jobWith(18)];
    const impact = changeImpact(before, recipes, ingredients, jobId('j1'), {
      dishes: [dish('Lasagne', 19)],
    });

    const m = mincedIn(impact);
    expect(m?.required.before).toBe(4);
    expect(m?.required.after).toBe(6);
    expect(m?.required.delta).toBe(2);
  });

  it('does not report the linear extrapolation', () => {
    const impact = changeImpact([jobWith(18)], recipes, ingredients, jobId('j1'), {
      dishes: [dish('Lasagne', 19)],
    });

    // (19 - 18) / 9 * 2 = 0.2222. The wrong answer a private calculation gives.
    expect(mincedIn(impact)?.required.delta).not.toBeCloseTo(0.222, 2);
  });

  it('STRUCTURAL: the after figure equals a fresh full run of the after-state', () => {
    // This is what proves the number came from the real engine rather than from a
    // coincidentally-correct calculation of its own.
    const before = [jobWith(18)];
    const after = [jobWith(19)];

    const impact = changeImpact(before, recipes, ingredients, jobId('j1'), {
      dishes: [dish('Lasagne', 19)],
    });
    const fresh = requirementsForRange(after, recipes, ingredients);

    const freshMince = fresh.lines.find((l) => l.name === 'mince');
    expect(mincedIn(impact)?.required.after).toBe(freshMince?.required.value);
    expect(mincedIn(impact)?.packs?.after).toBe(freshMince?.packs?.packs);
  });

  it('reports the batch delta 2 -> 3 trays', () => {
    const impact = changeImpact([jobWith(18)], recipes, ingredients, jobId('j1'), {
      dishes: [dish('Lasagne', 19)],
    });

    const batch = impact.batches.find((b) => b.recipeName === 'Lasagne');
    expect(batch?.batches?.before).toBe(2);
    expect(batch?.batches?.after).toBe(3);
    expect(batch?.batches?.delta).toBe(1);
    expect(batch?.portions.delta).toBe(1);
  });

  it('reports the same +2 kg for 18 -> 20, since both land in 3 trays', () => {
    const impact = changeImpact([jobWith(18)], recipes, ingredients, jobId('j1'), {
      dishes: [dish('Lasagne', 20)],
    });

    expect(mincedIn(impact)?.required.delta).toBe(2);
  });

  it('reports no change within a tray: 19 -> 20', () => {
    const impact = changeImpact([jobWith(19)], recipes, ingredients, jobId('j1'), {
      dishes: [dish('Lasagne', 20)],
    });

    expect(mincedIn(impact)?.required.delta).toBe(0);
  });
});

describe('changeImpact — appearing and disappearing lines', () => {
  it('shows a newly added dish with a before of zero', () => {
    const impact = changeImpact([jobWith(18)], recipes, ingredients, jobId('j1'), {
      dishes: [dish('Lasagne', 18), dish('Gratin', 18)],
    });

    const c = impact.ingredients.find((i) => i.name === 'cheese');
    expect(c?.required.before).toBe(0);
    expect(c?.required.after).toBe(0.9);
  });

  it('shows a removed dish as after zero, not as an omitted line', () => {
    const before = [jobWith(18, { dishes: [dish('Lasagne', 18), dish('Gratin', 18)] })];
    const impact = changeImpact(before, recipes, ingredients, jobId('j1'), {
      dishes: [dish('Lasagne', 18)],
    });

    const c = impact.ingredients.find((i) => i.name === 'cheese');
    expect(c).toBeDefined();
    expect(c?.required.after).toBe(0);
    expect(c?.required.delta).toBe(-0.9);
  });

  it('drops all production when the job is cancelled', () => {
    const impact = changeImpact([jobWith(18)], recipes, ingredients, jobId('j1'), {
      status: 'cancelled',
    });

    expect(mincedIn(impact)?.required.after).toBe(0);
    expect(impact.batches.every((b) => b.batches?.after === 0 || b.portions.after === 0)).toBe(
      true,
    );
  });

  it('reports nothing changed for an empty change set', () => {
    const impact = changeImpact([jobWith(18)], recipes, ingredients, jobId('j1'), {});

    expect(impact.ingredients.every((i) => i.required.delta === 0)).toBe(true);
    expect(impact.batches.every((b) => b.portions.delta === 0)).toBe(true);
  });

  it('leaves other jobs alone', () => {
    const other = makeJob({
      id: jobId('j2'),
      serviceDate: isoDate('2026-07-22'),
      dishes: [dish('Lasagne', 9)],
    });
    const impact = changeImpact([jobWith(18), other], recipes, ingredients, jobId('j1'), {
      dishes: [dish('Lasagne', 19)],
    });

    // 18 + 9 = 27 -> 3 trays.  19 + 9 = 28 -> 4 trays.  6 kg -> 8 kg.
    expect(mincedIn(impact)?.required.before).toBe(6);
    expect(mincedIn(impact)?.required.after).toBe(8);
  });
});

describe('changeImpact — money', () => {
  const customer = makeCustomer('Tranquillity');
  const rates = [clientRate('Tranquillity', 'Buffet', { perHead: 20 })];

  it('reports a revenue delta for a guest-count change', () => {
    const impact = changeImpact(
      [jobWith(18)],
      recipes,
      ingredients,
      jobId('j1'),
      { guests: 23 },
      { customer, rates },
    );

    // 18 x EUR 20 = 360; 23 x EUR 20 = 460.
    expect(impact.revenue.before).toBe(euros(360));
    expect(impact.revenue.after).toBe(euros(460));
    expect(impact.revenue.delta).toBe(euros(100));
  });

  it('THE KNOWN GAP: a guest-count change does not move ingredients yet', () => {
    // JobDish.portions is explicit and nothing derives it from job.guests.
    // applyBuffetSplit is the unbuilt half of rules.ts. This test pins the current
    // behaviour so the gap stays visible instead of surfacing on a screen.
    const impact = changeImpact(
      [jobWith(18)],
      recipes,
      ingredients,
      jobId('j1'),
      { guests: 23 },
      { customer, rates },
    );

    expect(mincedIn(impact)?.required.delta).toBe(0);
  });

  it('leaves the revenue delta null when either side is unknown', () => {
    const impact = changeImpact(
      [jobWith(18, { serviceType: 'BBQ' })],
      recipes,
      ingredients,
      jobId('j1'),
      { guests: 23 },
      { customer, rates },
    );

    expect(impact.revenue.before).toBeNull();
    expect(impact.revenue.after).toBeNull();
    // Not 0. You cannot subtract from unknown (Rule 8).
    expect(impact.revenue.delta).toBeNull();
  });

  it('exposes both sides when revenue becomes known', () => {
    const impact = changeImpact(
      [jobWith(18, { serviceType: 'BBQ' })],
      recipes,
      ingredients,
      jobId('j1'),
      { serviceType: 'Buffet' },
      { customer, rates },
    );

    expect(impact.revenue.before).toBeNull();
    expect(impact.revenue.after).toBe(euros(360));
    // A screen can say "was unknown, now EUR 360" without implying an increase.
    expect(impact.revenue.delta).toBeNull();
  });

  it('reports a food cost delta across the batch boundary', () => {
    const impact = changeImpact(
      [jobWith(18)],
      recipes,
      ingredients,
      jobId('j1'),
      { dishes: [dish('Lasagne', 19)] },
      { customer, rates },
    );

    expect(impact.foodCost.before).not.toBeNull();
    expect(impact.foodCost.after).not.toBeNull();
    expect(impact.foodCost.delta).not.toBeNull();
  });

  it('reports money deltas of zero for no change', () => {
    const impact = changeImpact(
      [jobWith(18)],
      recipes,
      ingredients,
      jobId('j1'),
      {},
      { customer, rates },
    );

    expect(impact.revenue.delta).toBe(0);
    expect(impact.foodCost.delta).toBe(0);
    expect(impact.margin.delta).toBe(0);
  });
});

describe('changeImpact — gaps', () => {
  it('surfaces a gap the change would introduce', () => {
    const vague = makeRecipe('Vague', {
      course: 'main',
      yieldType: 'per_person',
      sameDayOnly: true,
      components: [
        ingredientLine('mystery', null, null, { ingredientId: ingredientId('mystery') }),
      ],
    });

    const impact = changeImpact(
      [jobWith(18)],
      [...recipes, vague],
      ingredients,
      jobId('j1'),
      { dishes: [dish('Lasagne', 18), dish('Vague', 5)] },
    );

    expect(impact.gapsIntroduced.length).toBeGreaterThan(0);
    expect(impact.gapsIntroduced.join(' ')).toContain('mystery');
  });

  it('surfaces a gap the change would clear', () => {
    const vague = makeRecipe('Vague', {
      course: 'main',
      yieldType: 'per_person',
      sameDayOnly: true,
      components: [
        ingredientLine('mystery', null, null, { ingredientId: ingredientId('mystery') }),
      ],
    });
    const before = [jobWith(18, { dishes: [dish('Lasagne', 18), dish('Vague', 5)] })];

    const impact = changeImpact(before, [...recipes, vague], ingredients, jobId('j1'), {
      dishes: [dish('Lasagne', 18)],
    });

    expect(impact.gapsResolved.length).toBeGreaterThan(0);
  });
});

describe('impact.ts keeps no arithmetic of its own', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../../src/engine/impact.ts', import.meta.url)),
    'utf8',
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it.each([
    ['Math.ceil', 'rounding — that belongs to scaling.ts'],
    ['Math.floor', 'rounding'],
    ['Math.round', 'rounding'],
    ['portionsToUnits', 'batch maths — it must come from the cascade, not be recomputed'],
    ['packSizeIn', 'pack maths'],
    ['recipeToStock', 'unit conversion — that belongs to units.ts'],
    ['stockToPacks', 'pack conversion'],
  ])('contains no %s (%s)', (token) => {
    expect(code).not.toContain(token);
  });

  it('imports the cascade rather than reimplementing it', () => {
    expect(code).toContain("from './shopping'");
    expect(code).toContain("from './production'");
    expect(code).toContain("from './costing'");
  });
});
