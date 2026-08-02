/**
 * The golden regression pack — deterministic tests.
 *
 * Every `deterministic_test` in `tests/fixtures/expected_results.json` runs here,
 * against the real engine, with the expected values read from the fixture rather
 * than restated.
 *
 * READ `tests/golden/PENDING_OWNER.md` BEFORE CHANGING ANYTHING HERE. Two
 * assertions are blocked on the owner and are wired as skips. Neither may be made
 * green by editing a fixture or inventing a rate — that would be Rule 1 dressed up
 * as a passing test.
 *
 * PROVENANCE_RULES.md: nothing marked `uncertain` becomes a hard expectation, and
 * a `historical_output` that conflicts with a confirmed rule is investigated rather
 * than overwritten.
 *
 * The expected keys are prose, not a schema — `egg_each` in the recipe is
 * `eggs_each` in the expectation, `wedges_or_baby_potatoes_g` is
 * `potatoes_or_wedges_g_all_guests`. Each mapping is written out explicitly below
 * so a mismatch is visible rather than fuzzily normalised away.
 */

import { describe, expect, it } from 'vitest';
import expectedJson from '../fixtures/expected_results.json' with { type: 'json' };
import { allergenScan } from '../../src/engine/checks';
import { scaleRecipe } from '../../src/engine/scaling';
import { goldenIngredients, goldenJob, goldenRecipes } from './adapter';
import type { RecipeId } from '../../src/engine/types';

const expected = expectedJson as unknown as {
  deterministic_tests: { id: string; expected?: Record<string, unknown>; expected_revenue_eur?: number }[];
};

const caseFor = (id: string): Record<string, unknown> => {
  const found = expected.deterministic_tests.find((t) => t.id === id);
  if (found === undefined) throw new Error(`golden pack has no case "${id}"`);
  return (found.expected ?? {}) as Record<string, unknown>;
};

const recipes = goldenRecipes();
const ingredients = goldenIngredients(recipes);
const lookup = (id: RecipeId) => recipes.find((r) => r.id === id);
const recipeNamed = (name: string) => {
  const r = recipes.find((x) => x.name === name);
  if (r === undefined) throw new Error(`adapter produced no recipe "${name}"`);
  return r;
};

/**
 * Scaled quantity for a component, by its fixture name.
 *
 * Throws rather than returning undefined. A fixture-driven test comparing two
 * undefineds passes vacuously, which is the worst possible outcome here: a green
 * regression pack that checks nothing. A missing component is a failure.
 */
const qty = (scaled: ReturnType<typeof scaleRecipe>, name: string): number => {
  const line = scaled.lines.find((l) => l.displayName === name);
  if (line === undefined) throw new Error(`engine produced no component "${name}"`);
  return line.qty;
};

/**
 * Read an expected value and assert it is actually a number.
 *
 * Same reason: a typo in a fixture key would otherwise yield undefined on both
 * sides and pass.
 */
const num = (source: Record<string, unknown>, key: string): number => {
  const value = source[key];
  if (typeof value !== 'number') {
    throw new Error(`fixture key "${key}" is not a number (got ${JSON.stringify(value)})`);
  }
  return value;
};

describe('CALC-CURRY-10', () => {
  const e = caseFor('CALC-CURRY-10');

  it('scales Chicken Curry to 10 portions', () => {
    const scaled = scaleRecipe(recipeNamed('Chicken Curry'), 10, lookup);

    expect(qty(scaled, 'chicken_breast')).toBe(num(e, 'chicken_breast_g'));
    expect(qty(scaled, 'curry_sauce')).toBe(num(e, 'curry_sauce_jars'));
    expect(qty(scaled, 'rice')).toBe(num(e, 'rice_g'));
    expect(scaled.gaps).toEqual([]);
  });
});

describe('CALC-LASAGNE-29', () => {
  const e = caseFor('CALC-LASAGNE-29');

  it('rounds 29 portions up to whole trays and scales the ingredients to them', () => {
    const scaled = scaleRecipe(recipeNamed('Lasagne'), 29, lookup);

    expect(scaled.batches?.batches).toBe(num(e, 'trays'));
    expect(scaled.batches?.capacity).toBe(num(e, 'production_capacity_portions'));

    // 4 trays, not 29/9 of one. Linear scaling would say 6.44 kg of mince.
    expect(qty(scaled, 'mince')).toBe(num(e, 'mince_kg'));
    expect(qty(scaled, 'red_sauce')).toBe(num(e, 'red_sauce_units'));
    expect(qty(scaled, 'white_sauce')).toBe(num(e, 'white_sauce_units'));
    expect(qty(scaled, 'cheese')).toBe(num(e, 'cheese_g'));
  });
});

