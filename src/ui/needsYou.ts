/**
 * "NEEDS YOU" — the short list at the top of Today: each thing that stops a job
 * being ready, worded as what is wrong and why it matters, with ONE place to go
 * and fix it.
 *
 * PURE, and it computes nothing. Every count below is one the dashboard view
 * already holds; this file only decides the ORDER and the words. A new figure
 * appearing here would be a second implementation of something the engine owns.
 *
 * THE ORDER is by what a mistake costs:
 *   1. safety   — a possible dietary conflict, a critical or high anomaly
 *   2. money    — unpriced jobs, uncosted jobs, shopping that cannot be worked out
 *   3. decisions — enquiries waiting to be confirmed
 *   4. the rest — smaller anomalies, then the backup
 *
 * EMPTY MEANS NOTHING WAS FOUND, not "all fine": the screen says so in those words,
 * because a quiet list on a screen that could not see a gap would be the calm
 * dashboard this app refuses to be.
 */

import type { DashboardView } from './dashboardView';

export type NeedTone = 'safety' | 'money' | 'plain';

export interface Need {
  readonly key: string;
  readonly tone: NeedTone;
  readonly title: string;
  readonly why: string;
  readonly action: { readonly label: string; readonly to: string };
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

export function needsYou(
  view: Pick<
    DashboardView,
    'dietary' | 'anomalies' | 'money' | 'shopping' | 'enquiries' | 'backup'
  >,
): Need[] {
  const out: Need[] = [];

  // 1 — SAFETY. Rule 9: "possible conflict — review required", never a verdict.
  // Counted as ISSUES, never as guests (Rule 16).
  if (view.dietary.length > 0) {
    const n = view.dietary.length;
    out.push({
      key: 'dietary',
      tone: 'safety',
      title: `Dietary — ${n} possible ${plural(n, 'conflict', 'conflicts')} to review`,
      why: view.dietary[0]?.detail ?? '',
      action: { label: 'Review jobs', to: '/jobs' },
    });
  }

  const serious = view.anomalies.filter((a) => a.severity === 'critical' || a.severity === 'high');
  for (const a of serious) {
    out.push({
      key: `anomaly-${a.jobId}-${a.reason}`,
      tone: 'safety',
      title: a.detail,
      why:
        a.severity === 'critical'
          ? 'Critical — this would go wrong on the day if left.'
          : 'Worth fixing before the job.',
      action: { label: 'Open jobs', to: '/jobs' },
    });
  }

  // 2 — MONEY. Each says what is unknown and why, never a partial sum as a total.
  const unpriced = view.money.revenue.unpriced;
  if (unpriced > 0) {
    out.push({
      key: 'unpriced',
      tone: 'money',
      title: `${unpriced} ${plural(unpriced, 'job has', 'jobs have')} no price`,
      why: 'No rate on the Rate card matches the client group and service type, and no price was typed in — so revenue for them is not known.',
      action: { label: 'Open Rate card', to: '/setup/rates' },
    });
  }

  const uncosted = view.money.foodCost.uncosted;
  if (uncosted > 0) {
    out.push({
      key: 'uncosted',
      tone: 'money',
      title: `${uncosted} ${plural(uncosted, 'job', 'jobs')} can’t be costed yet`,
      why: 'Something on the menu has no ingredient price or no quantity, so food cost and margin are not known.',
      action: { label: 'Open ingredients', to: '/library/ingredients' },
    });
  }

  const blocked = view.shopping.blocked;
  if (blocked > 0) {
    out.push({
      key: 'blocked',
      tone: 'money',
      title: `${blocked} shopping ${plural(blocked, 'quantity', 'quantities')} can’t be worked out`,
      why: 'The list leaves them out rather than guess. Open the list to see which, and why.',
      action: { label: 'Open shopping', to: '/service/shopping' },
    });
  }

  // 3 — DECISIONS.
  if (view.enquiries > 0) {
    const n = view.enquiries;
    out.push({
      key: 'enquiries',
      tone: 'plain',
      title: `${n} ${plural(n, 'enquiry', 'enquiries')} not confirmed`,
      why: 'Enquiries are not shopped or prepped for until you confirm them.',
      action: { label: 'Review jobs', to: '/jobs' },
    });
  }

  // 4 — THE REST.
  const minor = view.anomalies.filter((a) => a.severity === 'medium' || a.severity === 'low');
  if (minor.length > 0) {
    out.push({
      key: 'minor',
      tone: 'plain',
      title: `${minor.length} smaller ${plural(minor.length, 'thing', 'things')} worth a look`,
      why: minor[0]?.detail ?? '',
      action: { label: 'Open jobs', to: '/jobs' },
    });
  }

  if (view.backup.state === 'never') {
    out.push({
      key: 'backup',
      tone: 'plain',
      title: 'No backup saved from this device yet',
      why: view.backup.message,
      action: { label: 'Back up now', to: '/setup/backup' },
    });
  }

  return out;
}
