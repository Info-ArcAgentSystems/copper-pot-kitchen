/**
 * allergenScan, dietaryCrossCheck, readinessCheck, anomalyScan.
 *
 * Worked numbers first, per CLAUDE.md section 5.
 *
 * Rule 9 is the hard one here: surface POSSIBLE conflicts, never assert safety.
 * The language test at the end runs over the real serialised output, so a careless
 * message added later fails the build rather than reassuring a reader.
 *
 * Context that makes this sharper than it looks: the golden fixture contains NO
 * allergen tags on any ingredient. A keyword scan therefore finds nothing on
 * HIST-2026-07-20-NUCELLA-BUFFET, which carries a severe mushroom allergy. An empty
 * findings list is the normal case on real data, and must never read as a clean
 * bill of health.
 */

import { describe, expect, it } from 'vitest';
import {
  allergenScan,
  anomalyScan,
  dietaryCrossCheck,
  readinessCheck,
} from '../../src/engine/checks';
import {
  allocated,
  dish,
  guestRef,
  ingredientId,
  ingredientLine,
  isoDate,
  jobId,
  makeIngredient,
  makeJob,
  makeRecipe,
  recipeId,
  unresolved,
} from './factories';

const line = (name: string, qty: number, unit: string) =>
  ingredientLine(name, qty, unit, { ingredientId: ingredientId(name) });

const mushrooms = makeIngredient({
  id: ingredientId('mushrooms'),
  name: 'mushrooms',
  allergens: ['mushroom'],
});
const pork = makeIngredient({
  id: ingredientId('pork'),
  name: 'pork belly',
  allergens: ['pork'],
});
const untagged = makeIngredient({
  id: ingredientId('flour'),
  name: 'flour',
  allergens: [],
});

const risotto = makeRecipe('Risotto', {
  course: 'main',
  components: [line('mushrooms', 100, 'g')],
});
const porkDish = makeRecipe('Porchetta', {
  course: 'main',
  components: [line('pork', 200, 'g')],
});
const plainDish = makeRecipe('Bread', {
  course: 'side',
  components: [line('flour', 100, 'g')],
});

