/**
 * historicalAggregate.
 *
 * Worked numbers first, per CLAUDE.md section 5.
 *
 * Two defects guarded here, which are the same defect seen twice:
 *
 *   - a revenue that is UNKNOWN averaged or totalled as though it were zero.
 *     The weekend set below has 7 priceable jobs and one that is not; the honest
 *     average is EUR 249.71 over 7, and the silent-zero answer is EUR 218.50
 *     over 8. That EUR 31 gap is the bug, on real data.
 *   - a cancelled job vanishing. Rule 15 keeps it in history; it just must not
 *     count as covers served or money earned.
 */

import { describe, expect, it } from 'vitest';
import { historicalAggregate } from '../../src/engine/history';
import {
  clientRate,
  euros,
  isoDate,
  jobId,
  makeCustomer,
  makeJob,
} from './factories';
import type { CustomerId } from '../../src/engine/types';

/**
 * The WEEKEND-2026-07-17-19 set. Seven jobs price from the rate card; the
 * Tranquillity BBQ does not, because the rate card has no (Tranquillity, BBQ)
 * entry. That is the open owner decision recorded in PENDING_OWNER.md section 2.
 */
const rates = [
  clientRate('Tranquillity', 'Buffet', { perHead: 20 }),
  clientRate('Visit Carlingford', 'BBQ', { perHead: 15 }),
  clientRate('Visit Carlingford', 'Breakfast', { perHead: 15 }),
  clientRate('Other', 'Afternoon Tea', { perHead: 18 }),
  // Deliberately absent: (Tranquillity, BBQ).
];

const tranquillity = makeCustomer('Tranquillity', { id: 'c-tranq' as CustomerId });
const carlingford = makeCustomer('Visit Carlingford', { id: 'c-carl' as CustomerId });
const other = makeCustomer('Other', { id: 'c-other' as CustomerId });
const customers = [tranquillity, carlingford, other];

const closed = (
  id: string,
  date: string,
  serviceType: string,
  guests: number | null,
  customerId: CustomerId,
  over = {},
) =>
  makeJob({
    id: jobId(id),
    serviceDate: isoDate(date),
    serviceType,
    guests,
    customerId,
    status: 'paid',
    ...over,
  });

const weekend = [
  closed('nucella-buffet', '2026-07-17', 'Buffet', 15, tranquillity.id),
  closed('starboard-bbq', '2026-07-17', 'BBQ', 12, carlingford.id),
  closed('pandora-tea', '2026-07-18', 'Afternoon Tea', 16, other.id),
  // No rate exists for this pair. Revenue is null, not EUR 320.
  closed('tranquillity-bbq', '2026-07-18', 'BBQ', 16, tranquillity.id),
  closed('sweetpea-buffet', '2026-07-18', 'Buffet', 12, tranquillity.id),
  closed('pandora-buffet', '2026-07-18', 'Buffet', 16, tranquillity.id),
  closed('pandora-breakfast', '2026-07-19', 'Breakfast', 16, carlingford.id),
  closed('sweetpea-breakfast', '2026-07-19', 'Breakfast', 12, carlingford.id),
];

describe('historicalAggregate — unknown revenue is excluded, never zeroed', () => {
  it('totals only what it could price, and says how many that was', () => {
    const agg = historicalAggregate(weekend, customers, rates);

    // 300 + 180 + 288 + 240 + 320 + 240 + 180 = 1748.
    expect(agg.overall.revenue.total).toBe(euros(1748));
    expect(agg.overall.revenue.priced).toBe(7);
    expect(agg.overall.revenue.unpriced).toBe(1);
  });

  it('THE GUARD: averages over the priced jobs, not over all of them', () => {
    const agg = historicalAggregate(weekend, customers, rates);

    // 1748 / 7 = 249.71.  1748 / 8 = 218.50 is the silent-zero answer.
    expect(agg.overall.revenue.average).toBe(24971);
    expect(agg.overall.revenue.average).not.toBe(21850);
  });

  it('does not invent the missing job to reach the fixture total of 2068', () => {
    const agg = historicalAggregate(weekend, customers, rates);
    expect(agg.overall.revenue.total).not.toBe(euros(2068));
  });

  it('reports null rather than zero when nothing can be priced', () => {
    const agg = historicalAggregate(weekend, customers, []);

    expect(agg.overall.revenue.total).toBeNull();
    expect(agg.overall.revenue.average).toBeNull();
    expect(agg.overall.revenue.unpriced).toBe(8);
  });

  it('counts an overridden price as priced', () => {
    const jobs = [
      closed('override', '2026-07-18', 'BBQ', 16, tranquillity.id, {
        pricing: { kind: 'override', amount: euros(320) },
      }),
    ];
    const agg = historicalAggregate(jobs, customers, rates);

    expect(agg.overall.revenue.total).toBe(euros(320));
    expect(agg.overall.revenue.unpriced).toBe(0);
  });
});

