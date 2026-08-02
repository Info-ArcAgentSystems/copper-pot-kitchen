/**
 * prepDateFor, productionBuckets, prepPlanByDay, prioritisePrep.
 *
 * Worked numbers first, per CLAUDE.md section 5.
 *
 * The defect this file exists to prevent: rounding batches per job instead of per
 * consolidated total. scaling.ts rounds up internally, so summing per-job results
 * over-orders. productionBuckets is the function that has to consolidate FIRST.
 *
 * Note which test is actually load-bearing. The CLAUDE.md example — 12 / 18 / 9
 * lasagne consolidating to 39 portions and 5 trays — gives 5 either way
 * (2 + 2 + 1 = 5), so on its own it would pass against a per-job implementation.
 * The guard is the 1 / 1 / 1 case: 1 tray consolidated, 3 per job.
 */

import { describe, expect, it } from 'vitest';
import {
  prepDateFor,
  prepPlanByDay,
  prioritisePrep,
  productionBuckets,
} from '../../src/engine/production';
import { dish, isoDate, jobId, makeJob, makeRecipe } from './factories';

const lasagne = makeRecipe('Lasagne', {
  yieldType: 'batch',
  portionsPerBatch: 9,
  batchUnit: 'tray',
  sameDayOnly: false,
  makeAheadDays: 1,
});

const salad = makeRecipe('Salad', {
  yieldType: 'per_person',
  sameDayOnly: true,
});

const recipes = [lasagne, salad];

const jobOn = (id: string, date: string, dishes: ReturnType<typeof dish>[], over = {}) =>
  makeJob({ id: jobId(id), serviceDate: isoDate(date), dishes, ...over });

describe('prepDateFor', () => {
  it('is the service date when the recipe is same-day only', () => {
    const job = makeJob({ serviceDate: isoDate('2026-07-22') });
    expect(prepDateFor(job, salad)).toBe('2026-07-22');
  });

  it('is the service date minus make-ahead days', () => {
    const job = makeJob({ serviceDate: isoDate('2026-07-22') });
    const makeAhead = makeRecipe('x', { sameDayOnly: false, makeAheadDays: 2 });
    expect(prepDateFor(job, makeAhead)).toBe('2026-07-20');
  });

  it('lets same-day-only win over a contradictory make-ahead value', () => {
    // The schema allows both to be set. Same-day is the harder constraint.
    const job = makeJob({ serviceDate: isoDate('2026-07-22') });
    const contradictory = makeRecipe('x', { sameDayOnly: true, makeAheadDays: 2 });
    expect(prepDateFor(job, contradictory)).toBe('2026-07-22');
  });

  it('crosses a month boundary', () => {
    const job = makeJob({ serviceDate: isoDate('2026-08-01') });
    const makeAhead = makeRecipe('x', { sameDayOnly: false, makeAheadDays: 1 });
    expect(prepDateFor(job, makeAhead)).toBe('2026-07-31');
  });

  it('crosses a year boundary', () => {
    const job = makeJob({ serviceDate: isoDate('2027-01-01') });
    const makeAhead = makeRecipe('x', { sameDayOnly: false, makeAheadDays: 1 });
    expect(prepDateFor(job, makeAhead)).toBe('2026-12-31');
  });

  it('does not drift across a DST boundary', () => {
    // Europe/Dublin springs forward on 2026-03-29. A local-time implementation
    // can land on the wrong day here.
    const job = makeJob({ serviceDate: isoDate('2026-03-30') });
    const makeAhead = makeRecipe('x', { sameDayOnly: false, makeAheadDays: 1 });
    expect(prepDateFor(job, makeAhead)).toBe('2026-03-29');
  });

  it('returns null when the job has no service date (Rule 8, not today)', () => {
    expect(prepDateFor(makeJob({ serviceDate: null }), salad)).toBeNull();
  });
});

