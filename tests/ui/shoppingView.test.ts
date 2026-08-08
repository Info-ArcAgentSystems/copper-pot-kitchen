/**
 * Turning engine output into the shopping screen's sections.
 *
 * PURE, so it runs in Node with no DOM. `requirementsForRange` and
 * `outstandingShopping` computed every number here; this decides where each one
 * appears and how it reads. It must not do arithmetic — a second place that
 * subtracts stock from required is a second answer waiting to disagree.
 *
 * The behaviours worth guarding:
 *   - nothing the engine could not quantify is silently dropped (Rule 8)
 *   - no line ever reads "buy 0"
 *   - an unreconciled stock signal reaches the owner rather than being averaged away
 *   - an assumed pack size is visible on the screen where he acts on it
 */

import { describe, expect, it } from 'vitest';
import { buildShoppingView } from '../../src/ui/shoppingView';
import type { OutstandingLine, RequirementGap } from '../../src/engine/shopping';
import type {
  Ingredient,
  IngredientId,
  KitchenId,
  PurchaseUnit,
  StockUnit,
  Supplier,
  SupplierId,
} from '../../src/engine/types';

const KITCHEN = 'k1' as KitchenId;
const kg = 'kg' as StockUnit;

const ingredient = (over: Partial<Ingredient> = {}): Ingredient => ({
  id: 'mince' as IngredientId,
  kitchenId: KITCHEN,
  name: 'mince',
  category: null,
  stockUnit: kg,
  recipeUnit: null,
  recipeUnitsPerStockUnit: null,
  pack: { size: 1, unit: 'kg' as PurchaseUnit, assumed: false },
  supplierId: 'musgrave' as SupplierId,
  pricePerPack: null,
  previousPrice: null,
  priceChecked: null,
  allergens: [],
  ...over,
});

const supplier = (id: string, name: string): Supplier => ({
  id: id as SupplierId,
  kitchenId: KITCHEN,
  name,
  notes: null,
});

const line = (over: Partial<OutstandingLine> = {}): OutstandingLine => ({
  ingredientId: 'mince' as IngredientId,
  name: 'mince',
  required: { value: 2.4, unit: kg },
  onHand: { value: 0.5, unit: kg },
  purchased: { value: 0, unit: kg },
  outstanding: { value: 1.9, unit: kg },
  surplus: null,
  packs: { packs: 2, overage: { value: 0.1, unit: kg } },
  unreconciled: 0,
  ...over,
});

const view = (
  lines: OutstandingLine[] = [line()],
  gaps: RequirementGap[] = [],
  ingredients: Ingredient[] = [ingredient()],
  suppliers: Supplier[] = [supplier('musgrave', 'Musgrave')],
) => buildShoppingView(lines, gaps, ingredients, suppliers);

describe('grouping by supplier', () => {
  it('puts a line under its supplier by name', () => {
    const { groups } = view();

    expect(groups).toHaveLength(1);
    expect(groups[0]?.supplierName).toBe('Musgrave');
    expect(groups[0]?.lines[0]?.name).toBe('mince');
  });

  it('KEEPS a line whose ingredient has no supplier, in its own group', () => {
    // Dropping it would be a silent omission — he still has to buy the thing.
    const { groups } = view(
      [line()],
      [],
      [ingredient({ supplierId: null })],
      [supplier('musgrave', 'Musgrave')],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.supplierName).toBe('No supplier set');
    expect(groups[0]?.lines).toHaveLength(1);
  });

  it('puts the no-supplier group LAST, after the named ones', () => {
    // He shops supplier by supplier. The pile of unassigned things is the leftover
    // to sort out at the end, not the first thing he reads.
    const { groups } = view(
      [line(), line({ ingredientId: 'flour' as IngredientId, name: 'flour' })],
      [],
      [ingredient(), ingredient({ id: 'flour' as IngredientId, name: 'flour', supplierId: null })],
      [supplier('musgrave', 'Musgrave')],
    );

    expect(groups.map((g) => g.supplierName)).toEqual(['Musgrave', 'No supplier set']);
  });

  it('keeps a line whose supplier id matches no supplier record', () => {
    const { groups } = view([line()], [], [ingredient()], []);

    expect(groups[0]?.lines).toHaveLength(1);
    expect(groups[0]?.supplierName).toBe('No supplier set');
  });

  it('sorts suppliers by name so the order is stable between views', () => {
    const { groups } = view(
      [line(), line({ ingredientId: 'flour' as IngredientId, name: 'flour' })],
      [],
      [
        ingredient({ supplierId: 'zed' as SupplierId }),
        ingredient({ id: 'flour' as IngredientId, name: 'flour', supplierId: 'abc' as SupplierId }),
      ],
      [supplier('zed', 'Zed Wholesale'), supplier('abc', 'ABC Foods')],
    );

    expect(groups.map((g) => g.supplierName)).toEqual(['ABC Foods', 'Zed Wholesale']);
  });
});

