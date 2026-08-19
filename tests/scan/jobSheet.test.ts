/**
 * Reviewing a scanned job sheet.
 *
 * PURE — no network, no DOM. The model's OCR output goes in, a review the owner
 * can check goes out. Nothing here writes.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE: **flag, never invent.**
 *
 * A scanner is the easiest place in the whole system to breach Rule 8, because a
 * plausible value is always available — the date is probably this Saturday, the
 * guest count is probably the number next to the smudge, the customer is
 * probably the one they booked last time. Every one of those guesses would be
 * invisible once saved, and would move a purchase quantity.
 *
 * So: an unreadable field becomes a GAP, and a name not already in the owner's
 * data becomes NEW — flagged for him to confirm, never created behind his back.
 */

import { describe, expect, it } from 'vitest';
import { reviewJobSheet, type JobSheetRead } from '../../src/scan/jobSheet';
import type {
  Customer,
  CustomerId,
  KitchenId,
  Property,
  PropertyId,
  Recipe,
  RecipeId,
} from '../../src/engine/types';

const KITCHEN = 'k1' as KitchenId;

const customer = (id: string, name: string): Customer => ({
  id: id as CustomerId,
  kitchenId: KITCHEN,
  name,
  phone: null,
  email: null,
  clientGroup: 'private',
  notes: null,
});

const property = (id: string, name: string): Property => ({
  id: id as PropertyId,
  kitchenId: KITCHEN,
  name,
  eircode: null,
  address: null,
  accessNotes: null,
  facilities: null,
});

const recipe = (id: string, name: string): Recipe => ({
  id: id as RecipeId,
  kitchenId: KITCHEN,
  name,
  course: 'main',
  yieldType: 'per_person',
  portionsPerBatch: null,
  batchUnit: null,
  confidence: 'locked',
  makeAheadDays: 0,
  sameDayOnly: true,
  freezable: false,
  onsiteFinish: false,
  method: null,
  note: null,
  components: [],
  unquantified: [],
});

const owner = {
  customers: [customer('c1', 'Nucella'), customer('c2', 'Byrne')],
  properties: [property('p1', 'Ardmore House')],
  recipes: [recipe('r1', 'Chicken curry'), recipe('r2', 'Lasagne')],
};

/** A clean read, which individual tests spoil one field at a time. */
const read = (over: Partial<JobSheetRead> = {}): JobSheetRead => ({
  customer: 'Nucella',
  property: 'Ardmore House',
  serviceDate: '2026-08-22',
  serviceTime: '18:30',
  serviceType: 'Buffet',
  guests: 24,
  guestsWording: null,
  dishes: ['Chicken curry'],
  dietaries: [],
  notes: null,
  uncertain: [],
  ...over,
});

// ---------------------------------------------------------------------------

describe('a clean sheet reads straight through', () => {
  it('resolves customer, property and dish against the owner’s own records', () => {
    const review = reviewJobSheet(read(), owner);

    expect(review.customer.kind).toBe('matched');
    expect(review.property.kind).toBe('matched');
    expect(review.dishes[0]?.kind).toBe('matched');
    expect(review.guests).toBe(24);
    expect(review.serviceDate).toBe('2026-08-22');
    expect(review.gaps).toEqual([]);
    expect(review.newThings).toEqual([]);
  });

  it('matches a name the camera read in a different case or spacing', () => {
    // OCR of handwriting decides its own spacing and punctuation. This is the
    // shared matcher (engine/nameMatch) doing the work Ask Sous uses.
    const review = reviewJobSheet(
      read({ customer: 'nucella', property: 'ardmore  house', dishes: ['chicken curry'] }),
      owner,
    );

    expect(review.customer.kind).toBe('matched');
    expect(review.property.kind).toBe('matched');
    expect(review.dishes[0]?.kind).toBe('matched');
  });
});

