/**
 * The tools themselves — that each one returns what its engine returned.
 *
 * These are thin by design, so the assertions are mostly about the seam: the
 * right engine is called, the figures pass through untouched, and the propose
 * tool produces a diff without writing.
 */

import { describe, expect, it } from 'vitest';
import { runIntent, TOOLS, type SousData } from '../../src/sous/tools';
import { commitProposal } from '../../src/sous/commit';
import { outstandingShopping, requirementsForRange } from '../../src/engine/shopping';
import { fakeDb } from '../data/fakeDb';
import type {
  Cents,
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

const mince: Ingredient = {
  id: 'mince' as IngredientId,
  kitchenId: KITCHEN,
  name: 'mince',
  category: null,
  stockUnit: 'kg' as StockUnit,
  recipeUnit: 'kg' as RecipeUnit,
  recipeUnitsPerStockUnit: null,
  pack: { size: 1, unit: 'kg' as PurchaseUnit, assumed: false },
  supplierId: null,
  pricePerPack: c(900),
  previousPrice: null,
  priceChecked: null,
  allergens: [],
};

const lasagne: Recipe = {
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
      qty: 1,
      unit: 'kg' as RecipeUnit,
      position: 0,
    },
  ],
  unquantified: [],
};

const customer: Customer = {
  id: 'c1' as CustomerId,
  kitchenId: KITCHEN,
  name: 'Nolan',
  phone: null,
  email: null,
  clientGroup: 'private',
  notes: null,
};

const job = (over: Partial<Job> = {}): Job => ({
  id: 'j1' as JobId,
  kitchenId: KITCHEN,
  customerId: 'c1' as CustomerId,
  propertyId: null,
  jobGroup: null,
  serviceDate: '2026-08-20' as IsoDate,
  serviceTime: null,
  serviceType: 'Buffet',
  guests: 10,
  guestsConfirmed: true,
  meatEatingGuests: null,
  pricing: { kind: 'rate_card' },
  status: 'confirmed',
  notes: null,
  dishes: [
    {
      id: 'd1' as JobDishId,
      jobId: 'j1' as JobId,
      recipeId: 'lasagne' as RecipeId,
      portions: 10,
      note: null,
      position: 0,
    },
  ],
  dietaries: [],
  extras: [],
  ...over,
});

const data = (over: Partial<SousData> = {}): SousData => ({
  jobs: [job()],
  recipes: [lasagne],
  ingredients: [mince],
  customers: [customer],
  rates: [],
  stock: [],
  templates: [],
  ...over,
});

describe('read tools return what the engine returned', () => {
  it('shopping matches a direct engine call exactly', () => {
    // The point of the whole architecture: an Ask Sous answer and the Shopping
    // screen cannot disagree, because they are the same call.
    const d = data();
    const result = runIntent(d, {
      tool: 'shopping_for_range',
      args: { from: '2026-08-01' as IsoDate, to: '2026-08-31' as IsoDate },
    });

    const direct = outstandingShopping(
      requirementsForRange(d.jobs, d.recipes, d.ingredients).lines,
      [],
      [],
      d.ingredients,
    );

    expect(result?.kind).toBe('shopping');
    if (result?.kind !== 'shopping') return;
    expect(result.value.lines).toEqual(direct);
  });

  it('excludes jobs outside the window', () => {
    const result = runIntent(data(), {
      tool: 'shopping_for_range',
      args: { from: '2026-09-01' as IsoDate, to: '2026-09-30' as IsoDate },
    });

    expect(result?.kind).toBe('shopping');
    if (result?.kind !== 'shopping') return;
    expect(result.value.jobCount).toBe(0);
  });

  it('prep groups by day through the engine', () => {
    const result = runIntent(data(), {
      tool: 'prep_for_range',
      args: { from: '2026-08-01' as IsoDate, to: '2026-08-31' as IsoDate },
    });

    expect(result?.kind).toBe('prep');
    if (result?.kind !== 'prep') return;
    expect(result.value.days.length).toBeGreaterThan(0);
  });

  it('money returns a rangeMoney result, nulls intact', () => {
    // No rate card, so revenue is null rather than 0 (Rule 8) — and that survives
    // the trip through the tool.
    const result = runIntent(data(), {
      tool: 'money_for_range',
      args: { from: '2026-08-01' as IsoDate, to: '2026-08-31' as IsoDate },
    });

    expect(result?.kind).toBe('money');
    if (result?.kind !== 'money') return;
    expect(result.value.total.revenue.total).toBeNull();
  });

  it('job_details returns null rather than throwing for an unknown job', () => {
    const result = runIntent(data(), {
      tool: 'job_details',
      args: { jobId: 'ghost' as JobId },
    });

    expect(result?.kind).toBe('job');
    if (result?.kind !== 'job') return;
    expect(result.value.job).toBeNull();
  });

  it('packing derives portions through applyBuffetSplit', () => {
    const result = runIntent(data({ jobs: [job({ dishes: [] })] }), {
      tool: 'packing_for_job',
      args: { jobId: 'j1' as JobId },
    });

    expect(result?.kind).toBe('packing');
    if (result?.kind !== 'packing') return;
    expect(result.value.job).not.toBeNull();
  });
});