describe('historicalAggregate — covers', () => {
  it('totals and averages covers over the jobs that had a guest count', () => {
    const agg = historicalAggregate(weekend, customers, rates);

    // 15 + 12 + 16 + 16 + 12 + 16 + 16 + 12 = 115.
    expect(agg.overall.covers.totalCovers).toBe(115);
    expect(agg.overall.covers.withGuestCount).toBe(8);
    expect(agg.overall.covers.averageCovers).toBeCloseTo(14.375, 3);
  });

  it('excludes a job with no guest count instead of counting it as zero', () => {
    const jobs = [
      closed('a', '2026-07-17', 'Buffet', 20, tranquillity.id),
      closed('b', '2026-07-17', 'Buffet', null, tranquillity.id),
    ];
    const agg = historicalAggregate(jobs, customers, rates);

    expect(agg.overall.covers.totalCovers).toBe(20);
    expect(agg.overall.covers.withGuestCount).toBe(1);
    expect(agg.overall.covers.withoutGuestCount).toBe(1);
    // 20, not 10.
    expect(agg.overall.covers.averageCovers).toBe(20);
  });

  it('reports null covers when no job had a guest count', () => {
    const jobs = [closed('a', '2026-07-17', 'Buffet', null, tranquillity.id)];
    const agg = historicalAggregate(jobs, customers, rates);

    expect(agg.overall.covers.totalCovers).toBeNull();
    expect(agg.overall.covers.averageCovers).toBeNull();
  });
});

describe('historicalAggregate — Rule 15, cancelled jobs stay visible', () => {
  const withCancellation = [
    closed('live', '2026-07-17', 'Buffet', 20, tranquillity.id),
    closed('dead', '2026-07-18', 'Buffet', 30, tranquillity.id, { status: 'cancelled' }),
  ];

  it('counts a cancelled job rather than dropping it', () => {
    const agg = historicalAggregate(withCancellation, customers, rates);

    expect(agg.overall.jobs).toBe(2);
    expect(agg.overall.completed).toBe(1);
    expect(agg.overall.cancelled).toBe(1);
  });

  it('keeps cancelled covers out of the covers figures', () => {
    const agg = historicalAggregate(withCancellation, customers, rates);

    // 20, not 50. Those 30 covers were never served.
    expect(agg.overall.covers.totalCovers).toBe(20);
    expect(agg.overall.covers.withGuestCount).toBe(1);
  });

  it('keeps cancelled revenue out of the earned total', () => {
    const agg = historicalAggregate(withCancellation, customers, rates);

    // 20 x EUR 20 = EUR 400 earned. The cancelled EUR 600 is not earned.
    expect(agg.overall.revenue.total).toBe(euros(400));
    expect(agg.overall.revenue.priced).toBe(1);
  });

  it('reports what the cancellation would have been worth, separately', () => {
    const agg = historicalAggregate(withCancellation, customers, rates);

    expect(agg.overall.cancelledRevenue.total).toBe(euros(600));
    expect(agg.overall.cancelledRevenue.priced).toBe(1);
  });

  it('ignores jobs that have not happened yet', () => {
    const jobs = [
      closed('done', '2026-07-17', 'Buffet', 20, tranquillity.id),
      closed('maybe', '2026-07-18', 'Buffet', 40, tranquillity.id, { status: 'enquiry' }),
      closed('booked', '2026-07-19', 'Buffet', 40, tranquillity.id, { status: 'confirmed' }),
    ];
    const agg = historicalAggregate(jobs, customers, rates);

    expect(agg.overall.jobs).toBe(1);
    expect(agg.overall.covers.totalCovers).toBe(20);
  });

  it('treats delivered, invoiced and paid alike as completed', () => {
    const jobs = [
      closed('a', '2026-07-17', 'Buffet', 10, tranquillity.id, { status: 'delivered' }),
      closed('b', '2026-07-18', 'Buffet', 10, tranquillity.id, { status: 'invoiced' }),
      closed('c', '2026-07-19', 'Buffet', 10, tranquillity.id, { status: 'paid' }),
    ];
    const agg = historicalAggregate(jobs, customers, rates);

    expect(agg.overall.completed).toBe(3);
    expect(agg.overall.covers.totalCovers).toBe(30);
  });
});

