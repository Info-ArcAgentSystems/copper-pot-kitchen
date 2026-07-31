/**
 * Service rules.
 *
 * Currently just the meat-eating guest count. applyBuffetSplit and the rest of the
 * BBQ split land here later.
 */

import type { Job } from './types';

/**
 * How many guests eat meat.
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE ONLY PLACE IN THE ENGINE THAT DERIVES A HEADCOUNT FROM DIETARIES,
 * and the only place permitted to subtract anything from a guest count.
 * No caller re-derives it. That is what keeps replacing it a one-line change.
 * ---------------------------------------------------------------------------
 *
 * The owner's own figure always wins. The derivation below is a FALLBACK, pending
 * Paul's confirmation of the approach — if he would rather it worked differently,
 * only this function changes.
 *
 * Why it is safe under Rule 16: it counts DISTINCT guests, never a sum of category
 * counts. A guest who is both vegan and coeliac is two dietary records but one
 * person, and is subtracted once. Summing the categories would say two, and
 * under-order meat for a guest who does not exist.
 *
 * Why it returns null: if any requirement is still unresolved — "a few vegetarians"
 * — the true count is unknowable. Returning a number would mean treating "a few" as
 * zero, which is exactly the guess Rules 8 and 12 exist to prevent. Null propagates
 * as "blocked pending confirmation", not as an error.
 */
export function meatEatingGuests(job: Job): number | null {
  // 1. The owner said so.
  if (job.meatEatingGuests !== null) return job.meatEatingGuests;

  // 2. No guest count, no derived count.
  if (job.guests === null) return null;

  // 3. Anything unresolved blocks an exact figure.
  if (job.dietaries.some((d) => d.kind === 'unresolved')) return null;

  // 4. Distinct guests who exclude meat — counted once each, however many
  //    requirements they hold.
  const excluding = new Set(
    job.dietaries
      .filter((d) => d.kind === 'allocated' && d.excludesMeat)
      .map((d) => (d as Extract<typeof d, { kind: 'allocated' }>).guest),
  );

  // Clamp: more recorded exclusions than guests means the data is wrong, but a
  // negative headcount would be worse than a visibly empty one.
  return Math.max(0, job.guests - excluding.size);
}