describe('allergenScan — Rule 9', () => {
  it('flags a severe requirement with no assigned dish, regardless of keyword hits', () => {
    // The WARN-SEVERE-MUSHROOM-ALLERGY shape. No ingredient is tagged, so nothing
    // matches by keyword — this rule is the only thing that catches it.
    const job = makeJob({
      guests: 20,
      dishes: [dish('Bread', 20)],
      dietaries: [
        allocated('g1', {
          dietType: 'severe_mushroom_allergy',
          severity: 'severe',
          assignedRecipeId: null,
        }),
      ],
    });

    const result = allergenScan(job, [plainDish], [untagged]);

    expect(result.findings.map((f) => f.reason)).toContain('severe_without_assigned_dish');
  });

  it('flags a possible ingredient match from owner-entered tags', () => {
    const job = makeJob({
      guests: 10,
      dishes: [dish('Risotto', 10)],
      dietaries: [
        allocated('g1', {
          dietType: 'severe_mushroom_allergy',
          severity: 'severe',
          assignedRecipeId: recipeId('Risotto'),
        }),
      ],
    });

    const result = allergenScan(job, [risotto], [mushrooms]);
    const match = result.findings.find((f) => f.reason === 'possible_ingredient_match');

    expect(match).toBeDefined();
    expect(match?.recipeId).toBe('Risotto');
  });

  it('matches a compound requirement by token overlap, with no built-in vocabulary', () => {
    // "no_pork_no_alcohol" against an ingredient tagged "pork". Nothing in src/
    // knows what an allergen is; both sides are owner-entered strings.
    const job = makeJob({
      guests: 10,
      dishes: [dish('Porchetta', 10)],
      dietaries: [
        allocated('g1', {
          dietType: 'no_pork_no_alcohol',
          severity: 'moderate',
          assignedRecipeId: recipeId('Porchetta'),
        }),
      ],
    });

    const result = allergenScan(job, [porkDish], [pork]);

    expect(result.findings.map((f) => f.reason)).toContain('possible_ingredient_match');
  });

  it('flags an unresolved requirement, which cannot be checked at all', () => {
    const job = makeJob({
      guests: 10,
      dishes: [dish('Bread', 10)],
      dietaries: [unresolved('a couple with nut allergies', { severity: 'severe' })],
    });

    const result = allergenScan(job, [plainDish], [untagged]);

    expect(result.findings.map((f) => f.reason)).toContain('unresolved_requirement');
    expect(result.findings[0]?.guest).toBeNull();
  });

  it('reports dishes it could NOT check, so empty findings is not a clean bill', () => {
    const job = makeJob({
      guests: 10,
      dishes: [dish('Bread', 10)],
      dietaries: [
        allocated('g1', {
          dietType: 'dairy_free',
          severity: 'moderate',
          assignedRecipeId: recipeId('Bread'),
        }),
      ],
    });

    const result = allergenScan(job, [plainDish], [untagged]);

    expect(result.findings).toEqual([]);
    // Flour carries no allergen tags, so nothing about it was actually verified.
    expect(result.unchecked.map((u) => u.recipeId)).toContain('Bread');
  });

  it('lists a dish with no recipe record as unchecked', () => {
    const job = makeJob({
      guests: 10,
      dishes: [dish('Ghost', 10)],
      dietaries: [allocated('g1', { dietType: 'dairy_free', severity: 'moderate' })],
    });

    const result = allergenScan(job, [], []);

    expect(result.unchecked.map((u) => u.reason)).toContain('missing_recipe');
  });

  it('exposes no field that could be read as a safety verdict', () => {
    const job = makeJob({ guests: 10, dishes: [], dietaries: [] });
    const result = allergenScan(job, [], []);

    for (const banned of ['safe', 'clear', 'ok', 'passed', 'hasConflicts', 'conflictFree']) {
      expect(Object.keys(result)).not.toContain(banned);
    }
  });

  it('THE LANGUAGE TEST: no output can be read as a safety guarantee', () => {
    const job = makeJob({
      guests: 20,
      dishes: [dish('Risotto', 20), dish('Bread', 20), dish('Ghost', 5)],
      dietaries: [
        allocated('g1', {
          dietType: 'severe_mushroom_allergy',
          severity: 'severe',
          assignedRecipeId: null,
        }),
        allocated('g2', {
          dietType: 'dairy_free',
          severity: 'moderate',
          assignedRecipeId: recipeId('Bread'),
        }),
        unresolved('a few nut allergies', { severity: 'severe' }),
      ],
    });

    const serialised = JSON.stringify(
      allergenScan(job, [risotto, plainDish], [mushrooms, untagged]),
    ).toLowerCase();

    const forbidden = [
      'safe',
      'no allergen',
      'allergen-free',
      'allergen free',
      'free from',
      'none found',
      'no conflict',
      'verified',
      'guaranteed',
      'cleared',
    ];

    for (const phrase of forbidden) {
      expect(serialised, `output contains "${phrase}"`).not.toContain(phrase);
    }
  });

  it('phrases every finding as a possible conflict requiring review', () => {
    const job = makeJob({
      guests: 10,
      dishes: [dish('Risotto', 10)],
      dietaries: [
        allocated('g1', {
          dietType: 'severe_mushroom_allergy',
          severity: 'severe',
          assignedRecipeId: recipeId('Risotto'),
        }),
      ],
    });

    const result = allergenScan(job, [risotto], [mushrooms]);

    expect(result.findings.length).toBeGreaterThan(0);
    for (const f of result.findings) {
      expect(f.message).toContain('possible conflict');
      expect(f.message).toContain('review required');
    }
  });
});

