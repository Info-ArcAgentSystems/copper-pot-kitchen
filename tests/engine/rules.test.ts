/**
 * Rule 16 — the meat-eating guest count.
 *
 * This is the one place in the engine that turns dietaries into a headcount, and
 * the only place allowed to subtract anything from a guest count. Written before
 * the implementation, per CLAUDE.md section 5.
 *
 * The defect this guards against: a guest who is both vegan and coeliac being
 * counted twice, so meat portions are under-ordered.
 */

import { describe, expect, it } from 'vitest';
import { applyBuffetSplit, meatEatingGuests } from '../../src/engine/rules';
import { portionsToUnits } from '../../src/engine/scaling';
import { allocated, dish, makeJob, makeRecipe, unresolved } from './factories';

const noMeat = { excludesMeat: true } as const;

describe('meatEatingGuests', () => {
  it("returns the owner's figure when set, ignoring the dietaries entirely", () => {
    const job = makeJob({
      guests: 27,
      meatEatingGuests: 22,
      // Deliberately inconsistent with 22. The owner's number still wins.
      dietaries: [allocated('g1', noMeat)],
    });

    expect(meatEatingGuests(job)).toBe(22);
  });

  it('derives 22 from 27 guests and 5 distinct meat-excluding guests', () => {
    // The CALC-NUCELLA-BBQ-SPLIT shape: 4 salmon vegetarians + 1 vegan.
    const job = makeJob({
      guests: 27,
      meatEatingGuests: null,
      dietaries: [
        allocated('g1', noMeat),
        allocated('g2', noMeat),
        allocated('g3', noMeat),
        allocated('g4', noMeat),
        allocated('g5', noMeat),
      ],
    });

    expect(meatEatingGuests(job)).toBe(22);
  });

  it('counts a guest with TWO requirements once, not twice', () => {
    // The Rule 16 defect in miniature. Summing categories would give 24.
    const job = makeJob({
      guests: 27,
      meatEatingGuests: null,
      dietaries: [
        allocated('g1', { ...noMeat, dietType: 'vegan' }),
        allocated('g1', { ...noMeat, dietType: 'coeliac' }),
        allocated('g2', { ...noMeat, dietType: 'vegan' }),
      ],
    });

    expect(meatEatingGuests(job)).toBe(25);
  });

  it('ignores dietaries that do not exclude meat', () => {
    const job = makeJob({
      guests: 10,
      meatEatingGuests: null,
      dietaries: [
        allocated('g1', { excludesMeat: false, dietType: 'nut allergy' }),
        allocated('g2', noMeat),
      ],
    });

    expect(meatEatingGuests(job)).toBe(9);
  });

  it('returns null when ANY dietary is unresolved (Rules 8 and 12)', () => {
    const job = makeJob({
      guests: 27,
      meatEatingGuests: null,
      dietaries: [
        allocated('g1', noMeat),
        unresolved('a few vegetarians', noMeat),
      ],
    });

    // 26 would be the plausible wrong answer: it treats "a few" as zero.
    expect(meatEatingGuests(job)).toBeNull();
  });

  it("returns the owner's figure even when a dietary is unresolved", () => {
    const job = makeJob({
      guests: 27,
      meatEatingGuests: 22,
      dietaries: [unresolved('a few vegetarians', noMeat)],
    });

    expect(meatEatingGuests(job)).toBe(22);
  });

  it('returns null when the guest count is unknown', () => {
    const job = makeJob({
      guests: null,
      meatEatingGuests: null,
      dietaries: [allocated('g1', noMeat)],
    });

    expect(meatEatingGuests(job)).toBeNull();
  });

  it('returns the full guest count when there are no dietaries', () => {
    expect(meatEatingGuests(makeJob({ guests: 12 }))).toBe(12);
  });

  it('never returns a negative count', () => {
    // More meat-excluding guests recorded than guests. Data is wrong, but the
    // engine must not hand back a negative headcount.
    const job = makeJob({
      guests: 2,
      meatEatingGuests: null,
      dietaries: [allocated('g1', noMeat), allocated('g2', noMeat), allocated('g3', noMeat)],
    });

    expect(meatEatingGuests(job)).toBe(0);
  });
});

/**
 * applyBuffetSplit.
 *
 * CLAUDE.md section 3: "where a buffet has several mains or several desserts,
 * guests divide evenly across them. 17 across curry + lasagne = 9 and 8. Sides and
 * single-dish courses take the full guest count."
 *
 * This is not cosmetic. The split feeds batch consolidation, so getting it wrong
 * doubles the lasagne production and the mince order — see THE BITING CASE below.
 */

const curry = makeRecipe('Curry', { course: 'main', yieldType: 'per_person' });
const lasagne = makeRecipe('Lasagne', {
  course: 'main',
  yieldType: 'batch',
  portionsPerBatch: 9,
});
const pavlova = makeRecipe('Pavlova', { course: 'dessert' });
const brownies = makeRecipe('Brownies', { course: 'dessert' });
const wedges = makeRecipe('Wedges', { course: 'side' });
const slaw = makeRecipe('Slaw', { course: 'side' });
const fullIrish = makeRecipe('Full Irish', { course: 'breakfast' });
const pancakes = makeRecipe('Pancakes', { course: 'breakfast' });
const uncoursed = makeRecipe('Mystery', { course: null });

const portionsOf = (result: readonly { recipeId: string; portions: number | null }[], name: string) =>
  result.find((d) => d.recipeId === name)?.portions;

