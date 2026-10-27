/**
 * Turning the production plan into the prep screen's days.
 *
 * PURE, so it runs in Node with no DOM. `productionBuckets` consolidated the
 * portions and rounded the batches; `prepPlanByDay` grouped and ordered them. This
 * labels what they returned and does no arithmetic — a second rounding path is
 * exactly what Rule 5 forbids, and it is how 39 portions becomes 6 trays on one
 * screen and 5 on another.
 *
 * What is guarded:
 *   - surplus is shown, not hidden inside a tray count
 *   - a per_person recipe never renders a fictional tray count
 *   - the per-job allocation survives, because that is how he splits the tray
 *   - no gap reason is routed nowhere
 */

import { describe, expect, it } from 'vitest';
import { buildPrepView } from '../../src/ui/prepView';
import type { PrepDay, ProductionBucket } from '../../src/engine/production';
import type { RequirementGap } from '../../src/engine/shopping';
import type {
  Customer,
  CustomerId,
  IsoDate,
  Job,
  JobId,
  KitchenId,
  Recipe,
  RecipeId,
} from '../../src/engine/types';

const KITCHEN = 'k1' as KitchenId;

const bucket = (over: Partial<ProductionBucket> = {}): ProductionBucket => ({
  recipeId: 'lasagne' as RecipeId,
  recipeName: 'Lasagne',
  prepDate: '2026-08-17' as IsoDate,
  portions: 39,
  batches: { batches: 5, capacity: 45, surplus: 6 },
  allocations: [
    { jobId: 'j1' as JobId, portions: 18 },
    { jobId: 'j2' as JobId, portions: 12 },
    { jobId: 'j3' as JobId, portions: 9 },
  ],
  earliestServiceDate: '2026-08-18' as IsoDate,
  ...over,
});

const day = (over: Partial<PrepDay> = {}): PrepDay => ({
  prepDate: '2026-08-17' as IsoDate,
  buckets: [bucket()],
  ...over,
});

const job = (id: string, customerId: string | null, over: Partial<Job> = {}): Job => ({
  id: id as JobId,
  kitchenId: KITCHEN,
  customerId: customerId as CustomerId | null,
  propertyId: null,
  jobGroup: null,
  serviceDate: '2026-08-18' as IsoDate,
  serviceTime: null,
  serviceType: 'Buffet',
  guests: 18,
  guestsConfirmed: true,
  meatEatingGuests: null,
  pricing: { kind: 'rate_card' },
  status: 'confirmed',
  notes: null,
  dishes: [],
  dietaries: [],
  extras: [],
  ...over,
});

const customer = (id: string, name: string): Customer => ({
  id: id as CustomerId,
  kitchenId: KITCHEN,
  name,
  phone: null,
  email: null,
  clientGroup: null,
  notes: null,
});

const view = (
  days: readonly PrepDay[] = [day()],
  gaps: RequirementGap[] = [],
  jobs: Job[] = [job('j1', 'c1'), job('j2', 'c2'), job('j3', 'c3')],
  customers: Customer[] = [customer('c1', 'Nolan'), customer('c2', 'Byrne'), customer('c3', 'Carr')],
  ticks: { recipeId: string; prepDate: string; done: boolean }[] = [],
  recipes: Recipe[] = [],
) => buildPrepView(days, gaps, jobs, customers, ticks as never, recipes);

/** A recipe with ingredients in it — the ordinary case. */
const written = (id: string, name: string): Recipe => ({
  id: id as RecipeId, kitchenId: KITCHEN, name,
  course: 'main', yieldType: 'per_person', portionsPerBatch: null, batchUnit: null,
  confidence: 'locked', makeAheadDays: 0, sameDayOnly: true, freezable: false,
  onsiteFinish: false, method: null, note: null,
  components: [{ id: 'l1', recipeId: id, position: 0, kind: 'ingredient',
    ingredientId: 'i1', subRecipeId: null, quantity: 150, unit: 'g' } as never],
  unquantified: [],
});

