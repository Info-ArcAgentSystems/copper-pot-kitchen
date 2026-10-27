/**
 * Saving an edited scan: the rows, and the order they are written in.
 *
 * TWO DOCUMENTED GUARANTEES CHANGE HERE, and neither is loosened by editing a
 * test to go green. Each is replaced by a stricter one.
 *
 * 1. `commit.ts` said: "It refuses to create a customer, property or recipe. A
 *    name flagged new is the owner's to add, deliberately, somewhere else."
 *
 *    "Somewhere else" was the whole problem. It meant leaving the scan, adding
 *    the record by hand, coming back and scanning again — so the scanner saved
 *    time only for a sheet naming people and dishes he already had, which is
 *    the sheet he least needs help with.
 *
 *    The narrower rule: creation is allowed ONLY for a name the scan read
 *    cleanly and could not find (`kind: 'new'`), only for records he was shown
 *    by name before confirming, and NEVER for an ambiguous or unread one.
 *    Choosing between candidates stays forbidden — that was always the part
 *    Rule 8 cared about, and nothing here touches it.
 *
 * 2. `guards.test.ts` said: "a saved job carries no dietaries, because scanned
 *    wording is not a count."
 *
 *    True, and it threw the wording away. The narrower rule: a saved job
 *    carries the wording VERBATIM as an unresolved dietary, still with no count
 *    anywhere — and `dietType`, `severity` and `excludesMeat` are only ever
 *    what he typed.
 *
 * THE ORDER MATTERS. Records are created before the job because the job
 * references them, and sequentially rather than at once because supabase-js has
 * no transaction: if the fourth recipe fails, three exist, and telling him
 * "nothing was saved" would be a lie he would discover as duplicates on his
 * next attempt.
 */

import { describe, expect, it } from 'vitest';
import { reviewJobSheet, type JobSheetRead } from '../../src/scan/jobSheet';
import { draftFromReview, draftToJob, stubRecipe, type JobSheetDraft } from '../../src/scan/jobDraft';
import { commitScannedDraft } from '../../src/scan/commit';
import type { Db, Row } from '../../src/data/db';
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
  customers: [customer('c1', 'Nucella')],
  properties: [property('p1', 'Ardmore House')],
  recipes: [recipe('r1', 'Chicken curry')],
};

const read = (over: Partial<JobSheetRead> = {}): JobSheetRead => ({
  customer: 'Nucella', property: 'Ardmore House', serviceDate: '2026-08-22',
  serviceTime: '18:30', serviceType: 'Buffet', guests: 24, guestsWording: null,
  dishes: ['Chicken curry'], dietaries: [], notes: null, uncertain: [],
  ...over,
});

const draftOf = (over: Partial<JobSheetRead> = {}): JobSheetDraft =>
  draftFromReview(reviewJobSheet(read(over), owner));

/**
 * A `Db` that mints a DISTINCT id per insert and can be told to fail on one
 * table.
 *
 * `tests/data/fakeDb.ts` returns the literal id "generated" for everything,
 * which cannot show that the third recipe's id reached the third dish — and it
 * has no way to inject a failure, which is the whole subject below. Hence a
 * local one rather than a weaker shared one.
 */
const trackingDb = (failOn?: { table: string; at?: number }): Db & {
  readonly writes: { table: string; rows: readonly Row[] }[];
} => {
  const writes: { table: string; rows: readonly Row[] }[] = [];
  const seen = new Map<string, number>();

  const insert = async (table: string, rows: readonly Row[]): Promise<Row[]> => {
    const n = (seen.get(table) ?? 0) + 1;
    seen.set(table, n);

    if (failOn !== undefined && failOn.table === table && (failOn.at ?? 1) === n) {
      throw new Error(`${table} refused`);
    }

    writes.push({ table, rows });
    return rows.map((r) => ({ ...r, id: `${table}-${n}` }));
  };

  return {
    writes,
    async selectAll() { return []; },
    async selectWhere() { return []; },
    async selectWhereIn() { return []; },
    insert,
    async upsert(table, rows) { return insert(table, rows); },
    async update(_t, id, patch) { return [{ id, ...patch }]; },
    async deleteWhere() {},
    async rpc(fn, args) {
      const n = (seen.get(fn) ?? 0) + 1;
      seen.set(fn, n);
      if (failOn !== undefined && failOn.table === fn && (failOn.at ?? 1) === n) {
        throw new Error(`${fn} refused`);
      }
      writes.push({ table: fn, rows: [args as Row] });
      return `${fn}-${n}`;
    },
  };
};

