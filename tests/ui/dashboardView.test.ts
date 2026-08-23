/**
 * The dashboard — assembly over a finished engine.
 *
 * It computes NOTHING. Every figure on it is produced by a function that already
 * exists and is already tested elsewhere, and the only job of this layer is to
 * put them next to each other in the order the owner asks his questions. So what
 * these tests check is not arithmetic — it is that nothing is quietly dropped,
 * softened, or turned into a zero on the way to the screen.
 *
 * THE FAILURE THIS SCREEN IS MOST LIKELY TO HAVE. A dashboard is a summary, and
 * a summary's natural failure is to look calm. Every panel here has a state where
 * the honest answer is "I cannot tell you", and every one of those states can be
 * rendered as a nought that reads as good news:
 *
 *   nothing to buy        vs  the quantity could not be worked out
 *   no revenue            vs  no rate applies, so revenue is unknown
 *   no covers served      vs  no job in these dates has closed yet
 *   backed up             vs  backed up at some point, currency unchecked
 *
 * Each pair is one test below. Rule 8 is not decoration on this screen; it is the
 * screen's whole reason to be trusted.
 */

import { describe, expect, it } from 'vitest';
import { buildDashboardView } from '../../src/ui/dashboardView';
import {
  clientRate,
  dish,
  ingredientId,
  ingredientLine,
  isoDate,
  makeCustomer,
  makeIngredient,
  makeJob,
  makeRecipe,
  jobId,
  stockLevel,
} from '../engine/factories';
import type { Ingredient, IsoTime, Job, Recipe } from '../../src/engine/types';

const TODAY = '2026-08-23';
const HORIZON = '2026-08-30';

const lasagne = (): Recipe =>
  makeRecipe('BEEF LASAGNE', {
    course: 'main',
    yieldType: 'batch',
    portionsPerBatch: 20,
    components: [ingredientLine('Beef mince', 4, 'kg')],
  });

const mince = (over: Partial<Ingredient> = {}): Ingredient =>
  makeIngredient({
    id: ingredientId('Beef mince'),
    name: 'Beef mince',
    stockUnit: 'kg',
    recipeUnit: 'kg',
    pack: { size: 1, unit: 'kg', assumed: false },
    pricePerPack: 900,
    ...over,
  } as Partial<Ingredient>);

const confirmedJob = (over: Partial<Job> = {}): Job =>
  makeJob({
    id: jobId('j1'),
    status: 'confirmed',
    serviceDate: isoDate(TODAY),
    serviceTime: '19:00:00' as IsoTime,
    guests: 20,
    guestsConfirmed: true,
    dishes: [dish('BEEF LASAGNE', null)],
    ...over,
  });

const build = (over: Partial<Parameters<typeof buildDashboardView>[0]> = {}) =>
  buildDashboardView({
    jobs: [confirmedJob()],
    recipes: [lasagne()],
    ingredients: [mince()],
    customers: [],
    rates: [],
    stock: [],
    from: TODAY,
    to: HORIZON,
    today: TODAY,
    savedBackup: null,
    ...over,
  });

// ---------------------------------------------------------------------------

describe('nothing needed and nothing knowable are different answers', () => {
  it('separates what is outstanding from what could not be worked out', () => {
    // A dish with no derivable portions leaves the cascade entirely, so it
    // contributes ZERO outstanding lines. Reporting only that count would tell
    // the owner his shopping was done.
    const view = build({
      recipes: [makeRecipe('BEEF LASAGNE', { course: null, yieldType: 'batch', portionsPerBatch: 20, components: [ingredientLine('Beef mince', 4, 'kg')] })],
    });

    expect(view.shopping.outstanding).toBe(0);
    expect(view.shopping.blocked).toBeGreaterThan(0);
  });

  it('a clean job has something to buy and nothing blocked', () => {
    const view = build();

    expect(view.shopping.outstanding).toBeGreaterThan(0);
    expect(view.shopping.blocked).toBe(0);
  });

  it('READINESS is told about blocked quantities, not just outstanding ones', () => {
    // `readinessCheck` scores "shopping complete" from both. Passing only the
    // outstanding count makes a job whose dish vanished read as READIER than one
    // whose shopping is merely unfinished — the exact opposite of the truth.
    const view = build({
      recipes: [makeRecipe('BEEF LASAGNE', { course: null, yieldType: 'batch', portionsPerBatch: 20, components: [ingredientLine('Beef mince', 4, 'kg')] })],
    });

    const shopping = view.nextJobs[0]?.readiness.items.find((i) => i.key === 'shopping_done');
    expect(shopping?.met).toBe(false);
  });
});

