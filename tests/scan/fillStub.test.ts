/**
 * FILLING A STUB MUST FILL IT, NOT CLONE IT.
 *
 * A stub is a recipe that is a name and nothing else — most often one
 * `stubRecipe` created when a scanned job sheet named a dish the kitchen had no
 * recipe for. It already EXISTS, with an id, a name the owner recognises, and
 * jobs pointing at it.
 *
 * The existing web-import handoff (`draftFromWebReview`) was written for the
 * other case: a recipe found from a menu photo, with no local record behind it.
 * It therefore builds a draft with `id: ''`, and `recipeRepository.save` maps an
 * empty id to `null`, which `save_recipe` inserts. Reusing it unchanged to
 * "fill" a stub would leave the stub exactly as it was and add a SECOND recipe
 * beside it — a duplicate with the website's title, while every job still
 * pointed at the empty original.
 *
 * That is the one failure in this feature that corrupts data rather than
 * annoying someone, so it gets a real tooth: the identity comes from the STUB
 * and only the cooking comes from the page.
 *
 *   from the stub   id, kitchen, name, and his own service decisions
 *   from the page   components, unquantified items, yield, portions, source
 *
 * The owner can still change the name in the editor. What he cannot do is have
 * it changed for him by a website that happened to call the dish something else.
 */

import { describe, expect, it } from 'vitest';
import { draftFromWebReview, fillStub } from '../../src/scan/webRecipe';
import type { WebRecipeReview } from '../../src/scan/webRecipe';
import type {
  Ingredient,
  IngredientId,
  KitchenId,
  Recipe,
  RecipeId,
  RecipeLineId,
  RecipeUnit,
} from '../../src/engine/types';

const KITCHEN = 'k1' as KitchenId;

/** What `stubRecipe` produces: a name and nothing else. */
const stub = (over: Partial<Recipe> = {}): Recipe => ({
  id: 'r-stub' as RecipeId,
  kitchenId: KITCHEN,
  name: 'Nolan’s lasagne',
  course: null,
  yieldType: 'per_person',
  portionsPerBatch: null,
  batchUnit: null,
  confidence: 'missing',
  makeAheadDays: 0,
  sameDayOnly: true,
  freezable: false,
  onsiteFinish: false,
  method: null,
  note: null,
  components: [],
  unquantified: [],
  ...over,
});

const ingredient = (id: string, name: string): Ingredient => ({
  id: id as IngredientId,
  kitchenId: KITCHEN,
  name,
  category: null,
  stockUnit: 'kg' as Ingredient['stockUnit'],
  recipeUnit: 'g' as Ingredient['recipeUnit'],
  recipeUnitsPerStockUnit: 1000,
  pack: null,
  supplierId: null,
  pricePerPack: null,
  previousPrice: null,
  priceChecked: null,
  allergens: [],
});

const review = (over: Partial<WebRecipeReview> = {}): WebRecipeReview => ({
  title: 'The Best Beef Lasagne Ever',
  sourceUrl: 'https://example.com/lasagne',
  course: 'main',
  yieldType: 'batch',
  portionsPerBatch: 8,
  batchUnit: 'tray',
  components: [
    {
      read: 'beef mince',
      qty: 500,
      // Branded: `RecipeUnit` is a nominal type, so a bare string is refused
      // here exactly as it would be anywhere else in the engine.
      unit: 'g' as RecipeUnit,
      ingredient: { kind: 'matched', record: ingredient('i1', 'Beef mince'), read: 'beef mince' },
    },
  ],
  unquantified: [
    {
      name: 'seasoning',
      ingredient: { kind: 'matched', record: ingredient('i2', 'Seasoning'), read: 'seasoning' },
      reason: 'no quantity on the page',
    },
  ],
  gaps: [],
  newThings: [],
  warnings: [],
  readyToSave: true,
  ...over,
});

// ---------------------------------------------------------------------------