/** A name and nothing else — what a scanned menu line becomes. */
const nameOnly = (id: string, name: string, confidence: Recipe['confidence']): Recipe => ({
  ...written(id, name),
  confidence,
  components: [],
});

describe('days', () => {
  it('keeps the engine’s day order rather than re-sorting', () => {
    // prepPlanByDay already returns days ascending with prioritisePrep applied.
    // Re-sorting here would be a second ordering free to disagree with it.
    const { days } = view([
      day({ prepDate: '2026-08-17' as IsoDate }),
      day({ prepDate: '2026-08-19' as IsoDate }),
    ]);

    expect(days.map((d) => d.prepDate)).toEqual(['2026-08-17', '2026-08-19']);
  });

  it('keeps the engine’s bucket order within a day', () => {
    const { days } = view([
      day({
        buckets: [
          bucket({ recipeId: 'curry' as RecipeId, recipeName: 'Curry' }),
          bucket({ recipeId: 'lasagne' as RecipeId, recipeName: 'Lasagne' }),
        ],
      }),
    ]);

    expect(days[0]?.lines.map((l) => l.recipeName)).toEqual(['Curry', 'Lasagne']);
  });

  it('marks today, because "is this today’s list" is the first question', () => {
    const today = new Date().toISOString().slice(0, 10);
    const { days } = view([day({ prepDate: today as IsoDate }), day({ prepDate: '2099-01-01' as IsoDate })]);

    expect(days[0]?.isToday).toBe(true);
    expect(days[1]?.isToday).toBe(false);
  });

  it('is empty when there is nothing to make', () => {
    expect(view([]).days).toEqual([]);
    expect(view([]).nothingToMake).toBe(true);
  });
});

describe('a line', () => {
  it('leads with the batch count the engine rounded', () => {
    const [line] = view().days[0]!.lines;

    expect(line?.batchLabel).toBe('5 trays');
    expect(line?.portions).toBe(39);
  });

  it('SHOWS SURPLUS rather than hiding it in the tray count', () => {
    // 39 portions at 9 per tray is 5 trays making 45. The 6 spare are real food he
    // can plan around, and burying them would make the tray count look exact.
    const [line] = view().days[0]!.lines;

    expect(line?.surplus).toBe('6 portions spare');
  });

  it('says nothing about surplus when the batches come out even', () => {
    const [line] = view([
      day({ buckets: [bucket({ portions: 45, batches: { batches: 5, capacity: 45, surplus: 0 } })] }),
    ]).days[0]!.lines;

    expect(line?.surplus).toBeNull();
  });

  it('NEVER invents a tray count for a per-person recipe', () => {
    // `batches: null` means the recipe is scaled per person — there is no batch to
    // count. "0 trays" would be a fiction, and "1 tray" a worse one.
    const [line] = view([day({ buckets: [bucket({ batches: null, portions: 17 })] })]).days[0]!
      .lines;

    expect(line?.batchLabel).toBeNull();
    expect(line?.portions).toBe(17);
    expect(line?.surplus).toBeNull();
  });

  it('uses the singular for one batch', () => {
    const [line] = view([
      day({ buckets: [bucket({ batches: { batches: 1, capacity: 9, surplus: 0 } })] }),
    ]).days[0]!.lines;

    expect(line?.batchLabel).toBe('1 tray');
  });
});

