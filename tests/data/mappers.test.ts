/**
 * Row <-> domain mappers.
 *
 * Pure functions, so all of this runs in CI with no database.
 *
 * Three defect classes guarded here:
 *   - money: euros to cents and back, where float-to-integer bugs start
 *   - null: a nullable column becoming 0 or '' (Rule 8)
 *   - unions: a dietary row landing in the wrong variant, or a price arriving
 *     without a stated source (Rules 11, 12, 16)
 *
 * Round-trips catch the classic mapper defect: a field dropped on one side.
 */

import { describe, expect, it } from 'vitest';
import {
  clientRateToDomain,
  clientRateToRow,
  customerToDomain,
  customerToRow,
  dietaryToDomain,
  dietaryToRow,
  ingredientToDomain,
  ingredientToRow,
  jobToDomain,
  jobToRow,
  pricingToDomain,
  propertyToDomain,
  propertyToRow,
  recipeToDomain,
  stockToDomain,
  toCents,
  toEuros,
} from '../../src/data/mappers';
import type {
  ClientRateRow,
  CustomerRow,
  IngredientRow,
  JobDietaryRow,
  JobRow,
  PropertyRow,
  RecipeIngredientRow,
  RecipeRow,
  StockRow,
} from '../../src/data/rows';
import type { Cents, KitchenId } from '../../src/engine/types';

const KITCHEN = 'k1' as KitchenId;

describe('money', () => {
  it('converts euros to whole cents', () => {
    expect(toCents(20)).toBe(2000);
    expect(toCents(20.5)).toBe(2050);
    expect(toCents(0.01)).toBe(1);
  });

  it('rounds rather than truncating a float artefact', () => {
    // 20.15 * 100 is 2014.9999999999998 in IEEE 754. Truncation would lose a cent
    // on a value the database can and does hold.
    expect(toCents(20.15)).toBe(2015);
    expect(toCents(8.29)).toBe(829);
    expect(toCents(4748.99)).toBe(474899);
  });

  it('is only defined for values numeric(10,2) can hold', () => {
    // A sub-cent input is outside the contract: the column has two decimal places,
    // so 1.005 can never arrive from it. Documented rather than asserted, because
    // the IEEE 754 double for 1.005 is really 1.00499..., and any answer here would
    // be an artefact of the float rather than a decision this mapper made.
    expect(toCents(1.005)).toBe(Math.round(1.005 * 100));
  });

  it('keeps null as null, never zero (Rule 8)', () => {
    expect(toCents(null)).toBeNull();
    expect(toEuros(null)).toBeNull();
  });

  it('treats zero as a real amount, distinct from unknown', () => {
    expect(toCents(0)).toBe(0);
    expect(toEuros(0 as Cents)).toBe(0);
  });

  it('round-trips', () => {
    for (const euros of [0, 0.01, 1, 15, 18.5, 20, 320, 4748.99]) {
      expect(toEuros(toCents(euros))).toBe(euros);
    }
  });
});

describe('property and customer', () => {
  const property: PropertyRow = {
    id: 'p1',
    kitchen_id: KITCHEN,
    name: 'Nucella Lodge',
    eircode: 'A91 RY71',
    address: null,
    access_notes: null,
    facilities: null,
  };

  it('round-trips a property, nulls intact', () => {
    expect(propertyToRow(propertyToDomain(property))).toEqual(property);
  });

  it('round-trips a customer', () => {
    const row: CustomerRow = {
      id: 'c1',
      kitchen_id: KITCHEN,
      name: 'Tranquillity',
      phone: null,
      email: null,
      client_group: 'Tranquillity',
      notes: null,
    };
    expect(customerToRow(customerToDomain(row))).toEqual(row);
  });

  it('keeps a missing client group null, so no rate can match it', () => {
    const row: CustomerRow = { ...({} as CustomerRow), id: 'c2', kitchen_id: KITCHEN, name: 'X', phone: null, email: null, client_group: null, notes: null };
    expect(customerToDomain(row).clientGroup).toBeNull();
  });
});