describe('productionBuckets — consolidate BEFORE rounding', () => {
  it('THE GUARD: three jobs of 1 portion consolidate to ONE tray, not three', () => {
    // Per-job rounding gives ceil(1/9) x 3 = 3 trays. Consolidated: ceil(3/9) = 1.
    // This test fails loudly against a per-job implementation.
    const jobs = [
      jobOn('a', '2026-07-22', [dish('Lasagne', 1)]),
      jobOn('b', '2026-07-22', [dish('Lasagne', 1)]),
      jobOn('c', '2026-07-22', [dish('Lasagne', 1)]),
    ];

    const { buckets } = productionBuckets(jobs, recipes);

    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.portions).toBe(3);
    expect(buckets[0]?.batches?.batches).toBe(1);
  });

  it('also bites at 4 / 4 / 4: two trays, not three', () => {
    const jobs = [
      jobOn('a', '2026-07-22', [dish('Lasagne', 4)]),
      jobOn('b', '2026-07-22', [dish('Lasagne', 4)]),
      jobOn('c', '2026-07-22', [dish('Lasagne', 4)]),
    ];

    const { buckets } = productionBuckets(jobs, recipes);

    expect(buckets[0]?.portions).toBe(12);
    expect(buckets[0]?.batches?.batches).toBe(2);
  });

  it('the CLAUDE.md example: 12 / 18 / 9 becomes 39 portions and 5 trays', () => {
    // NOTE: this case gives 5 either way (2+2+1), so it pins the allocation
    // breakdown rather than the consolidation rule. The guard is above.
    const jobs = [
      jobOn('nucella', '2026-07-22', [dish('Lasagne', 12)]),
      jobOn('starboard', '2026-07-22', [dish('Lasagne', 18)]),
      jobOn('pandora', '2026-07-22', [dish('Lasagne', 9)]),
    ];

    const { buckets, gaps } = productionBuckets(jobs, recipes);

    expect(gaps).toEqual([]);
    expect(buckets).toHaveLength(1);

    const bucket = buckets[0];
    expect(bucket?.recipeName).toBe('Lasagne');
    expect(bucket?.prepDate).toBe('2026-07-21');
    expect(bucket?.portions).toBe(39);
    expect(bucket?.batches).toEqual({ batches: 5, capacity: 45, surplus: 6 });
    expect(bucket?.allocations).toEqual([
      { jobId: 'nucella', portions: 12 },
      { jobId: 'starboard', portions: 18 },
      { jobId: 'pandora', portions: 9 },
    ]);
  });

  it('keeps different prep dates in different buckets', () => {
    const jobs = [
      jobOn('a', '2026-07-22', [dish('Lasagne', 1)]),
      jobOn('b', '2026-07-23', [dish('Lasagne', 1)]),
    ];

    const { buckets } = productionBuckets(jobs, recipes);

    expect(buckets).toHaveLength(2);
    expect(buckets.every((b) => b.batches?.batches === 1)).toBe(true);
  });

  it('consolidates two dishes of the same recipe on one job', () => {
    const jobs = [jobOn('a', '2026-07-22', [dish('Lasagne', 5), dish('Lasagne', 5)])];

    const { buckets } = productionBuckets(jobs, recipes);

    expect(buckets[0]?.portions).toBe(10);
    expect(buckets[0]?.batches?.batches).toBe(2);
    expect(buckets[0]?.allocations).toEqual([{ jobId: 'a', portions: 10 }]);
  });

  it('leaves per-person recipes without a batch count', () => {
    const jobs = [jobOn('a', '2026-07-22', [dish('Salad', 17)])];

    const { buckets } = productionBuckets(jobs, recipes);

    expect(buckets[0]?.portions).toBe(17);
    expect(buckets[0]?.batches).toBeNull();
  });
});

describe('productionBuckets — what it refuses to do', () => {
  it('excludes cancelled jobs', () => {
    const jobs = [
      jobOn('live', '2026-07-22', [dish('Lasagne', 9)]),
      jobOn('dead', '2026-07-22', [dish('Lasagne', 9)], { status: 'cancelled' }),
    ];

    const { buckets } = productionBuckets(jobs, recipes);

    expect(buckets[0]?.portions).toBe(9);
    expect(buckets[0]?.allocations).toEqual([{ jobId: 'live', portions: 9 }]);
  });

  it('produces nothing at all when every job is cancelled', () => {
    const jobs = [jobOn('dead', '2026-07-22', [dish('Lasagne', 9)], { status: 'cancelled' })];
    expect(productionBuckets(jobs, recipes).buckets).toEqual([]);
  });

  it('includes non-cancelled jobs regardless of status', () => {
    const jobs = [
      jobOn('a', '2026-07-22', [dish('Lasagne', 1)], { status: 'enquiry' }),
      jobOn('b', '2026-07-22', [dish('Lasagne', 1)], { status: 'paid' }),
    ];

    expect(productionBuckets(jobs, recipes).buckets[0]?.portions).toBe(2);
  });

  it('gaps a dish with null portions rather than counting it as zero', () => {
    const jobs = [jobOn('a', '2026-07-22', [dish('Lasagne', null)])];

    const { buckets, gaps } = productionBuckets(jobs, recipes);

    expect(gaps.map((g) => g.reason)).toContain('no_portions');
    expect(buckets).toEqual([]);
  });

  it('gaps a missing recipe but still buckets the rest', () => {
    const jobs = [jobOn('a', '2026-07-22', [dish('Ghost', 5), dish('Lasagne', 9)])];

    const { buckets, gaps } = productionBuckets(jobs, recipes);

    expect(gaps.map((g) => g.reason)).toContain('missing_recipe');
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.recipeName).toBe('Lasagne');
  });

  it('gaps a job with no service date', () => {
    const jobs = [makeJob({ id: jobId('a'), serviceDate: null, dishes: [dish('Lasagne', 9)] })];

    const { buckets, gaps } = productionBuckets(jobs, recipes);

    expect(gaps.map((g) => g.reason)).toContain('no_service_date');
    expect(buckets).toEqual([]);
  });

  it('gaps a batch recipe with no batch size', () => {
    const broken = makeRecipe('Broken', {
      yieldType: 'batch',
      portionsPerBatch: null,
      sameDayOnly: true,
    });
    const jobs = [jobOn('a', '2026-07-22', [dish('Broken', 9)])];

    const { gaps } = productionBuckets(jobs, [broken]);

    expect(gaps.map((g) => g.reason)).toContain('no_portions_per_batch');
  });
});

