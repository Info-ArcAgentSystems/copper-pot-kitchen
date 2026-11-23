/**
 * One photographed page → several jobs.
 *
 * THE BUG THIS FILE EXISTS FOR. Paul's notebook page "Pandoras Cottage · Aoife"
 * holds two bookings — Fri 20th BBQ for 13, Sun 22nd breakfast for 16. The old
 * scanner had room for one job and kept whichever the model landed on: the same
 * photo gave the Sunday job in the morning and the Friday job that night, and
 * the other booking vanished without a word.
 *
 * The fixtures below are his two real pages, transcribed as the scanner is now
 * told to report them — verbatim, interpreting nothing.
 */

import { describe, expect, it } from 'vitest';
import {
  HEADER_DATE_FIELD,
  dateFromHeader,
  draftPage,
  guestsFromWording,
  jobGaps,
  monthYearFromHeader,
  needsDateConfirm,
  saveable,
  setHeading,
  settleAcrossPage,
  shortDate,
  timeQuestion,
  timesFromWording,
  withJob,
  type PageRead,
  type SittingRead,
} from '../../src/scan/page';
import { validatePage } from '../../src/scan/parseImage';
import { creationsFromDraft } from '../../src/scan/jobDraft';
import { phoneAction, phoneDigits, setNewCustomerPhone } from '../../src/scan/page';
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

const recipe = (id: string, name: string): Recipe => ({
  id: id as RecipeId, kitchenId: KITCHEN, name,
  course: null, yieldType: 'per_person', portionsPerBatch: null, batchUnit: null,
  confidence: 'missing', makeAheadDays: 0, sameDayOnly: true, freezable: false,
  onsiteFinish: false, method: null, note: null, components: [], unquantified: [],
});
const customer = (id: string, name: string): Customer => ({
  id: id as CustomerId, kitchenId: KITCHEN, name,
  phone: null, email: null, clientGroup: null, notes: null,
});
const property = (id: string, name: string): Property => ({
  id: id as PropertyId, kitchenId: KITCHEN, name,
  eircode: null, address: null, accessNotes: null, facilities: null,
});

/** An empty kitchen — every name on the page is new. */
const empty = { customers: [], properties: [], recipes: [] };

const sitting = (over: Partial<SittingRead>): SittingRead => ({
  dayWritten: null, serviceDate: null, serviceTime: null, timeWording: null,
  serviceType: null, guests: null, guestsWording: null, dishes: [], dietaries: [],
  notes: null, uncertain: [],
  ...over,
});

/** Paul's Pandoras Cottage page, as the scanner reports it. */
const PANDORAS: PageRead = {
  pageHeader: "PAUL - CATERING 20/21st NOV'26",
  blocks: [
    {
      customer: 'Aoife',
      property: 'Pandoras Cottage',
      phone: '0862034359',
      sittings: [
        sitting({
          dayWritten: 'FRI. 20TH', timeWording: '7/7.30pm', serviceType: 'B.B.Q',
          guestsWording: '13ppl',
        }),
        sitting({
          dayWritten: 'SUN. 22ND', timeWording: '10am', guestsWording: '16ppl',
          dishes: ['10 x Full Irish', '3 x Pancakes', '3 x Continental'],
        }),
      ],
    },
  ],
  unplaced: [],
  uncertain: [],
};

/** Paul's Tranquility House page: two bookings on the SAME day, no page title. */
const TRANQUILITY: PageRead = {
  pageHeader: null,
  blocks: [
    {
      customer: 'Mary',
      property: 'Tranquility House',
      phone: null,
      sittings: [
        sitting({
          dayWritten: 'SAT 21ST', timeWording: '9.30AM', guestsWording: '17PPL',
          dishes: ['5 x Full Irish', '10 x Pancakes Regular', '2 x Pancakes Gluten Free'],
        }),
        sitting({
          dayWritten: 'SAT 21ST', timeWording: '5.30PM', guestsWording: '27PPL',
          dishes: [
            'Chicken Curry Gluten Free',
            'Small portion of Beef Bourguignon (majority wanted curry)',
            'Vegetable Lasagne x 6',
            'Cheesecake',
            'Raspberry Brownie Gluten Free',
          ],
        }),
      ],
    },
  ],
  unplaced: [],
  uncertain: [],
};

