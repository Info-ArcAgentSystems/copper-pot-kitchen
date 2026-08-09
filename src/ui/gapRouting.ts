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

import type { MissingInput, MissingReason } from '../engine/costing';
import type { RequirementGap } from '../engine/shopping';

export interface CheckYourself {
  readonly label: string;
  readonly why: string;
}

export interface Flag {
  readonly label: string;
  /**
   * 'Rate card' is here for the money screen only: an unpriced job is fixed in
   * Setup rather than on the job, and sending him to the wrong screen is worse
   * than sending him nowhere.
   */
  readonly where: 'Recipes' | 'Ingredients' | 'Jobs' | 'Rate card';
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

// ---------------------------------------------------------------------------
// The money screen's blockers
// ---------------------------------------------------------------------------

/**
 * `MissingReason` is a DIFFERENT union from `RequirementGap['reason']`.
 *
 * They overlap heavily, but costing can fail for four reasons shopping never
 * encounters — an unpriced ingredient, an unpriced extra, no applicable rate, and
 * no guest count. Forcing one map to serve both would mean either a partial map
 * with a `default:` branch, or a union nobody can reason about. Two total maps is
 * the honest shape.
 */
const MISSING_ROUTING: Record<MissingReason, Flag['where'] | 'check'> = {
  // The engine cannot put a number on it. Nothing is wrong with the records.
  unquantified: 'check',
  named_unquantified: 'check',

  // A price or a conversion is absent.
  unpriced_ingredient: 'Ingredients',
  no_pack_size: 'Ingredients',
  missing_ingredient: 'Ingredients',
  unresolved_conversion: 'Ingredients',

  // The recipe itself is incomplete.
  missing_recipe: 'Recipes',
  missing_sub_recipe: 'Recipes',
  no_components: 'Recipes',
  no_portions_per_batch: 'Recipes',
  cycle: 'Recipes',

  // Something about this job.
  no_portions: 'Jobs',
  no_guest_count: 'Jobs',
  unpriced_extra: 'Jobs',

  // Rule 11: no rate for (client group, service type). Fixed in Setup, not on the
  // job — unless he means to override the price, which is a job-level decision.
  no_rate: 'Rate card',
};

/** Why a money figure could not be produced, and where to go about it. */
export function routeMissing(missing: readonly MissingInput[]): RoutedGaps {
  const checkYourself: CheckYourself[] = [];
  const needsFixing: Flag[] = [];
  const seen = new Set<string>();

  for (const item of missing) {
    const key = `${item.reason} ${item.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const destination = MISSING_ROUTING[item.reason];

    if (destination === 'check') {
      checkYourself.push({
        label: item.detail,
        why: 'No quantity is recorded for this, so it cannot be costed. Judge it yourself.',
      });
    } else {
      needsFixing.push({ label: item.detail, where: destination });
    }
  }

  return { checkYourself, needsFixing };
}
