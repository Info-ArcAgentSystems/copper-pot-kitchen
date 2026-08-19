/**
 * Sous answers, as sentences.
 *
 * PURE, so it runs in Node with no DOM. The screen used to render
 * `JSON.stringify(result)`; this is what replaced it.
 *
 * Two things are pinned throughout: the wording a person actually reads, and that
 * every figure in it came from the engine already formatted. A renderer that
 * reached past the formatter and rounded something itself would be a second
 * answer, free to disagree with the screen showing the same data.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderAnswer } from '../../src/ui/sousAnswer';
import type { HowMuch, SousData, ToolResult } from '../../src/sous/tools';
import type {
  Cents,
  IngredientId,
  PurchaseUnit,
  StockUnit,
} from '../../src/engine/types';

const kg = 'kg' as StockUnit;

const data: SousData = {
  jobs: [],
  recipes: [],
  ingredients: [],
  customers: [],
  rates: [],
  stock: [],
  templates: [],
  today: '2026-08-20',
  horizon: '2026-08-27',
};

const line = (over: Record<string, unknown> = {}) => ({
  ingredientId: 'adobo' as IngredientId,
  name: 'adobo',
  required: { value: 3.15, unit: kg },
  onHand: { value: 0, unit: kg },
  purchased: { value: 0, unit: kg },
  outstanding: { value: 3.15, unit: kg },
  surplus: null,
  packs: { packs: 4, overage: { value: 0.85, unit: kg } },
  unreconciled: 0,
  ...over,
});

const howMuch = (v: HowMuch): ToolResult => ({ kind: 'how_much', value: v });

const needed = (over: Record<string, unknown> = {}): HowMuch =>
  ({
    state: 'needed',
    name: 'adobo',
    from: '2026-08-20',
    to: '2026-08-27',
    line: line(),
    pack: { size: 1, unit: 'kg' as PurchaseUnit, assumed: false },
    ...over,
  }) as HowMuch;

describe('"how much X do I need" — the question that started this', () => {
  it('answers with a quantity and the packs to buy', () => {
    // The whole point. This used to return {from, to, anomalies}.
    const answer = renderAnswer(howMuch(needed()), data);

    expect(answer.lead).toContain('3.15 kg');
    expect(answer.lead).toContain('adobo');
    expect(answer.lead).toContain('4 × 1 kg');
  });

  it('STATES THE WINDOW it answered for, even when it names packs', () => {
    // When he asked no dates, the window is a default he never chose. A figure
    // that does not say what it covers is a figure he cannot check — a week's
    // adobo and a month's adobo read identically otherwise.
    const answer = renderAnswer(howMuch(needed()), data);

    expect(answer.lead).toContain('between 2026-08-20 and 2026-08-27');
    expect(answer.lead).toContain('4 × 1 kg');
    expect(answer.lead).not.toMatch(/which dates|specify/i);
  });

  it('SAYS SO when nothing in the window needs it', () => {
    // Rule 8, and the exact failure reported: a zero requirement is a real answer
    // and must be stated, not swapped for an unrelated object.
    const answer = renderAnswer(
      howMuch({ state: 'none_needed', name: 'adobo', from: '2026-08-20', to: '2026-08-27' }),
      data,
    );

    expect(answer.lead).toContain('No adobo needed');
    expect(answer.lead).toContain('2026-08-20');
    expect(answer.lead).not.toContain('anomal');
  });

  it('distinguishes "no such ingredient" from "none needed"', () => {
    // Different problems with different fixes. Blurring them sends him looking in
    // the wrong place.
    const answer = renderAnswer(howMuch({ state: 'no_such_ingredient', asked: 'adobo' }), data);

    expect(answer.lead).toContain('no ingredient called');
    expect(answer.detail.join(' ')).toContain('Ingredients');
  });

  it('NAMES the candidates when several match, and picks none', () => {
    // A guess about which ingredient he meant is a wrong shopping quantity.
    const answer = renderAnswer(
      howMuch({ state: 'ambiguous', asked: 'chicken', matches: ['chicken breast', 'chicken thigh'] }),
      data,
    );

    expect(answer.detail).toEqual(['chicken breast', 'chicken thigh']);
    expect(answer.lead).toContain('More than one');
  });

  it('says he has enough rather than "buy 0"', () => {
    const answer = renderAnswer(
      howMuch(needed({ line: line({ outstanding: { value: 0, unit: kg }, onHand: { value: 4, unit: kg } }) })),
      data,
    );

    expect(answer.lead).toContain('enough');
    expect(answer.lead).not.toMatch(/\b0 kg\b/);
  });

  it('states the quantity when there is no pack size, rather than dropping it', () => {
    const answer = renderAnswer(howMuch(needed({ line: line({ packs: null }), pack: null })), data);

    expect(answer.lead).toContain('3.15 kg');
    expect(answer.flags.join(' ')).toContain('No pack size');
  });

  it('warns that an unreconciled figure may be TOO HIGH, not too low', () => {
    // Direction matters: unconverted stock was left out of the subtraction, so the
    // figure over-states. The wrong direction sends him buying more.
    const answer = renderAnswer(howMuch(needed({ line: line({ unreconciled: 1 }) })), data);

    expect(answer.flags.join(' ')).toContain('more than you actually need');
  });

  it('surfaces an assumed pack size, since it makes the pack count wrong', () => {
    const answer = renderAnswer(
      howMuch(needed({ pack: { size: 1, unit: 'kg' as PurchaseUnit, assumed: true } })),
      data,
    );

    expect(answer.flags.join(' ')).toContain('assumed');
  });
});

describe('money reads as a sentence, with nulls intact', () => {
  const money = (over: Record<string, unknown> = {}): ToolResult =>
    ({
      kind: 'money',
      value: {
        from: '2026-08-01',
        to: '2026-08-31',
        total: {
          jobs: 2,
          revenue: { total: 90000 as Cents, priced: 2, unpriced: 0 },
          foodCost: { total: 2700 as Cents, costed: 2, uncosted: 0 },
          margin: { total: 87300 as Cents, withMargin: 2, withoutMargin: 0 },
          cancelled: { jobs: 0, revenue: { total: null, priced: 0, unpriced: 0 } },
          missing: [],
          ...over,
        },
      },
    }) as ToolResult;

  it('leads with the figures', () => {
    const answer = renderAnswer(money(), data);

    expect(answer.lead).toContain('€900.00');
    expect(answer.lead).toContain('€27.00');
  });

  it('RULE 8: an unknown reads as words, never €0.00', () => {
    const answer = renderAnswer(
      money({ revenue: { total: null, priced: 0, unpriced: 2 }, margin: { total: null, withMargin: 0, withoutMargin: 2 } }),
      data,
    );

    expect(answer.lead).toContain('not known');
    expect(answer.lead).not.toContain('€0.00');
  });

  it('RULE 11: says what a subtotal does not cover', () => {
    const answer = renderAnswer(
      money({ revenue: { total: 30000 as Cents, priced: 1, unpriced: 1 } }),
      data,
    );

    expect(answer.flags.join(' ')).toContain('could not be priced');
  });
});

describe('clarify returns a question, never a fact', () => {
  it('renders the question as the answer', () => {
    const answer = renderAnswer(
      { kind: 'clarify', value: { question: 'Which Saturday did you mean?' } },
      data,
    );

    expect(answer.lead).toBe('Which Saturday did you mean?');
    expect(answer.detail).toEqual([]);
  });
});

describe('a proposal says nothing is saved yet', () => {
  it('states the confirmation requirement in the answer itself', () => {
    const answer = renderAnswer(
      { kind: 'proposal', value: { jobId: 'j1', changes: {}, impact: {}, after: {} } } as never,
      data,
    );

    expect(answer.lead.toLowerCase()).toContain('confirm');
  });
});

describe('the renderer computes nothing', () => {
  const code = readFileSync(
    fileURLToPath(new URL('../../src/ui/sousAnswer.ts', import.meta.url)),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it.each(['Math.round', 'Math.ceil', 'Math.floor', 'Math.max', 'toFixed'])(
    'contains no %s',
    (token) => {
      expect(code).not.toContain(token);
    },
  );

  it('does no subtraction or division of its own', () => {
    // Every figure arrives computed. A total re-derived here would be a second
    // answer, free to disagree with the screen showing the same data.
    expect(code).not.toMatch(/\.value\s*[-/*]\s*/);
    expect(code).not.toMatch(/reduce\(/);
  });
});