let n = 0;
const ids = (): string => `group-${(n += 1)}`;

// ---------------------------------------------------------------------------

describe('dateFromHeader — the day on the line, the month and year in the title', () => {
  it('builds Fri 20th from "NOV\'26" and checks the weekday', () => {
    expect(dateFromHeader('FRI. 20TH', PANDORAS.pageHeader)).toEqual({
      date: '2026-11-20',
      weekdayMatches: true,
      weekdayWritten: 'Friday',
      disagreesWithHeader: false,
      headerDays: [20, 21],
    });
  });

  it('builds Sun 22nd, and says the title listed 20/21 rather than 22', () => {
    // A real disagreement on his page. Shown to him; nothing is decided by it.
    const got = dateFromHeader('SUN. 22ND', PANDORAS.pageHeader);

    expect(got?.date).toBe('2026-11-22');
    expect(got?.weekdayMatches).toBe(true);
    expect(got?.disagreesWithHeader).toBe(true);
  });

  it('flags a weekday that does not match the date', () => {
    expect(dateFromHeader('Sat 20th', PANDORAS.pageHeader)?.weekdayMatches).toBe(false);
  });

  it('builds NOTHING when the title gives no month and year', () => {
    // Tranquility House has no title. Nothing is filled from today.
    expect(dateFromHeader('SAT 21ST', null)).toBeNull();
    expect(dateFromHeader('SAT 21ST', 'Catering this weekend')).toBeNull();
  });

  it('will not read a bare two-digit number after the month as a year', () => {
    // "Nov 26" could be the 26th. Only "Nov '26" (with its apostrophe) is a year.
    expect(monthYearFromHeader('Catering Nov 26')).toBeNull();
    expect(monthYearFromHeader("Catering Nov '26")?.year).toBe(2026);
    expect(monthYearFromHeader('Catering November 2026')?.year).toBe(2026);
  });

  it('refuses a date that does not exist', () => {
    expect(dateFromHeader('31st', "Nov '26")).toBeNull();
  });

  it('builds nothing from a line with no day number', () => {
    expect(dateFromHeader('Friday', PANDORAS.pageHeader)).toBeNull();
  });
});

describe('guestsFromWording — "16ppl" is a number, "a few" is not', () => {
  it.each([
    ['16ppl', 16],
    ['13PPL', 13],
    ['for 13 ppl', 13],
    ['16', 16],
    ['20 pax', 20],
    ['24 guests', 24],
  ])('reads %s as %d', (wording, expected) => {
    expect(guestsFromWording(wording)).toBe(expected);
  });

  it.each(['a few', '20-25', 'approx 20', 'about 16ppl', '0ppl', '16 or 17'])(
    'leaves "%s" unresolved (Rule 12)',
    (wording) => {
      expect(guestsFromWording(wording)).toBeNull();
    },
  );
});

describe('timesFromWording — options, never a choice', () => {
  it('reads "7/7.30pm" as two times, the pm covering both', () => {
    expect(timesFromWording('7/7.30pm')).toEqual(['19:00', '19:30']);
  });

  it.each([
    ['10am', ['10:00']],
    ['9.30AM', ['09:30']],
    ['5.30PM', ['17:30']],
    ['12pm', ['12:00']],
    ['12am', ['00:00']],
    ['19:30', ['19:30']],
    ['7pm-9pm', ['19:00', '21:00']],
  ])('reads %s', (wording, expected) => {
    expect(timesFromWording(wording)).toEqual(expected);
  });

  it.each(['7/7.30', '7', 'about 7', 'evening', '25:00'])(
    'gives no options for "%s" — morning or evening is not written',
    (wording) => {
      expect(timesFromWording(wording)).toEqual([]);
    },
  );
});

