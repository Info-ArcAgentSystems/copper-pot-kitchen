/**
 * The packing list, per job.
 *
 * PURE, and — like the other two derived view-models — it does no arithmetic. The
 * portions come from `applyBuffetSplit`, which is the same single implementation
 * Prep and Shopping use to fill a null portions figure. Nothing is re-derived here.
 *
 * WHAT MAKES THIS SCREEN DIFFERENT
 * Shopping and Prep consolidate across jobs; that is their whole purpose. Packing
 * must not. Each job goes into its own boxes and its own van run, so three jobs
 * needing lasagne are three lists, not one line of 39 portions. A rollup here
 * would be a screen that is confidently useless.
 *
 * THE TICK KEY
 * `packing_state.item` is free text, so the key stored has to be stable rather
 * than the label on screen. Both are built here, by `foodKey` and `equipmentKey`,
 * so the read and the write can never derive them differently — a mismatch would
 * make every tick appear to do nothing at all.
 */

import { applyBuffetSplit } from '../engine/rules';
import { routeGaps, type CheckYourself, type Flag } from './gapRouting';
import type { RequirementGap } from '../engine/shopping';
import type {
  Customer,
  Job,
  JobId,
  PackingState,
  Recipe,
  RecipeId,
  ServiceTemplate,
  ServiceTemplateId,
} from '../engine/types';

/**
 * Namespaced so a recipe and an equipment item may share a name.
 *
 * "Chafing dish" is a plausible name for both a dish and a piece of kit. Keyed by
 * label they would be ONE tick, and ticking the food would strike through the
 * equipment. Keyed by id they cannot collide, and neither orphans on a rename.
 */
export const foodKey = (recipeId: RecipeId): string => `food:${recipeId}`;
export const equipmentKey = (templateId: ServiceTemplateId): string => `equipment:${templateId}`;

export interface PackingLine {
  readonly itemKey: string;
  readonly label: string;
  /** Food only. Null when it could not be derived — never a guess (Rule 8). */
  readonly portions: number | null;
  /** Why a figure is missing, or the recipe unknown. Null when there is nothing to say. */
  readonly note: string | null;
  readonly done: boolean;
}

export interface PackingJob {
  readonly jobId: JobId;
  readonly heading: string;
  readonly food: readonly PackingLine[];
  readonly equipment: readonly PackingLine[];
  readonly tasks: readonly PackingLine[];
  /** The job has no dishes at all. */
  readonly emptyMenu: boolean;
  /** A service type is set, but the owner has written no template for it yet. */
  readonly noTemplate: boolean;
  /** No service type, so nothing can be matched. A different fix from noTemplate. */
  readonly noServiceType: boolean;
}

export interface PackingView {
  readonly jobs: readonly PackingJob[];
  readonly checkYourself: readonly CheckYourself[];
  readonly needsFixing: readonly Flag[];
  readonly nothingToPack: boolean;
}

function headingFor(job: Job, customer: Customer | undefined): string {
  const parts = [customer?.name, job.serviceDate ?? undefined, job.serviceTime ?? undefined, job.serviceType ?? undefined]
    .filter((p): p is string => p !== undefined && p !== '');

  return parts.length === 0 ? 'Job with no details yet' : parts.join(' · ');
}

export function buildPackingView(
  jobs: readonly Job[],
  recipes: readonly Recipe[],
  templates: readonly ServiceTemplate[],
  customers: readonly Customer[],
  ticks: readonly PackingState[],
  gaps: readonly RequirementGap[],
): PackingView {
  const recipeById = new Map(recipes.map((r) => [r.id, r]));
  const customerById = new Map(customers.map((c) => [c.id as string, c]));

  // Ticks are scoped per job, so one job's lasagne cannot tick another's.
  const doneKeys = new Set(
    ticks.filter((t) => t.done).map((t) => `${t.jobId} ${t.itemKey}`),
  );
  const isDone = (jobId: JobId, itemKey: string): boolean =>
    doneKeys.has(`${jobId} ${itemKey}`);

  const packed: PackingJob[] = jobs
    .slice()
    // What leaves first is packed first. Date then time; a job with neither sorts
    // last rather than jumping the queue.
    .sort((a, b) => {
      const key = (j: Job): string => `${j.serviceDate ?? '9999-99-99'} ${j.serviceTime ?? '99:99'}`;
      return key(a).localeCompare(key(b));
    })
    .map((job) => {
      // The one engine call. Only fills nulls, and only when the guest count is
      // known — deriving from an unknown would be the invention Rule 8 forbids.
      const dishes =
        job.guests === null ? job.dishes : applyBuffetSplit(job.guests, job.dishes, recipes);

      const food: PackingLine[] = dishes.map((d) => {
        const recipe = recipeById.get(d.recipeId);

        return {
          itemKey: foodKey(d.recipeId),
          // A dish whose recipe is missing is still named, never dropped — a
          // dropped line is a dish silently never packed.
          label: recipe?.name ?? 'Dish with no recipe',
          portions: d.portions,
          note:
            recipe === undefined
              ? 'this dish has no recipe — check it in Recipes'
              : d.portions === null
                ? 'portions not set — check before packing'
                : null,
          done: isDone(job.id, foodKey(d.recipeId)),
        };
      });

      const forService =
        job.serviceType === null
          ? []
          : templates
              .filter((t) => t.serviceType === job.serviceType)
              .slice()
              .sort((a, b) => a.position - b.position);

      const lineOf = (t: ServiceTemplate): PackingLine => ({
        itemKey: equipmentKey(t.id),
        label: t.item,
        portions: null,
        note: null,
        done: isDone(job.id, equipmentKey(t.id)),
      });

      return {
        jobId: job.id,
        heading: headingFor(job, job.customerId === null ? undefined : customerById.get(job.customerId)),
        food,
        equipment: forService.filter((t) => t.kind === 'equipment').map(lineOf),
        tasks: forService.filter((t) => t.kind === 'task').map(lineOf),
        emptyMenu: dishes.length === 0,
        // Rule 1: the app ships with no templates, so this is the NORMAL state in
        // week one. An empty section would read as "no equipment needed", which is
        // a different and wrong statement.
        noTemplate: job.serviceType !== null && forService.length === 0,
        noServiceType: job.serviceType === null,
      };
    });

  const routed = routeGaps(gaps);

  return {
    jobs: packed,
    checkYourself: routed.checkYourself,
    needsFixing: routed.needsFixing,
    nothingToPack: packed.length === 0,
  };
}
