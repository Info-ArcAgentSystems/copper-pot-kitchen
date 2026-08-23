/**
 * The tools themselves — that each one returns what its engine returned.
 *
 * These are thin by design, so the assertions are mostly about the seam: the
 * right engine is called, the figures pass through untouched, and the propose
 * tool produces a diff without writing.
 */

import { describe, expect, it } from 'vitest';
import { runIntent, TOOLS, type SousData } from '../../src/sous/tools';
import { commitProposal } from '../../src/sous/commit';
import { outstandingShopping, requirementsForRange } from '../../src/engine/shopping';
import { fakeDb } from '../data/fakeDb';
import type {
  Cents,
  Customer,
  CustomerId,
  Ingredient,
  IngredientId,
  IsoDate,
  Job,
  JobDishId,
  JobId,
  KitchenId,
  PurchaseUnit,
  Recipe,
  RecipeId,
  RecipeIngredientLine,
  RecipeLineId,
  RecipeUnit,
  StockUnit,
} from '../../src/engine/types';

const KITCHEN = 'k1' as KitchenId;
const c = (n: number): Cents => n as Cents;

const mince: Ingredient = {
  id: 'mince' as IngredientId,
  kitchenId: KITCHEN,
  name: 'mince',
  category: null,
  stockUnit: 'kg' as StockUnit,
  recipeUnit: 'kg' as RecipeUnit,
  recipeUnitsPerStockUnit: null,
  pack: { size: 1, unit: 'kg' as PurchaseUnit, assumed: false },
  supplierId: null,
  pricePerPack: c(900),
  previousPrice: null,
  priceChecked: null,
  allergens: [],
};

const lasagne: Recipe = {
  id: 'lasagne' as RecipeId,
  kitchenId: KITCHEN,
  name: 'Lasagne',
  course: 'main',
  yieldType: 'per_person',
  portionsPerBatch: null,
  batchUnit: null,
  confidence: 'locked',
  makeAheadDays: 0,
  sameDayOnly: true,
  freezable: false,
  onsiteFinish: false,
  method: null,
  note: null,
  components: [
    {
      id: 'l1' as RecipeLineId,
      kind: 'ingredient',
      ingredientId: 'mince' as IngredientId,
      displayName: 'mince',
      qty: 1,
      unit: 'kg' as RecipeUnit,
      position: 0,
    },
  ],
  unquantified: [],
};

const customer: Customer = {
  id: 'c1' as CustomerId,
  kitchenId: KITCHEN,
  name: 'Nolan',
  phone: null,
  email: null,
  clientGroup: 'private',
  notes: null,
};

const job = (over: Partial<Job> = {}): Job => ({
  id: 'j1' as JobId,
  kitchenId: KITCHEN,
  customerId: 'c1' as CustomerId,
  propertyId: null,
  jobGroup: null,
  serviceDate: '2026-08-20' as IsoDate,
  serviceTime: null,
  serviceType: 'Buffet',
  guests: 10,
  guestsConfirmed: true,
  meatEatingGuests: null,
  pricing: { kind: 'rate_card' },
  status: 'confirmed',
  notes: null,
  dishes: [
    {
      id: 'd1' as JobDishId,
      jobId: 'j1' as JobId,
      recipeId: 'lasagne' as RecipeId,
      portions: 10,
      note: null,
      position: 0,
    },
  ],
  dietaries: [],
  extras: [],
  ...over,
});

const data = (over: Partial<SousData> = {}): SousData => ({
  jobs: [job()],
  recipes: [lasagne],
  ingredients: [mince],
  customers: [customer],
  rates: [],
  stock: [],
  templates: [],
  today: '2026-08-01',
  horizon: '2026-08-31',
  ...over,
});