describe('the stub keeps its identity', () => {
  it('KEEPS ITS ID, so the save updates rather than inserts', () => {
    /*
     * THE WHOLE POINT. `recipeRepository.save` maps `id === ''` to null and
     * `save_recipe` inserts on null. An empty id here is a duplicate recipe and
     * an orphaned stub.
     */
    expect(fillStub(stub(), review()).id).toBe('r-stub');
    expect(fillStub(stub(), review()).id).not.toBe('');
  });

  it('keeps HIS name, not the website’s', () => {
    // He called it "Nolan's lasagne" because that is what the job sheet said.
    // A page titled "The Best Beef Lasagne Ever" does not get to rename it.
    expect(fillStub(stub(), review()).name).toBe('Nolan’s lasagne');
  });

  it('keeps the kitchen it belongs to', () => {
    expect(fillStub(stub(), review()).kitchenId).toBe(KITCHEN);
  });

  it('keeps his own service decisions, which a recipe page knows nothing about', () => {
    /*
     * Make-ahead, same-day-only, freezable and on-site finish are decisions
     * about HIS kitchen and his van — not facts about a dish. A website has no
     * opinion worth importing here, and overwriting them would silently change
     * which prep day the engine puts the work on.
     */
    const his = stub({ makeAheadDays: 3, sameDayOnly: false, freezable: true, onsiteFinish: true });
    const filled = fillStub(his, review());

    expect(filled.makeAheadDays).toBe(3);
    expect(filled.sameDayOnly).toBe(false);
    expect(filled.freezable).toBe(true);
    expect(filled.onsiteFinish).toBe(true);
  });

  it('keeps a course he already set, and takes the page’s only when he had none', () => {
    expect(fillStub(stub({ course: 'dessert' }), review()).course).toBe('dessert');
    expect(fillStub(stub({ course: null }), review()).course).toBe('main');
  });

  it('never takes a course the page did not state', () => {
    // Rule 8 at the boundary: the function is told not to infer a course from a
    // dish name, and this must not quietly supply one either.
    expect(fillStub(stub({ course: null }), review({ course: null })).course).toBeNull();
  });
});

describe('the cooking comes from the page', () => {
  it('brings in the components it matched', () => {
    const filled = fillStub(stub(), review());

    expect(filled.components).toHaveLength(1);
    expect(filled.components[0]?.kind).toBe('ingredient');
    expect(filled.components[0]?.qty).toBe(500);
    expect(filled.components[0]?.unit).toBe('g');
  });

  it('brings in the SOURCE’s yield, unscaled', () => {
    // Nothing is scaled on the way in. The engine scales it later, once he has
    // said the figures are worth trusting.
    const filled = fillStub(stub(), review());

    expect(filled.yieldType).toBe('batch');
    expect(filled.portionsPerBatch).toBe(8);
    expect(filled.batchUnit).toBe('tray');
  });

  it('keeps an unclear quantity as an unquantified item, never a guess', () => {
    const filled = fillStub(stub(), review());
    const seasoning = filled.unquantified.find((u) => u.item === 'seasoning');

    expect(seasoning).toBeDefined();
    expect(seasoning?.reason).toBe('no quantity on the page');
    // And it has no quantity field at all to put a number in.
    expect(Object.keys(seasoning ?? {})).not.toContain('qty');
  });

  it('records where it came from', () => {
    expect(fillStub(stub(), review()).note).toContain('https://example.com/lasagne');
  });

  it('stays visibly untrusted until he saves real figures', () => {
    // Anything unquantified means the recipe cannot be costed or shopped
    // honestly yet, and `confidence` is the strongest thing that can say so.
    expect(fillStub(stub(), review()).confidence).toBe('missing');
  });

  it('is `confirm` rather than `missing` when everything came through quantified', () => {
    const clean = fillStub(stub(), review({ unquantified: [] }));

    expect(clean.confidence).toBe('confirm');
  });
});