describe('what a line says', () => {
  it('leads with the packs to buy, not the raw quantity', () => {
    // What goes in the trolley is 2 packs. The kilos are the reason, not the action.
    const [group] = view().groups;

    expect(group?.lines[0]?.buy).toBe('2 × 1 kg');
  });

  it('shows the workings so the number is checkable', () => {
    const [group] = view().groups;
    const workings = group?.lines[0]?.workings ?? '';

    expect(workings).toContain('need 2.4 kg');
    expect(workings).toContain('0.5 kg in stock');
    expect(workings).toContain('buy 1.9 kg');
  });

  it('OMITS a line that is fully covered by stock — never "buy 0"', () => {
    const { groups, nothingToBuy } = view([
      line({ onHand: { value: 3, unit: kg }, outstanding: { value: 0, unit: kg }, packs: null }),
    ]);

    expect(groups).toEqual([]);
    expect(nothingToBuy).toBe(true);
  });

  it('distinguishes "nothing to buy" from "nothing at all"', () => {
    // All in stock is a different sentence from no jobs. Conflating them makes a
    // working app look broken.
    expect(view([]).nothingToBuy).toBe(true);
    expect(view().nothingToBuy).toBe(false);
  });

  it('reports surplus separately rather than as a negative to buy', () => {
    const { groups, surplus } = view([
      line({
        onHand: { value: 4, unit: kg },
        outstanding: { value: 0, unit: kg },
        surplus: { value: 1.6, unit: kg },
        packs: null,
      }),
    ]);

    expect(groups).toEqual([]);
    expect(surplus[0]?.label).toContain('mince');
    expect(surplus[0]?.label).toContain('1.6 kg');
  });
});

describe('RULE 8 — a quantity with no pack size still stands', () => {
  it('keeps the line and states the quantity when packs cannot be computed', () => {
    // The amount is known; only how it is SOLD is not. Dropping the line would
    // lose a real requirement over a missing pack size.
    const { groups } = view([line({ packs: null })]);

    expect(groups[0]?.lines[0]?.buy).toBeNull();
    expect(groups[0]?.lines[0]?.outstanding).toBe('1.9 kg');
  });

  it('flags the missing pack size on the line itself', () => {
    const { groups } = view([line({ packs: null })]);
    expect(groups[0]?.lines[0]?.note).toContain('no pack size');
  });
});

describe('an assumed pack size is visible where he acts on it', () => {
  it('marks a line whose pack size is still assumed', () => {
    // Batch 2 surfaces `assumed` on the ingredient form. It matters more here: an
    // assumed pack size makes the PACK COUNT wrong, on the screen he shops from.
    const { groups } = view(
      [line()],
      [],
      [ingredient({ pack: { size: 1, unit: 'kg' as PurchaseUnit, assumed: true } })],
    );

    expect(groups[0]?.lines[0]?.note).toContain('assumed');
  });

  it('says nothing when the pack size is confirmed', () => {
    expect(view().groups[0]?.lines[0]?.note).toBeNull();
  });
});