describe('applyBuffetSplit', () => {
  it('THE CANONICAL CASE: 17 guests across curry + lasagne is 9 and 8', () => {
    const out = applyBuffetSplit(
      17,
      [dish('Curry', null), dish('Lasagne', null)],
      [curry, lasagne],
    );

    expect(portionsOf(out, 'Curry')).toBe(9);
    expect(portionsOf(out, 'Lasagne')).toBe(8);
    expect(out.reduce((n, d) => n + (d.portions ?? 0), 0)).toBe(17);
  });

  it('THE BITING CASE: the split changes the tray count downstream', () => {
    const out = applyBuffetSplit(
      17,
      [dish('Curry', null), dish('Lasagne', null)],
      [curry, lasagne],
    );

    // Lasagne gets 8 -> ONE tray. The wrong full-17 would need two.
    expect(portionsToUnits(portionsOf(out, 'Lasagne') ?? 0, 9)?.batches).toBe(1);
    expect(portionsToUnits(17, 9)?.batches).toBe(2);
  });

  it('gives a single main the full guest count', () => {
    const out = applyBuffetSplit(17, [dish('Curry', null)], [curry]);
    expect(portionsOf(out, 'Curry')).toBe(17);
  });

  it('splits three mains as 6, 6, 5 and still totals the guest count', () => {
    const third = makeRecipe('Chickpea', { course: 'main' });
    const out = applyBuffetSplit(
      17,
      [dish('Curry', null), dish('Lasagne', null), dish('Chickpea', null)],
      [curry, lasagne, third],
    );

    expect(out.map((d) => d.portions)).toEqual([6, 6, 5]);
    expect(out.reduce((n, d) => n + (d.portions ?? 0), 0)).toBe(17);
  });

  it('splits desserts the same way', () => {
    const out = applyBuffetSplit(
      17,
      [dish('Pavlova', null), dish('Brownies', null)],
      [pavlova, brownies],
    );

    expect(out.map((d) => d.portions)).toEqual([9, 8]);
  });

  it('splits mains and desserts independently, not against each other', () => {
    const out = applyBuffetSplit(
      17,
      [dish('Curry', null), dish('Lasagne', null), dish('Pavlova', null), dish('Brownies', null)],
      [curry, lasagne, pavlova, brownies],
    );

    expect(portionsOf(out, 'Curry')).toBe(9);
    expect(portionsOf(out, 'Lasagne')).toBe(8);
    expect(portionsOf(out, 'Pavlova')).toBe(9);
    expect(portionsOf(out, 'Brownies')).toBe(8);
  });

  it('gives EVERY side the full guest count, however many there are', () => {
    // The BBQ rule: baps, corn, potatoes and slaw each feed everyone.
    const out = applyBuffetSplit(
      27,
      [dish('Wedges', null), dish('Slaw', null)],
      [wedges, slaw],
    );

    expect(out.map((d) => d.portions)).toEqual([27, 27]);
  });

  it('assigns the remainder by position, deterministically', () => {
    const forward = applyBuffetSplit(
      19,
      [dish('Curry', null), dish('Lasagne', null)],
      [curry, lasagne],
    );
    expect(forward.map((d) => d.portions)).toEqual([10, 9]);
  });

  it('and that ordering has real downstream consequences', () => {
    // Batch dish SECOND gets 9 -> one tray.
    const second = applyBuffetSplit(
      19,
      [dish('Curry', null), dish('Lasagne', null)],
      [curry, lasagne],
    );
    expect(portionsToUnits(portionsOf(second, 'Lasagne') ?? 0, 9)?.batches).toBe(1);

    // Batch dish FIRST gets 10 -> two trays. Same guests, different production.
    const first = applyBuffetSplit(
      19,
      [dish('Lasagne', null), dish('Curry', null)],
      [curry, lasagne],
    );
    expect(portionsToUnits(portionsOf(first, 'Lasagne') ?? 0, 9)?.batches).toBe(2);
  });

  it("never overrides the owner's explicit portions", () => {
    const out = applyBuffetSplit(
      17,
      [dish('Curry', 12), dish('Lasagne', null)],
      [curry, lasagne],
    );

    expect(portionsOf(out, 'Curry')).toBe(12);
    expect(portionsOf(out, 'Lasagne')).toBe(8);
  });

  it('leaves breakfast alone — an owner-recorded choice, not a division', () => {
    // CALC-SWEETPEA-BREAKFAST is 12 guests at 5 / 3 / 4. An even split would say
    // 6 and 6 for two options, and 4/4/4 for three. Both would be wrong.
    const out = applyBuffetSplit(
      12,
      [dish('Full Irish', null), dish('Pancakes', null)],
      [fullIrish, pancakes],
    );

    expect(out.map((d) => d.portions)).toEqual([null, null]);
  });

  it('leaves an uncoursed dish alone rather than guessing', () => {
    const out = applyBuffetSplit(17, [dish('Mystery', null)], [uncoursed]);
    expect(portionsOf(out, 'Mystery')).toBeNull();
  });

  it('leaves a dish with no recipe record alone', () => {
    const out = applyBuffetSplit(17, [dish('Ghost', null)], []);
    expect(portionsOf(out, 'Ghost')).toBeNull();
  });

  it('handles zero guests without inventing portions', () => {
    const out = applyBuffetSplit(0, [dish('Curry', null), dish('Lasagne', null)], [curry, lasagne]);
    expect(out.map((d) => d.portions)).toEqual([0, 0]);
  });

  it('does not mutate the dishes it is given', () => {
    const dishes = [dish('Curry', null), dish('Lasagne', null)];
    applyBuffetSplit(17, dishes, [curry, lasagne]);

    expect(dishes.map((d) => d.portions)).toEqual([null, null]);
  });
});
