/**
 * Safety and readiness checks.
 *
 * Rule 9 governs this file: **surface possible conflicts, never assert safety.**
 * The language is always "possible conflict — review required". Never "safe",
 * never "no allergens".
 *
 * That is not pedantry about wording. The golden fixture contains no allergen tags
 * on any ingredient, so a keyword scan finds NOTHING on a job carrying a severe
 * mushroom allergy. An empty findings list is the normal case on real data. If
 * anything here let that read as a clean bill of health it would be actively
 * dangerous, which is why `allergenScan` reports what it could not check and
 * exposes no boolean verdict of any kind.
 */

import type {
  DietarySeverity,
  GuestRef,
  Ingredient,
  Job,
  JobDietaryId,
  JobId,
  Recipe,
  RecipeId,
} from './types';

// ---------------------------------------------------------------------------
// allergenScan — Rule 9
// ---------------------------------------------------------------------------

export type AllergenFindingReason =
  | 'severe_without_assigned_dish'
  | 'possible_ingredient_match'
  | 'unresolved_requirement';

export interface AllergenFinding {
  readonly dietaryId: JobDietaryId;
  readonly guest: GuestRef | null;
  readonly dietType: string;
  readonly severity: DietarySeverity;
  readonly reason: AllergenFindingReason;
  readonly recipeId: RecipeId | null;
  /** Always the Rule 9 phrasing. */
  readonly message: string;
}

export type UncheckedReason = 'missing_recipe' | 'no_allergen_data';

export interface UncheckedDish {
  readonly recipeId: RecipeId;
  readonly reason: UncheckedReason;
  readonly detail: string;
}

/**
 * Deliberately carries NO verdict field — no `safe`, no `clear`, no
 * `hasConflicts`. A false on any such boolean is exactly the reading Rule 9
 * forbids. A caller must look at `findings` and `unchecked` together.
 */
export interface AllergenScanResult {
  readonly findings: readonly AllergenFinding[];
  readonly unchecked: readonly UncheckedDish[];
}

const REVIEW = 'possible conflict — review required';

/**
 * Split an owner-entered string into comparable tokens.
 *
 * No built-in allergen vocabulary exists anywhere in this file. Both sides of the
 * comparison are owner data: the dietary's `dietType`/`details` and the
 * ingredient's `allergens` tags. A hardcoded list would be business data in `src/`
 * (Rule 1) and would silently miss anything the owner phrases his own way, such as
 * `no_pork_no_alcohol`.
 */
function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );
}

function overlaps(a: Set<string>, b: Set<string>): boolean {
  for (const t of a) if (b.has(t)) return true;
  return false;
}

export function allergenScan(
  job: Job,
  recipes: readonly Recipe[],
  ingredients: readonly Ingredient[],
): AllergenScanResult {
  const recipeById = new Map(recipes.map((r) => [r.id, r]));
  const ingredientById = new Map(ingredients.map((i) => [i.id, i]));

  const findings: AllergenFinding[] = [];
  const unchecked: UncheckedDish[] = [];

  // What could not be checked at all. Reported so that empty findings can never be
  // mistaken for a clean bill of health.
  for (const d of job.dishes) {
    const recipe = recipeById.get(d.recipeId);
    if (recipe === undefined) {
      unchecked.push({
        recipeId: d.recipeId,
        reason: 'missing_recipe',
        detail: `no recipe record, so its ingredients could not be examined`,
      });
      continue;
    }

    const hasAnyTags = recipe.components.some((c) => {
      if (c.kind !== 'ingredient') return false;
      const ing = ingredientById.get(c.ingredientId);
      return ing !== undefined && ing.allergens.length > 0;
    });

    if (!hasAnyTags) {
      unchecked.push({
        recipeId: recipe.id,
        reason: 'no_allergen_data',
        detail: `${recipe.name}: no ingredient carries allergen tags, so nothing was examined`,
      });
    }
  }

  for (const dietary of job.dietaries) {
    if (dietary.kind === 'unresolved') {
      findings.push({
        dietaryId: dietary.id,
        guest: null,
        dietType: dietary.dietType,
        severity: dietary.severity,
        reason: 'unresolved_requirement',
        recipeId: null,
        message: `"${dietary.originalWording}" is unresolved — ${REVIEW}`,
      });
      continue;
    }

    // Rule 9, stated in CLAUDE.md section 3: a severe requirement with no assigned
    // dish is flagged regardless of keyword hits. On data with no allergen tags
    // this is the only thing that catches it.
    if (dietary.severity === 'severe' && dietary.assignedRecipeId === null) {
      findings.push({
        dietaryId: dietary.id,
        guest: dietary.guest,
        dietType: dietary.dietType,
        severity: dietary.severity,
        reason: 'severe_without_assigned_dish',
        recipeId: null,
        message: `severe requirement "${dietary.dietType}" has no assigned dish — ${REVIEW}`,
      });
    }

    const wanted = tokens(`${dietary.dietType} ${dietary.details ?? ''}`);

    for (const d of job.dishes) {
      const recipe = recipeById.get(d.recipeId);
      if (recipe === undefined) continue;

      for (const component of recipe.components) {
        if (component.kind !== 'ingredient') continue;
        const ing = ingredientById.get(component.ingredientId);
        if (ing === undefined || ing.allergens.length === 0) continue;

        if (overlaps(wanted, tokens(ing.allergens.join(' ')))) {
          findings.push({
            dietaryId: dietary.id,
            guest: dietary.guest,
            dietType: dietary.dietType,
            severity: dietary.severity,
            reason: 'possible_ingredient_match',
            recipeId: recipe.id,
            message: `"${dietary.dietType}" against ${ing.name} in ${recipe.name} — ${REVIEW}`,
          });
        }
      }
    }
  }

  return { findings, unchecked };
}