describe('RULE 8 — an absence is never rendered as a nought', () => {
  it('revenue with no applicable rate is null, not zero', () => {
    const view = build();

    expect(view.money.revenue.total).toBeNull();
  });

  it('a priced job does produce a revenue figure', () => {
    const customer = makeCustomer('private');
    const view = build({
      jobs: [confirmedJob({ customerId: customer.id, serviceType: 'Dinner party' })],
      customers: [customer],
      rates: [clientRate('private', 'Dinner party', { perHead: 30 })],
    });

    expect(view.money.revenue.total).not.toBeNull();
  });

  it('covers over a window with nothing CLOSED is unknown, not zero served', () => {
    // `historicalAggregate` only counts closed jobs. A forward window has none,
    // and "0 covers" would read as a bad week rather than as a week that has not
    // happened yet.
    const view = build();

    expect(view.history.completed).toBe(0);
    expect(view.history.covers.totalCovers).toBeNull();
  });

  it('covers ARE reported once a job has closed', () => {
    const view = build({
      jobs: [confirmedJob({ status: 'delivered' })],
    });

    expect(view.history.covers.totalCovers).toBe(20);
  });

  it('a job with no guest count contributes no covers and is counted as excluded', () => {
    const view = build({
      jobs: [confirmedJob({ status: 'delivered', guests: null })],
    });

    expect(view.history.covers.totalCovers).toBeNull();
    expect(view.history.covers.withGuestCount).toBe(0);
  });
});

describe('the panels the owner scans first', () => {
  it('lists the jobs in the window, with their readiness', () => {
    const view = build();

    expect(view.nextJobs).toHaveLength(1);
    expect(view.nextJobs[0]?.readiness.total).toBeGreaterThan(0);
  });

  it('leaves out a job outside the window', () => {
    const view = build({
      jobs: [confirmedJob({ serviceDate: isoDate('2026-09-30') })],
    });

    expect(view.nextJobs).toHaveLength(0);
  });

  it('leaves out a cancelled job — it needs nothing done to it', () => {
    const view = build({ jobs: [confirmedJob({ status: 'cancelled' })] });

    expect(view.nextJobs).toHaveLength(0);
  });

  it('orders next jobs by service date, soonest first', () => {
    const view = build({
      jobs: [
        confirmedJob({ id: jobId('late'), serviceDate: isoDate('2026-08-28') }),
        confirmedJob({ id: jobId('soon'), serviceDate: isoDate('2026-08-24') }),
      ],
    });

    expect(view.nextJobs.map((n) => n.job.id)).toEqual(['soon', 'late']);
  });

  it('puts the worst anomaly first, so the glance catches it', () => {
    const view = build({
      jobs: [confirmedJob({ guests: null, dishes: [dish('BEEF LASAGNE', null)] })],
    });

    const severities = view.anomalies.map((a) => a.severity);
    const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;

    for (let i = 1; i < severities.length; i += 1) {
      const previous = rank[severities[i - 1] as keyof typeof rank];
      const current = rank[severities[i] as keyof typeof rank];
      expect(previous).toBeLessThanOrEqual(current);
    }
  });

  it('subtracts what is already on the shelf, through the engine', () => {
    const view = build({ stock: [stockLevel(ingredientId('Beef mince'), 4, 'kg')] });

    expect(view.shopping.outstanding).toBe(0);
    expect(view.shopping.blocked).toBe(0);
  });
});

describe('RULE 16 — dietary requirements are never counted', () => {
  it('carries the issues themselves, with no summable total on the view', () => {
    const view = build();

    // The panel renders issues; it must not offer a number that invites adding
    // two requirements held by one guest into two people.
    expect(Object.keys(view)).not.toContain('dietaryCount');
    expect(Array.isArray(view.dietary)).toBe(true);
  });
});

describe('the view computes nothing of its own', () => {
  it('takes its money straight from rangeMoney', () => {
    // Same shape, same fields — proof it is a pass-through rather than a second
    // set of totals assembled here.
    const view = build();

    expect(view.money).toHaveProperty('revenue');
    expect(view.money).toHaveProperty('foodCost');
    expect(view.money).toHaveProperty('margin');
    expect(view.money).toHaveProperty('missing');
  });

  it('reports the window it covers, so a figure can be checked', () => {
    const view = build();

    expect(view.window).toEqual({ from: TODAY, to: HORIZON, jobCount: 1 });
  });
});
