/**
 * Service rules.
 *
 * `meatEatingGuests` — how many guests eat meat.
 * `applyBuffetSplit` — how guests divide across the dishes on a menu.
 */

import type { Job, JobDish, Recipe } from './types';

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

/**
 * Divide guests across the dishes on a menu.
 *
 * Where a course offers several mains or several desserts, guests divide evenly
 * across them: 17 across curry + lasagne is 9 and 8, not 17 each. Sides and
 * single-dish courses take the full guest count.
 *
 * This is not cosmetic. The result feeds batch consolidation, so getting it wrong
 * doubles the work: lasagne at 8 portions is ONE tray, at 17 it is two.
 *
 * The rules, in order:
 *
 *   1. A dish with explicit portions keeps them. The owner's data always wins;
 *      this only ever fills a null.
 *   2. `main` or `dessert`, several in the course -> even split, remainder by
 *      position.
 *   3. `main` or `dessert`, one in the course -> the full guest count.
 *   4. `side` -> the full guest count, ALWAYS, however many sides there are. This
 *      is the BBQ rule: baps, corn, potatoes and slaw each feed everyone.
 *   5. `breakfast`, no course, or no recipe -> left null. Not derivable, so it
 *      stays a gap (Rule 8).
 *
 * Breakfast is excluded on evidence, not by omission. CALC-SWEETPEA-BREAKFAST is
 * 12 guests across Full Irish / pancakes / continental at 5 / 3 / 4 — a choice the
 * owner recorded, not a division. An even split would say 4/4/4 and be wrong.
 *
 * The remainder goes to the earliest dishes by `position`, which is deterministic
 * and has real consequences: with 19 guests, a batch dish listed first takes 10 and
 * needs two trays, listed second it takes 9 and needs one.
 */
export function applyBuffetSplit(
  guests: number,
  dishes: readonly JobDish[],
  recipes: readonly Recipe[],
): readonly JobDish[] {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const courseOf = (d: JobDish): Recipe['course'] | null =>
    byId.get(d.recipeId)?.course ?? null;

  // Rank each dish within its own splittable course, ordered by position.
  const rank = new Map<JobDish['id'], { index: number; count: number }>();

  for (const course of ['main', 'dessert'] as const) {
    const inCourse = dishes
      .filter((d) => courseOf(d) === course)
      .slice()
      .sort((a, b) => a.position - b.position);

    inCourse.forEach((d, index) => rank.set(d.id, { index, count: inCourse.length }));
  }

  return dishes.map((d) => {
    // The owner said so.
    if (d.portions !== null) return d;

    if (courseOf(d) === 'side') return { ...d, portions: guests };

    const r = rank.get(d.id);
    // Breakfast, uncoursed, or no recipe: not derivable, so still a gap.
    if (r === undefined) return d;

    const base = Math.floor(guests / r.count);
    const remainder = guests % r.count;

    return { ...d, portions: r.index < remainder ? base + 1 : base };
  });
}
