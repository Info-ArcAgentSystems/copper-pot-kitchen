/**
 * Form parsing and validation.
 *
 * Runs in plain Node — no DOM, no new dependency. The logic lives in pure
 * functions precisely so this is possible; the components stay thin.
 *
 * The defect guarded here is the one Rule 8 exists for: a blank field becoming
 * 0 or ''. An unpriced rate is not a free one, and a job under it has null
 * revenue rather than a €0 total.
 */

import { describe, expect, it } from 'vitest';
import {
  byName,
  deleteWarning,
  formatMoney,
  moneyValue,
  parseCount,
  parseMoney,
  parseText,
  parseQuantity,
  requireText,
  textValue,
} from '../../src/ui/form';
import type { Cents } from '../../src/engine/types';

const c = (n: number): Cents => n as Cents;

describe('text', () => {
  it('trims', () => {
    expect(parseText('  Nucella Lodge  ')).toBe('Nucella Lodge');
  });

  it('is null when blank, never an empty string', () => {
    expect(parseText('')).toBeNull();
    expect(parseText('   ')).toBeNull();
  });

  it('requires a value only where asked', () => {
    expect(requireText('', 'Name')).toBe('Name is required');
    expect(requireText('   ', 'Name')).toBe('Name is required');
    expect(requireText('Paul', 'Name')).toBeNull();
  });

  it('renders null as an empty input, not the word null', () => {
    expect(textValue(null)).toBe('');
    expect(textValue('x')).toBe('x');
  });
});

describe('money — Rule 8', () => {
  it('THE GUARD: blank is null, not zero', () => {
    // Zero euros is a real price meaning free. Blank means the owner has not
    // said. Collapsing them makes an unpriced rate look like a free service.
    expect(parseMoney('').cents).toBeNull();
    expect(parseMoney('   ').cents).toBeNull();
    expect(parseMoney('').cents).not.toBe(0);
  });

  it('keeps zero as a real value, distinct from blank', () => {
    expect(parseMoney('0').cents).toBe(0);
  });

  it('parses euros into whole cents', () => {
    expect(parseMoney('20').cents).toBe(2000);
    expect(parseMoney('20.15').cents).toBe(2015);
    expect(parseMoney('0.01').cents).toBe(1);
  });

  it('tolerates what someone actually types on a phone', () => {
    expect(parseMoney('€20').cents).toBe(2000);
    expect(parseMoney(' 20.50 ').cents).toBe(2050);
    expect(parseMoney('1,250').cents).toBe(125000);
  });

  it('rejects nonsense with a message rather than silently becoming null', () => {
    const bad = parseMoney('abc');
    expect(bad.cents).toBeNull();
    expect(bad.error).not.toBeNull();
  });

  it('rejects a negative price', () => {
    expect(parseMoney('-5').error).toBe('Cannot be negative');
  });

  it('round-trips through the input value', () => {
    for (const input of ['20', '18.5', '0.01', '1250']) {
      expect(moneyValue(parseMoney(input).cents)).toBe(String(Number(input)));
    }
  });

  it('shows an empty input for an unknown price', () => {
    expect(moneyValue(null)).toBe('');
  });

  it('DISPLAYS unknown as a stated absence, never as €0.00', () => {
    expect(formatMoney(null)).toBe('not set');
    expect(formatMoney(null)).not.toContain('0.00');
    expect(formatMoney(c(0))).toBe('€0.00');
    expect(formatMoney(c(2000))).toBe('€20.00');
  });

  it('lets the caller word the absence for its own screen', () => {
    expect(formatMoney(null, 'no rate set')).toBe('no rate set');
  });
});

describe('counts', () => {
  it('is null when blank — a guest count is never guessed', () => {
    expect(parseCount('').value).toBeNull();
  });

  it('accepts whole numbers only', () => {
    expect(parseCount('17').value).toBe(17);
    expect(parseCount('17.5').error).toBe('Enter a whole number');
  });

  it('rejects negatives', () => {
    expect(parseCount('-1').error).toBe('Cannot be negative');
  });
});

describe('sorting', () => {
  it('sorts case-insensitively, so lowercase does not land after uppercase', () => {
    const names = [{ n: 'Zest' }, { n: 'apples' }, { n: 'Bakery' }];
    expect(names.sort(byName((x) => x.n)).map((x) => x.n)).toEqual([
      'apples',
      'Bakery',
      'Zest',
    ]);
  });
});

describe('delete warnings', () => {
  it('says plainly when nothing refers to the record', () => {
    expect(deleteWarning('customer', [])).toContain('Nothing else refers to it');
    expect(deleteWarning('customer', [{ label: 'job', count: 0 }])).toContain(
      'Nothing else refers to it',
    );
  });

  it('NAMES the consequence rather than asking the owner to guess', () => {
    // `on delete set null`: those jobs keep existing and lose their customer,
    // which under Rule 11 leaves them with no client group and no rate.
    const warning = deleteWarning('customer', [{ label: 'job', count: 3 }]);

    expect(warning).toContain('3 jobs');
    expect(warning).toContain('no customer');
  });

  it('gets singular and plural right', () => {
    expect(deleteWarning('customer', [{ label: 'job', count: 1 }])).toContain('1 job ');
    expect(deleteWarning('customer', [{ label: 'job', count: 2 }])).toContain('2 jobs');
  });

  it('reads as a sentence with several kinds of reference', () => {
    const warning = deleteWarning('supplier', [
      { label: 'ingredient', count: 4 },
      { label: 'invoice', count: 2 },
    ]);

    expect(warning).toContain('4 ingredients and 2 invoices');
  });

  it('omits the kinds that are not affected', () => {
    const warning = deleteWarning('supplier', [
      { label: 'ingredient', count: 4 },
      { label: 'invoice', count: 0 },
    ]);

    expect(warning).toContain('4 ingredients');
    expect(warning).not.toContain('invoice');
  });
});

describe('parseQuantity — measured amounts, unlike parseCount', () => {
  it('accepts a decimal, because stock on a shelf is fractional', () => {
    // parseCount would reject this. Forcing a round number here would make the
    // owner round, and the rounded figure feeds required − stock − purchased.
    expect(parseQuantity('2.5')).toEqual({ value: 2.5, error: null });
  });

  it('accepts a whole number', () => {
    expect(parseQuantity('4')).toEqual({ value: 4, error: null });
  });

  it('RULE 8: blank is null, not zero', () => {
    // For stock these are different statements — "not counted" and "none left".
    expect(parseQuantity('').value).toBeNull();
  });

  it('keeps an explicit zero as zero', () => {
    expect(parseQuantity('0')).toEqual({ value: 0, error: null });
  });

  it('rejects a negative amount', () => {
    expect(parseQuantity('-1').error).not.toBeNull();
  });

  it('rejects something that is not a number', () => {
    expect(parseQuantity('a few').error).not.toBeNull();
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseQuantity('  2.5  ').value).toBe(2.5);
  });
});
