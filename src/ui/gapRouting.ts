/**
 * Where an engine gap belongs on screen.
 *
 * Shared by Shopping and Prep. It lives here rather than in either of them
 * because two copies of this map would drift, and the way they would drift is
 * silent: a reason routed in one screen and forgotten in the other looks like
 * nothing at all on the screen that forgot it.
 *
 * The distinction the two destinations draw:
 *
 *   check yourself — the engine CANNOT produce a number. Nothing is wrong with
 *                    the records; the thing was never measured. He judges it.
 *   needs fixing   — something is absent from the records, and there is a screen
 *                    that fixes it.
 *
 * Both are always shown. Rule 8: a line the engine could not quantify is never
 * silently omitted and never rendered as zero.
 */

import type { RequirementGap } from '../engine/shopping';

export interface CheckYourself {
  readonly label: string;
  readonly why: string;
}

export interface Flag {
  readonly label: string;
  readonly where: 'Recipes' | 'Ingredients' | 'Jobs';
}

export interface RoutedGaps {
  readonly checkYourself: readonly CheckYourself[];
  readonly needsFixing: readonly Flag[];
}

/**
 * A TOTAL map over the union, not a switch with a default.
 *
 * If the engine gains a reason and it is not added here, this stops compiling —
 * which is the point. A `default:` branch would let a new reason disappear from
 * both screens quietly, and a gap nobody sees is the same defect as a guessed
 * number.
 */
const GAP_ROUTING: Record<RequirementGap['reason'], Flag['where'] | 'check'> = {
  unquantified: 'check',
  named_unquantified: 'check',

  missing_recipe: 'Recipes',
  missing_sub_recipe: 'Recipes',
  no_components: 'Recipes',
  no_portions_per_batch: 'Recipes',
  cycle: 'Recipes',
  missing_ingredient: 'Ingredients',
  no_pack_size: 'Ingredients',
  unresolved_conversion: 'Ingredients',
  no_service_date: 'Jobs',
  no_portions: 'Jobs',
};

export function routeGaps(gaps: readonly RequirementGap[]): RoutedGaps {
  const checkYourself: CheckYourself[] = [];
  const needsFixing: Flag[] = [];
  const seen = new Set<string>();

  for (const gap of gaps) {
    // Consolidation across jobs produces the same gap once per job that hit it.
    // He needs to know it happened, not how many times.
    const key = `${gap.reason} ${gap.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const destination = GAP_ROUTING[gap.reason];

    if (destination === 'check') {
      checkYourself.push({
        label: gap.detail,
        why: 'No quantity is recorded for this, so it cannot be worked out. Judge it yourself.',
      });
    } else {
      needsFixing.push({ label: gap.detail, where: destination });
    }
  }

  return { checkYourself, needsFixing };
}