describe('client rate', () => {
  it('round-trips both rate shapes', () => {
    const perHead: ClientRateRow = {
      id: 'r1',
      kitchen_id: KITCHEN,
      client_group: 'Tranquillity',
      service_type: 'Buffet',
      rate_per_head: 20,
      flat_fee: null,
    };
    expect(clientRateToRow(clientRateToDomain(perHead))).toEqual(perHead);

    const both: ClientRateRow = { ...perHead, id: 'r2', flat_fee: 150 };
    expect(clientRateToRow(clientRateToDomain(both))).toEqual(both);
  });

  it('converts the rate to cents', () => {
    const row: ClientRateRow = {
      id: 'r3',
      kitchen_id: KITCHEN,
      client_group: 'Other',
      service_type: 'Afternoon Tea',
      rate_per_head: 18,
      flat_fee: null,
    };
    expect(clientRateToDomain(row).ratePerHead).toBe(1800);
  });

  it('leaves an unpriced rate null on both sides', () => {
    const row: ClientRateRow = {
      id: 'r4',
      kitchen_id: KITCHEN,
      client_group: 'Tranquillity',
      service_type: 'BBQ',
      rate_per_head: null,
      flat_fee: null,
    };
    const rate = clientRateToDomain(row);
    expect(rate.ratePerHead).toBeNull();
    expect(rate.flatFee).toBeNull();
  });
});

describe('ingredient', () => {
  const base: IngredientRow = {
    id: 'i1',
    kitchen_id: KITCHEN,
    name: 'flour',
    category: 'dry',
    stock_unit: 'kg',
    recipe_unit: 'g',
    recipe_units_per_stock_unit: null,
    pack_size: 1,
    pack_unit: 'kg',
    pack_assumed: false,
    supplier_id: null,
    price_per_pack: 2,
    previous_price: null,
    price_checked: null,
    allergens: ['gluten'],
  };

  it('round-trips', () => {
    expect(ingredientToRow(ingredientToDomain(base))).toEqual(base);
  });

  it('converts the pack price to cents', () => {
    expect(ingredientToDomain(base).pricePerPack).toBe(200);
  });

  it('treats half a pack definition as no pack at all', () => {
    // A size with no unit is not a pack, and inventing the unit would be a guess.
    const noUnit = ingredientToDomain({ ...base, pack_unit: null });
    expect(noUnit.pack).toBeNull();

    const noSize = ingredientToDomain({ ...base, pack_size: null });
    expect(noSize.pack).toBeNull();
  });

  it('carries the assumed flag through', () => {
    expect(ingredientToDomain({ ...base, pack_assumed: true }).pack?.assumed).toBe(true);
  });

  it('keeps an unpriced ingredient null, never zero', () => {
    expect(ingredientToDomain({ ...base, price_per_pack: null }).pricePerPack).toBeNull();
  });

  it('turns a null allergen array into an empty one', () => {
    expect(ingredientToDomain({ ...base, allergens: null }).allergens).toEqual([]);
  });
});

describe('stock', () => {
  it('maps a stock row into a quantity with its unit', () => {
    const row: StockRow = {
      id: 's1',
      kitchen_id: KITCHEN,
      ingredient_id: 'i1',
      qty: 4.5,
      unit: 'kg',
      use_by: null,
      counted_at: '2026-07-01T00:00:00Z',
    };
    const level = stockToDomain(row);

    expect(level.onHand).toEqual({ value: 4.5, unit: 'kg' });
    expect(level.useBy).toBeNull();
  });
});