describe('dietaryCrossCheck — Rule 16', () => {
  it('flags a dietary with no assigned dish', () => {
    const job = makeJob({
      guests: 10,
      dishes: [dish('Bread', 10)],
      dietaries: [allocated('g1', { dietType: 'vegan', assignedRecipeId: null })],
    });

    const result = dietaryCrossCheck(job, [plainDish]);

    expect(result.map((f) => f.reason)).toContain('no_assigned_dish');
  });

  it('flags an assigned dish that is not on the menu', () => {
    const job = makeJob({
      guests: 10,
      dishes: [dish('Bread', 10)],
      dietaries: [
        allocated('g1', { dietType: 'vegan', assignedRecipeId: recipeId('Risotto') }),
      ],
    });

    const result = dietaryCrossCheck(job, [plainDish, risotto]);

    expect(result.map((f) => f.reason)).toContain('assigned_dish_not_on_menu');
  });

  it('flags an unresolved dietary', () => {
    const job = makeJob({ guests: 10, dietaries: [unresolved('a few vegetarians')] });

    expect(dietaryCrossCheck(job, []).map((f) => f.reason)).toContain('unresolved');
  });

  it('THE RULE 16 GUARD: one guest with two requirements counts once', () => {
    // Coeliac AND vegetarian is one person. Summing categories would say two.
    const job = makeJob({
      guests: 27,
      dishes: [],
      dietaries: [
        allocated('g1', { dietType: 'coeliac', assignedRecipeId: null }),
        allocated('g1', { dietType: 'vegetarian', assignedRecipeId: null }),
      ],
    });

    const result = dietaryCrossCheck(job, []);
    const guests = new Set(result.flatMap((f) => f.guests));

    expect(result).toHaveLength(2); // two requirements
    expect(guests.size).toBe(1); // one person
    expect([...guests]).toEqual([guestRef('g1')]);
  });

  it('is empty when every dietary is allocated to a dish on the menu', () => {
    const job = makeJob({
      guests: 10,
      dishes: [dish('Bread', 10)],
      dietaries: [
        allocated('g1', { dietType: 'vegan', assignedRecipeId: recipeId('Bread') }),
      ],
    });

    expect(dietaryCrossCheck(job, [plainDish])).toEqual([]);
  });
});

describe('readinessCheck', () => {
  const ready = () =>
    makeJob({
      guests: 10,
      guestsConfirmed: true,
      serviceTime: '18:00' as never,
      propertyId: 'prop-1' as never,
      dishes: [dish('Bread', 10)],
    });

  const ctx = (over = {}) => ({
    revenueKnown: true,
    outstandingCount: 0,
    dietaryIssues: 0,
    ...over,
  });

  it('is 100% when everything is in place', () => {
    const result = readinessCheck(ready(), ctx());

    expect(result.percentage).toBe(100);
    expect(result.items.every((i) => i.met)).toBe(true);
  });

  it('drops when the guest count is unconfirmed', () => {
    const result = readinessCheck(makeJob({ ...ready(), guestsConfirmed: false }), ctx());

    expect(result.percentage).toBeLessThan(100);
    expect(result.items.find((i) => i.key === 'guests_confirmed')?.met).toBe(false);
  });

  it('counts outstanding shopping as unmet', () => {
    const result = readinessCheck(ready(), ctx({ outstandingCount: 3 }));

    expect(result.items.find((i) => i.key === 'shopping_done')?.met).toBe(false);
  });

  it('counts unknown revenue as unmet', () => {
    const result = readinessCheck(ready(), ctx({ revenueKnown: false }));

    expect(result.items.find((i) => i.key === 'revenue_known')?.met).toBe(false);
  });

  it('reports an integer percentage', () => {
    const result = readinessCheck(makeJob({}), ctx({ revenueKnown: false }));

    expect(Number.isInteger(result.percentage)).toBe(true);
    expect(result.percentage).toBeGreaterThanOrEqual(0);
    expect(result.percentage).toBeLessThanOrEqual(100);
  });

  it('does not divide by zero when there is nothing to check', () => {
    const result = readinessCheck(ready(), ctx());
    expect(result.total).toBeGreaterThan(0);
    expect(Number.isNaN(result.percentage)).toBe(false);
  });
});

