/**
 * The plain-text shopping list.
 *
 * PURE, so the format is pinned in Node with no DOM and no clipboard. What ends up
 * in WhatsApp is what this returns; the only untested part of the export is the
 * one-line clipboard call in the component.
 *
 * The rule that governs the format: this is the version that leaves the app. If a
 * caveat is dropped on the way out — an unquantified item, an unreconciled stock
 * signal, an assumed pack size — the owner is standing in a supermarket with a
 * list that reads as complete and is not.
 */

import { describe, expect, it } from 'vitest';
import { shoppingText } from '../../src/ui/shoppingView';
import type { ShoppingView } from '../../src/ui/shoppingView';

const view = (over: Partial<ShoppingView> = {}): ShoppingView => ({
  groups: [],
  checkYourself: [],
  needsFixing: [],
  surplus: [],
  nothingToBuy: true,
  ...over,
});

const withLines = () =>
  view({
    nothingToBuy: false,
    groups: [
      {
        supplierName: 'Musgrave',
        lines: [
          {
            ingredientId: 'mince' as never,
            name: 'mince',
            buy: '2 × 1 kg',
            outstanding: '1.9 kg',
            workings: 'need 2.4 kg · 0.5 kg in stock · 0 kg bought · buy 1.9 kg',
            note: null,
          },
        ],
      },
    ],
  });

describe('the list itself', () => {
  it('heads each supplier and leads each line with what to buy', () => {
    const text = shoppingText(withLines(), '2026-08-10', '2026-08-17');

    expect(text).toContain('Musgrave');
    expect(text).toContain('2 × 1 kg');
    expect(text).toContain('mince');
  });

  it('names the window, because a list without dates is a list you cannot trust twice', () => {
    const text = shoppingText(withLines(), '2026-08-10', '2026-08-17');

    expect(text).toContain('2026-08-10');
    expect(text).toContain('2026-08-17');
  });

  it('says so plainly when there is nothing to buy', () => {
    const text = shoppingText(view(), '2026-08-10', '2026-08-17');
    expect(text.toLowerCase()).toContain('nothing to buy');
  });

  it('NEVER writes a quantity of 0 — an empty list is a sentence, not a zero', () => {
    const text = shoppingText(view(), '2026-08-10', '2026-08-17');
    expect(text).not.toMatch(/\b0\b/);
  });
});

describe('the caveats survive the export', () => {
  it('carries a line note — an assumed pack size reaches the shop', () => {
    const source = withLines();
    const text = shoppingText(
      {
        ...source,
        groups: [
          {
            supplierName: 'Musgrave',
            lines: [{ ...source.groups[0]!.lines[0]!, note: 'pack size is assumed, not confirmed' }],
          },
        ],
      },
      '2026-08-10',
      '2026-08-17',
    );

    expect(text).toContain('assumed');
  });

  it('carries the check-these-yourself section', () => {
    const text = shoppingText(
      view({ checkYourself: [{ label: 'Tapas: "seasoning" has no quantity', why: 'Judge it yourself.' }] }),
      '2026-08-10',
      '2026-08-17',
    );

    expect(text).toContain('CHECK THESE YOURSELF');
    expect(text).toContain('seasoning');
  });

  it('carries the needs-fixing section', () => {
    const text = shoppingText(
      view({ needsFixing: [{ label: 'mince: no pack size set', where: 'Ingredients' }] }),
      '2026-08-10',
      '2026-08-17',
    );

    expect(text).toContain('mince: no pack size set');
  });

  it('THE GUARD: a list with nothing to buy but something to check is NOT "nothing to buy"', () => {
    // The dangerous case. Every quantity is covered, but an unquantified item is
    // outstanding — exporting a bare "nothing to buy" would send him home empty
    // handed with an item he still has to judge.
    const text = shoppingText(
      view({ checkYourself: [{ label: 'Tapas: "seasoning" has no quantity', why: 'Judge it.' }] }),
      '2026-08-10',
      '2026-08-17',
    );

    expect(text).toContain('seasoning');
    expect(text).toContain('CHECK THESE YOURSELF');
  });

  it('omits a section that has nothing in it, rather than printing an empty heading', () => {
    const text = shoppingText(withLines(), '2026-08-10', '2026-08-17');

    expect(text).not.toContain('CHECK THESE YOURSELF');
    expect(text).not.toContain('NEEDS FIXING');
  });
});
