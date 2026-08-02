/**
 * Historical aggregates — counts, average covers, revenue by service type,
 * customer and period.
 *
 * Two rules carry this file, and they are the same rule seen twice.
 *
 * **Unknown is never zero.** A job that could not be priced is EXCLUDED from the
 * total and counted in `unpriced`, never folded in as zero. Every average divides
 * by what it could actually measure — revenue over `priced`, covers over
 * `withGuestCount` — so a figure is never quietly diluted by the things it could
 * not see. Rule 11: never present a partial sum as a total.
 *
 * **Cancelled jobs stay visible.** Rule 15 keeps them in the system precisely
 * because historical aggregates depend on them. They are counted, kept out of
 * covers served and revenue earned, and their value reported separately — "what
 * did we lose to cancellations" is a real question, and mixing it into earned
 * revenue would answer a different one.
 */

import { jobRevenue } from './costing';
import type { Cents, ClientRate, Customer, CustomerId, Job } from './types';

export interface CoversAggregate {
  /** Null when no job in the slice had a guest count. Not zero. */
  readonly totalCovers: number | null;
  /** Over the jobs WITH a guest count, never over all of them. */
  readonly averageCovers: number | null;
  readonly withGuestCount: number;
  /** Excluded from the figures above, and visibly so. */
  readonly withoutGuestCount: number;
}

export interface RevenueAggregate {
  /** Null when nothing in the slice could be priced. Zero is a real revenue. */
  readonly total: Cents | null;
  /** total / priced, never total / jobs. */
  readonly average: Cents | null;
  readonly priced: number;
  /** Excluded from the total, and visibly so. */
  readonly unpriced: number;
}

export interface AggregateSlice {
  /** Every closed job in the slice, cancelled ones included. */
  readonly jobs: number;
  readonly completed: number;
  readonly cancelled: number;
  /** Completed jobs only — cancelled covers were never served. */
  readonly covers: CoversAggregate;
  /** Completed jobs only — this is money earned. */
  readonly revenue: RevenueAggregate;
  /** What the cancellations would have been worth. Never mixed into `revenue`. */
  readonly cancelledRevenue: RevenueAggregate;
}

export interface KeyedSlice<K = string> extends AggregateSlice {
  readonly key: K;
}

export interface HistoricalAggregate {
  readonly overall: AggregateSlice;
  readonly byServiceType: readonly KeyedSlice[];
  readonly byCustomer: readonly KeyedSlice<CustomerId | null>[];
  /** Keyed 'YYYY-MM'. */
  readonly byPeriod: readonly KeyedSlice[];
  /** Jobs with no service date: counted overall, but they belong to no period. */
  readonly undated: number;
}

/** A job and the revenue the engine could derive for it — null if it could not. */
interface Priced {
  readonly job: Job;
  readonly revenue: Cents | null;
}

const COMPLETED = new Set(['delivered', 'invoiced', 'paid']);

function coversOf(jobs: readonly Job[]): CoversAggregate {
  const counted = jobs.filter((j) => j.guests !== null);
  const withGuestCount = counted.length;

  if (withGuestCount === 0) {
    return {
      totalCovers: null,
      averageCovers: null,
      withGuestCount: 0,
      withoutGuestCount: jobs.length,
    };
  }

  const totalCovers = counted.reduce((n, j) => n + (j.guests ?? 0), 0);

  return {
    totalCovers,
    // Divided by what could be measured, not by every job.
    averageCovers: totalCovers / withGuestCount,
    withGuestCount,
    withoutGuestCount: jobs.length - withGuestCount,
  };
}

function revenueOf(entries: readonly Priced[]): RevenueAggregate {
  const priced = entries.filter((e) => e.revenue !== null);

  if (priced.length === 0) {
    return { total: null, average: null, priced: 0, unpriced: entries.length };
  }

  const total = priced.reduce((n, e) => n + (e.revenue as number), 0);

  return {
    total: total as Cents,
    // Divided by the jobs that could be priced. Dividing by every job would
    // silently treat an unknown revenue as zero and drag the average down.
    average: Math.round(total / priced.length) as Cents,
    priced: priced.length,
    unpriced: entries.length - priced.length,
  };
}

function sliceOf(entries: readonly Priced[]): AggregateSlice {
  const completed = entries.filter((e) => COMPLETED.has(e.job.status));
  const cancelled = entries.filter((e) => e.job.status === 'cancelled');

  return {
    jobs: entries.length,
    completed: completed.length,
    cancelled: cancelled.length,
    covers: coversOf(completed.map((e) => e.job)),
    revenue: revenueOf(completed),
    cancelledRevenue: revenueOf(cancelled),
  };
}

function groupBy<K>(
  entries: readonly Priced[],
  key: (e: Priced) => K | undefined,
): KeyedSlice<K>[] {
  const groups = new Map<K, Priced[]>();

  for (const entry of entries) {
    const k = key(entry);
    if (k === undefined) continue;

    const existing = groups.get(k);
    if (existing === undefined) groups.set(k, [entry]);
    else existing.push(entry);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0))
    .map(([key, group]) => ({ key, ...sliceOf(group) }));
}

/**
 * Aggregate the jobs that have finished, one way or the other.
 *
 * Only closed statuses count — `delivered`, `invoiced`, `paid` and `cancelled`.
 * An enquiry has not happened, and counting it would inflate both covers and
 * revenue with work that may never exist.
 *
 * Revenue comes from `jobRevenue`, so Rule 11's overrides, the flat-fee and
 * per-head combination, and the null-when-no-rate behaviour are all inherited
 * rather than reimplemented (Rule 5). The only arithmetic here is summing and
 * dividing.
 */
export function historicalAggregate(
  jobs: readonly Job[],
  customers: readonly Customer[],
  rates: readonly ClientRate[],
): HistoricalAggregate {
  const customerById = new Map(customers.map((c) => [c.id, c]));

  const entries: Priced[] = jobs
    .filter((j) => COMPLETED.has(j.status) || j.status === 'cancelled')
    .map((job) => ({
      job,
      revenue: jobRevenue(
        job,
        job.customerId === null ? undefined : customerById.get(job.customerId),
        rates,
      ).total,
    }));

  return {
    overall: sliceOf(entries),
    byServiceType: groupBy(entries, (e) => e.job.serviceType ?? undefined),
    byCustomer: groupBy<CustomerId | null>(entries, (e) => e.job.customerId),
    byPeriod: groupBy(entries, (e) =>
      e.job.serviceDate === null ? undefined : e.job.serviceDate.slice(0, 7),
    ),
    undated: entries.filter((e) => e.job.serviceDate === null).length,
  };
}