const noCreations = { customerId: null, propertyId: null, recipeIds: new Map<string, RecipeId>() };

// ---------------------------------------------------------------------------

describe('draftToJob — the rows he is confirming', () => {
  it('refuses to build a job from a draft with anything outstanding', () => {
    /*
     * There is NO path from an incomplete draft to a Job. Returning a Job with
     * a null guest count and letting the commit catch it later is how an
     * unconfirmed value gets saved and then forgotten.
     */
    const result = draftToJob(draftOf({ guests: null }), noCreations);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.gaps.map((g) => g.field)).toContain('guests');
  });

  it('carries the matched records and the read values', () => {
    const result = draftToJob(draftOf(), noCreations);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.job.customerId).toBe('c1');
    expect(result.job.propertyId).toBe('p1');
    expect(result.job.guests).toBe(24);
    expect(result.job.serviceDate).toBe('2026-08-22');
    expect(result.job.dishes.map((d) => d.recipeId)).toEqual(['r1']);
  });

  it('still never claims the guest count was confirmed', () => {
    // He confirmed the scan is a fair reading of the sheet. That is not the
    // same as confirming the sheet was right, and conflating them would tick a
    // readiness box nobody ticked. Unchanged by this feature.
    const result = draftToJob(draftOf(), noCreations);

    expect(result.ok && result.job.guestsConfirmed).toBe(false);
  });

  it('wires each created record to the thing that referenced it', () => {
    const draft = draftOf({
      customer: 'Laura',
      property: 'Nucella Lodge',
      dishes: ['Chicken curry', 'Pavlova', 'Tarte tatin'],
    });

    const result = draftToJob(draft, {
      customerId: 'c9' as CustomerId,
      propertyId: 'p9' as PropertyId,
      recipeIds: new Map([
        ['Pavlova', 'r8' as RecipeId],
        ['Tarte tatin', 'r9' as RecipeId],
      ]),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.job.customerId).toBe('c9');
    expect(result.job.propertyId).toBe('p9');
    // In sheet order, with the existing recipe first and the two new ones after.
    expect(result.job.dishes.map((d) => d.recipeId)).toEqual(['r1', 'r8', 'r9']);
  });

  it('refuses rather than dropping a dish whose recipe was never created', () => {
    /*
     * The silent failure this replaces. `jobFromReview` dropped any dish that
     * was not already a recipe, so a sheet with four unknown dishes saved a job
     * with an EMPTY menu and no complaint — no prep, no shopping, no cost, and
     * nothing on screen saying why.
     */
    const result = draftToJob(draftOf({ dishes: ['Pavlova'] }), noCreations);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.gaps.map((g) => g.field)).toContain('dish:0');
  });
});

