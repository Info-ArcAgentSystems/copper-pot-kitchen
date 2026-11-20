/**
 * Splitting a stated count off a dish name.
 *
 * The rule under test is Rule 8 at the boundary: a count the sheet WROTE is read
 * and carried; a count it did not write is never invented. The name must come out
 * clean so it matches the recipe he already has rather than spawning a new one per
 * headcount.
 */

import { describe, expect, it } from 'vitest';
import { parseDishQuantity } from '../../src/scan/dishQuantity';

describe('a stated count comes off the name', () => {
  it('splits a leading "N x"', () => {
    expect(parseDishQuantity('10 x Full Irish')).toEqual({ name: 'Full Irish', portions: 10 });
  });

  it('splits a tight "Nx" with no space before the name letter', () => {
    expect(parseDishQuantity('10x Full Irish')).toEqual({ name: 'Full Irish', portions: 10 });
  });

  it('splits the unicode × as well as the letter x', () => {
    expect(parseDishQuantity('2 × Pancakes')).toEqual({ name: 'Pancakes', portions: 2 });
  });

  it('splits a trailing "x N"', () => {
    expect(parseDishQuantity('Vegetable Lasagne x 6')).toEqual({
      name: 'Vegetable Lasagne',
      portions: 6,
    });
  });

  it('keeps a dietary qualifier that is part of the name', () => {
    // The "Gluten Free" is the dish's, not a count — it stays on the name and is
    // dealt with by the dietary path, never stripped as if it were a quantity.
    expect(parseDishQuantity('2 x Pancakes Gluten Free')).toEqual({
      name: 'Pancakes Gluten Free',
      portions: 2,
    });
  });
});

describe('a dish with no stated count is left exactly as written', () => {
  it('returns the name untouched and a null count', () => {
    expect(parseDishQuantity('Cheesecake')).toEqual({ name: 'Cheesecake', portions: null });
  });

  it('does NOT read a bare leading number as a count — that would be a guess', () => {
    // "7 Up float" is not seven floats. Only an explicit N x / x N is a count.
    expect(parseDishQuantity('7 Up float')).toEqual({ name: '7 Up float', portions: null });
  });

  it('refuses a zero count rather than storing "make none"', () => {
    expect(parseDishQuantity('0 x Pancakes')).toEqual({ name: '0 x Pancakes', portions: null });
  });

  it('trims surrounding space', () => {
    expect(parseDishQuantity('  Chicken curry  ')).toEqual({ name: 'Chicken curry', portions: null });
  });
});