describe('read tools return what the engine returned', () => {
  it('shopping matches a direct engine call exactly', () => {
    // The point of the whole architecture: an Ask Sous answer and the Shopping
    // screen cannot disagree, because they are the same call.
    const d = data();
    const result = runIntent(d, {
      tool: 'shopping_for_range',
      args: { from: '2026-08-01' as IsoDate, to: '2026-08-31' as IsoDate },
    });

    const direct = outstandingShopping(
      requirementsForRange(d.jobs, d.recipes, d.ingredients).lines,
      [],
      [],
      d.ingredients,
    );

    expect(result?.kind).toBe('shopping');
    if (result?.kind !== 'shopping') return;
    expect(result.value.lines).toEqual(direct);
  });

  it('excludes jobs outside the window', () => {
    const result = runIntent(data(), {
      tool: 'shopping_for_range',
      args: { from: '2026-09-01' as IsoDate, to: '2026-09-30' as IsoDate },
    });

    expect(result?.kind).toBe('shopping');
    if (result?.kind !== 'shopping') return;
    expect(result.value.jobCount).toBe(0);
  });

  it('prep groups by day through the engine', () => {
    const result = runIntent(data(), {
      tool: 'prep_for_range',
      args: { from: '2026-08-01' as IsoDate, to: '2026-08-31' as IsoDate },
    });

    expect(result?.kind).toBe('prep');
    if (result?.kind !== 'prep') return;
    expect(result.value.days.length).toBeGreaterThan(0);
  });

  it('money returns a rangeMoney result, nulls intact', () => {
    // No rate card, so revenue is null rather than 0 (Rule 8) — and that survives
    // the trip through the tool.
    const result = runIntent(data(), {
      tool: 'money_for_range',
      args: { from: '2026-08-01' as IsoDate, to: '2026-08-31' as IsoDate },
    });

    expect(result?.kind).toBe('money');
    if (result?.kind !== 'money') return;
    expect(result.value.total.revenue.total).toBeNull();
  });

  it('job_details returns null rather than throwing for an unknown job', () => {
    const result = runIntent(data(), {
      tool: 'job_details',
      args: { jobId: 'ghost' as JobId },
    });

    expect(result?.kind).toBe('job');
    if (result?.kind !== 'job') return;
    expect(result.value.job).toBeNull();
  });

  /**
   * "How much adobo do I need" — WITH NO DATES.
   *
   * The reported defect after the routing fix: instead of the anomalies object it
   * had returned before, Sous replied "could you specify the dates?". That is more
   * friction than the Shopping screen, which simply opens on today to a week
   * ahead and answers.
   *
   * So a dateless quantity question must ANSWER, over `today`–`horizon`, and the
   * result must carry that window back so the sentence can state it. The routing
   * half — that the model picks this tool rather than `clarify` — is guarded on
   * the tool surface in `guards.test.ts`; what a deployed model actually picks is
   * not something a unit test can claim.
   */
  it('answers a quantity question with NO DATES over the default window', () => {
    const d = data({ jobs: [job()], today: '2026-08-18', horizon: '2026-08-25' });

    const result = runIntent(d, {
      tool: 'how_much_ingredient',
      args: { ingredient: 'mince' },
    });

    expect(result?.kind).toBe('how_much');
    if (result?.kind !== 'how_much') return;

    // Not a clarification, and not a refusal — a quantity.
    expect(result.value.state).toBe('needed');
    if (result.value.state !== 'needed') return;

    // The window it used, reported so the answer can say which dates it covered.
    expect(result.value.from).toBe('2026-08-18');
    expect(result.value.to).toBe('2026-08-25');
  });

  it('the default window is the SCREEN\'s, not one invented here', () => {
    // Same question, a different window from the screen: the answer follows the
    // window it was given rather than a range this layer decided for itself. The
    // job on the 20th is outside this one, so the honest answer is "none needed".
    const result = runIntent(
      data({ jobs: [job()], today: '2026-09-01', horizon: '2026-09-08' }),
      { tool: 'how_much_ingredient', args: { ingredient: 'mince' } },
    );

    expect(result?.kind).toBe('how_much');
    if (result?.kind !== 'how_much') return;
    expect(result.value.state).toBe('none_needed');
    if (result.value.state !== 'none_needed') return;
    expect(result.value.from).toBe('2026-09-01');
  });

  it('dates the owner DID name override the default', () => {
    const result = runIntent(data({ jobs: [job()], today: '2026-09-01', horizon: '2026-09-08' }), {
      tool: 'how_much_ingredient',
      args: { ingredient: 'mince', from: '2026-08-01' as IsoDate, to: '2026-08-31' as IsoDate },
    });

    expect(result?.kind).toBe('how_much');
    if (result?.kind !== 'how_much') return;
    expect(result.value.state).toBe('needed');
  });

  /**
   * "How much soy sauce do I need" — WHEN SOY SAUCE IS RIGHT THERE.
   *
   * Reported after the routing fix landed: the question reached the right tool,
   * did not ask for dates, and then answered "you have no ingredient called soy
   * sauce" about an ingredient visible on the Ingredients screen.
   *
   * Case was never the cause — the old matcher lowercased both sides. It compared
   * CHARACTERS, so any difference in shape (a comma, a doubled space, a hyphen,
   * word order, or a stored name shorter than what he said) read as absent.
   *
   * These pin the shapes. `no_such_ingredient` is now a claim about the whole
   * kitchen, so it must only be made when it is true.
   */
  const withIngredients = (...names: string[]): SousData =>
    data({
      jobs: [],
      recipes: [],
      stock: [],
      ingredients: names.map((name, n) => ({ ...mince, id: `i${n}` as IngredientId, name })),
    });

  const lookup = (names: string[], asked: string) => {
    const result = runIntent(withIngredients(...names), {
      tool: 'how_much_ingredient',
      args: { ingredient: asked },
    });

    expect(result?.kind).toBe('how_much');
    return result?.kind === 'how_much' ? result.value : null;
  };

  it.each([
    ['Soy Sauce', 'the reported case — stored capitalised'],
    ['soy sauce', 'already lowercase'],
    ['SOY SAUCE', 'shouted'],
    ['  Soy Sauce  ', 'padded with spaces'],
    ['Soy  Sauce', 'a doubled interior space'],
    ['Soy-sauce', 'hyphenated'],
    ['Sauce, Soy', 'supplier-style, words reordered'],
    ['Dark Soy Sauce', 'stored name more specific than the question'],
  ])('resolves "soy sauce" to stored %j — %s', (stored) => {
    const value = lookup([stored], 'soy sauce');

    expect(value?.state, `"${stored}" was reported as not existing`).not.toBe(
      'no_such_ingredient',
    );
    if (value?.state !== 'none_needed') return;
    expect(value.name).toBe(stored);
  });

  it('resolves a question MORE specific than the stored name', () => {
    // "Soy" is what is stored; he asked for "soy sauce". The old matcher only
    // looked one way — stored-contains-asked — so this was absent.
    const value = lookup(['Soy'], 'soy sauce');

    expect(value?.state).toBe('none_needed');
  });

  it('no_such_ingredient fires ONLY for a name genuinely absent', () => {
    const value = lookup(['Soy Sauce', 'Chicken breast'], 'saffron');

    expect(value?.state).toBe('no_such_ingredient');
    if (value?.state !== 'no_such_ingredient') return;
    expect(value.asked).toBe('saffron');
    // Nothing stored shares a word with it, so there is nothing to suggest.
    expect(value.near).toEqual([]);
  });

  it('names what IS stored rather than denying it outright', () => {
    // "Light soy" is not confidently "soy sauce", so it is not matched — but
    // saying "you have no ingredient called soy sauce" would still be false.
    const value = lookup(['Light soy', 'Chicken breast'], 'soy sauce');

    expect(value?.state).toBe('no_such_ingredient');
    if (value?.state !== 'no_such_ingredient') return;
    expect(value.near).toEqual(['Light soy']);
  });

  it('matches on WORD boundaries, so "oil" is not found inside "boiled rice"', () => {
    const value = lookup(['Boiled rice'], 'oil');

    expect(value?.state).toBe('no_such_ingredient');
  });

  it('NAMES several rather than picking, when the question fits more than one', () => {
    // Being looser makes this path more likely, which is the safe direction:
    // several candidates is an answer, picking one is a guess (Rule 8).
    const value = lookup(['Dark soy sauce', 'Light soy sauce'], 'soy sauce');

    expect(value?.state).toBe('ambiguous');
    if (value?.state !== 'ambiguous') return;
    expect(value.matches).toEqual(['Dark soy sauce', 'Light soy sauce']);
  });

  it('an EXACT hit is not diluted into an ambiguity by looser neighbours', () => {
    // "Soy Sauce" is exactly what he asked for. "Dark soy sauce" also contains
    // those words, but the exact tier wins outright and never reaches it.
    const value = lookup(['Soy Sauce', 'Dark soy sauce'], 'soy sauce');

    expect(value?.state).toBe('none_needed');
    if (value?.state !== 'none_needed') return;
    expect(value.name).toBe('Soy Sauce');
  });

  it('accepts an ingredient ID, since the context hands the model ids too', () => {
    const result = runIntent(withIngredients('Soy Sauce'), {
      tool: 'how_much_ingredient',
      args: { ingredient: 'i0' },
    });

    expect(result?.kind).toBe('how_much');
    if (result?.kind !== 'how_much') return;
    expect(result.value.state).toBe('none_needed');
  });

  it('reads the ingredients it was GIVEN, which are the screen\'s own rows', () => {
    // Rule: no repository filters by kitchen — RLS is the single definition of
    // scope, and Ask Sous and the Ingredients screen make the same list() call.
    // This layer therefore searches exactly what it was handed, and an empty set
    // is reported as absent rather than as an error.
    const value = lookup([], 'soy sauce');

    expect(value?.state).toBe('no_such_ingredient');
  });

  it('packing derives portions through applyBuffetSplit', () => {
    const result = runIntent(data({ jobs: [job({ dishes: [] })] }), {
      tool: 'packing_for_job',
      args: { jobId: 'j1' as JobId },
    });

    expect(result?.kind).toBe('packing');
    if (result?.kind !== 'packing') return;
    expect(result.value.job).not.toBeNull();
  });
});

