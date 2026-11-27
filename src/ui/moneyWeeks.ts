/**
 * REVENUE BY WEEK, for the chart on Money.
 *
 * NO NEW ARITHMETIC. Each week's figure is `rangeMoney` — the same engine call
 * that produces the totals above the chart — run over that week's jobs. This
 * file only decides which jobs fall in which week, and says plainly how sure
 * each bar is:
 *
 *   none      no jobs that week                 → drawn as a gap, "no jobs"
 *   unpriced  jobs, but none of them priced     → hatched gap, "not priced"
 *   partial   some priced, some not             → the subtotal, MARKED
 *   full      every job priced                  → the figure
 *
 * A week the date window cuts in half is `clipped`. Partial and clipped weeks
 * are drawn, but never used in the headline comparison: comparing a full week
 * with half of one, or a priced total with a subtotal, would state a finding
 * that is not true.
 *
 * Weeks start on Monday. Pure: no DOM, no React.
 */

import { rangeMoney, type RevenueTotal } from '../engine/costing';
import type { ClientRate, Customer, Ingredient, Job, Recipe } from '../engine/types';

export type WeekState = 'none' | 'unpriced' | 'partial' | 'full';

export interface MoneyWeek {
  /** The Monday, ISO date. */
  readonly start: string;
  /** "16 Nov" */
  readonly label: string;
  readonly clipped: boolean;
  readonly state: WeekState;
  readonly revenue: RevenueTotal;
}

export interface WeekComparison {
  readonly latest: MoneyWeek;
  readonly previous: MoneyWeek;
  /** Whether `previous` is the week immediately before `latest`. */
  readonly adjacent: boolean;
}

const DAY = 86_400_000;
const parse = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The Monday on or before a date. */
export function mondayOf(date: string): string {
  const ms = parse(date);
  const dow = new Date(ms).getUTCDay(); // 0 Sun … 6 Sat
  const back = (dow + 6) % 7;
  return iso(ms - back * DAY);
}

const label = (monday: string): string =>
  new Date(parse(monday)).toLocaleDateString('en-IE', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

export function moneyWeeks(
  jobs: readonly Job[],
  from: string,
  to: string,
  customers: readonly Customer[],
  rates: readonly ClientRate[],
  recipes: readonly Recipe[],
  ingredients: readonly Ingredient[],
): MoneyWeek[] {
  if (from > to) return [];

  const weeks: MoneyWeek[] = [];
  for (let start = mondayOf(from); start <= to; start = iso(parse(start) + 7 * DAY)) {
    const end = iso(parse(start) + 6 * DAY);
    const inWeek = jobs.filter(
      (j) =>
        j.serviceDate !== null &&
        j.serviceDate >= start &&
        j.serviceDate <= end &&
        j.serviceDate >= from &&
        j.serviceDate <= to,
    );
    const revenue = rangeMoney(inWeek, customers, rates, recipes, ingredients).revenue;
    const state: WeekState =
      revenue.priced + revenue.unpriced === 0
        ? 'none'
        : revenue.priced === 0
          ? 'unpriced'
          : revenue.unpriced > 0
            ? 'partial'
            : 'full';

    weeks.push({
      start,
      label: label(start),
      clipped: start < from || end > to,
      state,
      revenue,
    });
  }
  return weeks;
}

/** The last two weeks that can honestly be compared, or null if fewer than two. */
export function latestComparison(weeks: readonly MoneyWeek[]): WeekComparison | null {
  const usable = weeks.filter((w) => w.state === 'full' && !w.clipped);
  const latest = usable[usable.length - 1];
  const previous = usable[usable.length - 2];
  if (latest === undefined || previous === undefined) return null;
  return {
    latest,
    previous,
    adjacent: parse(latest.start) - parse(previous.start) === 7 * DAY,
  };
}
