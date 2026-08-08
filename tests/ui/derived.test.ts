/**
 * RULE 6 — shopping, prep and packing are DERIVED, never stored.
 *
 * This is the guard for the one rule on the shopping screen that nothing else
 * would notice breaking. Every other rule fails loudly: a wrong quantity fails a
 * golden test, a missing gap fails the routing test. But storing the computed list
 * "for speed" would keep every test green and quietly kill the cascade — the list
 * would stop following the jobs, and the first anyone knew of it would be food
 * bought for a guest count that changed a week earlier.
 *
 * So the guard is structural, and it is deliberately blunt: the shopping feature
 * may write exactly one thing, the owner's tick, and the view-model may do no
 * arithmetic of its own.
 *
 * Verified by inversion — planting a write of a computed line and confirming this
 * goes red. A guard that has never failed is a guard nobody has checked.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const SHOPPING_DIR = fileURLToPath(new URL('../../src/features/shopping', import.meta.url));

const shoppingSources = (): { file: string; code: string }[] =>
  readdirSync(SHOPPING_DIR)
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .map((file) => ({ file, code: strip(readFileSync(join(SHOPPING_DIR, file), 'utf8')) }));

describe('the shopping feature stores nothing but the tick', () => {
  it('has files to check', () => {
    // Without this, deleting the feature would make every test below vacuously
    // pass. A guard over an empty set guards nothing.
    expect(shoppingSources().length).toBeGreaterThan(0);
  });

  it('calls no repository write except setBought', () => {
    // `save`, `create`, `update` and `remove` all persist a record. On a derived
    // screen there is no record to persist — only the tick, which is `setBought`.
    for (const { file, code } of shoppingSources()) {
      for (const forbidden of ['.save(', '.create(', '.remove(', '.update(']) {
        expect(code, `${file} calls ${forbidden} — the list must not be stored`).not.toContain(
          forbidden,
        );
      }
    }
  });

  it('names no table but purchase_state', () => {
    for (const { file, code } of shoppingSources()) {
      for (const table of ['shopping', 'shopping_list', 'shopping_lines', 'requirements']) {
        expect(code, `${file} references a "${table}" table`).not.toMatch(
          new RegExp(`['"]${table}['"]`),
        );
      }
    }
  });

  it('touches no repository that could write a computed figure', () => {
    // Reading jobs, recipes, ingredients, stock and suppliers is the whole point —
    // that is what the list is derived FROM. Writing through them is not.
    for (const { file, code } of shoppingSources()) {
      expect(code, `${file} uses db.insert directly`).not.toContain('db.insert');
      expect(code, `${file} uses db.upsert directly`).not.toContain('db.upsert');
      expect(code, `${file} uses db.rpc directly`).not.toContain('db.rpc');
    }
  });

  it('recomputes from the engine rather than reading a stored list', () => {
    const all = shoppingSources()
      .map((s) => s.code)
      .join('\n');

    expect(all, 'the list must come from the engine').toContain('requirementsForRange');
    expect(all, 'outstanding must come from the engine').toContain('outstandingShopping');
  });
});

describe('shoppingView.ts keeps no arithmetic of its own', () => {
  const code = strip(
    readFileSync(fileURLToPath(new URL('../../src/ui/shoppingView.ts', import.meta.url)), 'utf8'),
  );

  it.each([
    ['Math.ceil', 'rounding — packs are rounded once, in units.ts'],
    ['Math.floor', 'rounding'],
    ['Math.max', 'clamping — outstandingShopping already clamps at zero'],
    ['toPurchaseUnits', 'pack maths'],
    ['stockToPacks', 'pack conversion'],
    ['recipeToStock', 'unit conversion'],
  ])('contains no %s (%s)', (token) => {
    expect(code).not.toContain(token);
  });

  it('never subtracts stock from required — that is outstandingShopping’s job', () => {
    // A second subtraction here is a second answer, free to disagree with the
    // engine's. Rule 5 permits exactly one implementation of each step.
    expect(code).not.toMatch(/required[^\n]*-[^\n]*onHand/);
    expect(code).not.toMatch(/\.value\s*-\s*/);
  });
});
