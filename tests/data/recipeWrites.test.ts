/**
 * Saving a recipe.
 *
 * A recipe spans three tables and supabase-js has no transactions, so the save
 * goes through the `save_recipe` RPC — one call, one transaction. These tests
 * pin the payload shape against the fake `Db`.
 *
 * What they cannot prove is that the function is atomic, or that RLS accepts the
 * call. Only `tests/integration/` can, and it does.
 */

import { describe, expect, it } from 'vitest';
import { recipeRepository } from '../../src/data/repositories';
import { fakeDb } from './fakeDb';
import type {
  IngredientId,
  KitchenId,
  Recipe,
  RecipeId,
  RecipeLineId,
  RecipeUnit,
} from '../../src/engine/types';

const KITCHEN = 'k1' as KitchenId;

const recipe = (over: Partial<Recipe> = {}): Recipe => ({
  id: '' as RecipeId,
  kitchenId: KITCHEN,
  name: 'Lasagne',
  course: 'main',
  yieldType: 'batch',
  portionsPerBatch: 9,
  batchUnit: 'tray',
  confidence: 'locked',
  makeAheadDays: 1,
  sameDayOnly: false,
  freezable: true,
  onsiteFinish: false,
  method: null,
  note: null,
  components: [],
  unquantified: [],
  ...over,
});

const line = (over: Record<string, unknown> = {}) => ({
  id: '' as RecipeLineId,
  displayName: 'mince',
  position: 0,
  qty: 2,
  unit: 'kg' as RecipeUnit,
  kind: 'ingredient' as const,
  ingredientId: 'mince' as IngredientId,
  ...over,
});

const payloadOf = (db: ReturnType<typeof fakeDb>) => {
  const call = db.calls.find((c) => c.op === 'rpc');
  expect(call, 'no rpc call was issued').toBeDefined();
  expect(call?.table, 'wrong function called').toBe('save_recipe');
  return call?.payload as {
    p_recipe: Record<string, unknown>;
    p_components: Record<string, unknown>[];
    p_unquantified: Record<string, unknown>[];
  };
};

describe('save', () => {
  it('sends header, components and unquantified in ONE call', async () => {
    // The whole point. Three separate writes could leave a recipe with no
    // components, which scaleRecipe would turn into silence rather than a gap.
    const db = fakeDb({}, 'new-id');
    await recipeRepository(db).save(
      recipe({
        components: [line()],
        unquantified: [{ id: '' as RecipeLineId, item: 'seasoning', reason: null }],
      }),
    );

    expect(db.calls.filter((c) => c.op === 'rpc')).toHaveLength(1);
    // And no direct table writes alongside it.
    expect(db.calls.some((c) => c.op === 'insert' || c.op === 'delete')).toBe(false);
  });

  it('sends null id for a new recipe, so the database mints one', async () => {
    const db = fakeDb({}, 'new-id');
    await recipeRepository(db).save(recipe());

    expect(payloadOf(db).p_recipe['id']).toBeNull();
  });

  it('sends the existing id when editing', async () => {
    const db = fakeDb({}, 'lasagne');
    await recipeRepository(db).save(recipe({ id: 'lasagne' as RecipeId }));

    expect(payloadOf(db).p_recipe['id']).toBe('lasagne');
  });

  it('does NOT send kitchen_id — the function resolves it from my_kitchen_id()', async () => {
    // Trusting a kitchen from the payload would let a client write into another
    // kitchen. The function takes it from the session instead.
    const db = fakeDb({}, 'x');
    await recipeRepository(db).save(recipe());

    expect(payloadOf(db).p_recipe).not.toHaveProperty('kitchen_id');
  });

  it('keeps the XOR: an ingredient line carries no sub_recipe_id', async () => {
    const db = fakeDb({}, 'x');
    await recipeRepository(db).save(recipe({ components: [line()] }));

    const [component] = payloadOf(db).p_components;
    expect(component?.['ingredient_id']).toBe('mince');
    expect(component?.['sub_recipe_id']).toBeNull();
  });

  it('keeps the XOR: a sub-recipe line carries no ingredient_id', async () => {
    const db = fakeDb({}, 'x');
    await recipeRepository(db).save(
      recipe({
        components: [
          line({ kind: 'sub_recipe', subRecipeId: 'sauce' as RecipeId, ingredientId: undefined }),
        ],
      }),
    );

    const [component] = payloadOf(db).p_components;
    expect(component?.['sub_recipe_id']).toBe('sauce');
    expect(component?.['ingredient_id']).toBeNull();
  });

  it('RULE 13: sends one qty, with no min/max anywhere', async () => {
    const db = fakeDb({}, 'x');
    await recipeRepository(db).save(recipe({ components: [line({ qty: 2 })] }));

    const [component] = payloadOf(db).p_components;
    expect(component?.['qty']).toBe(2);
    expect(component).not.toHaveProperty('qty_min');
    expect(component).not.toHaveProperty('qty_max');
  });

  it('RULE 8: an unquantified item carries no quantity at all', async () => {
    // Not a null quantity — no quantity key. There is nothing for a zero to
    // occupy.
    const db = fakeDb({}, 'x');
    await recipeRepository(db).save(
      recipe({
        unquantified: [{ id: '' as RecipeLineId, item: 'eight tapas dishes', reason: 'never measured' }],
      }),
    );

    const [item] = payloadOf(db).p_unquantified;
    expect(item?.['item']).toBe('eight tapas dishes');
    expect(item).not.toHaveProperty('qty');
    expect(item).not.toHaveProperty('quantity');
  });

  it('keeps an unquantified COMPONENT as a null qty, distinct from zero', async () => {
    const db = fakeDb({}, 'x');
    await recipeRepository(db).save(recipe({ components: [line({ qty: null })] }));

    const [component] = payloadOf(db).p_components;
    expect(component?.['qty']).toBeNull();
    expect(component?.['qty']).not.toBe(0);
  });

  it('numbers positions from the order on screen', async () => {
    const db = fakeDb({}, 'x');
    await recipeRepository(db).save(
      recipe({
        components: [
          line({ displayName: 'first' }),
          line({ displayName: 'second', ingredientId: 'cheese' as IngredientId }),
        ],
      }),
    );

    expect(payloadOf(db).p_components.map((c) => c['position'])).toEqual([0, 1]);
  });

  it('returns the id the function reports', async () => {
    const db = fakeDb({}, 'minted-id');
    expect(await recipeRepository(db).save(recipe())).toBe('minted-id');
  });
});

describe('remove', () => {
  it('deletes the recipe by id and lets the children cascade', async () => {
    const db = fakeDb();
    await recipeRepository(db).remove('lasagne' as RecipeId);

    const call = db.calls.find((c) => c.op === 'delete');
    expect(call?.table).toBe('recipes');
    expect(call?.column).toBe('id');
    expect(call?.value).toBe('lasagne');
  });
});