describe('anomalyScan — the BBQ guards, generalised', () => {
  const meat = makeRecipe('Burgers', { course: 'main' });
  const baps = makeRecipe('Baps', { course: 'side' });
  const slaw = makeRecipe('Slaw', { course: 'side' });
  const pav = makeRecipe('Pavlova', { course: 'dessert' });

  it('THE GUARD: flags sides ordered for meat eaters instead of all guests', () => {
    // The original defect: 27 guests, 22 meat eaters. Baps scaled to 22.
    const job = makeJob({
      id: jobId('nucella'),
      guests: 27,
      meatEatingGuests: 22,
      serviceDate: isoDate('2026-07-22'),
      dishes: [dish('Burgers', 22), dish('Baps', 22), dish('Slaw', 2700)],
    });

    const found = anomalyScan([job], [meat, baps, slaw]);
    const sides = found.filter((a) => a.reason === 'sides_below_guests');

    expect(sides.length).toBeGreaterThan(0);
    expect(sides[0]?.detail).toContain('27');
  });

  it('does not flag sides that cover every guest', () => {
    const job = makeJob({
      guests: 27,
      meatEatingGuests: 22,
      serviceDate: isoDate('2026-07-22'),
      dishes: [dish('Burgers', 22), dish('Baps', 27), dish('Slaw', 27)],
    });

    const found = anomalyScan([job], [meat, baps, slaw]);

    expect(found.map((a) => a.reason)).not.toContain('sides_below_guests');
  });

  it('does not flag a MAIN scaled to meat eaters — that is correct', () => {
    // Burgers at 22 for 27 guests is right: meat scales to meat eaters.
    const job = makeJob({
      guests: 27,
      meatEatingGuests: 22,
      serviceDate: isoDate('2026-07-22'),
      dishes: [dish('Burgers', 22), dish('Baps', 27), dish('Slaw', 27)],
    });

    const found = anomalyScan([job], [meat, baps, slaw]);

    expect(found.map((a) => a.reason)).not.toContain('mains_below_guests');
  });

  it('flags a menu with mains and no sides at all', () => {
    const job = makeJob({
      guests: 27,
      serviceDate: isoDate('2026-07-22'),
      dishes: [dish('Burgers', 27)],
    });

    expect(anomalyScan([job], [meat]).map((a) => a.reason)).toContain('mains_without_sides');
  });

  it('flags a menu with mains and no dessert', () => {
    const job = makeJob({
      guests: 27,
      serviceDate: isoDate('2026-07-22'),
      dishes: [dish('Burgers', 27), dish('Baps', 27)],
    });

    expect(anomalyScan([job], [meat, baps]).map((a) => a.reason)).toContain(
      'menu_without_dessert',
    );
  });

  it('does not flag a complete menu', () => {
    const job = makeJob({
      guests: 27,
      guestsConfirmed: true,
      serviceTime: '18:00' as never,
      serviceDate: isoDate('2026-07-22'),
      dishes: [dish('Burgers', 27), dish('Baps', 27), dish('Pavlova', 27)],
    });

    expect(anomalyScan([job], [meat, baps, pav])).toEqual([]);
  });
});

describe('anomalyScan — Rule 8 gaps and Rule 16', () => {
  const meat = makeRecipe('Burgers', { course: 'main' });
  const baps = makeRecipe('Baps', { course: 'side' });

  it('flags a job with no guest count', () => {
    const job = makeJob({ guests: null, serviceDate: isoDate('2026-07-22') });
    expect(anomalyScan([job], []).map((a) => a.reason)).toContain('no_guest_count');
  });

  it('flags a job with no menu', () => {
    const job = makeJob({ guests: 10, serviceDate: isoDate('2026-07-22'), dishes: [] });
    expect(anomalyScan([job], []).map((a) => a.reason)).toContain('no_menu');
  });

  it('flags a missing recipe', () => {
    const job = makeJob({
      guests: 10,
      serviceDate: isoDate('2026-07-22'),
      dishes: [dish('Ghost', 10)],
    });
    expect(anomalyScan([job], []).map((a) => a.reason)).toContain('missing_recipe');
  });

  it('skips cancelled jobs entirely', () => {
    const job = makeJob({ guests: null, status: 'cancelled', dishes: [] });
    expect(anomalyScan([job], [])).toEqual([]);
  });

  it('reports unallocated dietaries by distinct guest, never a count', () => {
    const job = makeJob({
      guests: 27,
      serviceDate: isoDate('2026-07-22'),
      dishes: [dish('Burgers', 27), dish('Baps', 27)],
      dietaries: [
        allocated('g1', { dietType: 'coeliac', assignedRecipeId: null }),
        allocated('g1', { dietType: 'vegetarian', assignedRecipeId: null }),
      ],
    });

    const found = anomalyScan([job], [meat, baps]);
    const dietary = found.find((a) => a.reason === 'unallocated_dietary');

    expect(dietary).toBeDefined();
    // One person, not two. "2 guests" would be the Rule 16 defect.
    expect(dietary?.guests).toEqual([guestRef('g1')]);
  });

  it('scans several jobs at once', () => {
    const a = makeJob({ id: jobId('a'), guests: null, serviceDate: isoDate('2026-07-22') });
    const b = makeJob({ id: jobId('b'), guests: null, serviceDate: isoDate('2026-07-23') });

    const found = anomalyScan([a, b], []);

    expect(new Set(found.map((x) => x.jobId)).size).toBe(2);
  });
});