describe('Pandoras Cottage — two bookings under one heading', () => {
  const page = draftPage(PANDORAS, empty, ids);
  const [fri, sun] = page.jobs;

  it('makes TWO jobs, not one — neither booking is dropped', () => {
    expect(page.jobs).toHaveLength(2);
  });

  it('gives both the heading’s customer and property', () => {
    expect(fri?.draft.customer.choice).toEqual({ kind: 'create', name: 'Aoife' });
    expect(sun?.draft.customer.choice).toEqual({ kind: 'create', name: 'Aoife' });
    expect(fri?.draft.property.choice).toEqual({ kind: 'create', name: 'Pandoras Cottage' });
    expect(sun?.draft.property.choice).toEqual({ kind: 'create', name: 'Pandoras Cottage' });
  });

  it('links them as one event', () => {
    expect(fri?.group).not.toBeNull();
    expect(fri?.group).toBe(sun?.group);
  });

  it('builds each date from its own line and the title, marked as header-built', () => {
    expect(fri?.draft.serviceDate).toBe('2026-11-20');
    expect(sun?.draft.serviceDate).toBe('2026-11-22');
    expect(fri?.meta.dateFrom).toBe('header');
    expect(shortDate('2026-11-20')).toBe('Fri 20 Nov');
  });

  it('reads "13ppl" and "16ppl" as 13 and 16', () => {
    expect(fri?.draft.guests).toBe('13');
    expect(sun?.draft.guests).toBe('16');
    expect(fri?.meta.guestsWording).toBe('13ppl');
  });

  it('fills "10am" but leaves "7/7.30pm" for him, offering both', () => {
    expect(sun?.draft.serviceTime).toBe('10:00');
    expect(fri?.draft.serviceTime).toBe('');
    expect(fri !== undefined && timeQuestion(fri)).toEqual(['19:00', '19:30']);
  });

  it('keeps the BBQ as the service type and invents no menu for it', () => {
    expect(fri?.draft.serviceType).toBe('B.B.Q');
    expect(fri?.draft.dishes).toEqual([]);
  });

  it('splits the Sunday counts off the dish names', () => {
    expect(sun?.draft.dishes.map((d) => [d.choice, d.portions])).toEqual([
      [{ kind: 'create', name: 'Full Irish' }, 10],
      [{ kind: 'create', name: 'Pancakes' }, 3],
      [{ kind: 'create', name: 'Continental' }, 3],
    ]);
  });

  it('blocks both until the header-built dates are confirmed', () => {
    expect(jobGaps(page, 1).map((g) => g.field)).toEqual([HEADER_DATE_FIELD]);
    expect(saveable(page, 1)).toBe(false);
  });

  it('readies the Sunday job once the dates are confirmed, and holds the BBQ for its menu', () => {
    const confirmed = { ...page, headerDatesConfirmed: true };

    expect(saveable(confirmed, 1)).toBe(true);
    expect(jobGaps(confirmed, 0).map((g) => g.field)).toEqual(['dishes']);
  });

  it('lets the BBQ save once he SAYS the menu is not decided — the time does not block', () => {
    const decided = withJob({ ...page, headerDatesConfirmed: true }, 0, (d) => ({
      ...d,
      menuToBeDecided: true,
    }));

    expect(saveable(decided, 0)).toBe(true);
  });

  it('treats a date he typed himself as his answer, not one to confirm', () => {
    const typed = withJob(page, 0, (d) => ({ ...d, serviceDate: '2026-11-21' }));

    expect(needsDateConfirm(typed, typed.jobs[0]!)).toBe(false);
  });
});

