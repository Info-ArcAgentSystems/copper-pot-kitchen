/**
 * RULE 6 — shopping, prep and packing are DERIVED, never stored.
 *
 * This is the guard for the one rule on these screens that nothing else would
 * notice breaking. Every other rule fails loudly: a wrong quantity fails a golden
 * test, a missing gap fails the routing test. But storing the computed list "for
 * speed" would keep every test green and quietly kill the cascade — the list would
 * stop following the jobs, and the first anyone knew of it would be food bought
 * for a guest count that changed a week earlier.
 *
 * So the guard is structural, and deliberately blunt: a derived feature may write
 * exactly one thing, the owner's tick, and its view-model may do no arithmetic.
 *
 * Verified by inversion in both features — planting a write of a computed figure
 * and confirming this goes red. A guard that has never failed is a guard nobody
 * has checked.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/**
 * Every derived feature: the one table it may write, the one write method it may
 * call, and the engine functions its list must actually come from.
 *
 * Adding a derived screen means adding a row here. Packing will be the third, and
 * the failure mode is identical in all of them.
 */
const DERIVED = [
  {
    feature: 'shopping',
    tickTable: 'purchase_state',
    write: 'setBought',
    engine: ['requirementsForRange', 'outstandingShopping'],
    view: 'shoppingView.ts',
  },
  {
    feature: 'prep',
    tickTable: 'prep_state',
    write: 'setDone',
    engine: ['productionBuckets', 'prepPlanByDay'],
    view: 'prepView.ts',
  },
  {
    feature: 'packing',
    tickTable: 'packing_state',
    // Shares a method NAME with prep. They are different repositories, so the
    // entanglement check below compares tick TABLES rather than method names —
    // otherwise it would fire on a coincidence of naming rather than on anything
    // actually wrong.
    write: 'setDone',
    engine: ['applyBuffetSplit'],
    view: 'packingView.ts',
  },
] as const;

/** Persisting methods. None of these belongs on a screen with no record to save. */
const RECORD_WRITES = ['.save(', '.create(', '.remove(', '.update('];

/** Tables that would mean a computed list had been written down. */
const FORBIDDEN_TABLES = [
  'shopping_list',
  'shopping_lines',
  'prep_plan',
  'prep_lines',
  'requirements',
  'production_buckets',
];

const sourcesOf = (feature: string): { file: string; code: string }[] => {
  const dir = fileURLToPath(new URL(`../../src/features/${feature}`, import.meta.url));
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .map((file) => ({ file, code: strip(readFileSync(join(dir, file), 'utf8')) }));
};

const viewSource = (view: string): string =>
  strip(readFileSync(fileURLToPath(new URL(`../../src/ui/${view}`, import.meta.url)), 'utf8'));

describe.each(DERIVED)(
  'the $feature feature stores nothing but the tick',
  ({ feature, tickTable, write, engine, view }) => {
    const sources = () => sourcesOf(feature);

    it('has files to check', () => {
      // Without this, renaming or deleting the feature would make every test below
      // vacuously pass. A guard over an empty set guards nothing.
      expect(sources().length).toBeGreaterThan(0);
    });

    it(`calls no repository write except ${write}`, () => {
      for (const { file, code } of sources()) {
        for (const forbidden of RECORD_WRITES) {
          expect(code, `${file} calls ${forbidden} — the list must not be stored`).not.toContain(
            forbidden,
          );
        }
      }
    });

    it(`writes through ${write} on its own repository`, () => {
      const all = sources()
        .map((s) => s.code)
        .join('\n');

      expect(all, `${feature} must tick through ${write}`).toContain(write);

      // Entanglement is checked by REPOSITORY, not by method name: prep and
      // packing both call `setDone` on different repositories, and comparing
      // names would fire on that coincidence rather than on anything wrong.
      const ownRepository = `${feature === 'shopping' ? 'purchase' : feature}StateRepository`;
      expect(all, `${feature} must use ${ownRepository}`).toContain(ownRepository);

      for (const other of DERIVED) {
        if (other.feature === feature) continue;
        const otherRepository = `${other.feature === 'shopping' ? 'purchase' : other.feature}StateRepository`;
        expect(all, `${feature} uses ${otherRepository}`).not.toContain(otherRepository);
      }
    });

    it(`names no table that would hold a computed list`, () => {
      for (const { file, code } of sources()) {
        for (const table of FORBIDDEN_TABLES) {
          expect(code, `${file} references a "${table}" table`).not.toMatch(
            new RegExp(`['"]${table}['"]`),
          );
        }
        // And never the other feature's tick table either.
        for (const other of DERIVED) {
          if (other.tickTable === tickTable) continue;
          expect(code, `${file} references ${other.tickTable}`).not.toContain(other.tickTable);
        }
      }
    });

    it('touches no low-level write that could bypass the repository', () => {
      // Reading jobs, recipes, ingredients and so on is the whole point — that is
      // what the list is derived FROM. Writing around the repositories is not.
      for (const { file, code } of sources()) {
        for (const call of ['db.insert', 'db.upsert', 'db.rpc']) {
          expect(code, `${file} uses ${call} directly`).not.toContain(call);
        }
      }
    });

    it('recomputes from the engine rather than rendering something stored', () => {
      // The feature AND its view-model together. The derivation legitimately spans
      // both — Shopping and Prep call the engine in the component, Packing does it
      // in `packingView.ts` — and what matters is that the list comes from the
      // engine somewhere on that path, not which of the two files holds the call.
      const all = [...sources().map((s) => s.code), viewSource(view)].join('\n');

      // Without this, a screen could satisfy every "writes nothing" assertion above
      // by rendering a stored or hardcoded list and writing nothing at all.
      for (const fn of engine) {
        expect(all, `${feature}'s list must come from ${fn}`).toContain(fn);
      }
    });
  },
);

describe.each(DERIVED)('$view keeps no arithmetic of its own', ({ view }) => {
  const code = strip(
    readFileSync(fileURLToPath(new URL(`../../src/ui/${view}`, import.meta.url)), 'utf8'),
  );

  it.each([
    ['Math.ceil', 'rounding — batches and packs are rounded once, in the engine'],
    ['Math.floor', 'rounding'],
    ['Math.round', 'rounding'],
    ['Math.max', 'clamping — the engine already clamps'],
    ['toPurchaseUnits', 'pack maths'],
    ['stockToPacks', 'pack conversion'],
    ['recipeToStock', 'unit conversion'],
    ['portionsToUnits', 'batch maths'],
  ])('contains no %s (%s)', (token) => {
    expect(code).not.toContain(token);
  });

  it('performs no subtraction of its own', () => {
    // A second subtraction is a second answer, free to disagree with the engine's.
    // Rule 5 permits exactly one implementation of each step — and the way this
    // fails is quiet: 39 portions is 5 trays consolidated but 6 if each job's
    // share is rounded separately.
    expect(code).not.toMatch(/\.value\s*-\s*/);
    expect(code).not.toMatch(/required[^\n]*-[^\n]*onHand/);
    expect(code).not.toMatch(/capacity[^\n]*-[^\n]*(required|portions)/);
  });
});
