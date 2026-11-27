/**
 * REVENUE BY WEEK, drawn. The numbers come from `moneyWeeks` (engine totals per
 * week); this only draws them and writes the headline.
 *
 * THE HEADLINE STATES A FINDING, and only one the data supports: it compares
 * the last two weeks that are whole and fully priced, in euros, both figures
 * shown. No percentage — a change figure is one more number to trust, and two
 * amounts side by side say the same thing without one.
 *
 * WHAT A BAR CAN BE. A gap is never drawn as a zero-height bar, because a zero
 * bar says "earned nothing":
 *   no jobs      a dashed baseline, "—"
 *   not priced   a hatched block, "not priced"
 *   part priced  the subtotal, starred, with the footnote saying so
 *
 * Heights are set inline from the largest known week. No DOM globals: the test
 * build compiles this file.
 */

import type { ReactNode } from 'react';
import { formatMoney } from './form';
import { latestComparison, type MoneyWeek } from './moneyWeeks';
import type { Cents } from '../engine/types';

const PLOT = 140; // px of bar height for the largest week

const money = (c: Cents | null): string => formatMoney(c, 'not known');

function headline(weeks: readonly MoneyWeek[]): string {
  const cmp = latestComparison(weeks);
  if (cmp === null) return 'Not enough whole, fully priced weeks yet to compare';

  const now = cmp.latest.revenue.total ?? (0 as Cents);
  const then = cmp.previous.revenue.total ?? (0 as Cents);
  const when = cmp.adjacent ? 'the week before' : `the week of ${cmp.previous.label}`;
  const move = now > then ? 'up from' : now < then ? 'down from' : 'the same as';
  return `Week of ${cmp.latest.label}: ${money(now)} — ${move} ${money(then)} ${when}`;
}

function bar(week: MoneyWeek, max: number, highlight: boolean): ReactNode {
  if (week.state === 'none') {
    return (
      <>
        <span className="week-value muted">—</span>
        <i className="week-bar is-empty" />
      </>
    );
  }
  if (week.state === 'unpriced') {
    return (
      <>
        <span className="week-value muted">not priced</span>
        <i className="week-bar is-gap" style={{ height: '24px' }} />
      </>
    );
  }
  const total = (week.revenue.total ?? 0) as number;
  const px = max === 0 ? 0 : Math.max(6, Math.round((total / max) * PLOT));
  return (
    <>
      <span className="week-value num">
        {money(week.revenue.total)}
        {week.state === 'partial' ? '*' : ''}
      </span>
      <i
        className={`week-bar${highlight ? ' is-latest' : ''}${week.state === 'partial' ? ' is-partial' : ''}`}
        style={{ height: `${px}px` }}
      />
    </>
  );
}

export function WeekChart({ weeks }: { readonly weeks: readonly MoneyWeek[] }): ReactNode {
  if (weeks.length === 0) return null;

  const known = weeks
    .filter((w) => w.state === 'full' || w.state === 'partial')
    .map((w) => (w.revenue.total ?? 0) as number);
  const max = known.length === 0 ? 0 : Math.max(...known);
  const latest = latestComparison(weeks)?.latest.start ?? null;
  const anyPartial = weeks.some((w) => w.state === 'partial');
  const anyClipped = weeks.some((w) => w.clipped && w.state !== 'none');

  const spoken = weeks
    .map((w) => {
      const what =
        w.state === 'none'
          ? 'no jobs'
          : w.state === 'unpriced'
            ? 'jobs, none priced'
            : `${money(w.revenue.total)}${w.state === 'partial' ? ', only part priced' : ''}`;
      return `Week of ${w.label}: ${what}`;
    })
    .join('; ');

  return (
    <figure className="week-chart">
      <figcaption>
        <strong className="week-title">{headline(weeks)}</strong>
        <span className="week-sub">
          Revenue from priced jobs, by week starting Monday. A gap is a week with no priced job —
          not a week that earned nothing.
        </span>
      </figcaption>

      <div className="week-cols" role="img" aria-label={spoken} style={{ height: `${PLOT + 28}px` }}>
        {weeks.map((w) => (
          <div key={w.start} className={`week-col${w.clipped ? ' is-clipped' : ''}`}>
            {bar(w, max, w.start === latest)}
          </div>
        ))}
      </div>
      <div className="week-labels" aria-hidden="true">
        {weeks.map((w) => (
          <span key={w.start}>{w.label}</span>
        ))}
      </div>

      {(anyPartial || anyClipped) && (
        <p className="week-note">
          {anyPartial && '* Only part of that week is priced, so its real total is higher. '}
          {anyClipped && 'Weeks the dates cut short are drawn faded. '}
          Neither is used in the comparison above.
        </p>
      )}
    </figure>
  );
}