describe('check these yourself — the engine cannot give a number', () => {
  it('routes an unquantified component here, not to the buy list', () => {
    const { checkYourself, groups } = view([], [
      { reason: 'unquantified', detail: 'Tapas: "seasoning" has no quantity' },
    ]);

    expect(checkYourself).toHaveLength(1);
    expect(checkYourself[0]?.label).toContain('seasoning');
    expect(groups).toEqual([]);
  });

  it('routes a named unquantified item here too', () => {
    const { checkYourself } = view([], [
      { reason: 'named_unquantified', detail: 'Tapas: "eight tapas dishes" has no quantity' },
    ]);

    expect(checkYourself).toHaveLength(1);
  });

  it('THE UNRECONCILED SIGNAL: an unconvertible stock row reaches him', () => {
    // `sumInto` refuses to add 500 of something to 5 kg. It counts what it left
    // out instead, so `outstanding` is an OVER-estimate — he might buy what he
    // already has. Silence here would be the Rule 4 conflation arriving by the
    // back door.
    const { checkYourself } = view([line({ unreconciled: 1 })]);

    expect(checkYourself).toHaveLength(1);
    expect(checkYourself[0]?.label).toContain('mince');
    expect(checkYourself[0]?.why).toContain('could not be converted');
  });

  it('says the outstanding figure may be too high, not too low', () => {
    // Direction matters: unreconciled stock was NOT subtracted, so the figure
    // over-states. Telling him it might be too low would send him buying more.
    const { checkYourself } = view([line({ unreconciled: 2 })]);
    expect(checkYourself[0]?.why).toContain('too high');
  });

  it('still shows the line in the buy list — the figure is usable, just not final', () => {
    const { groups } = view([line({ unreconciled: 1 })]);
    expect(groups[0]?.lines).toHaveLength(1);
  });
});

describe('needs fixing — something is absent from the records', () => {
  const cases: [RequirementGap['reason'], string][] = [
    ['missing_recipe', 'Recipes'],
    ['missing_sub_recipe', 'Recipes'],
    ['no_components', 'Recipes'],
    ['no_portions_per_batch', 'Recipes'],
    ['cycle', 'Recipes'],
    ['missing_ingredient', 'Ingredients'],
    ['no_pack_size', 'Ingredients'],
    ['unresolved_conversion', 'Ingredients'],
    ['no_service_date', 'Jobs'],
    ['no_portions', 'Jobs'],
  ];

  for (const [reason, where] of cases) {
    it(`routes ${reason} to ${where}`, () => {
      const { needsFixing } = view([], [{ reason, detail: `${reason} happened` }]);

      expect(needsFixing).toHaveLength(1);
      expect(needsFixing[0]?.where).toBe(where);
    });
  }

  it('EVERY reason lands somewhere — no gap is silently swallowed', () => {
    // The point of the whole section. A reason added to the engine later and not
    // routed here would vanish from the screen, which is exactly the silent
    // omission Rule 8 forbids.
    const all: RequirementGap['reason'][] = [
      'unquantified', 'named_unquantified', 'missing_sub_recipe', 'no_portions_per_batch',
      'no_components', 'cycle', 'missing_recipe', 'no_service_date', 'no_portions',
      'missing_ingredient', 'unresolved_conversion', 'no_pack_size',
    ];

    for (const reason of all) {
      const { checkYourself, needsFixing } = view([], [{ reason, detail: 'x' }]);
      expect(
        checkYourself.length + needsFixing.length,
        `reason "${reason}" was routed nowhere`,
      ).toBe(1);
    }
  });

  it('keeps the engine’s own wording rather than rewriting it', () => {
    const { needsFixing } = view([], [
      { reason: 'missing_recipe', detail: 'job j1 references a recipe that does not exist' },
    ]);

    expect(needsFixing[0]?.label).toBe('job j1 references a recipe that does not exist');
  });

  it('collapses duplicate gaps, which consolidation across jobs produces a lot of', () => {
    const { needsFixing } = view([], [
      { reason: 'no_pack_size', detail: 'mince: no pack size set' },
      { reason: 'no_pack_size', detail: 'mince: no pack size set' },
    ]);

    expect(needsFixing).toHaveLength(1);
  });
});
