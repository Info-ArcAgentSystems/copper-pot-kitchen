/**
 * The golden regression pack — system behaviour tests.
 *
 * Two of the four `system_behavior_tests` map onto the engine as it exists and run
 * for real. The other two need layers that are not built, and are `it.todo` with
 * the reason in the title so they stay visible in every run rather than being
 * quietly dropped.
 */

import { describe, expect, it } from 'vitest';
import expectedJson from '../fixtures/expected_results.json' with { type: 'json' };
import { changeImpact } from '../../src/engine/impact';
import { meatEatingGuests } from '../../src/engine/rules';
import { allergenScan } from '../../src/engine/checks';
import { goldenIngredients, goldenJob, goldenRecipes } from './adapter';
import type { JobDietary, JobId, RecipeId } from '../../src/engine/types';

const behaviours = (expectedJson as unknown as {
  system_behavior_tests: { id: string; given: string; expected: string }[];
}).system_behavior_tests;

const behaviour = (id: string) => {
  const found = behaviours.find((b) => b.id === id);
  if (found === undefined) throw new Error(`golden pack has no behaviour case "${id}"`);
  return found;
};

const recipes = goldenRecipes();
const ingredients = goldenIngredients(recipes);

describe('UNCERTAINTY-NO-GUESSING', () => {
  const spec = behaviour('UNCERTAINTY-NO-GUESSING');

  it(`retains the uncertainty and blocks exact quantities — ${spec.given}`, () => {
    // The CHANGE-UNCONFIRMED-DIETARY-COUNT case: "a few vegetarians" plus one
    // coeliac, with the vegetarian count unconfirmed.
    const base = goldenJob('HIST-2026-07-22-NUCELLA-BBQ');
    const unresolved: JobDietary = {
      kind: 'unresolved',
      id: 'golden-unresolved' as JobDietary['id'],
      jobId: base.id,
      dietType: 'vegetarian',
      severity: 'moderate',
      excludesMeat: true,
      details: null,
      assignedRecipeId: null,
      originalWording: 'a few vegetarians',
    };

    const job = {
      ...base,
      meatEatingGuests: null,
      dietaries: [...base.dietaries, unresolved],
    };

    // The wording is kept verbatim, never parsed into a number.
    expect(unresolved.originalWording).toBe('a few vegetarians');

    // And it blocks the exact count rather than reading "a few" as zero.
    expect(meatEatingGuests(job)).toBeNull();

    // It also surfaces for review rather than sitting silently in the record.
    const scan = allergenScan(job, recipes, ingredients);
    expect(scan.findings.map((f) => f.reason)).toContain('unresolved_requirement');
  });
});

describe('DOWNSTREAM-RECALC', () => {
  const spec = behaviour('DOWNSTREAM-RECALC');

  it(`recalculates the cascade from the updated job — ${spec.given}`, () => {
    // Lasagne at 9 portions per tray, portions unallocated so the guest count
    // drives them.
    const base = goldenJob('HIST-2026-07-20-NUCELLA-BUFFET');
    const job = {
      ...base,
      id: 'recalc' as JobId,
      guests: 18,
      dishes: [
        {
          id: 'recalc-dish' as (typeof base.dishes)[number]['id'],
          jobId: 'recalc' as JobId,
          recipeId: 'Lasagne' as RecipeId,
          portions: null,
          note: null,
          position: 0,
        },
      ],
      dietaries: [],
    };

    const impact = changeImpact([job], recipes, ingredients, job.id, { guests: 23 });

    // 18 guests -> 2 trays; 23 -> 3. Ingredients follow the trays, not the guests.
    const batch = impact.batches.find((b) => b.recipeName === 'Lasagne');
    expect(batch?.batches?.before).toBe(2);
    expect(batch?.batches?.after).toBe(3);

    const mince = impact.ingredients.find((i) => i.name === 'mince');
    expect(mince?.required.before).toBe(4);
    expect(mince?.required.after).toBe(6);
    expect(mince?.required.delta).toBe(2);
  });
});

describe('AUDIT-CHANGE-HISTORY', () => {
  // CHANGE-VISIT-CARLINGFORD-EIRCODE: an eircode corrected after entry, with the
  // prior value still traceable. Rules 10 and 14 put that in `job_changes`, which
  // is a data-layer concern — the engine never writes.
  it.todo('eircode correction leaves an audit trail — needs src/data and job_changes');
});

describe('ASK-SOUS-NO-HALLUCINATION', () => {
  // Rule 2: code calculates, the model phrases. Cannot be tested until the tool
  // layer in src/sous exists.
  it.todo('Ask Sous answers only from engine output — needs src/sous');
});
