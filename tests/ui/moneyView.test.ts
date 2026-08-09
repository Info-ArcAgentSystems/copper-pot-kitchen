/**
 * The money screen's rows, built from engine output.
 *
 * PURE, and here the NULL CASES ARE THE PRODUCT. On every other screen a missing
 * value is an edge case; on this one it is the main event, because the expensive
 * mistake in catering is a job that looks profitable only because an unpriced
 * ingredient counted as free.
 *
 * So the assertions are mostly about what must NOT appear: no €0.00 standing in
 * for unknown, no margin where either side is missing, and no percentage at all
 * until the owner says which basis he means.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildMoneyView } from '../../src/ui/moneyView';
import type { MarginResult, RangeMoneyResult, RevenueResult } from '../../src/engine/costing';
import type { Cents, Customer, CustomerId, IsoDate, Job, JobId, KitchenId } from '../../src/engine/types';

const KITCHEN = 'k1' as KitchenId;
const c = (n: number): Cents => n as Cents;

const job = (id: string, over: Partial<Job> = {}): Job => ({
  id: id as JobId,
  kitchenId: KITCHEN,
  customerId: 'c1' as CustomerId,
  propertyId: null,
  jobGroup: null,
  serviceDate: '2026-08-18' as IsoDate,
  serviceTime: null,
  serviceType: 'Buffet',
  guests: 10,
  guestsConfirmed: true,
  meatEatingGuests: null,
  pricing: { kind: 'rate_card' },
  status: 'confirmed',
  notes: null,
  dishes: [],
  dietaries: [],
  extras: [],
  ...over,
});

const customer: Customer = {
  id: 'c1' as CustomerId,
  kitchenId: KITCHEN,
  name: 'Nolan',
  phone: null,
  email: null,
  clientGroup: 'private',
  notes: null,
};

const margin = (over: Partial<MarginResult> = {}): MarginResult => ({
  revenue: c(30000),
  foodCost: c(9000),
  margin: c(21000),
  missing: [],
  ...over,
});

const revenue = (over: Partial<RevenueResult> = {}): RevenueResult => ({
  total: c(30000),
  computed: c(30000),
  isOverride: false,
  missing: [],
  ...over,
});

const range = (over: Partial<RangeMoneyResult> = {}): RangeMoneyResult => ({
  jobs: 1,
  revenue: { total: c(30000), priced: 1, unpriced: 0 },
  foodCost: { total: c(9000), costed: 1, uncosted: 0 },
  margin: { total: c(21000), withMargin: 1, withoutMargin: 0 },
  cancelled: { jobs: 0, revenue: { total: null, priced: 0, unpriced: 0 } },
  missing: [],
  ...over,
});

const view = (
  rows: { job: Job; margin: MarginResult; revenue: RevenueResult }[] = [
    { job: job('j1'), margin: margin(), revenue: revenue() },
  ],
  total: RangeMoneyResult = range(),
) => buildMoneyView(rows, total, [customer]);

describe('a job that costs out cleanly', () => {
  it('shows all three figures', () => {
    const [row] = view().rows;

    expect(row?.revenue).toBe('€300.00');
    expect(row?.foodCost).toBe('€90.00');
    expect(row?.margin).toBe('€210.00');
  });

  it('names the job so the row is identifiable', () => {
    const [row] = view().rows;
    expect(row?.heading).toContain('Nolan');
  });

  it('has nothing blocking it', () => {
    const [row] = view().rows;
    expect(row?.blockers).toEqual([]);
  });
});

describe('RULE 8 — an unknown is stated, never €0.00', () => {
  it('shows food cost as a stated absence when it cannot be costed', () => {
    const [row] = view([
      {
        job: job('j1'),
        margin: margin({
          foodCost: null,
          margin: null,
          missing: [{ reason: 'unpriced_ingredient', detail: 'mince has no price per pack' }],
        }),
        revenue: revenue(),
      },
    ]).rows;

    expect(row?.foodCost).not.toContain('0.00');
    expect(row?.foodCost).toBe('not known yet');
  });

  it('THE TRAP: margin is blank when revenue is known but cost is not', () => {
    // A €300 job with an uncostable menu must never read as a €300 margin. That
    // is the single most expensive misreading this screen can produce.
    const [row] = view([
      {
        job: job('j1'),
        margin: margin({ foodCost: null, margin: null }),
        revenue: revenue(),
      },
    ]).rows;

    expect(row?.revenue).toBe('€300.00');
    expect(row?.margin).toBe('not known yet');
    expect(row?.margin).not.toContain('300');
  });

  it('shows revenue as a stated absence when no rate applies', () => {
    const [row] = view([
      {
        job: job('j1'),
        margin: margin({ revenue: null, margin: null }),
        revenue: revenue({ total: null, computed: null }),
      },
    ]).rows;

    expect(row?.revenue).toBe('not known yet');
    expect(row?.margin).toBe('not known yet');
  });

  it('renders a genuine zero as €0.00, distinct from unknown', () => {
    // Zero revenue is a real statement — a favour, a write-off. It must not read
    // the same as "I do not know".
    const [row] = view([
      {
        job: job('j1'),
        margin: margin({ revenue: c(0), margin: c(-9000) }),
        revenue: revenue({ total: c(0), computed: c(0) }),
      },
    ]).rows;

    expect(row?.revenue).toBe('€0.00');
  });

  it('shows a loss rather than hiding it', () => {
    const [row] = view([
      { job: job('j1'), margin: margin({ margin: c(-5000) }), revenue: revenue() },
    ]).rows;

    expect(row?.margin).toContain('50.00');
    expect(row?.isLoss).toBe(true);
  });
});

describe('what is blocking the number', () => {
  it('routes an unpriced ingredient to Ingredients', () => {
    const [row] = view([
      {
        job: job('j1'),
        margin: margin({
          foodCost: null,
          margin: null,
          missing: [{ reason: 'unpriced_ingredient', detail: 'mince has no price per pack' }],
        }),
        revenue: revenue(),
      },
    ]).rows;

    expect(row?.blockers[0]?.where).toBe('Ingredients');
    expect(row?.blockers[0]?.label).toContain('mince');
  });

  it('routes a missing rate to the Rate card, not to Jobs', () => {
    // Sending him to the wrong screen is worse than sending him nowhere.
    const [row] = view([
      {
        job: job('j1'),
        margin: margin({
          revenue: null,
          margin: null,
          missing: [{ reason: 'no_rate', detail: 'no rate for (private, Buffet)' }],
        }),
        revenue: revenue({ total: null }),
      },
    ]).rows;

    expect(row?.blockers[0]?.where).toBe('Rate card');
  });

  it('de-duplicates a blocker the same job reports twice', () => {
    const [row] = view([
      {
        job: job('j1'),
        margin: margin({
          foodCost: null,
          margin: null,
          missing: [
            { reason: 'unpriced_ingredient', detail: 'mince has no price per pack' },
            { reason: 'unpriced_ingredient', detail: 'mince has no price per pack' },
          ],
        }),
        revenue: revenue(),
      },
    ]).rows;

    expect(row?.blockers).toHaveLength(1);
  });
});

describe('RULE 11 — the computed figure stays visible beside an override', () => {
  it('shows what was overridden', () => {
    const [row] = view([
      {
        job: job('j1', { pricing: { kind: 'override', amount: c(32000) } }),
        margin: margin({ revenue: c(32000), margin: c(23000) }),
        revenue: revenue({ total: c(32000), computed: c(30000), isOverride: true }),
      },
    ]).rows;

    expect(row?.revenue).toBe('€320.00');
    expect(row?.overriddenFrom).toBe('€300.00');
  });

  it('says nothing about an override when there is none', () => {
    expect(view().rows[0]?.overriddenFrom).toBeNull();
  });

  it('still marks an override when the rate card could not produce a figure', () => {
    const [row] = view([
      {
        job: job('j1', { pricing: { kind: 'override', amount: c(32000) } }),
        margin: margin({ revenue: c(32000) }),
        revenue: revenue({ total: c(32000), computed: null, isOverride: true }),
      },
    ]).rows;

    expect(row?.overriddenFrom).toBe('no rate applies');
  });
});

describe('the range summary', () => {
  it('shows the totals', () => {
    const { summary } = view();

    expect(summary.revenue).toBe('€300.00');
    expect(summary.margin).toBe('€210.00');
  });

  it('SAYS what the total does not cover', () => {
    // A subtotal presented as a total is exactly what Rule 11 forbids.
    const { summary } = view(undefined, range({
      revenue: { total: c(90000), priced: 2, unpriced: 1 },
      foodCost: { total: c(900), costed: 1, uncosted: 2 },
      margin: { total: c(29100), withMargin: 1, withoutMargin: 2 },
      jobs: 3,
    }));

    expect(summary.revenueNote).toContain('1');
    expect(summary.foodCostNote).toContain('2');
    expect(summary.marginNote).toContain('2');
  });

  it('says nothing extra when the total covers everything', () => {
    expect(view().summary.revenueNote).toBeNull();
  });

  it('reports cancelled value separately, never mixed in', () => {
    const { summary } = view(undefined, range({
      cancelled: { jobs: 1, revenue: { total: c(60000), priced: 1, unpriced: 0 } },
    }));

    expect(summary.revenue).toBe('€300.00');
    expect(summary.cancelledNote).toContain('€600.00');
  });

  it('says nothing about cancellations when there are none', () => {
    expect(view().summary.cancelledNote).toBeNull();
  });

  it('shows an empty range as unknown rather than zero', () => {
    const { summary } = view([], range({
      jobs: 0,
      revenue: { total: null, priced: 0, unpriced: 0 },
      foodCost: { total: null, costed: 0, uncosted: 0 },
      margin: { total: null, withMargin: 0, withoutMargin: 0 },
    }));

    expect(summary.revenue).toBe('not known yet');
    expect(summary.revenue).not.toContain('0.00');
  });
});

describe('THE GUARD: no margin percentage, on either basis', () => {
  // Whether margin is a percentage of price or of cost is an open owner question,
  // and the two differ substantially at catering margins. Picking one silently
  // would put a number in front of him that he never chose.
  //
  // Without this test a future session adds a percentage in thirty seconds and
  // nobody notices which basis it assumed.
  const sources = [
    'src/ui/moneyView.ts',
    'src/features/money/Money.tsx',
  ].map((path) => ({
    path,
    code: readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      // Import specifiers are PATHS, not division. `from '../engine/costing'`
      // contains "/cost" and tripped the first version of this guard — the same
      // false positive the engine purity guard hit on `windowFrom`.
      .replace(/^\s*import[\s\S]*?from\s*['"][^'"]+['"];?$/gm, ''),
  }));

  it.each(sources)('$path renders no percent sign', ({ code }) => {
    expect(code).not.toContain('%');
  });

  it.each(sources)('$path divides by neither revenue nor cost', ({ code }) => {
    expect(code).not.toMatch(/\/\s*\w*[Rr]evenue/);
    expect(code).not.toMatch(/\/\s*\w*[Cc]ost/);
    expect(code).not.toMatch(/\*\s*100/);
  });

  it('exposes no percentage field on any row', () => {
    const [row] = view().rows;
    const keys = Object.keys(row ?? {}).join(' ').toLowerCase();

    expect(keys).not.toContain('percent');
    expect(keys).not.toContain('pct');
  });
});