describe('RULES 9, 12 and 16 — the dietary reaches the job intact', () => {
  const filled = (): JobSheetDraft => {
    const draft = draftOf({ dietaries: [{ wording: 'severe nut allergy — Ciara' }] });
    return {
      ...draft,
      dietaries: [
        {
          wording: 'severe nut allergy — Ciara',
          dietType: 'nut allergy',
          severity: 'severe',
          excludesMeat: false,
        },
      ],
    };
  };

  it('saves the sheet’s own words, verbatim, as UNRESOLVED', () => {
    /*
     * THE REPLACED GUARANTEE. The old rule dropped this entirely; the new one
     * keeps it as the only shape that is honest about it — `unresolved`, whose
     * presence on a job blocks exact purchase quantities under Rule 12 until he
     * allocates it to named guests.
     */
    const result = draftToJob(filled(), noCreations);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dietary = result.job.dietaries[0];
    expect(dietary?.kind).toBe('unresolved');
    expect(dietary?.kind === 'unresolved' && dietary.originalWording).toBe(
      'severe nut allergy — Ciara',
    );
  });

  it('carries only what he typed for the three it could not read', () => {
    const result = draftToJob(filled(), noCreations);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dietary = result.job.dietaries[0];
    expect(dietary?.dietType).toBe('nut allergy');
    expect(dietary?.severity).toBe('severe');
    expect(dietary?.excludesMeat).toBe(false);
    // Rule 9 again: it is for review, not assignment. He assigns a dish on the
    // job screen, where he can see the menu.
    expect(dietary?.assignedRecipeId).toBeNull();
  });

  it('has no count anywhere on the saved row (Rule 16)', () => {
    const draft = draftOf({ dietaries: [{ wording: '3 vegetarians' }] });
    const result = draftToJob(
      {
        ...draft,
        dietaries: [
          { wording: '3 vegetarians', dietType: 'vegetarian', severity: 'moderate', excludesMeat: true },
        ],
      },
      noCreations,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // ONE row holding the words, not three rows and not a 3 in a numeric field.
    expect(result.job.dietaries).toHaveLength(1);
    expect(
      Object.values(result.job.dietaries[0] ?? {}).some((v) => typeof v === 'number'),
      'a saved dietary has a numeric field',
    ).toBe(false);
  });

  it('cannot be saved at all while the severity is unsaid', () => {
    const result = draftToJob(draftOf({ dietaries: [{ wording: 'nut allergy' }] }), noCreations);

    expect(result.ok).toBe(false);
  });
});

describe('a scanned dish becomes a recipe that cannot lie about itself', () => {
  it('is a name and nothing else', () => {
    const stub = stubRecipe('Pavlova', KITCHEN);

    expect(stub.name).toBe('Pavlova');
    // Decision: components stays [], not nullable. An empty component list is
    // already what makes the cost null and the shopping line absent.
    expect(stub.components).toEqual([]);
    expect(stub.unquantified).toEqual([]);
  });

  it('claims no course, because the sheet named a dish and not a course', () => {
    // Guessing "main" from a dish name would be business data in src/ (Rule 1)
    // and would put it into a buffet split it was never part of.
    expect(stubRecipe('Pavlova', KITCHEN).course).toBeNull();
  });

  it('is marked as missing, not merely unconfirmed', () => {
    /*
     * `confirm` means "read from a card, check it". `missing` means nothing is
     * known — which is the truth about a name lifted off a menu line, and it is
     * what Prep and Money read to mark the line rather than drop it.
     */
    expect(stubRecipe('Pavlova', KITCHEN).confidence).toBe('missing');
  });

  it('invents no yield figures', () => {
    const stub = stubRecipe('Pavlova', KITCHEN);

    expect(stub.portionsPerBatch).toBeNull();
    expect(stub.batchUnit).toBeNull();
  });
});

describe('commitScannedDraft — created first, job last, one at a time', () => {
  it('refuses a draft with gaps WITHOUT touching the database', async () => {
    let reached = false;
    const db = new Proxy({}, {
      get() {
        reached = true;
        throw new Error('the database was reached for a draft with gaps');
      },
    }) as Db;

    const result = await commitScannedDraft(db, draftOf({ guests: null }), KITCHEN);

    expect(reached, 'a draft with gaps reached the database').toBe(false);
    expect(result.ok).toBe(false);
  });

  it('creates the customer, the property and each recipe BEFORE the job', async () => {
    const db = trackingDb();
    const draft = draftOf({
      customer: 'Laura',
      property: 'Nucella Lodge',
      dishes: ['Pavlova', 'Tarte tatin'],
    });

    const result = await commitScannedDraft(db, draft, KITCHEN);

    expect(result.ok).toBe(true);
    // The job references the others, so it cannot be written first.
    const tables = db.writes.map((w) => w.table);
    expect(tables.indexOf('save_job')).toBe(tables.length - 1);
    expect(tables.filter((t) => t === 'customers')).toHaveLength(1);
    expect(tables.filter((t) => t === 'properties')).toHaveLength(1);
  });

  it('creates nothing when everything on the sheet was already his', async () => {
    const db = trackingDb();

    const result = await commitScannedDraft(db, draftOf(), KITCHEN);

    expect(result.ok).toBe(true);
    expect(db.writes.map((w) => w.table)).toEqual(['save_job']);
  });

  it('REPORTS what it managed to create when a later step fails', async () => {
    /*
     * supabase-js has no transaction, so a partial write is a real outcome and
     * not a theoretical one. Saying "nothing was saved" would be a lie he would
     * discover as duplicates on his next attempt.
     */
    const db = trackingDb({ table: 'save_job' });
    const draft = draftOf({ customer: 'Laura', dishes: ['Pavlova'] });

    const result = await commitScannedDraft(db, draft, KITCHEN);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const done = result.created.filter((s) => s.ok).map((s) => s.what);
    expect(done).toContain('Laura');
    expect(done).toContain('Pavlova');
    expect(result.error).toContain('save_job');
  });

  it('stops at the first failure rather than writing on past it', async () => {
    // Creating the recipes after the customer failed would leave more orphans
    // behind for no gain: the job cannot be written either way.
    const db = trackingDb({ table: 'customers' });
    const draft = draftOf({ customer: 'Laura', dishes: ['Pavlova', 'Tarte tatin'] });

    const result = await commitScannedDraft(db, draft, KITCHEN);

    expect(result.ok).toBe(false);
    expect(db.writes.map((w) => w.table)).not.toContain('save_job');
    expect(db.writes.filter((w) => w.table === 'recipes')).toHaveLength(0);
  });

  it('RULE 11 — a created customer gets no guessed client group', async () => {
    /*
     * A rate is keyed on (client group, service type). Guessing "private"
     * because most of his work is private would make a rate APPLY to a job he
     * never priced, and the job would carry a revenue figure he never agreed
     * to. Null means no rate can match, so revenue stays blank — which is
     * Rule 8's answer and Rule 11's.
     */
    const db = trackingDb();

    await commitScannedDraft(db, draftOf({ customer: 'Laura' }), KITCHEN);

    const row = db.writes.find((w) => w.table === 'customers')?.rows[0];
    expect(row).toBeDefined();
    expect(row?.['client_group'] ?? null).toBeNull();
  });

  it('RULE 8 — a created property gets no guessed eircode or address', async () => {
    // An invented eircode is a van sent to the wrong house.
    const db = trackingDb();

    await commitScannedDraft(db, draftOf({ property: 'Nucella Lodge' }), KITCHEN);

    const row = db.writes.find((w) => w.table === 'properties')?.rows[0];
    expect(row?.['eircode'] ?? null).toBeNull();
    expect(row?.['address'] ?? null).toBeNull();
  });

  it('abandons the save the moment ONE creation fails', async () => {
    /*
     * Not merely "stops before the job" — it must not create the REST either.
     * Per-item error handling that pushed `ok: false` and carried on would
     * leave him with a half-made set of records and no job, which is the worst
     * of the available outcomes: the next scan matches some of them and
     * duplicates the others.
     *
     * (The first attempt at this inversion planted an unreachable defect and
     * passed, which is why the assertion is on the recipe writes rather than
     * on reaching `save_job`.)
     */
    const db = trackingDb({ table: 'customers' });
    const draft = draftOf({
      customer: 'Laura',
      property: 'Nucella Lodge',
      dishes: ['Pavlova', 'Tarte tatin'],
    });

    const result = await commitScannedDraft(db, draft, KITCHEN);

    expect(result.ok).toBe(false);
    expect(db.writes.map((w) => w.table)).toEqual([]);
    if (result.ok) return;
    // And nothing is claimed as created, because nothing was.
    expect(result.created.filter((c) => c.ok)).toEqual([]);
  });

  it('hands back the ids it created, so a retry does not duplicate them', async () => {
    const db = trackingDb({ table: 'save_job' });
    const draft = draftOf({ customer: 'Laura', dishes: ['Pavlova'] });

    const result = await commitScannedDraft(db, draft, KITCHEN);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The screen turns these into `existing` choices before offering Try again.
    expect(result.ids.customerId).toBe('customers-1');
    expect(result.ids.recipeIds.get('Pavlova')).toBe('save_recipe-1');
  });
});