describe('the propose tool', () => {
  /**
   * Portions left NULL, so the guest count drives the food.
   *
   * With explicit portions the owner's numbers win and a guest change moves
   * revenue alone — correct, and pinned separately below. The first version of
   * this test used the explicit fixture and asserted the food moved; the engine
   * was right and the fixture was wrong.
   */
  const scalingJob = () =>
    data({
      jobs: [
        job({
          dishes: [
            {
              id: 'd1' as JobDishId,
              jobId: 'j1' as JobId,
              recipeId: 'lasagne' as RecipeId,
              portions: null,
              note: null,
              position: 0,
            },
          ],
        }),
      ],
    });

  const proposal = (d = scalingJob()) => {
    const result = runIntent(d, {
      tool: 'propose_job_change',
      args: { jobId: 'j1' as JobId, guests: 20 },
    });
    if (result?.kind !== 'proposal') throw new Error('expected a proposal');
    return result.value;
  };

  it('returns the engine’s before/after diff', () => {
    // Rule 7's proposal is not invented here — it is what changeImpact returns.
    // 10 guests to 20, one main at 1 kg a portion: 10 kg becomes 20 kg.
    const p = proposal();

    expect(p.impact.ingredients.length).toBeGreaterThan(0);
    const line = p.impact.ingredients[0];
    expect(line?.required.before).toBe(10);
    expect(line?.required.after).toBe(20);
  });

  it('moves no food when the owner set the portions by hand', () => {
    // His numbers win over the guest count. Worth pinning, because a preview that
    // silently overrode a typed portion count would be far worse than one that
    // appears to do nothing.
    const p = proposal(data());

    for (const line of p.impact.ingredients) {
      expect(line.required.delta).toBe(0);
    }
  });

  it('echoes only what the owner asked to change', () => {
    const p = proposal();

    expect(p.changes).toEqual({ guests: 20 });
    expect(Object.keys(p.changes)).not.toContain('serviceDate');
  });

  it('carries the job as it WOULD be saved, built from the job plus the change', () => {
    const p = proposal();

    expect(p.after.guests).toBe(20);
    expect(p.after.id).toBe('j1');
    expect(p.after.serviceType).toBe('Buffet');
  });

  it('returns null for a job that does not exist', () => {
    const result = runIntent(data(), {
      tool: 'propose_job_change',
      args: { jobId: 'ghost' as JobId, guests: 20 },
    });

    expect(result).toBeNull();
  });

  it('is declared as a propose tool, not a read', () => {
    expect(TOOLS.propose_job_change.kind).toBe('propose');
  });
});

describe('RULE 7 — committing', () => {
  const proposal = () => {
    const result = runIntent(data(), {
      tool: 'propose_job_change',
      args: { jobId: 'j1' as JobId, guests: 20 },
    });
    if (result?.kind !== 'proposal') throw new Error('expected a proposal');
    return result.value;
  };

  it('writes a confirmed proposal through the audited repository path', async () => {
    // The same `save_job` the Jobs screen uses, so the triggers fire identically.
    // An AI-originated change is an ordinary write that needed a confirmation.
    const db = fakeDb({}, 'j1');
    const result = await commitProposal(db, proposal());

    expect(result.ok).toBe(true);
    expect(db.calls.filter((call) => call.op === 'rpc')).toHaveLength(1);
    expect(db.calls[0]?.table).toBe('save_job');
  });

  it('REFUSES an object that never came from the propose path', async () => {
    // Not about a hostile caller — one user, one bundle. It is about the honest
    // mistake: a hand-built object skips the diff the owner was shown, and Rule 7
    // is specifically that he saw the before/after.
    const db = fakeDb({}, 'j1');
    const forged = { jobId: 'j1', changes: { guests: 99 } } as never;

    const result = await commitProposal(db, forged);

    expect(result.ok).toBe(false);
    expect(db.calls).toHaveLength(0);
  });

  it('refuses a proposal that changes nothing', async () => {
    const db = fakeDb({}, 'j1');
    const empty = { ...proposal(), changes: {} };

    const result = await commitProposal(db, empty);

    expect(result.ok).toBe(false);
    expect(db.calls).toHaveLength(0);
  });

  it('reports a failed write rather than claiming success', async () => {
    const db = fakeDb({}, 'j1');
    const boom = {
      ...db,
      rpc: async () => {
        throw new Error('database refused');
      },
    };

    const result = await commitProposal(boom, proposal());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('database refused');
  });
});