describe('historicalAggregate — grouping', () => {
  it('groups by service type', () => {
    const agg = historicalAggregate(weekend, customers, rates);
    const buffet = agg.byServiceType.find((s) => s.key === 'Buffet');

    expect(buffet?.jobs).toBe(3);
    // 15 + 12 + 16 = 43 covers; 300 + 240 + 320 = EUR 860.
    expect(buffet?.covers.totalCovers).toBe(43);
    expect(buffet?.revenue.total).toBe(euros(860));
  });

  it('keeps the unpriced job visible inside its service-type group', () => {
    const agg = historicalAggregate(weekend, customers, rates);
    const bbq = agg.byServiceType.find((s) => s.key === 'BBQ');

    // Two BBQs; only the Visit Carlingford one prices.
    expect(bbq?.jobs).toBe(2);
    expect(bbq?.revenue.priced).toBe(1);
    expect(bbq?.revenue.unpriced).toBe(1);
    expect(bbq?.revenue.total).toBe(euros(180));
  });

  it('groups by customer', () => {
    const agg = historicalAggregate(weekend, customers, rates);
    const tranq = agg.byCustomer.find((s) => s.key === tranquillity.id);

    // Four Tranquillity jobs; three price.
    expect(tranq?.jobs).toBe(4);
    expect(tranq?.revenue.priced).toBe(3);
    expect(tranq?.revenue.unpriced).toBe(1);
  });

  it('groups by calendar month', () => {
    const jobs = [
      closed('jul', '2026-07-17', 'Buffet', 20, tranquillity.id),
      closed('aug', '2026-08-02', 'Buffet', 30, tranquillity.id),
    ];
    const agg = historicalAggregate(jobs, customers, rates);

    expect(agg.byPeriod.map((p) => p.key)).toEqual(['2026-07', '2026-08']);
    expect(agg.byPeriod[0]?.covers.totalCovers).toBe(20);
  });

  it('counts an undated job separately rather than inventing a period', () => {
    const jobs = [
      makeJob({
        id: jobId('undated'),
        serviceDate: null,
        serviceType: 'Buffet',
        guests: 10,
        customerId: tranquillity.id,
        status: 'paid',
      }),
    ];
    const agg = historicalAggregate(jobs, customers, rates);

    expect(agg.undated).toBe(1);
    expect(agg.byPeriod).toEqual([]);
    // It still counts overall — it happened, we just do not know when.
    expect(agg.overall.jobs).toBe(1);
  });
});

describe('historicalAggregate — empty input', () => {
  it('returns zeroes and nulls without dividing by zero', () => {
    const agg = historicalAggregate([], customers, rates);

    expect(agg.overall.jobs).toBe(0);
    expect(agg.overall.revenue.total).toBeNull();
    expect(agg.overall.revenue.average).toBeNull();
    expect(agg.overall.covers.totalCovers).toBeNull();
    expect(agg.overall.covers.averageCovers).toBeNull();
    expect(Number.isNaN(agg.overall.covers.averageCovers ?? 0)).toBe(false);
    expect(agg.byServiceType).toEqual([]);
  });
});
