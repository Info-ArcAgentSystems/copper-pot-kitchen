/**
 * Which dates — as one compact bar, not two full-width form fields.
 *
 * The window is a FILTER over his jobs, not data he is entering, and it was
 * drawn like a form: a section heading, two labelled boxes the full width of
 * the column, stacked on Money. It sat above every figure on three screens and
 * was the largest thing on all of them.
 *
 * Now: From – To side by side at their natural width, and a few common windows
 * one tap away. The presets only SET the two dates — they appear in the boxes,
 * where he can see and change them — so nothing is hidden behind a label.
 *
 * No DOM globals: compiled by the test build too.
 */

import { useId, type ReactNode } from 'react';
import { addDays, today } from './dateRange';

export interface RangePreset {
  readonly label: string;
  /** Days from today to the start and to the end. */
  readonly from: number;
  readonly to: number;
}

export function DateRangeBar({
  from,
  to,
  setFrom,
  setTo,
  presets,
  caption,
}: {
  readonly from: string;
  readonly to: string;
  readonly setFrom: (value: string) => void;
  readonly setTo: (value: string) => void;
  readonly presets: readonly RangePreset[];
  readonly caption?: string;
}): ReactNode {
  const id = useId();
  const now = today();

  return (
    <div className="date-range" role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className="date-range-label">
        Dates
      </span>
      <div className="date-range-fields">
        <label className="date-range-field">
          <span className="visually-quiet">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom((e.currentTarget as unknown as { value: string }).value)}
          />
        </label>
        <span className="date-range-dash" aria-hidden="true">
          –
        </span>
        <label className="date-range-field">
          <span className="visually-quiet">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo((e.currentTarget as unknown as { value: string }).value)}
          />
        </label>
      </div>
      <div className="chips" aria-label="Common date ranges">
        {presets.map((p) => {
          const pf = addDays(now, p.from);
          const pt = addDays(now, p.to);
          return (
            <button
              key={p.label}
              type="button"
              className="chip"
              aria-pressed={from === pf && to === pt}
              onClick={() => {
                setFrom(pf);
                setTo(pt);
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      {caption !== undefined && <p className="hint">{caption}</p>}
    </div>
  );
}

export const AHEAD: readonly RangePreset[] = [
  { label: 'Next 7 days', from: 0, to: 7 },
  { label: 'Next 14 days', from: 0, to: 14 },
  { label: 'Next 30 days', from: 0, to: 30 },
];

export const BEHIND: readonly RangePreset[] = [
  { label: 'Last 7 days', from: -7, to: 0 },
  { label: 'Last 30 days', from: -30, to: 0 },
  { label: 'Last 90 days', from: -90, to: 0 },
];