describe('prepPlanByDay', () => {
  it('groups buckets into ascending days', () => {
    const jobs = [
      jobOn('a', '2026-07-23', [dish('Salad', 4)]), // same day -> 07-23
      jobOn('b', '2026-07-22', [dish('Lasagne', 9)]), // make ahead 1 -> 07-21
    ];

    const days = prepPlanByDay(productionBuckets(jobs, recipes));

    expect(days.map((d) => d.prepDate)).toEqual(['2026-07-21', '2026-07-23']);
    expect(days[0]?.buckets[0]?.recipeName).toBe('Lasagne');
  });

  it('puts several recipes for one day under a single entry', () => {
    const jobs = [jobOn('a', '2026-07-22', [dish('Salad', 4), dish('Lasagne', 9)])];
    // Salad is same-day (07-22); lasagne is make-ahead 1 (07-21).
    const days = prepPlanByDay(productionBuckets(jobs, recipes));

    expect(days).toHaveLength(2);
  });

  it('is empty for an empty plan', () => {
    expect(prepPlanByDay(productionBuckets([], recipes))).toEqual([]);
  });
});

describe('prioritisePrep', () => {
  it('orders by prep date first', () => {
    const jobs = [
      jobOn('a', '2026-07-25', [dish('Salad', 1)]),
      jobOn('b', '2026-07-22', [dish('Salad', 1)]),
    ];

    const ordered = prioritisePrep(productionBuckets(jobs, recipes).buckets);

    expect(ordered.map((b) => b.prepDate)).toEqual(['2026-07-22', '2026-07-25']);
  });

  it('puts the tighter slack first within a day', () => {
    // Both prepped 2026-07-22: the salad is served that day (slack 0), the
    // lasagne the next (slack 1). The salad cannot be moved, so it comes first.
    const jobs = [
      jobOn('a', '2026-07-23', [dish('Lasagne', 9)]), // make ahead 1 -> prep 07-22
      jobOn('b', '2026-07-22', [dish('Salad', 4)]), // same day  -> prep 07-22
    ];

    const ordered = prioritisePrep(productionBuckets(jobs, recipes).buckets);

    expect(ordered.map((b) => b.recipeName)).toEqual(['Salad', 'Lasagne']);
  });

  it('puts the bigger job first when slack ties', () => {
    const big = makeRecipe('Big', { yieldType: 'per_person', sameDayOnly: true });
    const small = makeRecipe('Small', { yieldType: 'per_person', sameDayOnly: true });
    const jobs = [
      jobOn('a', '2026-07-22', [dish('Small', 2)]),
      jobOn('b', '2026-07-22', [dish('Big', 40)]),
    ];

    const ordered = prioritisePrep(productionBuckets(jobs, [big, small]).buckets);

    expect(ordered.map((b) => b.recipeName)).toEqual(['Big', 'Small']);
  });

  it('does not mutate the array it is given', () => {
    const jobs = [
      jobOn('a', '2026-07-25', [dish('Salad', 1)]),
      jobOn('b', '2026-07-22', [dish('Salad', 1)]),
    ];
    const { buckets } = productionBuckets(jobs, recipes);
    const before = [...buckets];

    prioritisePrep(buckets);

    expect(buckets).toEqual(before);
  });
});