describe('Tranquility House — two bookings on the same day, no page title', () => {
  const page = draftPage(TRANQUILITY, empty, ids);
  const [breakfast, dinner] = page.jobs;

  it('keeps two same-day bookings apart', () => {
    expect(page.jobs).toHaveLength(2);
    expect(breakfast?.draft.serviceTime).toBe('09:30');
    expect(dinner?.draft.serviceTime).toBe('17:30');
    expect(breakfast?.draft.guests).toBe('17');
    expect(dinner?.draft.guests).toBe('27');
  });

  it('builds NO date without a title, and the empty date blocks the save', () => {
    expect(breakfast?.draft.serviceDate).toBe('');
    expect(jobGaps(page, 0).map((g) => g.field)).toContain('serviceDate');
  });

  it('splits counts at either end of a dish and leaves count-less dishes whole', () => {
    expect(breakfast?.draft.dishes.map((d) => d.portions)).toEqual([5, 10, 2]);
    expect(dinner?.draft.dishes.map((d) => [d.read, d.portions])).toEqual([
      ['Chicken Curry Gluten Free', null],
      ['Small portion of Beef Bourguignon (majority wanted curry)', null],
      ['Vegetable Lasagne', 6],
      ['Cheesecake', null],
      ['Raspberry Brownie Gluten Free', null],
    ]);
  });
});

describe('the heading belongs to every booking under it', () => {
  it('changes the customer for every UNSAVED job under that heading, and no other', () => {
    const page = draftPage(PANDORAS, empty, ids);
    const saved = { ...page, jobs: page.jobs.map((j, i) => (i === 0 ? { ...j, savedJobId: 'job-1' } : j)) };

    const changed = setHeading(saved, 0, 'customer', { kind: 'existing', id: 'c9', name: 'Aoife B' });

    expect(changed.jobs[1]?.draft.customer.choice).toEqual({ kind: 'existing', id: 'c9', name: 'Aoife B' });
    // The saved job is left exactly as it was written.
    expect(changed.jobs[0]?.draft.customer.choice).toEqual({ kind: 'create', name: 'Aoife' });
  });

  it('matches a heading he already has, so nothing is created twice', () => {
    const owner = {
      customers: [customer('c1', 'Aoife')],
      properties: [property('p1', 'Pandoras Cottage')],
      recipes: [recipe('r1', 'Full Irish')],
    };
    const page = draftPage(PANDORAS, owner, ids);

    expect(page.jobs[1]?.draft.customer.choice).toEqual({ kind: 'existing', id: 'c1', name: 'Aoife' });
    expect(page.jobs[1]?.draft.dishes[0]?.choice).toEqual({ kind: 'existing', id: 'r1', name: 'Full Irish' });
  });
});

describe('saving one job does not make the next one create the same things again', () => {
  it('points every other job at the customer, property and recipes just created', () => {
    const page = draftPage(PANDORAS, empty, ids);
    const friday = page.jobs[0]!.draft;

    const settled = settleAcrossPage(page, friday, {
      customerId: 'c-new' as CustomerId,
      propertyId: 'p-new' as PropertyId,
      recipeIds: new Map([['Full Irish', 'r-new' as RecipeId]]),
    });

    const sunday = settled.jobs[1]!.draft;
    expect(sunday.customer.choice).toEqual({ kind: 'existing', id: 'c-new', name: 'Aoife' });
    expect(sunday.property.choice).toEqual({ kind: 'existing', id: 'p-new', name: 'Pandoras Cottage' });
    expect(sunday.dishes[0]?.choice).toEqual({ kind: 'existing', id: 'r-new', name: 'Full Irish' });
    // A recipe that was not created stays a creation.
    expect(sunday.dishes[1]?.choice).toEqual({ kind: 'create', name: 'Pancakes' });
  });
});

describe('a page written in block capitals', () => {
  const CAPS: PageRead = {
    ...PANDORAS,
    blocks: [
      {
        customer: 'AOIFE',
        property: 'PANDORAS COTTAGE',
        phone: null,
        sittings: [
          sitting({
            dayWritten: 'SUN. 22ND', timeWording: '10AM', guestsWording: '16PPL',
            dishes: ['10 x FULL IRISH', '3 X PANCAKES'],
          }),
        ],
      },
    ],
  };

  it('creates tidy names, and keeps the sheet’s capitals as the evidence', () => {
    const d = draftPage(CAPS, empty, ids).jobs[0]!.draft;

    expect(d.customer.read).toBe('AOIFE');
    expect(d.customer.choice).toEqual({ kind: 'create', name: 'Aoife' });
    expect(d.property.choice).toEqual({ kind: 'create', name: 'Pandoras Cottage' });
    expect(d.dishes.map((x) => x.read)).toEqual(['FULL IRISH', 'PANCAKES']);
    expect(d.dishes.map((x) => x.choice)).toEqual([
      { kind: 'create', name: 'Full Irish' },
      { kind: 'create', name: 'Pancakes' },
    ]);
  });

  it('still matches a capitals read to a recipe he already has', () => {
    const owner = { ...empty, recipes: [recipe('r1', 'Full Irish')] };
    const d = draftPage(CAPS, owner, ids).jobs[0]!.draft;

    expect(d.dishes[0]?.choice).toEqual({ kind: 'existing', id: 'r1', name: 'Full Irish' });
  });
});

