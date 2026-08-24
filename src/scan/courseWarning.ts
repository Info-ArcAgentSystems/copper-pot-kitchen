/**
 * What a non-derivable course will cost, said before the recipe is saved.
 *
 * SHARED by the recipe-card scanner and the web-recipe import, because it is one
 * rule and a second copy is how the two would start telling the owner different
 * things about the same problem.
 *
 * THE RECIPE THAT PROMPTED IT came off the card scanner with `course: null`,
 * because nothing on the card said "main". `applyBuffetSplit` could then not fill
 * the dish's blank portions on a confirmed job for 20 guests, `productionBuckets`
 * dropped it, and the beef mince it needed never appeared on any shopping list.
 * Every screen downstream was correct and every one of them was silent.
 *
 * A WARNING, NOT A GAP. A recipe with no course is legal — it simply cannot have
 * its portions derived from a guest count. Blocking would refuse a legitimate
 * recipe from a screen that offers no way to fix it.
 *
 * Asks `courseDerivable` rather than testing for null, so breakfast — which fails
 * identically and is easy to forget — is covered by construction.
 */

import { courseDerivable } from '../engine/rules';

const CONSEQUENCE =
  'the guest count cannot fill in its portions, so every job using it needs a portions figure typed in — otherwise the dish is left off prep, shopping and cost.';

/**
 * `where` names where the course was looked for, so the sentence reads correctly
 * whether it came off a photograph or a web page. Two sentences, not one: the
 * consequence is shared but the cause is not, and telling an owner whose source
 * says "Breakfast" to go and set a course would send him to a field already
 * filled in.
 */
export function courseWarnings(course: string | null, where: string): readonly string[] {
  if (courseDerivable(course)) return [];

  return course === null || course.trim() === ''
    ? [`No course was read ${where}. Set one in Recipes: without it, ${CONSEQUENCE}`]
    : [
        `This was read as a ${course}. A ${course} is a choice rather than an even split, so ${CONSEQUENCE}`,
      ];
}