// ---------------------------------------------------------------------------
// dietaryCrossCheck — Rule 16
// ---------------------------------------------------------------------------

export type DietaryIssueReason =
  | 'no_assigned_dish'
  | 'assigned_dish_not_on_menu'
  | 'unresolved';

export interface DietaryIssue {
  readonly dietaryId: JobDietaryId;
  readonly reason: DietaryIssueReason;
  readonly dietType: string;
  readonly severity: DietarySeverity;
  /**
   * The distinct guests affected. Rule 16 — a list of refs, never a count. One
   * guest holding two requirements appears once here, in each of two issues.
   */
  readonly guests: readonly GuestRef[];
  readonly detail: string;
}

export function dietaryCrossCheck(job: Job, _recipes: readonly Recipe[]): DietaryIssue[] {
  const onMenu = new Set(job.dishes.map((d) => d.recipeId));
  const issues: DietaryIssue[] = [];

  for (const dietary of job.dietaries) {
    if (dietary.kind === 'unresolved') {
      issues.push({
        dietaryId: dietary.id,
        reason: 'unresolved',
        dietType: dietary.dietType,
        severity: dietary.severity,
        guests: [],
        detail: `"${dietary.originalWording}" has not been resolved to named guests`,
      });
      continue;
    }

    if (dietary.assignedRecipeId === null) {
      issues.push({
        dietaryId: dietary.id,
        reason: 'no_assigned_dish',
        dietType: dietary.dietType,
        severity: dietary.severity,
        guests: [dietary.guest],
        detail: `${dietary.dietType} has no dish assigned`,
      });
      continue;
    }

    if (!onMenu.has(dietary.assignedRecipeId)) {
      issues.push({
        dietaryId: dietary.id,
        reason: 'assigned_dish_not_on_menu',
        dietType: dietary.dietType,
        severity: dietary.severity,
        guests: [dietary.guest],
        detail: `${dietary.dietType} is assigned a dish that is not on this job's menu`,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// readinessCheck
// ---------------------------------------------------------------------------

export interface ReadinessContext {
  /** From `jobRevenue`. Passed in rather than recomputed — Rule 5. */
  readonly revenueKnown: boolean;
  /** From `outstandingShopping`: how many lines still need buying. */
  readonly outstandingCount: number;
  /** From `dietaryCrossCheck`: how many issues remain. */
  readonly dietaryIssues: number;
}

export interface ReadinessItem {
  readonly key: string;
  readonly label: string;
  readonly met: boolean;
  readonly detail: string | null;
}

export interface ReadinessResult {
  readonly items: readonly ReadinessItem[];
  readonly metCount: number;
  readonly total: number;
  /** 0–100, integer. */
  readonly percentage: number;
}

/**
 * Is this job ready to execute?
 *
 * Assembles signals the rest of the engine has already produced. It recalculates
 * nothing: money comes from `jobRevenue`, quantities from `outstandingShopping`.
 * A second orchestration path here would drift from the real cascade (Rule 5).
 */
export function readinessCheck(job: Job, context: ReadinessContext): ReadinessResult {
  const items: ReadinessItem[] = [
    {
      key: 'guests_confirmed',
      label: 'Guest count confirmed',
      met: job.guests !== null && job.guestsConfirmed,
      detail: job.guests === null ? 'no guest count recorded' : null,
    },
    {
      key: 'service_time',
      label: 'Service time set',
      met: job.serviceTime !== null,
      detail: null,
    },
    {
      key: 'location',
      label: 'Location set',
      met: job.propertyId !== null,
      detail: null,
    },
    {
      key: 'menu',
      label: 'Menu chosen',
      met: job.dishes.length > 0,
      detail: null,
    },
    {
      key: 'dietaries_allocated',
      label: 'Dietary requirements allocated',
      met: context.dietaryIssues === 0,
      detail:
        context.dietaryIssues === 0 ? null : `${context.dietaryIssues} still need attention`,
    },
    {
      key: 'shopping_done',
      label: 'Shopping complete',
      met: context.outstandingCount === 0,
      detail:
        context.outstandingCount === 0 ? null : `${context.outstandingCount} still to buy`,
    },
    {
      key: 'revenue_known',
      label: 'Price known',
      met: context.revenueKnown,
      detail: context.revenueKnown ? null : 'no rate applies and no manual figure is set',
    },
  ];

  const metCount = items.filter((i) => i.met).length;
  const total = items.length;

  // Guarded, though `items` is never empty today — 0/0 is NaN, and a NaN
  // percentage on a dashboard is worse than a wrong one.
  const percentage = total === 0 ? 100 : Math.round((metCount / total) * 100);

  return { items, metCount, total, percentage };
}

// ---------------------------------------------------------------------------
// anomalyScan
// ---------------------------------------------------------------------------

export type AnomalySeverity = 'critical' | 'high' | 'medium' | 'low';

export type AnomalyReason =
  | 'mains_without_sides'
  | 'sides_below_guests'
  | 'mains_below_guests'
  | 'menu_without_dessert'
  | 'missing_recipe'
  | 'no_guest_count'
  | 'no_service_time'
  | 'no_menu'
  | 'unallocated_dietary';

export interface Anomaly {
  readonly jobId: JobId;
  readonly reason: AnomalyReason;
  readonly severity: AnomalySeverity;
  readonly detail: string;
  /** Distinct guests, where relevant. Rule 16 — refs, never a count. */
  readonly guests?: readonly GuestRef[];
}

/**
 * Cross-job anomaly report.
 *
 * The BBQ guards, generalised. CLAUDE.md's case is a BBQ where meat scales to
 * meat-eating guests but sides must scale to ALL guests — 27 guests, 22 meat
 * eaters, and baps ordered for 22 was the real defect the golden pack caught.
 *
 * This file does not know what a BBQ is, and must not: `serviceType` is
 * owner-defined free text, and putting "BBQ" in `src/` would be the business data
 * Rule 1 forbids. The guard is expressed through `Recipe.course` instead —
 * structural, and it catches the same defect:
 *
 *   - a menu with mains and no side at all
 *   - a side whose portions fall below the guest count
 *
 * A main below the guest count is NOT flagged as a side would be, because meat
 * legitimately scales to meat eaters. It is flagged only when it falls below the
 * meat-eating count, or below guests when no meat-eater figure is set.
 *
 * Known false positive: a service that genuinely has no sides. This is a report,
 * not a blocked action, and it is the price of keeping service-type strings out of
 * the engine. See ARCHITECTURE.md.
 */
export function anomalyScan(
  jobs: readonly Job[],
  recipes: readonly Recipe[],
): readonly Anomaly[] {
  const recipeById = new Map(recipes.map((r) => [r.id, r]));
  const found: Anomaly[] = [];

  for (const job of jobs) {
    if (job.status === 'cancelled') continue;

    const add = (
      reason: AnomalyReason,
      severity: AnomalySeverity,
      detail: string,
      guests?: readonly GuestRef[],
    ): void => {
      found.push(guests === undefined ? { jobId: job.id, reason, severity, detail } : {
        jobId: job.id,
        reason,
        severity,
        detail,
        guests,
      });
    };

    if (job.guests === null) {
      add('no_guest_count', 'high', 'no guest count recorded');
    }
    if (job.serviceTime === null) {
      add('no_service_time', 'medium', 'no service time recorded');
    }
    if (job.dishes.length === 0) {
      add('no_menu', 'high', 'no dishes on the menu');
    }

    const courses = { main: 0, side: 0, dessert: 0 };

    for (const d of job.dishes) {
      const recipe = recipeById.get(d.recipeId);
      if (recipe === undefined) {
        add('missing_recipe', 'critical', `no recipe record for dish "${d.recipeId}"`);
        continue;
      }

      if (recipe.course === 'main') courses.main += 1;
      if (recipe.course === 'side') courses.side += 1;
      if (recipe.course === 'dessert') courses.dessert += 1;

      if (job.guests === null || d.portions === null) continue;

      // Sides feed everyone. This is the guard for the original defect.
      if (recipe.course === 'side' && d.portions < job.guests) {
        add(
          'sides_below_guests',
          'critical',
          `${recipe.name}: ${d.portions} portions for ${job.guests} guests — sides feed everyone`,
        );
      }

      // Mains may legitimately scale to meat eaters, so the floor is that figure
      // when the owner has set it.
      if (recipe.course === 'main') {
        const floor = job.meatEatingGuests ?? job.guests;
        if (d.portions < floor) {
          add(
            'mains_below_guests',
            'high',
            `${recipe.name}: ${d.portions} portions against a floor of ${floor}`,
          );
        }
      }
    }

    if (courses.main > 0 && courses.side === 0) {
      add('mains_without_sides', 'high', 'menu has a main course but no side dish');
    }
    if (courses.main > 0 && courses.dessert === 0) {
      add('menu_without_dessert', 'medium', 'menu has a main course but no dessert');
    }

    // Rule 16 — distinct guests, never a count.
    const unallocated = new Set<GuestRef>();
    for (const dietary of job.dietaries) {
      if (dietary.kind === 'allocated' && dietary.assignedRecipeId === null) {
        unallocated.add(dietary.guest);
      }
    }
    if (unallocated.size > 0) {
      add(
        'unallocated_dietary',
        'high',
        'dietary requirements with no dish assigned',
        [...unallocated],
      );
    }
  }

  return found;
}