describe('a dish he typed himself', () => {
  it('is created and settled under its trimmed name, not his stray spaces', () => {
    const page = draftPage(PANDORAS, empty, ids);
    const typed = withJob(page, 1, (d) => ({
      ...d,
      dishes: [...d.dishes, { read: null, matches: [], choice: { kind: 'create', name: 'Beef  stew ' }, portions: null }],
    }));
    const sunday = typed.jobs[1]!.draft;

    expect(creationsFromDraft(sunday).recipes).toContain('Beef stew');

    const settled = settleAcrossPage(typed, sunday, {
      customerId: null,
      propertyId: null,
      recipeIds: new Map([['Beef stew', 'r-stew' as RecipeId]]),
    });

    expect(settled.jobs[1]!.draft.dishes.at(-1)?.choice).toEqual({
      kind: 'existing', id: 'r-stew', name: 'Beef stew',
    });
  });
});

describe('the phone number beside the name is placed, never dropped', () => {
  /*
   * THE BUG THIS EXISTS FOR. The scanner was told to copy the customer's name
   * "without any phone number" and given nowhere else to put it, so Aoife's
   * 0862034359 vanished on every scan — while the screen said every line on the
   * page had been placed.
   */
  it('compares numbers by their digits, assuming no country prefix', () => {
    expect(phoneDigits('086 203 4359')).toBe(phoneDigits('086-2034359'));
    expect(phoneDigits('+353 86 203 4359')).not.toBe(phoneDigits('086 203 4359'));
  });

  it('saves it with a NEW customer, and lets him decline', () => {
    const page = draftPage(PANDORAS, empty, ids);
    expect(page.jobs[0]?.draft.customerPhone).toBe('0862034359');
    expect(phoneAction(page.jobs[0]!, [])).toEqual({ kind: 'with-new', phone: '0862034359', saving: true });

    const declined = setNewCustomerPhone(page, 0, false);
    expect(declined.jobs.map((j) => j.draft.customerPhone)).toEqual([null, null]);
    expect(phoneAction(declined.jobs[0]!, [])).toMatchObject({ kind: 'with-new', saving: false });
  });

  it('OFFERS it for an existing customer with no phone — it never writes it on its own', () => {
    const aoife = customer('c1', 'Aoife');
    const page = draftPage(PANDORAS, { ...empty, customers: [aoife] }, ids);

    expect(phoneAction(page.jobs[0]!, [aoife])).toEqual({ kind: 'offer', phone: '0862034359', customer: aoife });
  });

  it('says nothing to do when his record already has the same number, however written', () => {
    const aoife = { ...customer('c1', 'Aoife'), phone: '086 203 4359' };
    const page = draftPage(PANDORAS, { ...empty, customers: [aoife] }, ids);

    expect(phoneAction(page.jobs[0]!, [aoife])).toEqual({ kind: 'same', phone: '0862034359' });
  });

  it('shows a DIFFERENT number beside his and changes neither', () => {
    const aoife = { ...customer('c1', 'Aoife'), phone: '0871112222' };
    const page = draftPage(PANDORAS, { ...empty, customers: [aoife] }, ids);

    expect(phoneAction(page.jobs[0]!, [aoife])).toEqual({ kind: 'differs', phone: '0862034359', customer: aoife });
  });

  it('waits for a customer to be chosen when the name matched two', () => {
    const page = draftPage(
      PANDORAS,
      { ...empty, customers: [customer('c1', 'Aoife'), customer('c2', 'Aoife')] },
      ids,
    );

    expect(phoneAction(page.jobs[0]!, [])).toEqual({ kind: 'unassigned', phone: '0862034359' });
  });

  it('has nothing to say when the heading had no number', () => {
    const page = draftPage(TRANQUILITY, empty, ids);
    expect(phoneAction(page.jobs[0]!, [])).toEqual({ kind: 'none' });
  });
});

