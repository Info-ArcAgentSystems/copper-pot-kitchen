/**
 * The service window: from, to, and the two helpers that bound it.
 *
 * Shopping, Prep and Packing each declared their own identical
 * `useState(today)` / `addDays(today(), 7)` pair plus a private copy of both
 * date helpers. Three copies of one default is three places for it to drift, and
 * the Service tab needs them to agree by construction, not by coincidence.
 *
 * ---------------------------------------------------------------------------
 * ONE RANGE, THREE MEANINGS — AND THAT IS CORRECT.
 *
 * The three screens share these two dates and then filter on DIFFERENT fields:
 *
 *   Shopping   job.serviceDate      jobs serving in the window
 *   Packing    job.serviceDate      you pack for service, not for prep
 *   Prep       bucket.prepDate      serviceDate MINUS make_ahead_days
 *
 * So the same window legitimately shows different jobs per view. A job serving
 * on the 6th with three make-ahead days is prepped on the 3rd: inside a 27th–3rd
 * Prep window, outside the same Shopping window.
 *
 * Nothing here changes that — each screen still filters exactly as it did. But
 * it is why the caption under the dates is written PER VIEW rather than claiming
 * one range drives all three. Unexplained, the difference reads as a bug.
 * ---------------------------------------------------------------------------
 */

import { useState } from 'react';

export const today = (): string => new Date().toISOString().slice(0, 10);

export const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export interface DateRange {
  readonly from: string;
  readonly to: string;
  readonly setFrom: (value: string) => void;
  readonly setTo: (value: string) => void;
}

/** Today to a week out — the default all three screens already used. */
export function useDateRange(): DateRange {
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(() => addDays(today(), 7));

  return { from, to, setFrom, setTo };
}

/** What the window MEANS on the view being shown. */
export const RANGE_CAPTION: Readonly<Record<string, string>> = {
  shopping: 'Jobs serving in these dates.',
  packing: 'Jobs serving in these dates.',
  prep: 'Things prepped in these dates — a make-ahead job serving later shows here.',
};
