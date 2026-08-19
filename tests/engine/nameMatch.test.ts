/**
 * The shared name matcher.
 *
 * It lives in the engine because two features depend on agreeing: Ask Sous asks
 * "which ingredient did he mean", and the job-sheet scanner asks "is this
 * customer already in his data". A second implementation would eventually answer
 * differently, and the scanner would create a duplicate of someone already in
 * the book — a failure nobody would notice for weeks.
 *
 * The shapes below are the ones that actually broke it. See `nameMatch.ts`.
 */

import { describe, expect, it } from 'vitest';
import { matchByName, nearestNames, words } from '../../src/engine/nameMatch';

const record = (id: string, name: string) => ({ id, name });

const names = (matches: readonly { name: string }[]): string[] => matches.map((m) => m.name);

describe('normalisation', () => {
  it('splits on anything that is not a letter or digit', () => {
    expect(words('  Sauce,  Soy-Bean 2  ')).toEqual(['sauce', 'soy', 'bean', '2']);
  });

  it('is empty for a name of pure punctuation', () => {
    expect(words('---')).toEqual([]);
  });
});

describe('the shapes that used to be reported as absent', () => {
  it.each([
    ['Soy Sauce', 'the reported case'],
    ['soy sauce', 'already lowercase'],
    ['SOY SAUCE', 'shouted'],
    ['  Soy Sauce  ', 'padded'],
    ['Soy  Sauce', 'a doubled interior space'],
    ['Soy-sauce', 'hyphenated'],
    ['Sauce, Soy', 'supplier-style, reordered'],
    ['Dark Soy Sauce', 'stored name more specific'],
    ['Soy', 'stored name SHORTER than the question'],
  ])('finds %j — %s', (stored) => {
    expect(names(matchByName([record('i1', stored)], 'soy sauce'))).toEqual([stored]);
  });
});

describe('it narrows, it never picks', () => {
  it('returns every candidate when several fit', () => {
    const found = matchByName(
      [record('i1', 'Dark soy sauce'), record('i2', 'Light soy sauce')],
      'soy sauce',
    );

    expect(names(found)).toEqual(['Dark soy sauce', 'Light soy sauce']);
  });

  it('an exact hit is NOT diluted by looser neighbours', () => {
    // The tier ladder stops at the first tier that finds anything. Without that,
    // asking for the exact name of one record returns it plus every record that
    // merely contains those words — an ambiguity invented by the matcher.
    const found = matchByName(
      [record('i1', 'Soy Sauce'), record('i2', 'Dark soy sauce')],
      'soy sauce',
    );

    expect(names(found)).toEqual(['Soy Sauce']);
  });

  it('matches whole words only', () => {
    expect(matchByName([record('i1', 'Boiled rice')], 'oil')).toEqual([]);
  });

  it('an id short-circuits everything', () => {
    const found = matchByName([record('i1', 'Soy Sauce'), record('i2', 'Soy')], 'i2');

    expect(names(found)).toEqual(['Soy']);
  });

  it('finds nothing for a name genuinely absent', () => {
    expect(matchByName([record('i1', 'Soy Sauce')], 'saffron')).toEqual([]);
  });

  it('finds nothing for an empty question rather than everything', () => {
    expect(matchByName([record('i1', 'Soy Sauce')], '   ')).toEqual([]);
  });
});

describe('near misses', () => {
  it('offers stored names sharing a word', () => {
    expect(nearestNames([record('i1', 'Light soy'), record('i2', 'Chicken')], 'soy sauce')).toEqual([
      'Light soy',
    ]);
  });

  it('offers nothing when nothing is close', () => {
    expect(nearestNames([record('i1', 'Chicken')], 'saffron')).toEqual([]);
  });
});