describe('a lone booking is just a job', () => {
  it('makes one job with no event group', () => {
    const one: PageRead = { ...PANDORAS, blocks: [{ ...PANDORAS.blocks[0]!, sittings: [PANDORAS.blocks[0]!.sittings[1]!] }] };
    const page = draftPage(one, empty, ids);

    expect(page.jobs).toHaveLength(1);
    expect(page.jobs[0]?.group).toBeNull();
  });
});

describe('validatePage — the browser and the scanner can ship in either order', () => {
  it('reads the page shape: headings, bookings, unplaced lines', () => {
    const reply = validatePage({
      read: {
        pageHeader: "PAUL - CATERING 20/21st NOV'26",
        blocks: [
          {
            customer: 'Aoife',
            property: 'Pandoras Cottage',
            phone: '0862034359',
            sittings: [{ dayWritten: 'FRI. 20TH', guestsWording: '13ppl', dishes: [], dietaries: [], uncertain: [] }],
          },
        ],
        unplaced: ['call Aoife Thursday'],
        uncertain: [],
      },
    });

    expect(reply.kind).toBe('read');
    if (reply.kind !== 'read') return;
    expect(reply.page.blocks[0]?.sittings[0]?.dayWritten).toBe('FRI. 20TH');
    expect(reply.page.unplaced).toEqual(['call Aoife Thursday']);
    expect(reply.page.blocks[0]?.phone).toBe('0862034359');
  });

  it('reads a heading with no phone field — an older scanner — as no phone, not an error', () => {
    const reply = validatePage({
      read: {
        pageHeader: null,
        blocks: [{ customer: 'Aoife', property: null, sittings: [] }],
        unplaced: [],
        uncertain: [],
      },
    });

    expect(reply.kind).toBe('read');
    if (reply.kind !== 'read') return;
    expect(reply.page.blocks[0]?.phone).toBeNull();
  });

  it('reads an OLDER single-job reply as a page with one booking', () => {
    const reply = validatePage({
      read: {
        customer: 'Nucella', property: 'Ardmore House', serviceDate: '2026-08-22',
        serviceTime: '18:30', serviceType: 'Buffet', guests: 24, guestsWording: null,
        dishes: ['Chicken curry'], dietaries: [], notes: null, uncertain: [],
      },
    });

    expect(reply.kind).toBe('read');
    if (reply.kind !== 'read') return;
    expect(reply.page.blocks).toHaveLength(1);
    expect(reply.page.blocks[0]?.sittings[0]?.guests).toBe(24);
    expect(draftPage(reply.page, empty, ids).jobs).toHaveLength(1);
  });

  it('moves a time in the wrong shape to the wording rather than losing it', () => {
    const reply = validatePage({
      read: { pageHeader: null, blocks: [{ sittings: [{ serviceTime: '7/7.30pm' }] }], unplaced: [], uncertain: [] },
    });

    expect(reply.kind === 'read' && reply.page.blocks[0]?.sittings[0]).toMatchObject({
      serviceTime: null,
      timeWording: '7/7.30pm',
    });
  });

  it('passes a refusal through untouched', () => {
    expect(validatePage({ reason: 'not a job sheet' })).toEqual({
      kind: 'unresolved',
      reason: 'not a job sheet',
    });
  });

  it('never turns a quoted guest number into a count — that is the wording’s job', () => {
    const reply = validatePage({
      read: { pageHeader: null, blocks: [{ sittings: [{ guests: '16ppl', guestsWording: '16ppl' }] }], unplaced: [], uncertain: [] },
    });

    expect(reply.kind === 'read' && reply.page.blocks[0]?.sittings[0]?.guests).toBeNull();
  });
});