describe('the propose tool', () => {
  /**
   * Portions left NULL, so the guest count drives the food.
   *
   * With explicit portions the owner's numbers win and a guest change moves
   * revenue alone — correct, and pinned separately below. The first version of
   * this test used the explicit fixture and asserted the food moved; the engine
   * was right and the fixture was wrong.
   */
  const scalingJob = () =>
    data({
      jobs: [
        job({
          dishes: [
            {
              id: 'd1' as JobDishId,
              jobId: 'j1' as JobId,
              recipeId: 'lasagne' as RecipeId,
              portions: null,
              note: null,
              position: 0,
            },
          ],
        }),
      ],
    });

  const proposal = (d = scalingJob()) => {
    const result = runIntent(d, {
      tool: 'propose_job_change',
      args: { jobId: 'j1' as JobId, guests: 20 },
    });
    if (result?.kind !== 'proposal') throw new Error('expected a proposal');
    return result.value;
  };

  it('returns the engine’s before/after diff', () => {
    // Rule 7's proposal is not invented here — it is what changeImpact returns.
    // 10 guests to 20, one main at 1 kg a portion: 10 kg becomes 20 kg.
    const p = proposal();

    expect(p.impact.ingredients.length).toBeGreaterThan(0);
    const line = p.impact.ingredients[0];
    expect(line?.required.before).toBe(10);
    expect(line?.required.after).toBe(20);
  });

  it('moves no food when the owner set the portions by hand', () => {
    // His numbers win over the guest count. Worth pinning, because a preview that
    // silently overrode a typed portion count would be far worse than one that
    // appears to do nothing.
    const p = proposal(data());

    for (const line of p.impact.ingredients) {
      expect(line.required.delta).toBe(0);
    }
  });

  it('echoes only what the owner asked to change', () => {
    const p = proposal();

    expect(p.changes).toEqual({ guests: 20 });
    expect(Object.keys(p.changes)).not.toContain('serviceDate');
  });

  it('carries the job as it WOULD be saved, built from the job plus the change', () => {
    const p = proposal();

    expect(p.after.guests).toBe(20);
    expect(p.after.id).toBe('j1');
    expect(p.after.serviceType).toBe('Buffet');
  });

  it('returns null for a job that does not exist', () => {
    const result = runIntent(data(), {
      tool: 'propose_job_change',
      args: { jobId: 'ghost' as JobId, guests: 20 },
    });

    expect(result).toBeNull();
  });

  it('is declared as a propose tool, not a read', () => {
    expect(TOOLS.propose_job_change.kind).toBe('propose');
  });
});

