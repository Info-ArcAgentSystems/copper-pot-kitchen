/**
 * The pack size a person types, turned into a pack or into a complaint.
 *
 * THE REGRESSION THIS PINS is a silent discard. The Ingredients form built its
 * pack with `parseCount(packSize).value` — taking the value and DROPPING the
 * error beside it — so every rejected input became `null`, `null` became "no
 * pack", and the save reported success. A 2.5 kg pack of mince was typed into a
 * field marked `inputMode="decimal"`, refused for not being a whole number, and
 * thrown away without a word.
 *
 * The owner then scanned an invoice, was told "no pack size recorded", went back
 * to the form, and saw the pack size he had entered sitting in the box.
 *
 * Three ways the pack was lost, all of them quiet:
 *
 *   1. a fractional size, refused by a whole-number parser
 *   2. a size with no unit    — correctly not a pack, but never said so
 *   3. a unit with no size    — likewise
 *
 * So the rule returns a THIRD state. Not a pack, and not the absence of a pack,
 * but a half-filled pack that has to be settled before saving. A parser that can
 * only answer "value or nothing" is what made the discard invisible: there was
 * nowhere for "you meant something and it did not survive" to go.
 */

import { describe, expect, it } from 'vitest';
import { parsePack } from '../../src/ui/form';
import { ingredientToDomain, ingredientToRow } from '../../src/data/mappers';
import { pricePerPackFromInvoice } from '../../src/engine/costing';
import type {
  Cents,
  Ingredient,
  IngredientId,
  KitchenId,
  PurchaseUnit,
  RecipeUnit,
  StockUnit,
} from '../../src/engine/types';

describe('a pack needs both halves, and says which is missing', () => {
  it('takes a whole-number pack', () => {
    expect(parsePack('12', 'each')).toEqual({ kind: 'pack', size: 12, unit: 'each' });
  });

  it('THE ONE THAT WAS LOST — takes a fractional pack size', () => {
    // 2.5 kg of mince is an ordinary pack. The field invites a decimal and the
    // engine costs one; only the form refused it.
    expect(parsePack('2.5', 'kg')).toEqual({ kind: 'pack', size: 2.5, unit: 'kg' });
  });

  it('both blank is no pack, which is a legitimate thing to record', () => {
    // Rule 8: not knowing the pack is a real state, not an error to nag about.
    expect(parsePack('', '')).toEqual({ kind: 'none' });
    expect(parsePack('  ', '  ')).toEqual({ kind: 'none' });
  });

  it('REFUSES a size with no unit, rather than discarding it', () => {
    const parsed = parsePack('2.5', '');

    expect(parsed.kind).toBe('error');
    if (parsed.kind !== 'error') return;
    expect(parsed.unitError).not.toBeNull();
    expect(parsed.sizeError).toBeNull();
  });

  it('REFUSES a unit with no size, rather than discarding it', () => {
    const parsed = parsePack('', 'kg');

    expect(parsed.kind).toBe('error');
    if (parsed.kind !== 'error') return;
    expect(parsed.sizeError).not.toBeNull();
    expect(parsed.unitError).toBeNull();
  });

  it('refuses a size that is not a number', () => {
    const parsed = parsePack('two', 'kg');

    expect(parsed.kind).toBe('error');
    if (parsed.kind !== 'error') return;
    expect(parsed.sizeError).not.toBeNull();
  });

  it('refuses a zero pack, which would cost every recipe at nothing', () => {
    // `pricePerPack = (lineTotal ÷ quantity) × packSize`. A zero pack size makes
    // that 0 — a plausible-looking price for a real ingredient.
    const parsed = parsePack('0', 'kg');

    expect(parsed.kind).toBe('error');
  });

  it('refuses a negative pack', () => {
    expect(parsePack('-1', 'kg').kind).toBe('error');
  });

  it('trims, so a trailing space does not lose a pack', () => {
    expect(parsePack(' 2.5 ', ' kg ')).toEqual({ kind: 'pack', size: 2.5, unit: 'kg' });
  });
});

describe('NOTHING is ever silently dropped', () => {
  it('every input that is not a pack is either explicitly none, or an error', () => {
    // The property the old code broke: there was a fourth outcome — "not a pack,
    // no error" — and that outcome is what reached the database as null.
    const inputs: readonly (readonly [string, string])[] = [
      ['', ''],
      ['2.5', ''],
      ['', 'kg'],
      ['two', 'kg'],
      ['0', 'kg'],
      ['-1', 'kg'],
      ['12', 'each'],
      ['2.5', 'kg'],
    ];

    for (const [size, unit] of inputs) {
      const parsed = parsePack(size, unit);
      const label = `${JSON.stringify(size)} / ${JSON.stringify(unit)}`;

      if (parsed.kind === 'error') {
        // An error state that names neither field is the same silent discard
        // wearing a different type.
        expect(parsed.sizeError ?? parsed.unitError, label).not.toBeNull();
      } else if (parsed.kind === 'none') {
        expect([size.trim(), unit.trim()], label).toEqual(['', '']);
      } else {
        expect(parsed.size, label).toBeGreaterThan(0);
        expect(parsed.unit, label).not.toBe('');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The whole way through
// ---------------------------------------------------------------------------

describe('a typed pack size reaches the invoice scanner', () => {
  /**
   * THE FULL PATH THE BUG BROKE, with no database in it:
   *
   *   what he types → parsePack → Ingredient → row → back → priced invoice line
   *
   * Every link was already tested in isolation and every link was fine. The pack
   * was lost at the very first one, and because `null` is a legitimate pack, no
   * later stage could tell a pack he never entered from one that was thrown away.
   */
  const typed = (size: string, unit: string): Ingredient => {
    const parsed = parsePack(size, unit);

    return {
      id: 'beef' as IngredientId,
      kitchenId: 'k1' as KitchenId,
      name: 'Beef mince',
      category: null,
      stockUnit: 'kg' as StockUnit,
      recipeUnit: 'g' as RecipeUnit,
      recipeUnitsPerStockUnit: null,
      pack:
        parsed.kind === 'pack'
          ? { size: parsed.size, unit: parsed.unit as PurchaseUnit, assumed: false }
          : null,
      supplierId: null,
      pricePerPack: null,
      previousPrice: null,
      priceChecked: null,
      allergens: [],
    };
  };

  it('survives the round trip through the row mappers', () => {
    const back = ingredientToDomain(ingredientToRow(typed('2.5', 'kg')));

    expect(back.pack).toEqual({ size: 2.5, unit: 'kg', assumed: false });
  });

  it('PRICES the invoice line that used to say "no pack size recorded"', () => {
    // 5 kg for €45.00 is €9.00 a kilo. A 2.5 kg pack therefore cost €22.50.
    const back = ingredientToDomain(ingredientToRow(typed('2.5', 'kg')));

    const price = pricePerPackFromInvoice(back, {
      quantity: 5,
      unit: 'kg' as StockUnit,
      lineTotal: 4500 as Cents,
    });

    expect(price.kind).toBe('priced');
    if (price.kind !== 'priced') return;
    expect(price.pricePerPack).toBe(2250);
    expect(price.pricePerUnit).toBe(900);
  });

  it('and a 1 kg pack of the same delivery costs €9.00', () => {
    const back = ingredientToDomain(ingredientToRow(typed('1', 'kg')));

    const price = pricePerPackFromInvoice(back, {
      quantity: 5,
      unit: 'kg' as StockUnit,
      lineTotal: 4500 as Cents,
    });

    if (price.kind !== 'priced') throw new Error(`expected priced, got ${price.kind}`);
    expect(price.pricePerPack).toBe(900);
  });
});
