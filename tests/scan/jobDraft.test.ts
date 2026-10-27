/**
 * The scan result, as something he can FIX rather than only read.
 *
 * Today the scan screen is read-only, and that makes it a dead end rather than
 * a shortcut. `reviewJobSheet` raises a gap for any dietary wording on the
 * sheet, `readyToSave` is `gaps.length === 0`, and `commitScannedJob` refuses
 * while a gap stands — so a sheet that mentions an allergy, which is most real
 * sheets, cannot be saved at all. There is no screen on which to clear it.
 *
 * So the draft: the review's values drop into editable fields, he corrects what
 * is wrong, and the gaps are recomputed FROM THE DRAFT rather than from the
 * photograph. Nothing about Rule 8 is relaxed by that — what changes is who is
 * allowed to fill a gap, not whether a gap may be guessed.
 *
 * WHAT THIS FILE IS GUARDING, stated as properties:
 *
 *   the sheet's own words are never overwritten by an edit — they are the
 *   evidence, and he needs them beside the box to judge it
 *
 *   an empty field stays empty. No field is ever prefilled from another, from
 *   today's date, or from the last job
 *
 *   a name the scan could not resolve is never resolved here either. Several
 *   candidates stays several candidates (Rule 8)
 *
 *   a dietary carries dietType, severity and excludesMeat ONLY when he typed
 *   them. None of the three can come off a photograph: Rule 1 forbids a list of
 *   diet names in `src/`, Rule 9 forbids defaulting a severity, and
 *   `excludesMeat` moves the meat quantities on a BBQ
 */

import { describe, expect, it } from 'vitest';
import { reviewJobSheet, type JobSheetRead } from '../../src/scan/jobSheet';
import {
  creationsFromDraft,
  draftFromReview,
  draftGaps,
  originOf,
  type JobSheetDraft,
} from '../../src/scan/jobDraft';
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
  id: id as CustomerId, kitchenId: KITCHEN, name,
  phone: null, email: null, clientGroup: 'private', notes: null,
});

const property = (id: string, name: string): Property => ({
  id: id as PropertyId, kitchenId: KITCHEN, name,
  eircode: null, address: null, accessNotes: null, facilities: null,
});

const recipe = (id: string, name: string): Recipe => ({
  id: id as RecipeId, kitchenId: KITCHEN, name,
  course: 'main', yieldType: 'per_person', portionsPerBatch: null, batchUnit: null,
  confidence: 'locked', makeAheadDays: 0, sameDayOnly: true, freezable: false,
  onsiteFinish: false, method: null, note: null, components: [], unquantified: [],
});

const owner = {
  customers: [customer('c1', 'Nucella'), customer('c2', 'Byrne')],
  properties: [property('p1', 'Ardmore House')],
  recipes: [recipe('r1', 'Chicken curry'), recipe('r2', 'Lasagne')],
};

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

/** The same customer in his data twice, punctuated differently. */
const twoOBriens = {
  ...owner,
  customers: [customer('c2', "O'Brien"), customer('c3', 'O Brien')],
};

const draftOf = (over: Partial<JobSheetRead> = {}): JobSheetDraft =>
  draftFromReview(reviewJobSheet(read(over), owner));

// ---------------------------------------------------------------------------

describe('a clean sheet lands in the boxes ready to confirm', () => {
  it('drops every read value straight into its field', () => {
    /*
     * The "21 ppl" problem: the scan read a figure and the owner had to retype
     * it into a different screen. 24 read means 24 in the box.
     */
    const draft = draftOf();

    expect(draft.guests).toBe('24');
    expect(draft.serviceDate).toBe('2026-08-22');
    expect(draft.serviceTime).toBe('18:30');
    expect(draft.serviceType).toBe('Buffet');
  });

  it('picks the record the scan matched, rather than offering to create it again', () => {
    const draft = draftOf();

    expect(draft.customer.choice).toEqual({ kind: 'existing', id: 'c1', name: 'Nucella' });
    expect(draft.property.choice).toEqual({ kind: 'existing', id: 'p1', name: 'Ardmore House' });
    expect(draft.dishes[0]?.choice).toEqual({ kind: 'existing', id: 'r1', name: 'Chicken curry' });
  });

  it('has nothing outstanding', () => {
    expect(draftGaps(draftOf())).toEqual([]);
  });

  it('creates nothing, because everything was already his', () => {
    expect(creationsFromDraft(draftOf())).toEqual({ customers: [], properties: [], recipes: [] });
  });
});