describe('RULE 7 — committing', () => {
  const proposal = () => {
    const result = runIntent(data(), {
      tool: 'propose_job_change',
      args: { jobId: 'j1' as JobId, guests: 20 },
    });
    if (result?.kind !== 'proposal') throw new Error('expected a proposal');
    return result.value;
  };

  it('writes a confirmed proposal through the audited repository path', async () => {
    // The same `save_job` the Jobs screen uses, so the triggers fire identically.
    // An AI-originated change is an ordinary write that needed a confirmation.
    const db = fakeDb({}, 'j1');
    const result = await commitProposal(db, proposal());

    expect(result.ok).toBe(true);
    expect(db.calls.filter((call) => call.op === 'rpc')).toHaveLength(1);
    expect(db.calls[0]?.table).toBe('save_job');
  });

  it('REFUSES an object that never came from the propose path', async () => {
    // Not about a hostile caller — one user, one bundle. It is about the honest
    // mistake: a hand-built object skips the diff the owner was shown, and Rule 7
    // is specifically that he saw the before/after.
    const db = fakeDb({}, 'j1');
    const forged = { jobId: 'j1', changes: { guests: 99 } } as never;

    const result = await commitProposal(db, forged);

    expect(result.ok).toBe(false);
    expect(db.calls).toHaveLength(0);
  });

  it('refuses a proposal that changes nothing', async () => {
    const db = fakeDb({}, 'j1');
    const empty = { ...proposal(), changes: {} };

    const result = await commitProposal(db, empty);

    expect(result.ok).toBe(false);
    expect(db.calls).toHaveLength(0);
  });

  it('reports a failed write rather than claiming success', async () => {
    const db = fakeDb({}, 'j1');
    const boom = {
      ...db,
      rpc: async () => {
        throw new Error('database refused');
      },
    };

    const result = await commitProposal(boom, proposal());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('database refused');
  });
});