describe('RULE 8 — an unreadable value is a gap, never a guess', () => {
  it('leaves an unreadable guest count NULL and raises a gap', () => {
    const review = reviewJobSheet(
      read({ guests: null, uncertain: [{ field: 'guests', saw: 'smudged' }] }),
      owner,
    );

    expect(review.guests).toBeNull();
    expect(review.gaps.map((g) => g.field)).toContain('guests');
  });

  it('never turns "a few" into a number — the wording is kept verbatim (Rule 12)', () => {
    const review = reviewJobSheet(read({ guests: null, guestsWording: 'a few' }), owner);

    expect(review.guests).toBeNull();
    const gap = review.gaps.find((g) => g.field === 'guests');
    expect(gap?.saw).toBe('a few');
    // The exact failure this guards: any digit derived from vague wording.
    expect(JSON.stringify(review)).not.toMatch(/"guests":\s*\d/);
  });

  it.each(['serviceDate', 'serviceTime', 'serviceType'] as const)(
    'raises a gap for an unreadable %s rather than filling it in',
    (field) => {
      const review = reviewJobSheet(read({ [field]: null }), owner);

      expect(review[field]).toBeNull();
      expect(review.gaps.map((g) => g.field)).toContain(field);
    },
  );

  it('does not invent today’s date for a missing one', () => {
    const review = reviewJobSheet(read({ serviceDate: null }), owner);

    expect(review.serviceDate).toBeNull();
  });

  it('carries every uncertain entry the model reported into the gaps', () => {
    const review = reviewJobSheet(
      read({ notes: null, uncertain: [{ field: 'notes', saw: 'two illegible lines' }] }),
      owner,
    );

    const gap = review.gaps.find((g) => g.field === 'notes');
    expect(gap?.saw).toBe('two illegible lines');
  });
});

describe('anything not already in the owner’s data is flagged NEW, never created', () => {
  it('flags an unknown customer as new', () => {
    const review = reviewJobSheet(read({ customer: 'Ó Braonáin' }), owner);

    expect(review.customer.kind).toBe('new');
    expect(review.newThings).toContainEqual({ what: 'customer', read: 'Ó Braonáin' });
  });

  it('flags an unknown property as new', () => {
    const review = reviewJobSheet(read({ property: 'Sea View Lodge' }), owner);

    expect(review.property.kind).toBe('new');
    expect(review.newThings).toContainEqual({ what: 'property', read: 'Sea View Lodge' });
  });

  it('flags an unknown dish as new, and keeps the known one matched', () => {
    const review = reviewJobSheet(read({ dishes: ['Chicken curry', 'Pavlova'] }), owner);

    expect(review.dishes[0]?.kind).toBe('matched');
    expect(review.dishes[1]?.kind).toBe('new');
    expect(review.newThings).toContainEqual({ what: 'dish', read: 'Pavlova' });
  });

  it('NAMES the candidates when a read name fits more than one, and picks none', () => {
    const two = { ...owner, customers: [customer('c1', 'Byrne John'), customer('c2', 'Byrne Mary')] };
    const review = reviewJobSheet(read({ customer: 'Byrne' }), two);

    expect(review.customer.kind).toBe('ambiguous');
    if (review.customer.kind !== 'ambiguous') return;
    expect(review.customer.matches).toEqual(['Byrne John', 'Byrne Mary']);
    // An ambiguity the owner must settle is a gap, not a silent pick.
    expect(review.gaps.map((g) => g.field)).toContain('customer');
  });

  it('a name read as nothing at all is missing, not new', () => {
    // "New" invites him to create a record. There is nothing to create here.
    const review = reviewJobSheet(read({ property: null }), owner);

    expect(review.property.kind).toBe('missing');
    expect(review.newThings).toEqual([]);
    expect(review.gaps.map((g) => g.field)).toContain('property');
  });
});

describe('RULE 16 — scanned dietaries never become counts', () => {
  it('keeps "3 vegetarians" as the owner’s wording, unresolved', () => {
    const review = reviewJobSheet(read({ dietaries: [{ wording: '3 vegetarians' }] }), owner);

    expect(review.dietaries).toEqual([{ wording: '3 vegetarians' }]);
    // Rule 16: one guest can hold several requirements, so a scanned figure is
    // not a count of anything. It stays words until the owner allocates guests.
    expect(review.gaps.map((g) => g.field)).toContain('dietaries');
  });

  it('a sheet with no dietaries raises no dietary gap', () => {
    expect(reviewJobSheet(read(), owner).gaps.map((g) => g.field)).not.toContain('dietaries');
  });
});

describe('the review is not a job', () => {
  it('reports whether anything still blocks a confident save', () => {
    expect(reviewJobSheet(read(), owner).readyToSave).toBe(true);
    expect(reviewJobSheet(read({ guests: null }), owner).readyToSave).toBe(false);
  });

  it('an empty read produces gaps, not an empty job', () => {
    const review = reviewJobSheet(
      {
        customer: null, property: null, serviceDate: null, serviceTime: null,
        serviceType: null, guests: null, guestsWording: null, dishes: [],
        dietaries: [], notes: null, uncertain: [],
      },
      owner,
    );

    expect(review.readyToSave).toBe(false);
    expect(review.gaps.length).toBeGreaterThan(3);
    expect(review.newThings).toEqual([]);
  });
});