describe('a note the owner already wrote is not thrown away', () => {
  it('keeps his note and adds the source beside it', () => {
    /*
     * A stub created from a job sheet can carry a note he typed — "Nolan asked
     * for extra béchamel". Replacing it with "Imported from …" would delete
     * something only he knew, to record something the URL already says.
     */
    const his = stub({ note: 'Nolan asked for extra béchamel.' });
    const filled = fillStub(his, review());

    expect(filled.note).toContain('Nolan asked for extra béchamel.');
    expect(filled.note).toContain('https://example.com/lasagne');
  });

  it('is just the source when he had no note', () => {
    expect(fillStub(stub({ note: null }), review()).note).toBe(
      'Imported from https://example.com/lasagne',
    );
  });
});

describe('filling is not merging — the page replaces an EMPTY recipe', () => {
  it('refuses a recipe that already has components', () => {
    /*
     * This action only exists on a stub. Offering it on a recipe he has already
     * written up would mean a website's ingredient list silently replacing his
     * own — and "fill" would be the wrong word for that.
     *
     * The UI only shows the action on an empty recipe; this makes the rule a
     * property of the function rather than of the screen that happens to call
     * it today.
     */
    const written = stub({
      components: [
        {
          id: 'l1' as RecipeLineId,
          kind: 'ingredient',
          ingredientId: 'i9' as IngredientId,
          displayName: 'his own line',
          qty: 1,
          unit: 'kg' as RecipeUnit,
          position: 0,
        },
      ],
    });

    expect(() => fillStub(written, review())).toThrow(/not a stub/i);
  });
});

/**
 * AND THE TOOTH: the write that actually reaches the database.
 *
 * Everything above is about the VALUE `fillStub` returns. This is about what
 * `recipeRepository.save` then sends — because the insert-or-update decision is
 * not made in either place the eye lands on. It is made by one line in the
 * repository:
 *
 *     id: recipe.id === '' ? null : recipe.id
 *
 * and then by `save_recipe`, which inserts when that id is null. A regression
 * that reset the id to '' anywhere between the review and the RPC would pass
 * every assertion above and still duplicate his recipe.
 */

import { recipeRepository } from '../../src/data/repositories';
import type { Db, Row } from '../../src/data/db';

/** A `Db` that records the RPC payload and nothing else. */
const recordingDb = (): Db & { readonly calls: { fn: string; args: Record<string, unknown> }[] } => {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    async selectAll() { return []; },
    async selectWhere() { return []; },
    async selectWhereIn() { return []; },
    async insert(_t, rows) { return rows as Row[]; },
    async upsert(_t, rows) { return rows as Row[]; },
    async update(_t, id, patch) { return [{ id, ...patch }]; },
    async deleteWhere() {},
    async rpc(fn, args) {
      calls.push({ fn, args });
      return 'r-stub';
    },
  };
};

describe('filling a stub UPDATES it and never inserts a second recipe', () => {
  it('sends the stub’s own id to save_recipe', async () => {
    const db = recordingDb();

    await recipeRepository(db).save(fillStub(stub(), review()));

    const call = db.calls.find((c) => c.fn === 'save_recipe');
    expect(call, 'save_recipe was never reached').toBeDefined();

    const header = call?.args['p_recipe'] as Record<string, unknown> | undefined;
    expect(header?.['id'], 'the id reaching the RPC is not the stub’s').toBe('r-stub');
    // null is what makes it an INSERT. This is the assertion that matters.
    expect(header?.['id'], 'a null id here inserts a duplicate recipe').not.toBeNull();
  });

  it('a draft built the OTHER way does insert — the distinction is real', async () => {
    /*
     * The contrast is the proof. `draftFromWebReview` is correct for its own
     * case (a dish found from a menu, with nothing local behind it) and sends a
     * null id, which inserts. If both paths sent the same thing, the assertion
     * above would be measuring nothing.
     */
    const db = recordingDb();

    await recipeRepository(db).save(draftFromWebReview(review()));

    const header = db.calls.find((c) => c.fn === 'save_recipe')?.args['p_recipe'] as
      | Record<string, unknown>
      | undefined;

    expect(header?.['id']).toBeNull();
  });
});