/**
 * A BLOCKED QUANTITY IS NOT A ZERO ONE.
 *
 * The reported defect: Ask Sous answered "no beef mince needed" for a CONFIRMED
 * job, 20 guests, Beef Lasagne on the menu, beef mince priced and listed on the
 * recipe at 4 kg.
 *
 * Nothing in the data was wrong in the way the answer implied. The dish carried
 * no explicit portions — the normal state, meaning "derive from the guest count"
 * — and the recipe had no `course`, so `applyBuffetSplit` could not derive them
 * and left them null. `productionBuckets` then dropped the dish with a
 * `no_portions` gap, so no bucket existed, so `requirementsForRange` produced no
 * line for the mince.
 *
 * The ENGINE was right at every step: it reported the gap. `howMuch` looked only
 * at `lines`, found nothing, and said `none_needed` — whose own sentence claims
 * "nothing on the confirmed jobs in those dates uses it". That is a false
 * statement about the kitchen, and the exact class of defect Rules 8 and 12 exist
 * to prevent: an unresolved input presented as a settled figure.
 */
describe('how_much_ingredient — blocked is not zero', () => {
  const uncoursedLasagne: Recipe = { ...lasagne, course: null };

  /** The mince line off `lasagne`, typed, so a variant can restate one field. */
  const minceLine = lasagne.components[0] as RecipeIngredientLine;

  const askAbout = (d: SousData, ingredient = 'mince') => {
    const result = runIntent(d, {
      tool: 'how_much_ingredient',
      args: { ingredient, from: '2026-08-01' as IsoDate, to: '2026-08-31' as IsoDate },
    });

    expect(result?.kind).toBe('how_much');
    return result?.kind === 'how_much' ? result.value : null;
  };

  /** The reported case, reduced: portions unallocated, recipe uncoursed. */
  const unallocated = (over: Partial<Job> = {}): SousData =>
    data({
      recipes: [uncoursedLasagne],
      jobs: [
        job({
          status: 'confirmed',
          guests: 20,
          dishes: [
            {
              id: 'd1' as JobDishId,
              jobId: 'j1' as JobId,
              recipeId: 'lasagne' as RecipeId,
              portions: null,
              note: null,
              position: 0,
            },
          ],
          ...over,
        }),
      ],
    });

  it('REGRESSION: does not say "none needed" when the recipe uses it', () => {
    const value = askAbout(unallocated());

    expect(value?.state, 'a blocked quantity was reported as zero').not.toBe('none_needed');
    expect(value?.state).toBe('blocked');
  });

  it('names the recipe that uses it, so the answer is actionable', () => {
    const value = askAbout(unallocated());

    if (value?.state !== 'blocked') return;
    expect(value.name).toBe('mince');
    expect(value.usedBy).toEqual(['Lasagne']);
  });

  it('carries only the gaps that actually blocked THIS ingredient', () => {
    // A gap about an unrelated recipe is not a reason his mince is blocked.
    // Without gap identity the honest fallback is to dump every gap in the
    // window, and "Salt & pepper has no quantity" would be offered as the reason.
    const unrelated: Recipe = {
      ...lasagne,
      id: 'trifle' as RecipeId,
      name: 'Trifle',
      course: null,
      components: [],
      unquantified: [{ id: 'u1' as never, item: 'Salt & pepper', reason: null }],
    };

    const d = data({
      recipes: [uncoursedLasagne, unrelated],
      jobs: [
        job({
          status: 'confirmed',
          guests: 20,
          dishes: [
            {
              id: 'd1' as JobDishId,
              jobId: 'j1' as JobId,
              recipeId: 'lasagne' as RecipeId,
              portions: null,
              note: null,
              position: 0,
            },
            {
              id: 'd2' as JobDishId,
              jobId: 'j1' as JobId,
              recipeId: 'trifle' as RecipeId,
              portions: null,
              note: null,
              position: 1,
            },
          ],
        }),
      ],
    });

    const value = askAbout(d);

    if (value?.state !== 'blocked') return;
    expect(value.blockers.map((g) => g.reason)).toEqual(['no_portions']);
    expect(value.blockers[0]?.detail).toContain('Lasagne');
    expect(value.blockers.some((g) => g.detail.includes('Trifle'))).toBe(false);
  });

  it('blocks when the component itself has no quantity', () => {
    // The other route to no line. The recipe plainly lists mince; the card just
    // never said how much. "None needed" would be as wrong here as above.
    const vague: Recipe = {
      ...lasagne,
      components: [{ ...minceLine, qty: null, unit: null }],
    };

    const value = askAbout(data({ recipes: [vague] }));

    expect(value?.state).toBe('blocked');
    if (value?.state !== 'blocked') return;
    expect(value.blockers.map((g) => g.reason)).toContain('unquantified');
  });

  it('blocks when the ingredient cannot be converted into its stock unit', () => {
    // Rule 4's failure mode: the line exists on the recipe and cannot cross into
    // stock units, so requirementsForRange drops it with a gap.
    const noFactor: Ingredient = {
      ...mince,
      recipeUnit: 'each' as RecipeUnit,
      recipeUnitsPerStockUnit: null,
    };
    const perEach: Recipe = {
      ...lasagne,
      components: [{ ...minceLine, unit: 'each' as RecipeUnit }],
    };

    const value = askAbout(data({ recipes: [perEach], ingredients: [noFactor] }));

    expect(value?.state).toBe('blocked');
    if (value?.state !== 'blocked') return;
    expect(value.blockers.map((g) => g.reason)).toContain('unresolved_conversion');
  });

  it('STILL says none_needed when nothing in the window genuinely uses it', () => {
    // The other half of the fix. `none_needed` is a real answer and must survive
    // — replacing it with a blanket "cannot say" would be its own defect.
    const saffron: Ingredient = { ...mince, id: 'saffron' as IngredientId, name: 'saffron' };
    const value = askAbout(data({ ingredients: [mince, saffron] }), 'saffron');

    expect(value?.state).toBe('none_needed');
  });

  it('says none_needed when the window holds no jobs at all', () => {
    const result = runIntent(data({ jobs: [] }), {
      tool: 'how_much_ingredient',
      args: { ingredient: 'mince', from: '2026-08-01' as IsoDate, to: '2026-08-31' as IsoDate },
    });

    expect(result?.kind).toBe('how_much');
    if (result?.kind !== 'how_much') return;
    expect(result.value.state).toBe('none_needed');
  });

  it('finds an ingredient only a SUB-recipe uses', () => {
    // The usage walk goes through sub-recipes, so a parent that never names the
    // mince still counts as using it.
    const ragu: Recipe = { ...lasagne, id: 'ragu' as RecipeId, name: 'Ragu', course: null };
    const bake: Recipe = {
      ...lasagne,
      id: 'bake' as RecipeId,
      name: 'Pasta Bake',
      course: null,
      components: [
        {
          id: 'b1' as RecipeLineId,
          kind: 'sub_recipe',
          subRecipeId: 'ragu' as RecipeId,
          displayName: 'Ragu',
          qty: 1,
          unit: null,
          position: 0,
        },
      ],
    };

    const d = data({
      recipes: [ragu, bake],
      jobs: [
        job({
          status: 'confirmed',
          guests: 20,
          dishes: [
            {
              id: 'd1' as JobDishId,
              jobId: 'j1' as JobId,
              recipeId: 'bake' as RecipeId,
              portions: null,
              note: null,
              position: 0,
            },
          ],
        }),
      ],
    });

    const value = askAbout(d);

    expect(value?.state).toBe('blocked');
    if (value?.state !== 'blocked') return;
    expect(value.usedBy).toEqual(['Pasta Bake']);
  });

  it('ignores a cancelled job when deciding that nothing uses it', () => {
    // productionBuckets drops cancelled jobs, so no line exists for one — and the
    // usage walk must agree, or a cancelled job would block every answer forever.
    const value = askAbout(unallocated({ status: 'cancelled' }));

    expect(value?.state).toBe('none_needed');
  });
});
