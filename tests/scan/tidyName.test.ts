/**
 * Names written in block capitals are tidied for CREATION only.
 *
 * THE BUG THIS FILE EXISTS FOR. Saving Paul's Sunday breakfast from a notebook
 * page written in capitals created recipes "FULL IRISH", "PANCAKES" and
 * "CONTINENTAL" in his library. The sheet's words stay verbatim as evidence;
 * only the name a new record is created under is tidied, and only when the
 * read had no lower case at all.
 */

import { describe, expect, it } from 'vitest';
import { createdName, tidyName } from '../../src/scan/jobDraft';

describe('tidyName — block capitals become a readable name', () => {
  it.each([
    ['FULL IRISH', 'Full Irish'],
    ['PANCAKES', 'Pancakes'],
    ['AOIFE', 'Aoife'],
    ['PANDORAS COTTAGE', 'Pandoras Cottage'],
    ['PANCAKES GLUTEN FREE', 'Pancakes Gluten Free'],
    [
      'SMALL PORTION OF BEEF BOURGUIGNON (MAJORITY WANTED CURRY)',
      'Small Portion of Beef Bourguignon (Majority Wanted Curry)',
    ],
    ['THE SALMON AND DILL TART', 'The Salmon and Dill Tart'],
    ['CHICKEN-AND-LEEK PIE', 'Chicken-And-Leek Pie'],
    ['SURF-TURF', 'Surf-Turf'],
  ])('%s → %s', (read, tidied) => {
    expect(tidyName(read)).toBe(tidied);
  });

  it('keeps words with dots, digits or ampersands exactly as written', () => {
    expect(tidyName('B.B.Q')).toBe('B.B.Q');
    expect(tidyName('M&S TRIFLE')).toBe('M&S Trifle');
    expect(tidyName('2KG HAM')).toBe('2KG Ham');
  });

  it('leaves any name with a lower-case letter untouched — he wrote the case', () => {
    expect(tidyName('Full Irish')).toBe('Full Irish');
    expect(tidyName('BBQ ribs')).toBe('BBQ ribs');
    expect(tidyName('McDONAGH')).toBe('McDONAGH');
  });

  it('leaves a name with no letters untouched', () => {
    expect(tidyName('123')).toBe('123');
  });

  it('adds, drops and reorders nothing — only the case changes', () => {
    const read = 'SMALL PORTION OF BEEF BOURGUIGNON (MAJORITY WANTED CURRY)';
    expect(tidyName(read).toUpperCase()).toBe(read);
  });
});

describe('createdName — one form for saving, matching and settling', () => {
  it('trims the ends and collapses inner spaces', () => {
    expect(createdName('  Beef   stew ')).toBe('Beef stew');
  });
});
