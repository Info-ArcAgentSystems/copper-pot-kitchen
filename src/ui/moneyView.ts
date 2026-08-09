/**
 * The money screen's rows, built from engine output.
 *
 * PURE, and it does NO ARITHMETIC. `jobMargin` produced every figure and
 * `rangeMoney` every total; this formats them and routes what is blocking them.
 *
 * THE NULL CASES ARE THE PRODUCT HERE.
 *
 * On every other screen a missing value is an edge case. On this one it is the
 * main event, because the expensive mistake in catering is a job that looks
 * profitable only because an unpriced ingredient counted as free. The engine
 * already refuses to produce those numbers; this file's job is to refuse to
 * disguise the refusal — no €0.00 standing in for unknown, no margin where either
 * side is missing, and always the reason.
 *
 * NO PERCENTAGE. Whether margin is a percentage of price or of cost is an open
 * owner question, and the two differ substantially at catering margins. Until Paul
 * answers, this shows the absolute figure only. `tests/ui/moneyView.test.ts`
 * fails if a percent sign or a division by revenue or cost appears here.
 */

import { formatMoney } from './form';
import { routeMissing, type Flag } from './gapRouting';
import type { MarginResult, RangeMoneyResult, RevenueResult } from '../engine/costing';
import type { Customer, Job, JobId } from '../engine/types';

/** What an absent figure reads as. Never "€0.00", never blank. */
const UNKNOWN = 'not known yet';

export interface MoneyRow {
  readonly jobId: JobId;
  readonly heading: string;
  readonly status: string;
  readonly revenue: string;
  readonly foodCost: string;
  readonly margin: string;
  /** Rule 11: what the rate card said, when an override replaced it. */
  readonly overriddenFrom: string | null;
  /** A loss is a real answer and is shown as one, not hidden. */
  readonly isLoss: boolean;
  readonly blockers: readonly Flag[];
}

export interface MoneySummary {
  readonly revenue: string;
  readonly foodCost: string;
  readonly margin: string;
  /** "3 of 4 jobs priced" — null when the total covers everything. */
  readonly revenueNote: string | null;
  readonly foodCostNote: string | null;
  readonly marginNote: string | null;
  /** Cancelled value, stated apart from earned money (Rule 15). */
  readonly cancelledNote: string | null;
}

export interface MoneyView {
  readonly rows: readonly MoneyRow[];
  readonly summary: MoneySummary;
  readonly blockers: readonly Flag[];
  readonly checkYourself: readonly { label: string; why: string }[];
}

export interface MoneyInput {
  readonly job: Job;
  readonly margin: MarginResult;
  readonly revenue: RevenueResult;
}

/** "2 of 3 jobs priced" — or null when nothing was left out. */
function coverage(counted: number, excluded: number, verb: string): string | null {
  if (excluded === 0) return null;

  const total = counted + excluded;
  return `${counted} of ${total} jobs ${verb}. ${excluded} could not be, so this total does not cover ${excluded === 1 ? 'it' : 'them'}.`;
}

function headingFor(job: Job, customer: Customer | undefined): string {
  const parts = [customer?.name, job.serviceDate ?? undefined, job.serviceType ?? undefined]
    .filter((p): p is string => p !== undefined && p !== '');

  return parts.length === 0 ? 'Job with no details yet' : parts.join(' · ');
}

export function buildMoneyView(
  inputs: readonly MoneyInput[],
  total: RangeMoneyResult,
  customers: readonly Customer[],
): MoneyView {
  const customerById = new Map(customers.map((c) => [c.id as string, c]));

  const rows: MoneyRow[] = inputs.map(({ job, margin, revenue }) => {
    const routed = routeMissing(margin.missing);

    return {
      jobId: job.id,
      heading: headingFor(job, job.customerId === null ? undefined : customerById.get(job.customerId)),
      status: job.status,
      revenue: formatMoney(margin.revenue, UNKNOWN),
      foodCost: formatMoney(margin.foodCost, UNKNOWN),
      // Null whenever either side is null — the engine already guarantees it, and
      // formatMoney turns that into words rather than a zero.
      margin: formatMoney(margin.margin, UNKNOWN),
      overriddenFrom: revenue.isOverride
        ? formatMoney(revenue.computed, 'no rate applies')
        : null,
      isLoss: margin.margin !== null && (margin.margin as number) < 0,
      blockers: routed.needsFixing,
    };
  });

  // Range-level blockers, de-duplicated across every job by `rangeMoney`.
  const routed = routeMissing(total.missing);

  return {
    rows,
    summary: {
      revenue: formatMoney(total.revenue.total, UNKNOWN),
      foodCost: formatMoney(total.foodCost.total, UNKNOWN),
      margin: formatMoney(total.margin.total, UNKNOWN),
      revenueNote: coverage(total.revenue.priced, total.revenue.unpriced, 'priced'),
      foodCostNote: coverage(total.foodCost.costed, total.foodCost.uncosted, 'costed'),
      marginNote: coverage(total.margin.withMargin, total.margin.withoutMargin, 'have both figures'),
      cancelledNote:
        total.cancelled.jobs === 0
          ? null
          : `${total.cancelled.jobs} cancelled job${total.cancelled.jobs === 1 ? '' : 's'} in this range, worth ${formatMoney(total.cancelled.revenue.total, UNKNOWN)}. Not counted above.`,
    },
    blockers: routed.needsFixing,
    checkYourself: routed.checkYourself,
  };
}