describe('CALC-SWEETPEA-BREAKFAST', () => {
  const e = caseFor('CALC-SWEETPEA-BREAKFAST');
  const job = goldenJob('HIST-2026-07-19-SWEETPEA-BREAKFAST');

  const portionsFor = (name: string): number => {
    const found = job.dishes.find((d) => d.recipeId === (name as RecipeId));
    if (found?.portions == null) throw new Error(`no portions for "${name}"`);
    return found.portions;
  };

  it('takes the breakfast choices as recorded, 5 / 3 / 4 across 12 guests', () => {
    // Not an even split. applyBuffetSplit deliberately leaves breakfast alone,
    // because this is a choice the owner recorded rather than a division.
    expect(portionsFor('Full Irish')).toBe(5);
    expect(portionsFor('Pancakes')).toBe(3);
    expect(portionsFor('Continental')).toBe(4);
    expect(job.guests).toBe(12);
  });

  it('scales the Full Irish to 5 portions', () => {
    const fi = e['full_irish'] as Record<string, number>;
    const scaled = scaleRecipe(recipeNamed('Full Irish'), portionsFor('Full Irish'), lookup);

    expect(qty(scaled, 'sausages')).toBe(num(fi, 'sausages_each'));
    expect(qty(scaled, 'bacon_rashers')).toBe(num(fi, 'bacon_rashers_each'));
    // Fixture inconsistency: the recipe says `egg_each`, the expectation
    // `eggs_each`. Mapped explicitly rather than normalised away.
    expect(qty(scaled, 'egg')).toBe(num(fi, 'eggs_each'));
  });

  it('scales the pancakes to 3 portions', () => {
    const p = e['pancakes'] as Record<string, number>;
    const scaled = scaleRecipe(recipeNamed('Pancakes'), portionsFor('Pancakes'), lookup);

    expect(qty(scaled, 'flour')).toBe(num(p, 'flour_g'));
    expect(qty(scaled, 'buttermilk')).toBe(num(p, 'buttermilk_ml'));
    expect(qty(scaled, 'nutella')).toBe(num(p, 'nutella_g'));
    expect(qty(scaled, 'blueberries')).toBe(num(p, 'blueberries_g'));
    expect(qty(scaled, 'banana')).toBe(num(p, 'bananas_each')); // banana_each vs bananas_each
    expect(qty(scaled, 'maple_syrup')).toBe(num(p, 'maple_syrup_ml'));
  });

  it('scales the continental to 4 portions', () => {
    const c = e['continental'] as Record<string, number>;
    const scaled = scaleRecipe(recipeNamed('Continental'), portionsFor('Continental'), lookup);

    expect(qty(scaled, 'pastry')).toBe(num(c, 'pastries_each')); // pastry_each vs pastries_each
    expect(qty(scaled, 'yoghurt')).toBe(num(c, 'yoghurt_g'));
    expect(qty(scaled, 'granola')).toBe(num(c, 'granola_g'));
    expect(qty(scaled, 'fruit')).toBe(num(c, 'fruit_g'));
  });

  it.skip('orange juice — PENDING OWNER, see PENDING_OWNER.md §1 (Rule 13 conflict)', () => {
    // The fixture expects orange_juice_ml_range [600, 800] for 4 guests, from a
    // per-portion range of [150, 200] marked `confidence: "confirmed"`.
    //
    // CLAUDE.md Rule 13 supersedes that with a flat 200 ml, which makes the answer
    // a single 800. The engine cannot even express a range: types.ts has no range
    // type, by design.
    //
    // Paul confirms the v2 range is superseded, or Rule 13 is wrong. Until then
    // neither the fixture nor the engine is edited.
  });

  it('flags the two gluten-free requirements for review rather than substituting', () => {
    const w = e['warnings'] as string[];
    expect(w).toHaveLength(2);

    const scan = allergenScan(job, recipes, ingredients);
    // No ingredient in the pack carries allergen tags, so nothing can be verified
    // by keyword. The scan must say so rather than imply the menu is clear.
    expect(scan.unchecked.length).toBeGreaterThan(0);
    expect(job.dietaries.every((d) => d.kind === 'unresolved' || d.assignedRecipeId === null)).toBe(
      true,
    );
  });
});