describe('the per-job allocation — how he splits the tray', () => {
  it('labels each share with the customer and the service', () => {
    const [line] = view().days[0]!.lines;

    expect(line?.allocations[0]?.label).toContain('Nolan');
    expect(line?.allocations[0]?.portions).toBe(18);
  });

  it('keeps the engine’s allocation figures untouched', () => {
    // A CHECK on the engine's number, not a recomputation of it: the shares the
    // engine allocated must account for the total it consolidated.
    const [line] = view().days[0]!.lines;
    const shares = line!.allocations.map((a) => a.portions);

    expect(shares).toEqual([18, 12, 9]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(line?.portions);
  });

  it('falls back to something identifying when a job has no customer', () => {
    // A job with no customer is legitimate — Rule 8 says null, not a guess. It
    // still has to be namable on a prep sheet.
    const [line] = view([day()], [], [job('j1', null), job('j2', 'c2'), job('j3', 'c3')]).days[0]!
      .lines;

    expect(line?.allocations[0]?.label).not.toContain('undefined');
    expect(line?.allocations[0]?.label).not.toBe('');
  });

  it('does not drop an allocation whose job is missing entirely', () => {
    // Dropping it would make the shares stop accounting for the total, and the
    // prep sheet would quietly under-allocate a tray.
    const [line] = view([day()], [], []).days[0]!.lines;

    expect(line?.allocations).toHaveLength(3);
    expect(line?.allocations.reduce((sum, a) => sum + a.portions, 0)).toBe(39);
  });
});

/**
 * A gap literal.
 *
 * `recipeId` / `ingredientId` default to null: these tests are about ROUTING BY
 * REASON, and the identity fields are what Ask Sous uses to tell a blocked
 * quantity from a zero one. Naming them here would suggest routing depends on
 * them, which it does not.
 */
const gap = (reason: RequirementGap['reason'], detail: string): RequirementGap => ({
  reason,
  recipeId: null,
  ingredientId: null,
  detail,
});

describe('gap flags — the same vocabulary as Shopping', () => {
  it('routes an unquantified component to check-yourself', () => {
    // Genuinely a prep concern: he has to judge the seasoning at the stove.
    const { checkYourself } = view([], [
      gap('unquantified', 'Tapas: "seasoning" has no quantity'),
    ]);

    expect(checkYourself).toHaveLength(1);
    expect(checkYourself[0]?.label).toContain('seasoning');
  });

  it('routes a missing recipe to needs-fixing, naming where to fix it', () => {
    const { needsFixing } = view([], [
      gap('missing_recipe', 'no recipe found for dish "x"'),
    ]);

    expect(needsFixing[0]?.where).toBe('Library → Recipes');
  });

  it('routes a missing portions-per-batch to Recipes', () => {
    const { needsFixing } = view([], [
      gap('no_portions_per_batch', 'Lasagne: batch recipe with no portions per batch'),
    ]);

    expect(needsFixing[0]?.where).toBe('Library → Recipes');
  });

  it('EVERY reason lands somewhere', () => {
    const all: RequirementGap['reason'][] = [
      'unquantified', 'named_unquantified', 'missing_sub_recipe', 'no_portions_per_batch',
      'no_components', 'cycle', 'missing_recipe', 'no_service_date', 'no_portions',
      'missing_ingredient', 'unresolved_conversion', 'no_pack_size',
    ];

    for (const reason of all) {
      const { checkYourself, needsFixing } = view([], [gap(reason, 'x')]);
      expect(
        checkYourself.length + needsFixing.length,
        `reason "${reason}" was routed nowhere`,
      ).toBe(1);
    }
  });

  it('collapses duplicates, which consolidation across jobs produces plenty of', () => {
    const { needsFixing } = view([], [
      gap('missing_recipe', 'same detail'),
      gap('missing_recipe', 'same detail'),
    ]);

    expect(needsFixing).toHaveLength(1);
  });
});

describe('ticks', () => {
  it('marks a line done when a tick exists for that recipe on that day', () => {
    const { days } = view([day()], [], undefined, undefined, [
      { recipeId: 'lasagne', prepDate: '2026-08-17', done: true },
    ]);

    expect(days[0]?.lines[0]?.done).toBe(true);
  });

  it('does NOT carry a tick across to another day', () => {
    // The same recipe made on two days is two jobs of work. One tick must not
    // strike both through.
    const { days } = view(
      [day({ prepDate: '2026-08-17' as IsoDate }), day({ prepDate: '2026-08-18' as IsoDate })],
      [],
      undefined,
      undefined,
      [{ recipeId: 'lasagne', prepDate: '2026-08-17', done: true }],
    );

    expect(days[0]?.lines[0]?.done).toBe(true);
    expect(days[1]?.lines[0]?.done).toBe(false);
  });

  it('is not done when there is no tick at all', () => {
    expect(view().days[0]?.lines[0]?.done).toBe(false);
  });
});

describe('a recipe with nothing in it is MARKED, not dropped', () => {
  /*
   * THE HOLE THIS CLOSES. A scanned menu line becomes a recipe that is a name
   * and nothing else, and a recipe with no components produces:
   *
   *   a cost of null          — correct, `recipeFoodCost` refuses to guess
   *   no shopping line        — correct, there is nothing to buy
   *   a PREP BUCKET with a real tray count — and nothing saying why the other
   *                             two are empty
   *
   * So the prep sheet said "5 trays of Pavlova" on the strength of a recipe
   * with no ingredients in it. The engine does raise `no_components`, and
   * `routeGaps` puts it in `needsFixing` — at the BOTTOM of the screen, under a
   * heading, while the tray count sits at the top. A flag down there and a tray
   * count up here is how he makes five trays of nothing.
   *
   * Marked rather than filtered, deliberately: 17 people are still eating it.
   * The portions are real work. What is absent is the shopping and the cost,
   * and that is what the line now says.
   *
   * THE MARKER IS A VIEW CONCERN. It reads `components.length`, it does no
   * arithmetic, and it adds nothing to the engine — so the golden pack cannot
   * move for it.
   */
  it('marks a line whose recipe has no ingredients', () => {
    const lines = view(undefined, [], undefined, undefined, [], [nameOnly('lasagne', 'Lasagne', 'locked')]).days[0]?.lines;

    expect(lines?.[0]?.stub).toBe('No ingredients yet — nothing to buy and no cost for this.');
  });

  it('says where a scanned one came from, because that is how he recognises it', () => {
    // `missing` is what `stubRecipe` sets: nothing is known about it at all.
    const lines = view(undefined, [], undefined, undefined, [], [nameOnly('lasagne', 'Lasagne', 'missing')]).days[0]?.lines;

    expect(lines?.[0]?.stub).toBe(
      'Scanned as a name only — add ingredients before it can be bought or costed.',
    );
  });

  it('keeps the portions and the tray count on a marked line', () => {
    // MARK, DON'T FILTER. He still has to make it.
    const lines = view(undefined, [], undefined, undefined, [], [nameOnly('lasagne', 'Lasagne', 'missing')]).days[0]?.lines;

    expect(lines?.[0]?.portions).toBe(39);
    expect(lines?.[0]?.recipeName).toBe('Lasagne');
  });

  it('leaves an ordinary recipe unmarked', () => {
    const lines = view(undefined, [], undefined, undefined, [], [written('lasagne', 'Lasagne')]).days[0]?.lines;

    expect(lines?.[0]?.stub).toBeNull();
  });

  it('does not mark a scanned recipe he has since filled in', () => {
    /*
     * The operational fact is `components.length`, not the confidence flag. He
     * scans a recipe card, the recipe lands as `confirm` or `missing`, and he
     * then types the ingredients in. It is shoppable and costable from that
     * moment, and marking it on the flag alone would nag him about a recipe
     * that works.
     */
    const filledIn = { ...written('lasagne', 'Lasagne'), confidence: 'missing' as const };
    const lines = view(undefined, [], undefined, undefined, [], [filledIn]).days[0]?.lines;

    expect(lines?.[0]?.stub).toBeNull();
  });

  it('does not claim a recipe is empty when it simply was not passed in', () => {
    /*
     * The failure mode of adding a parameter. `sousAnswer` builds this view for
     * one answer and has no reason to hand over the whole recipe book; if an
     * absent recipe read as an empty one, every line there would be marked as
     * having no ingredients.
     */
    const lines = view().days[0]?.lines;

    expect(lines?.[0]?.stub).toBeNull();
  });
});
