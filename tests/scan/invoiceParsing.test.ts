/**
 * Parsing the numbers off an invoice line.
 *
 * THE BUG THIS FILE EXISTS FOR. Two real invoices came back with every
 * ingredient NAME read correctly and every QUANTITY and TOTAL reported
 * unreadable, saving nothing. Names survived because `text()` accepts a string;
 * numbers died because the narrowers demanded `typeof === 'number'`, and models
 * routinely quote numbers.
 *
 * Underneath it was a contradiction in the schema: `lineTotal` was described as
 * "IN CENTS — EUR 45.00 is 4500" inside a prompt whose headline instruction is
 * "you do not calculate". Asking a model to multiply by a hundred while telling
 * it not to calculate is a Rule 2 violation in the schema itself, and it resolved
 * the contradiction by reporting the printed figure.
 *
 * The rule these tests hold: READ WHAT IS PRINTED, NEVER GUESS. A string that
 * does not resolve cleanly is null, not a number somebody inferred.
 */

import { describe, expect, it } from 'vitest';
import { validateInvoice } from '../../src/scan/parseImage';

const reply = (line: Record<string, unknown>): unknown => ({
  read: {
    supplier: 'Musgrave',
    invoiceDate: '2026-08-20',
    lines: [{ description: 'Beef mince', ...line }],
    uncertain: [],
  },
});

const parse = (line: Record<string, unknown>) => {
  const out = validateInvoice(reply(line));
  if (out.kind !== 'read') throw new Error('expected a read');
  return out.read.lines[0];
};

describe('THE SHAPE THE MODEL ACTUALLY RETURNS', () => {
  it('prices a line in the exact shape the tool now asks for', () => {
    // The regression test for the reported failure: this must be a priced line,
    // not "could not be read".
    const line = parse({ quantity: 5, unit: 'kg', lineTotalPrinted: 45.0 });

    expect(line?.quantity).toBe(5);
    expect(line?.unit).toBe('kg');
    expect(line?.lineTotalCents).toBe(4500);
  });

  it('THE €0.45 BUG: 45.0 is forty-five euros, never forty-five cents', () => {
    // The dangerous half. Under the old contract a plain 45.0 PASSED validation
    // and was stored as 45 cents — a hundredfold error that never showed as an
    // error, on a screen the owner trusts.
    const line = parse({ quantity: 5, unit: 'kg', lineTotalPrinted: 45.0 });

    expect(line?.lineTotalCents).toBe(4500);
    expect(line?.lineTotalCents).not.toBe(45);
  });

  it('keeps the pence on a total with real decimals', () => {
    // 45.5 was rejected outright before, because `count` demanded an integer.
    expect(parse({ quantity: 5, unit: 'kg', lineTotalPrinted: 45.5 })?.lineTotalCents).toBe(4550);
  });

  it('rounds to whole cents rather than carrying a fraction of one', () => {
    expect(parse({ quantity: 3, unit: 'kg', lineTotalPrinted: 10.005 })?.lineTotalCents).toBe(1001);
  });
});

describe('numbers the model sent as text', () => {
  it('reads a quoted quantity and total', () => {
    const line = parse({ quantity: '5', unit: 'kg', lineTotalPrinted: '45.00' });

    expect(line?.quantity).toBe(5);
    expect(line?.lineTotalCents).toBe(4500);
  });

  it('strips a currency symbol, which is notation rather than value', () => {
    expect(parse({ quantity: 5, unit: 'kg', lineTotalPrinted: '€45.00' })?.lineTotalCents).toBe(4500);
  });

  it('strips a thousands separator in the only shape it can be one', () => {
    expect(parse({ quantity: 2, unit: 'kg', lineTotalPrinted: '1,250.00' })?.lineTotalCents).toBe(
      125000,
    );
  });

  it('splits a quantity that arrived with its unit attached', () => {
    // "5 kg" in the quantity field is a plausible thing for a model to send.
    // Splitting an exact `number unit` shape is reading, not guessing.
    const line = parse({ quantity: '5 kg', unit: null, lineTotalPrinted: 45.0 });

    expect(line?.quantity).toBe(5);
    expect(line?.unit).toBe('kg');
  });

  it('does not let an attached unit override one that was reported properly', () => {
    const line = parse({ quantity: '5 kg', unit: 'kilograms', lineTotalPrinted: 45.0 });
    expect(line?.unit).toBe('kilograms');
  });
});

describe('NEVER GUESSES — residue means null', () => {
  it.each([
    ['a vague word', 'about 5'],
    ['a range', '5-6'],
    ['a fraction in words', 'half a case'],
    ['trailing prose', '45.00 approx'],
    ['nothing but a symbol', '€'],
    ['empty', ''],
  ])('refuses %s rather than inferring a number', (_label, raw) => {
    expect(parse({ quantity: raw, unit: 'kg', lineTotalPrinted: raw })?.lineTotalCents).toBeNull();
  });

  it('REFUSES a lone comma rather than picking a convention', () => {
    // "45,50" is forty-five point five to a French supplier and four thousand
    // five hundred and fifty to an Irish one. There is no way to tell, so it is
    // not guessed.
    expect(parse({ quantity: 5, unit: 'kg', lineTotalPrinted: '45,50' })?.lineTotalCents).toBeNull();
  });

  it('refuses a negative, which is a credit note rather than a price', () => {
    expect(parse({ quantity: 5, unit: 'kg', lineTotalPrinted: '-45.00' })?.lineTotalCents).toBeNull();
  });

  it('refuses NaN and Infinity, which survive a bare typeof check', () => {
    expect(parse({ quantity: 5, unit: 'kg', lineTotalPrinted: Number.NaN })?.lineTotalCents).toBeNull();
    expect(
      parse({ quantity: Number.POSITIVE_INFINITY, unit: 'kg', lineTotalPrinted: 45 })?.quantity,
    ).toBeNull();
  });

  it('refuses a total sent as an object rather than a figure', () => {
    expect(
      parse({ quantity: 5, unit: 'kg', lineTotalPrinted: { amount: 45, currency: 'EUR' } })
        ?.lineTotalCents,
    ).toBeNull();
  });
});

describe('the deploy window between the two halves', () => {
  it('a STALE function returning the old cents field fails VISIBLY', () => {
    // The field was renamed on purpose. An old deployed function still sends
    // `lineTotal` in cents; reading that as euros would be a hundredfold error in
    // the opposite direction, silent. Not finding the field is the safe failure.
    const line = parse({ quantity: 5, unit: 'kg', lineTotal: 4500 });

    expect(line?.lineTotalCents).toBeNull();
    expect(line?.quantity).toBe(5);
  });
});