describe('CALC-NUCELLA-BBQ-SPLIT', () => {
  const e = caseFor('CALC-NUCELLA-BBQ-SPLIT');
  const job = goldenJob('HIST-2026-07-22-NUCELLA-BBQ');

  it('takes the meat-eater count from the owner, not by subtracting dietaries', () => {
    // 27 - (4 + 1) = 22 is the arithmetic Rule 16 forbids. The fixture records
    // guest_split.meat_eaters explicitly, and that is what the engine uses.
    expect(job.meatEatingGuests).toBe(num(e, 'meat_eaters'));
    expect(job.guests).toBe(27);
  });

  it('THE REGRESSION: meat scales to meat eaters, sides scale to ALL guests', () => {
    const meat = scaleRecipe(recipeNamed('BBQ Meat'), job.meatEatingGuests ?? 0, lookup);
    const sides = scaleRecipe(recipeNamed('BBQ Sides'), job.guests ?? 0, lookup);

    expect(qty(meat, 'burger_mince')).toBe(num(e, 'burger_mince_g_for_meat_eaters'));
    expect(qty(meat, 'pork')).toBe(num(e, 'pork_g_for_meat_eaters'));
    expect(qty(meat, 'chicken_drumstick')).toBe(num(e, 'drumsticks_each_for_meat_eaters'));

    // The original defect: these were scaled to 22 instead of 27.
    expect(qty(sides, 'burger_bap')).toBe(num(e, 'burger_baps_each_all_guests'));
    expect(qty(sides, 'corn')).toBe(num(e, 'corn_each_all_guests'));
    // wedges_or_baby_potatoes_g -> potatoes_or_wedges_g_all_guests
    expect(qty(sides, 'wedges_or_baby_potatoes')).toBe(num(e, 'potatoes_or_wedges_g_all_guests'));
    expect(qty(sides, 'coleslaw')).toBe(num(e, 'coleslaw_g_all_guests'));
  });

  it('adds no vegetarian burgers when salmon was chosen for the vegetarians', () => {
    // A rule check, not a quantity: nothing in the produced menu is a vegetarian
    // burger, because the owner selected salmon for those four guests.
    expect(num(e, 'vegetarian_burgers_for_salmon_guests')).toBe(0);
    expect(job.dishes.some((d) => String(d.recipeId).toLowerCase().includes('vegetarian'))).toBe(
      false,
    );
  });
});

describe('WARN-SEVERE-MUSHROOM-ALLERGY', () => {
  const e = caseFor('WARN-SEVERE-MUSHROOM-ALLERGY');
  const job = goldenJob('HIST-2026-07-20-NUCELLA-BUFFET');

  it('surfaces the severe requirement for review', () => {
    const scan = allergenScan(job, recipes, ingredients);
    const severe = scan.findings.filter((f) => f.severity === 'severe');

    expect(e['must_surface_warning']).toBe(true);
    expect(severe.length).toBeGreaterThan(0);
    expect(severe[0]?.severity).toBe(e['severity']);
  });

  it('does not auto-substitute anything', () => {
    expect(e['must_not_auto_substitute']).toBe(true);

    // The engine assigns no dish on the owner's behalf. Every dietary is still
    // unassigned, which is what makes it a review item rather than a resolution.
    expect(job.dietaries.every((d) => d.kind === 'allocated' && d.assignedRecipeId === null)).toBe(
      true,
    );
  });

  it('never phrases the result as safe (Rule 9)', () => {
    const serialised = JSON.stringify(allergenScan(job, recipes, ingredients)).toLowerCase();

    for (const phrase of ['safe', 'no allergen', 'no conflict', 'cleared', 'verified']) {
      expect(serialised, `output contains "${phrase}"`).not.toContain(phrase);
    }
  });
});

describe('FIN-REVENUE-WEEKEND-17-19', () => {
  it.skip('weekend revenue — PENDING OWNER, see PENDING_OWNER.md §2 (Tranquillity BBQ rate)', () => {
    // The fixture expects EUR 2068 across eight jobs. Seven price cleanly from the
    // rate card. HIST-2026-07-18-TRANQUILLITY-BBQ does not: the rate card has no
    // (Tranquillity, BBQ) entry, and the job is `historical_output` noting that
    // "rate may reflect booking-specific pricing".
    //
    // Under Rule 11 that job's revenue is null, so the weekend total is null too -
    // NOT EUR 1748, because Rule 11 forbids presenting a partial sum as a total.
    //
    // Recommended resolution: record that job with a manual override of EUR 320.
    // Do NOT add a Tranquillity BBQ rate to a fixture to make this pass.
  });
});