describe('RULE 8 — a blank field stays blank', () => {
  it('leaves an unread date as an empty box, not today and not a guess', () => {
    /*
     * The single most tempting default in the whole app. A job sheet is usually
     * for the coming weekend, so "this Saturday" would be right often enough to
     * be trusted and wrong often enough to move a shopping list.
     */
    const draft = draftOf({ serviceDate: null });

    expect(draft.serviceDate).toBe('');
    expect(draftGaps(draft).map((g) => g.field)).toContain('serviceDate');
  });

  it('leaves an unread guest count empty rather than deriving it from anything', () => {
    const draft = draftOf({ guests: null });

    expect(draft.guests).toBe('');
    expect(draftGaps(draft).map((g) => g.field)).toContain('guests');
  });

  it('refuses a guest count that is not a whole number of people', () => {
    /*
     * FOUND BY INVERTING THIS FILE: loosening the check to `Number.isNaN`
     * passed every other test here. 24.5 guests is not a reading, it is a
     * misreading — and `portionsToUnits` rounding 24.5 up to 25 would hide it
     * behind a plausible tray count.
     *
     * `parseImage` already drops a non-whole count at the boundary. This is the
     * same rule applied to the BOX, which he can type into directly.
     */
    for (const typed of ['24.5', '-3', '1e3', 'twenty', '2 4']) {
      const draft = { ...draftOf(), guests: typed };

      expect(draftGaps(draft).map((g) => g.field), `"${typed}" was accepted`).toContain('guests');
    }
  });

  it('accepts a whole number with space either side of it', () => {
    // He is typing on a phone in a kitchen. A stray space is not an error.
    expect(draftGaps({ ...draftOf(), guests: ' 24 ' }).map((g) => g.field)).not.toContain('guests');
  });

  it('keeps vague wording verbatim beside the empty box (Rule 12)', () => {
    // "a few" is not a number and must never become one. It is also not
    // nothing: it is what he wrote, and he needs to see it to resolve it.
    const draft = draftOf({ guests: null, guestsWording: 'a few' });

    expect(draft.guests).toBe('');
    expect(draft.guestsWording).toBe('a few');
  });

  it('does not treat a filled box as a reason to drop the wording', () => {
    // He resolves "a few" to 18. The sheet still said "a few", and that is what
    // the next person reading the job needs to know it came from.
    const draft = { ...draftOf({ guests: null, guestsWording: 'a few' }), guests: '18' };

    expect(draft.guestsWording).toBe('a few');
    expect(draftGaps(draft).map((g) => g.field)).not.toContain('guests');
  });
});

describe('the sheet’s own words survive every edit', () => {
  it('keeps what the camera read after he overwrites the field', () => {
    /*
     * The read is the evidence. If editing a box discarded it, the chip beside
     * it could no longer say the value was changed from what the sheet said —
     * and he would have no way to notice he had corrected the wrong field.
     */
    const draft = draftOf({ serviceTime: '12:15' });
    const edited = { ...draft, serviceTime: '19:00' };

    expect(edited.from.serviceTime).toBe('12:15');
  });

  it('reports a changed field as edited, and an untouched one as scanned', () => {
    expect(originOf('12:15', '12:15')).toBe('scanned');
    expect(originOf('12:15', '19:00')).toBe('edited');
  });

  it('distinguishes nothing-on-the-sheet from he-cleared-it', () => {
    // Both end up empty, and they are not the same event. One is the camera
    // finding nothing; the other is him saying there is nothing.
    expect(originOf(null, '')).toBe('blank');
    expect(originOf('Buffet', '')).toBe('edited');
  });

  it('calls a read-but-unusable value a thing to confirm', () => {
    // "SAT 24TH" is a real reading and not a date. The chip says confirm rather
    // than scanned, because accepting it unchanged would save nothing usable.
    expect(originOf('SAT 24TH', '')).toBe('edited');
    expect(originOf(null, '2026-08-22')).toBe('edited');
  });
});