describe('recipe', () => {
  const recipe: RecipeRow = {
    id: 'lasagne',
    kitchen_id: KITCHEN,
    name: 'Lasagne',
    course: 'main',
    yield_type: 'batch',
    portions_per_batch: 9,
    batch_unit: 'tray',
    confidence: 'locked',
    make_ahead_days: 1,
    same_day_only: false,
    freezable: true,
    onsite_finish: false,
    method: null,
    note: null,
  };

  const line = (over: Partial<RecipeIngredientRow>): RecipeIngredientRow => ({
    id: 'l1',
    kitchen_id: KITCHEN,
    recipe_id: 'lasagne',
    ingredient_id: 'mince',
    sub_recipe_id: null,
    display_name: 'mince',
    qty: 2,
    qty_min: null,
    qty_max: null,
    unit: 'kg',
    position: 0,
    ...over,
  });

  it('maps components in position order', () => {
    const r = recipeToDomain(
      recipe,
      [line({ id: 'b', display_name: 'second', position: 2 }), line({ id: 'a', position: 1 })],
      [],
    );
    expect(r.components.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('RULE 13: ignores qty_min and qty_max entirely', () => {
    // The columns exist in the schema. Mapping either end of a range would be
    // inventing owner data, and the domain has no range type to hold it.
    const r = recipeToDomain(recipe, [line({ qty: null, qty_min: 150, qty_max: 200 })], []);

    expect(r.components[0]?.qty).toBeNull();
    expect(JSON.stringify(r)).not.toContain('150');
    expect(JSON.stringify(r)).not.toContain('200');
  });

  it('discriminates an ingredient line from a sub-recipe line', () => {
    const r = recipeToDomain(
      recipe,
      [
        line({ id: 'ing' }),
        line({ id: 'sub', ingredient_id: null, sub_recipe_id: 'sauce', position: 1 }),
      ],
      [],
    );

    expect(r.components.find((c) => c.id === 'ing')?.kind).toBe('ingredient');
    expect(r.components.find((c) => c.id === 'sub')?.kind).toBe('sub_recipe');
  });

  it('drops a line that is neither, rather than guessing', () => {
    const r = recipeToDomain(recipe, [line({ ingredient_id: null, sub_recipe_id: null })], []);
    expect(r.components).toEqual([]);
  });

  it('nulls an unrecognised course rather than coercing it', () => {
    // rules.ts and checks.ts branch on course. A value they do not know is null,
    // not a guess at which course it resembles.
    expect(recipeToDomain({ ...recipe, course: 'amuse-bouche' }, [], []).course).toBeNull();
    expect(recipeToDomain({ ...recipe, course: 'side' }, [], []).course).toBe('side');
  });
});

describe('job pricing — Rule 11', () => {
  const job: JobRow = {
    id: 'j1',
    kitchen_id: KITCHEN,
    customer_id: 'c1',
    property_id: null,
    job_group: null,
    service_date: '2026-07-18',
    service_time: null,
    service_type: 'BBQ',
    guests: 16,
    guests_confirmed: true,
    meat_eating_guests: null,
    price: null,
    price_source: null,
    status: 'paid',
    notes: null,
  };

  it('reads a manual price as an override', () => {
    const pricing = pricingToDomain({ ...job, price: 320, price_source: 'manual' });

    expect(pricing.kind).toBe('override');
    if (pricing.kind === 'override') expect(pricing.amount).toBe(32000);
  });

  it('reads anything else as rate card', () => {
    expect(pricingToDomain({ ...job, price: 320, price_source: 'rate_card' }).kind).toBe(
      'rate_card',
    );
    expect(pricingToDomain(job).kind).toBe('rate_card');
  });

  it('ignores a manual source with no amount, rather than inventing one', () => {
    expect(pricingToDomain({ ...job, price: null, price_source: 'manual' }).kind).toBe(
      'rate_card',
    );
  });

  it('round-trips a job with an override', () => {
    const row: JobRow = { ...job, price: 320, price_source: 'manual' };
    expect(jobToRow(jobToDomain(row, [], [], []))).toEqual(row);
  });

  it('round-trips a rate-card job', () => {
    const row: JobRow = { ...job, price: null, price_source: 'rate_card' };
    expect(jobToRow(jobToDomain(row, [], [], []))).toEqual(row);
  });
});

describe('dietary — Rules 12 and 16', () => {
  const base: JobDietaryRow = {
    id: 'd1',
    kitchen_id: KITCHEN,
    job_id: 'j1',
    diet_type: 'vegetarian',
    severity: 'moderate',
    guest_ref: 'g1',
    excludes_meat: true,
    guests_unresolved: false,
    unresolved_note: null,
    details: null,
    assigned_recipe_id: null,
  };

  it('maps an allocated row to the allocated variant, carrying its guest', () => {
    const d = dietaryToDomain(base);

    expect(d.kind).toBe('allocated');
    if (d.kind === 'allocated') expect(d.guest).toBe('g1');
  });

  it('maps an unresolved row to the unresolved variant, keeping the wording', () => {
    const d = dietaryToDomain({
      ...base,
      guest_ref: null,
      guests_unresolved: true,
      unresolved_note: 'a few vegetarians',
    });

    expect(d.kind).toBe('unresolved');
    if (d.kind === 'unresolved') expect(d.originalWording).toBe('a few vegetarians');
  });

  it('never produces a count field on either variant', () => {
    // Rule 16 has no operand to sum. If a count ever appeared here the engine
    // could add them, and a guest with two requirements would be counted twice.
    const allocated = dietaryToDomain(base);
    const unresolved = dietaryToDomain({ ...base, guests_unresolved: true });

    expect(Object.keys(allocated)).not.toContain('guests');
    expect(Object.keys(unresolved)).not.toContain('guests');
  });

  it('round-trips both variants', () => {
    expect(dietaryToRow(dietaryToDomain(base), KITCHEN)).toEqual(base);

    const unresolvedRow: JobDietaryRow = {
      ...base,
      guest_ref: null,
      guests_unresolved: true,
      unresolved_note: 'a few vegetarians',
    };
    expect(dietaryToRow(dietaryToDomain(unresolvedRow), KITCHEN)).toEqual(unresolvedRow);
  });

  it('carries excludesMeat through, since it is owner-set not inferred', () => {
    expect(dietaryToDomain({ ...base, excludes_meat: false }).excludesMeat).toBe(false);
  });
});

describe('job aggregate', () => {
  const job: JobRow = {
    id: 'j1',
    kitchen_id: KITCHEN,
    customer_id: null,
    property_id: null,
    job_group: null,
    service_date: null,
    service_time: null,
    service_type: null,
    guests: null,
    guests_confirmed: false,
    meat_eating_guests: null,
    price: null,
    price_source: null,
    status: 'enquiry',
    notes: null,
  };

  it('keeps every unknown null rather than defaulting it', () => {
    const d = jobToDomain(job, [], [], []);

    expect(d.guests).toBeNull();
    expect(d.serviceDate).toBeNull();
    expect(d.serviceType).toBeNull();
    expect(d.meatEatingGuests).toBeNull();
    expect(d.customerId).toBeNull();
  });

  it('orders dishes and extras by position', () => {
    const d = jobToDomain(
      job,
      [
        { id: 'b', kitchen_id: KITCHEN, job_id: 'j1', recipe_id: 'r', portions: 1, note: null, position: 2 },
        { id: 'a', kitchen_id: KITCHEN, job_id: 'j1', recipe_id: 'r', portions: 1, note: null, position: 1 },
      ],
      [],
      [
        { id: 'y', kitchen_id: KITCHEN, job_id: 'j1', label: 'y', amount_each: 1, quantity: 1, position: 2 },
        { id: 'x', kitchen_id: KITCHEN, job_id: 'j1', label: 'x', amount_each: 1, quantity: 1, position: 1 },
      ],
    );

    expect(d.dishes.map((x) => x.id)).toEqual(['a', 'b']);
    expect(d.extras.map((x) => x.id)).toEqual(['x', 'y']);
  });

  it('converts an extra amount to cents and keeps an unpriced one null', () => {
    const d = jobToDomain(
      job,
      [],
      [],
      [
        { id: 'x', kitchen_id: KITCHEN, job_id: 'j1', label: 'steak', amount_each: 10, quantity: 2, position: 0 },
        { id: 'y', kitchen_id: KITCHEN, job_id: 'j1', label: 'mystery', amount_each: null, quantity: 1, position: 1 },
      ],
    );

    expect(d.extras[0]?.amountEach).toBe(1000);
    expect(d.extras[1]?.amountEach).toBeNull();
  });
});
