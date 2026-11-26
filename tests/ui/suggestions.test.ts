import { describe, expect, it } from 'vitest';
import { distinctNames } from '../../src/ui/suggestions';

describe('distinctNames — the spellings he already uses, once each', () => {
  it('keeps the first spelling, so the rate card’s wins over a job’s', () => {
    expect(distinctNames(['BBQ', 'Breakfast'], ['B.B.Q', 'bbq', 'Dinner'])).toEqual([
      'BBQ',
      'Breakfast',
      'Dinner',
    ]);
  });

  it('drops blanks, nulls and stray spaces', () => {
    expect(distinctNames([null, '  ', ' Priority ', 'priority'])).toEqual(['Priority']);
  });

  it('nothing in, nothing offered', () => {
    expect(distinctNames([], [null])).toEqual([]);
  });
});