describe('a name the scan could not settle is not settled here either', () => {
  it('offers the candidates and chooses NONE of them', () => {
    /*
     * Rule 8's sharpest edge. Two customers both matching "Byrne" is an answer —
     * naming them. Picking the first is a guess that disappears on save.
     */
    /*
     * A REAL ambiguity, which took a corrected fixture to write. "Byrne" beside
     * "Byrne Catering" is NOT one: `matchByName` stops at the first tier that
     * finds anything, so an exact hit is never diluted by a longer neighbour.
     * What is ambiguous is the same customer entered twice with different
     * punctuation — which is the case that actually happens in his data.
     */
    const draft = draftFromReview(reviewJobSheet(read({ customer: "O'Brien" }), twoOBriens));

    expect(draft.customer.choice).toEqual({ kind: 'none' });
    expect(draft.customer.matches).toEqual(["O'Brien", 'O Brien']);
    expect(draftGaps(draft).map((g) => g.field)).toContain('customer');
  });

  it('offers to create a name read cleanly that he simply does not have', () => {
    // Read fine, not in his data. That is a different thing from unreadable,
    // and it is the one case where creating on save is honest.
    const draft = draftOf({ customer: 'Laura' });

    expect(draft.customer.choice).toEqual({ kind: 'create', name: 'Laura' });
    expect(creationsFromDraft(draft).customers).toEqual(['Laura']);
  });

  it('does not offer to create something the camera never read', () => {
    // There is nothing to create. An empty name is not a new customer.
    const draft = draftOf({ customer: null });

    expect(draft.customer.choice).toEqual({ kind: 'none' });
    expect(creationsFromDraft(draft).customers).toEqual([]);
  });

  it('never offers to create one of the candidates it refused to choose', () => {
    const draft = draftFromReview(reviewJobSheet(read({ customer: "O'Brien" }), twoOBriens));

    // Creating a THIRD O'Brien because two already matched would be the worst
    // of the three possible wrong answers.
    expect(creationsFromDraft(draft).customers).toEqual([]);
  });
});

describe('dishes become recipes he has, or stubs he will have', () => {
  it('lists each unknown dish as a recipe to create, in sheet order', () => {
    const draft = draftOf({ dishes: ['Chicken curry', 'Pavlova', 'Dauphinoise'] });

    expect(creationsFromDraft(draft).recipes).toEqual(['Pavlova', 'Dauphinoise']);
  });

  it('does not make an unknown dish block the save', () => {
    /*
     * The change of mind that this whole feature is. A dish he does not have a
     * recipe for used to be a gap, which made the sheet unsaveable; it is now a
     * stub he is told about before he confirms.
     */
    const draft = draftOf({ dishes: ['Pavlova'] });

    expect(draftGaps(draft).map((g) => g.field)).not.toContain('dish:0');
  });

  it('still refuses to choose between two recipes with the same name', () => {
    // Same two words, entered twice with different capitals: both match at the
    // same tier, so neither wins.
    const twoCurries = {
      ...owner,
      recipes: [recipe('r1', 'Chicken curry'), recipe('r3', 'chicken Curry')],
    };
    const draft = draftFromReview(
      reviewJobSheet(read({ dishes: ['Chicken curry'] }), twoCurries),
    );

    expect(draft.dishes[0]?.choice).toEqual({ kind: 'none' });
    expect(draftGaps(draft).map((g) => g.field)).toContain('dish:0');
  });

  it('treats a sheet with no dishes as something to settle', () => {
    expect(draftGaps(draftOf({ dishes: [] })).map((g) => g.field)).toContain('dishes');
  });
});

