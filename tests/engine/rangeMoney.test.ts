/**
 * rangeMoney — revenue, food cost and margin across a set of jobs.
 *
 * The summation the Money screen needs, in the engine rather than a view-model,
 * because every view-model in this codebase is forbidden arithmetic and a range
 * figure IS arithmetic.
 *
 * The rule that shapes the whole function: a total over a SUBSET must say so. It
 * is legitimate to total the jobs that could be valued — refusing to show anything
 * because one job of twenty is unpriced would make the screen useless — but only
 * if the excluded ones are counted where the owner can see them. That is the same
 * bargain `RevenueAggregate` already strikes in history.ts.
 *
 * The trap it exists to prevent: summing revenue over one set of jobs and cost
 * over a different set, then subtracting. The result belongs to no actual set of
 * jobs and looks authoritative.
 */

import { describe, expect, it } from 'vitest';
import { rangeMoney } from '../../src/engine/costing';
import type {
  Cents,
  ClientRate,
  ClientRateId,
  Customer,
  CustomerId,
  Ingredient,
  IngredientId,
  IsoDate,
  Job,
  JobDishId,
  JobId,
  KitchenId,
  PurchaseUnit,
  Recipe,
  RecipeId,
  RecipeLineId,
  RecipeUnit,
  StockUnit,
} from '../../src/engine/types';

const KITCHEN = 'k1' as KitchenId;
const c = (n: number): Cents => n as Cents;

/** 1 kg pack at €9.00, so 100 g costs 90c. */
const mince = (over: Partial<Ingredient> = {}): Ingredient => ({
  id: 'mince' as IngredientId,
  kitchenId: KITCHEN,
  name: 'mince',
  category: null,
  stockUnit: 'kg' as StockUnit,
  recipeUnit: 'g' as RecipeUnit,
  recipeUnitsPerStockUnit: null,
  pack: { size: 1, unit: 'kg' as PurchaseUnit, assumed: false },
  supplierId: null,
  pricePerPack: c(900),
  previousPrice: null,
  priceChecked: null,
  allergens: [],
  ...over,
});

/** 100 g of mince per portion = 90c per portion. */
const lasagne = (over: Partial<Recipe> = {}): Recipe => ({
  id: 'lasagne' as RecipeId,
  kitchenId: KITCHEN,
  name: 'Lasagne',
  course: 'main',
  yieldType: 'per_person',
  portionsPerBatch: null,
  batchUnit: null,
  confidence: 'locked',
  makeAheadDays: 0,
  sameDayOnly: true,
  freezable: false,
  onsiteFinish: false,
  method: null,
  note: null,
  components: [
    {
      id: 'l1' as RecipeLineId,
      kind: 'ingredient',
      ingredientId: 'mince' as IngredientId,
      displayName: 'mince',
      qty: 100,
      unit: 'g' as RecipeUnit,
      position: 0,
    },
  ],
  unquantified: [],
  ...over,
});

const customer = (over: Partial<Customer> = {}): Customer => ({
  id: 'c1' as CustomerId,
  kitchenId: KITCHEN,
  name: 'Nolan',
  phone: null,
  email: null,
  clientGroup: 'private',
  notes: null,
  ...over,
});

/** €30 a head. */
const rate = (over: Partial<ClientRate> = {}): ClientRate => ({
  id: 'r1' as ClientRateId,
  kitchenId: KITCHEN,
  clientGroup: 'private',
  serviceType: 'Buffet',
  ratePerHead: c(3000),
  flatFee: null,
  ...over,
});

