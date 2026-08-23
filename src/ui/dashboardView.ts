/**
 * The dashboard, assembled.
 *
 * PURE, and it computes NOTHING. Every figure here is produced by a function that
 * already exists and is already tested; this file decides only what sits next to
 * what. If a calculation ever appears below, it is a second implementation of a
 * step the cascade already owns (Rule 5) — and it will be the copy that drifts,
 * because it lives on the screen nobody scrolls past.
 *
 * DERIVED ON EVERY VIEW, LIKE THE OTHER THREE (Rule 6). The dashboard is the
 * strictest case of that rule in the app: shopping, prep and packing each persist
 * the owner's tick, and this persists nothing whatever. `tests/ui/derived.test.ts`
 * holds it to that.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SCREEN NEEDS MORE CARE THAN IT LOOKS LIKE IT DOES.
 *
 * A dashboard's characteristic failure is looking calm. Every panel has a state
 * where the honest answer is "I cannot tell you", and every one of those can be
 * rendered as a nought that reads as good news:
 *
 *   nothing left to buy   vs  the quantity could not be worked out at all
 *   no revenue            vs  no rate applies, so revenue is unknown
 *   no covers served      vs  nothing in these dates has closed yet
 *   backed up             vs  backed up once, currency never checked
 *
 * The left column is reassurance; the right is work outstanding. They are not
 * distinguishable from a count of list rows, which is why `blocked` is carried
 * beside `outstanding` rather than folded into it, and why the backup panel below
 * refuses to claim currency it has not verified.
 * ---------------------------------------------------------------------------
 */

import { anomalyScan, dietaryCrossCheck, readinessCheck } from '../engine/checks';
import { jobRevenue, rangeMoney } from '../engine/costing';
import { historicalAggregate } from '../engine/history';
import { isOperational } from '../engine/rules';
import { blocksQuantity, outstandingShopping, requirementsForRange } from '../engine/shopping';
import { backupReminder, type BackupReminder } from './backup';
import type { Anomaly, DietaryIssue, ReadinessResult } from '../engine/checks';
import type { RangeMoneyResult } from '../engine/costing';
import type { AggregateSlice } from '../engine/history';
import type {
  ClientRate,
  Customer,
  Ingredient,
  Job,
  Recipe,
  StockLevel,
} from '../engine/types';

export interface DashboardInput {
  readonly jobs: readonly Job[];
  readonly recipes: readonly Recipe[];
  readonly ingredients: readonly Ingredient[];
  readonly customers: readonly Customer[];
  readonly rates: readonly ClientRate[];
  readonly stock: readonly StockLevel[];
  readonly from: string;
  readonly to: string;
  readonly today: string;
  readonly savedBackup: { readonly fingerprint: string; readonly at: string } | null;
}

export interface NextJob {
  readonly job: Job;
  readonly readiness: ReadinessResult;
  /** Requirements that could not be worked out at all — see the file comment. */
  readonly blocked: number;
  readonly dietary: readonly DietaryIssue[];
}

export interface DashboardView {
  readonly window: { readonly from: string; readonly to: string; readonly jobCount: number };
  readonly nextJobs: readonly NextJob[];
  /**
   * Two counts, never one.
   *
   * A dropped line contributes ZERO to `outstanding`, so a job whose dish left
   * the cascade reads as fully shopped. Absence presented as completeness is the
   * same defect as a guessed number.
   */
  readonly shopping: { readonly outstanding: number; readonly blocked: number };
  readonly anomalies: readonly Anomaly[];
  /** Issues, not a count — Rule 16 forbids a summable dietary total. */
  readonly dietary: readonly DietaryIssue[];
  readonly money: RangeMoneyResult;
  /** Closed jobs only. A forward window legitimately has none. */
  readonly history: AggregateSlice;
  readonly backup: BackupReminder;
}

/** Worst first, so the glance catches the thing that matters. */
const SEVERITY_ORDER: Record<Anomaly['severity'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const inWindow = (jobs: readonly Job[], from: string, to: string): Job[] =>
  jobs.filter((j) => j.serviceDate !== null && j.serviceDate >= from && j.serviceDate <= to);

export function buildDashboardView(input: DashboardInput): DashboardView {
  const { recipes, ingredients, customers, rates, stock } = input;

  const windowJobs = inWindow(input.jobs, input.from, input.to);
  const live = windowJobs.filter(isOperational);

  // ONE cascade run for the window, reused by every panel that needs it. Running
  // it per panel would be the same answer computed several times, which is how
  // two panels come to disagree on one screen.
  const requirements = requirementsForRange(live, recipes, ingredients);
  const outstanding = outstandingShopping(requirements.lines, stock, [], ingredients);
  const blockers = requirements.gaps.filter(blocksQuantity);

  const customerById = new Map(customers.map((c) => [c.id, c]));

  const nextJobs: NextJob[] = live
    .slice()
    .sort((a, b) => (a.serviceDate ?? '').localeCompare(b.serviceDate ?? ''))
    .map((job) => {
      // Per job, because readiness is a question about one job. The cascade is
      // the same one; only the input set narrows.
      const own = requirementsForRange([job], recipes, ingredients);
      const ownOutstanding = outstandingShopping(own.lines, stock, [], ingredients);
      const ownBlocked = own.gaps.filter(blocksQuantity);
      const dietary = dietaryCrossCheck(job, recipes);

      return {
        job,
        blocked: ownBlocked.length,
        dietary,
        readiness: readinessCheck(job, {
          revenueKnown:
            jobRevenue(
              job,
              job.customerId === null ? undefined : customerById.get(job.customerId),
              rates,
            ).total !== null,
          outstandingCount: ownOutstanding.filter((l) => l.outstanding.value > 0).length,
          blockedCount: ownBlocked.length,
          dietaryIssues: dietary.length,
        }),
      };
    });

  return {
    window: { from: input.from, to: input.to, jobCount: windowJobs.length },
    nextJobs,
    shopping: {
      outstanding: outstanding.filter((l) => l.outstanding.value > 0).length,
      blocked: blockers.length,
    },
    anomalies: anomalyScan(live, recipes)
      .slice()
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    dietary: nextJobs.flatMap((n) => n.dietary),
    money: rangeMoney(windowJobs, customers, rates, recipes, ingredients),
    // `historicalAggregate` aggregates CLOSED jobs only, and that is the right
    // reading of a forward window: nothing has happened yet, which is not the
    // same as nothing having been sold. `.overall` reports the excluded counts
    // beside every average so neither can be mistaken for complete.
    history: historicalAggregate(windowJobs, customers, rates).overall,
    backup: backupReminder(input.savedBackup, input.today),
  };
}