describe('RULES 9, 12 and 16 — a scanned dietary is wording and nothing else', () => {
  const withAllergy = (): JobSheetDraft =>
    draftOf({ dietaries: [{ wording: 'severe nut allergy — Ciara' }] });

  it('keeps the wording exactly as the sheet had it', () => {
    expect(withAllergy().dietaries[0]?.wording).toBe('severe nut allergy — Ciara');
  });

  it('invents no diet type from it', () => {
    /*
     * "nut allergy" is sitting right there in the words, and parsing it out
     * would mean a list of diet names in `src/` — business data, Rule 1 — and a
     * category he never chose.
     */
    expect(withAllergy().dietaries[0]?.dietType).toBe('');
  });

  it('invents no SEVERITY, even when the sheet says "severe"', () => {
    /*
     * RULE 9, and the most dangerous default available anywhere in this app.
     * Reading "severe" off the page and setting severity is still the model
     * deciding an allergy's gravity. Defaulting the other way is worse: 'info'
     * would quietly downgrade a nut allergy to a note.
     */
    expect(withAllergy().dietaries[0]?.severity).toBeNull();
  });

  it('invents no meat exclusion, because that one moves quantities', () => {
    // `excludesMeat` is what splits a BBQ's meat count from its sides count.
    // Guessing it changes how much mince he buys.
    expect(withAllergy().dietaries[0]?.excludesMeat).toBe(false);
  });

  it('blocks the save until he has said what it is and how serious', () => {
    const gaps = draftGaps(withAllergy()).map((g) => g.field);

    expect(gaps).toContain('dietary:0');
  });

  it('clears once he has filled all three', () => {
    const draft = withAllergy();
    const filled: JobSheetDraft = {
      ...draft,
      dietaries: [
        { wording: 'severe nut allergy — Ciara', dietType: 'nut allergy', severity: 'severe', excludesMeat: false },
      ],
    };

    expect(draftGaps(filled).map((g) => g.field)).not.toContain('dietary:0');
  });

  it('still blocks when he named it but left the severity unsaid', () => {
    // Half-filled is not filled. A requirement with no severity cannot be
    // weighed against a dish, and Rule 9 will not let the system pick.
    const draft = withAllergy();
    const half: JobSheetDraft = {
      ...draft,
      dietaries: [
        { wording: 'severe nut allergy — Ciara', dietType: 'nut allergy', severity: null, excludesMeat: false },
      ],
    };

    expect(draftGaps(half).map((g) => g.field)).toContain('dietary:0');
  });

  it('carries no count anywhere, whatever the sheet said (Rule 16)', () => {
    const draft = draftOf({ dietaries: [{ wording: '3 vegetarians and 2 coeliacs' }] });

    /*
     * One row, holding the words — not five rows, and no field anywhere that
     * could hold the 3 or the 2.
     *
     * Asserted as the SHAPE rather than "no digits appear", which was my first
     * attempt and was wrong: the digits are IN his wording, verbatim, and that
     * is the point of keeping it. What must not exist is a numeric field.
     */
    expect(draft.dietaries).toHaveLength(1);
    expect(draft.dietaries[0]?.wording).toBe('3 vegetarians and 2 coeliacs');
    expect(Object.keys(draft.dietaries[0] ?? {}).sort()).toEqual([
      'dietType',
      'excludesMeat',
      'severity',
      'wording',
    ]);
    expect(
      Object.values(draft.dietaries[0] ?? {}).some((v) => typeof v === 'number'),
      'a dietary row has a numeric field, which Rule 16 says has no operand',
    ).toBe(false);
  });
});

describe('what the owner is told will happen', () => {
  it('names every record that the save will create, and only those', () => {
    const draft = draftOf({
      customer: 'Laura',
      property: 'Nucella Lodge',
      dishes: ['Chicken curry', 'Pavlova', 'Tarte tatin'],
    });

    expect(creationsFromDraft(draft)).toEqual({
      customers: ['Laura'],
      properties: ['Nucella Lodge'],
      recipes: ['Pavlova', 'Tarte tatin'],
    });
  });

  it('drops a creation he turned into an existing record instead', () => {
    const draft = draftOf({ customer: 'Laura' });
    const picked: JobSheetDraft = {
      ...draft,
      customer: { ...draft.customer, choice: { kind: 'existing', id: 'c2', name: 'Byrne' } },
    };

    expect(creationsFromDraft(picked).customers).toEqual([]);
  });

  it('does not list the same new recipe twice when the sheet repeats it', () => {
    // A sheet with two sittings often lists the same dish on both. Creating it
    // twice would leave him with two identical recipes to maintain.
    const draft = draftOf({ dishes: ['Pavlova', 'Pavlova'] });

    expect(creationsFromDraft(draft).recipes).toEqual(['Pavlova']);
  });
});