const job = (id: string, guests: number | null, over: Partial<Job> = {}): Job => ({
  id: id as JobId,
  kitchenId: KITCHEN,
  customerId: 'c1' as CustomerId,
  propertyId: null,
  jobGroup: null,
  serviceDate: '2026-08-18' as IsoDate,
  serviceTime: null,
  serviceType: 'Buffet',
  guests,
  guestsConfirmed: true,
  meatEatingGuests: null,
  pricing: { kind: 'rate_card' },
  status: 'confirmed',
  notes: null,
  dishes: [
    {
      id: `d-${id}` as JobDishId,
      jobId: id as JobId,
      recipeId: 'lasagne' as RecipeId,
      portions: guests,
      note: null,
      position: 0,
    },
  ],
  dietaries: [],
  extras: [],
  ...over,
});

const run = (jobs: Job[], ingredients: Ingredient[] = [mince()]) =>
  rangeMoney(jobs, [customer()], [rate()], [lasagne()], ingredients);

describe('the worked case', () => {
  // 10 guests × €30 = €300 revenue, 10 portions × 90c = €9.00 cost, €291 margin.
  // 20 guests × €30 = €600 revenue, 20 portions × 90c = €18.00 cost, €582 margin.
  // Totals: €900 revenue, €27 cost, €873 margin.
  const result = run([job('j1', 10), job('j2', 20)]);

  it('totals revenue across the range', () => {
    expect(result.revenue.total).toBe(90000);
    expect(result.revenue.priced).toBe(2);
    expect(result.revenue.unpriced).toBe(0);
  });

  it('totals food cost across the range', () => {
    expect(result.foodCost.total).toBe(2700);
    expect(result.foodCost.costed).toBe(2);
  });

  it('totals margin across the range', () => {
    expect(result.margin.total).toBe(87300);
    expect(result.margin.withMargin).toBe(2);
    expect(result.margin.withoutMargin).toBe(0);
  });

  it('reports the margin total as exactly revenue minus cost over the same jobs', () => {
    // Not a separate accumulation that could drift from the other two.
    expect(result.margin.total).toBe(
      (result.revenue.total as number) - (result.foodCost.total as number),
    );
  });
});

describe('THE TRAP: a total over a subset must say it is a subset', () => {
  it('keeps an uncostable job in revenue but out of cost AND margin', () => {
    // j2's mince is unpriced, so its cost is null. Its €600 revenue is still real
    // and still counts. What must NOT happen is €900 revenue minus €9 cost being
    // reported as an €891 margin — that subtracts two jobs' revenue from one
    // job's cost.
    const unpriced = mince({ id: 'chicken' as IngredientId, name: 'chicken', pricePerPack: null });
    const chickenRecipe = lasagne({
      id: 'curry' as RecipeId,
      name: 'Curry',
      components: [
        {
          id: 'c1' as RecipeLineId,
          kind: 'ingredient',
          ingredientId: 'chicken' as IngredientId,
          displayName: 'chicken',
          qty: 100,
          unit: 'g' as RecipeUnit,
          position: 0,
        },
      ],
    });

    const j2 = job('j2', 20, {
      dishes: [
        {
          id: 'd-j2' as JobDishId,
          jobId: 'j2' as JobId,
          recipeId: 'curry' as RecipeId,
          portions: 20,
          note: null,
          position: 0,
        },
      ],
    });

    const result = rangeMoney(
      [job('j1', 10), j2],
      [customer()],
      [rate()],
      [lasagne(), chickenRecipe],
      [mince(), unpriced],
    );

    expect(result.revenue.total).toBe(90000);
    expect(result.revenue.priced).toBe(2);

    // Only j1 could be costed.
    expect(result.foodCost.total).toBe(900);
    expect(result.foodCost.costed).toBe(1);
    expect(result.foodCost.uncosted).toBe(1);

    // And the margin covers only j1: €300 − €9 = €291. NOT €891.
    expect(result.margin.total).toBe(29100);
    expect(result.margin.withMargin).toBe(1);
    expect(result.margin.withoutMargin).toBe(1);
  });

  it('excludes an unpriceable job from revenue and margin but still costs it', () => {
    // No guest count, so no rate can apply — revenue null. The food is still
    // costable from explicit portions.
    const noRate = job('j2', null, {
      dishes: [
        {
          id: 'd-j2' as JobDishId,
          jobId: 'j2' as JobId,
          recipeId: 'lasagne' as RecipeId,
          portions: 20,
          note: null,
          position: 0,
        },
      ],
    });

    const result = run([job('j1', 10), noRate]);

    expect(result.revenue.priced).toBe(1);
    expect(result.revenue.unpriced).toBe(1);
    expect(result.foodCost.costed).toBe(2);
    expect(result.margin.withMargin).toBe(1);
  });
});

describe('RULE 8 — null, never zero', () => {
  it('returns null totals when nothing in the range can be valued', () => {
    const result = rangeMoney([job('j1', 10)], [], [], [lasagne()], [mince()]);

    expect(result.revenue.total).toBeNull();
    expect(result.revenue.total).not.toBe(0);
    expect(result.margin.total).toBeNull();
  });

  it('returns null rather than zero for an empty range', () => {
    // No jobs is not "€0 earned". It is "nothing to say".
    const result = run([]);

    expect(result.revenue.total).toBeNull();
    expect(result.foodCost.total).toBeNull();
    expect(result.margin.total).toBeNull();
    expect(result.jobs).toBe(0);
  });

  it('collects what is blocking each figure', () => {
    const result = rangeMoney([job('j1', 10)], [], [], [lasagne()], [mince()]);

    expect(result.missing.length).toBeGreaterThan(0);
    expect(result.missing.some((m) => m.reason === 'no_rate')).toBe(true);
  });

  it('de-duplicates a blocker that every job shares', () => {
    // Twenty jobs missing the same rate is one thing to fix, not twenty.
    const result = rangeMoney(
      [job('j1', 10), job('j2', 20)],
      [],
      [],
      [lasagne()],
      [mince()],
    );

    const noRate = result.missing.filter((m) => m.reason === 'no_rate');
    expect(noRate).toHaveLength(1);
  });
});

describe('RULE 15 — cancelled jobs are kept, and kept apart', () => {
  const result = run([job('j1', 10), job('j2', 20, { status: 'cancelled' })]);

  it('leaves cancelled revenue out of the earned total', () => {
    expect(result.revenue.total).toBe(30000);
    expect(result.revenue.priced).toBe(1);
  });

  it('reports what the cancellation would have been worth, separately', () => {
    expect(result.cancelled.jobs).toBe(1);
    expect(result.cancelled.revenue.total).toBe(60000);
  });

  it('never mixes cancelled food cost into the earned cost', () => {
    expect(result.foodCost.total).toBe(900);
  });

  it('counts the jobs it looked at, cancelled included', () => {
    expect(result.jobs).toBe(2);
  });
});

describe('a loss is a real answer', () => {
  it('preserves a negative margin rather than clamping it at zero', () => {
    // €30/head against a dish costing more than that per portion. Selling at a
    // loss is information, and hiding it is the one thing a money screen must not
    // do.
    const expensive = mince({ pricePerPack: c(50_000) });
    const result = run([job('j1', 10)], [expensive]);

    expect(result.margin.total).toBeLessThan(0);
  });
});

describe('the override path (Rule 11)', () => {
  it('uses the manual figure, and still costs the food', () => {
    const overridden = job('j1', 10, { pricing: { kind: 'override', amount: c(50000) } });
    const result = run([overridden]);

    expect(result.revenue.total).toBe(50000);
    expect(result.margin.total).toBe(49100);
  });

  it('prices a job the rate card cannot, when an override is set', () => {
    // The override is what unblocks a job with no applicable rate.
    const overridden = job('j1', 10, { pricing: { kind: 'override', amount: c(32000) } });
    const result = rangeMoney([overridden], [], [], [lasagne()], [mince()]);

    expect(result.revenue.total).toBe(32000);
    expect(result.revenue.unpriced).toBe(0);
  });
});
