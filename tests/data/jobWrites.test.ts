/**
 * Saving a job.
 *
 * A job spans four tables, so the save goes through the `save_job` RPC — one
 * call, one transaction, one coherent audit entry. These tests pin the payload
 * shape against the fake `Db`.
 *
 * The load-bearing ones are the Rule 16 pair: no count field is sent, and two
 * guests with the same requirement arrive as two rows. That is what makes the
 * summing the rule forbids have no operand at the wire level, not just in the
 * TypeScript types.
 *
 * What these cannot prove is that the function is atomic, that RLS accepts the
 * call, or that the child triggers fire. Only `tests/integration/` can.
 */

import { describe, expect, it } from 'vitest';
import { jobRepository } from '../../src/data/repositories';
import { fakeDb } from './fakeDb';
import type {
  Cents,
  CustomerId,
  Job,
  JobDietary,
  JobDietaryId,
  JobDish,
  JobDishId,
  JobExtraId,
  JobId,
  KitchenId,
  RecipeId,
} from '../../src/engine/types';

const KITCHEN = 'k1' as KitchenId;

const job = (over: Partial<Job> = {}): Job => ({
  id: '' as JobId,
  kitchenId: KITCHEN,
  customerId: 'c1' as CustomerId,
  propertyId: null,
  jobGroup: null,
  serviceDate: '2026-07-22' as Job['serviceDate'],
  serviceTime: null,
  serviceType: 'Buffet',
  guests: 17,
  guestsConfirmed: false,
  meatEatingGuests: null,
  pricing: { kind: 'rate_card' },
  status: 'confirmed',
  notes: null,
  dishes: [],
  dietaries: [],
  extras: [],
  ...over,
});

const dish = (over: Partial<JobDish> = {}): JobDish => ({
  id: '' as JobDishId,
  jobId: '' as JobId,
  recipeId: 'lasagne' as RecipeId,
  portions: 12,
  note: null,
  position: 0,
  ...over,
});

const allocated = (guest: string, dietType = 'vegetarian'): JobDietary => ({
  kind: 'allocated',
  id: '' as JobDietaryId,
  jobId: '' as JobId,
  dietType,
  severity: 'moderate',
  excludesMeat: true,
  details: null,
  assignedRecipeId: null,
  guest: guest as never,
});

const payloadOf = (db: ReturnType<typeof fakeDb>) => {
  const call = db.calls.find((c) => c.op === 'rpc');
  expect(call, 'no rpc call was issued').toBeDefined();
  expect(call?.table, 'wrong function called').toBe('save_job');
  return call?.payload as {
    p_job: Record<string, unknown>;
    p_dishes: Record<string, unknown>[];
    p_dietaries: Record<string, unknown>[];
    p_extras: Record<string, unknown>[];
  };
};

describe('save', () => {
  it('sends header, dishes, dietaries and extras in ONE call', async () => {
    // Four round trips would leave a half-edited job on failure, and would
    // scatter one edit across job_changes as several unrelated changes.
    const db = fakeDb({}, 'new-id');
    await jobRepository(db).save(
      job({
        dishes: [dish()],
        dietaries: [allocated('g1')],
        extras: [
          { id: '' as JobExtraId, jobId: '' as JobId, label: 'Steak surcharge', amountEach: 1500 as Cents, quantity: 4 },
        ],
      }),
    );

    expect(db.calls.filter((c) => c.op === 'rpc')).toHaveLength(1);
    expect(db.calls.some((c) => c.op === 'insert' || c.op === 'delete')).toBe(false);
  });

  it('sends null id for a new job, so the database mints one', async () => {
    const db = fakeDb({}, 'new-id');
    await jobRepository(db).save(job());

    expect(payloadOf(db).p_job['id']).toBeNull();
  });

  it('sends the existing id when editing', async () => {
    const db = fakeDb({}, 'j1');
    await jobRepository(db).save(job({ id: 'j1' as JobId }));

    expect(payloadOf(db).p_job['id']).toBe('j1');
  });

  it('does NOT send kitchen_id — the function resolves it from my_kitchen_id()', async () => {
    const db = fakeDb({}, 'x');
    await jobRepository(db).save(job());

    expect(payloadOf(db).p_job).not.toHaveProperty('kitchen_id');
  });

  it('returns the id the function reports', async () => {
    const db = fakeDb({}, 'minted-id');
    expect(await jobRepository(db).save(job())).toBe('minted-id');
  });
});

describe('RULE 16 — nothing summable crosses the wire', () => {
  it('sends no count field on a dietary, of any name', async () => {
    const db = fakeDb({}, 'x');
    await jobRepository(db).save(job({ dietaries: [allocated('g1')] }));

    const [row] = payloadOf(db).p_dietaries;
    for (const key of ['guests', 'count', 'quantity', 'qty', 'headcount', 'num_guests']) {
      expect(row, `a dietary carried a summable "${key}"`).not.toHaveProperty(key);
    }
  });

  it('sends TWO rows for two guests with the same requirement', async () => {
    // Not one row with a 2. That row is what a later screen would add up.
    const db = fakeDb({}, 'x');
    await jobRepository(db).save(
      job({ dietaries: [allocated('g1'), allocated('g2')] }),
    );

    const rows = payloadOf(db).p_dietaries;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r['guest_ref'])).toEqual(['g1', 'g2']);
  });

  it('sends the SAME guest ref twice for one guest with two requirements', async () => {
    // Coeliac and vegetarian is one person. Counting rows would say two; the
    // distinct guest refs say one, which is why the engine counts those.
    const db = fakeDb({}, 'x');
    await jobRepository(db).save(
      job({ dietaries: [allocated('g1', 'coeliac'), allocated('g1', 'vegetarian')] }),
    );

    const rows = payloadOf(db).p_dietaries;
    expect(rows.map((r) => r['guest_ref'])).toEqual(['g1', 'g1']);
    expect(new Set(rows.map((r) => r['guest_ref'])).size).toBe(1);
  });
});

describe('RULE 12 — unresolved wording survives the trip verbatim', () => {
  const unresolved: JobDietary = {
    kind: 'unresolved',
    id: '' as JobDietaryId,
    jobId: '' as JobId,
    dietType: 'vegetarian',
    severity: 'moderate',
    excludesMeat: true,
    details: null,
    assignedRecipeId: null,
    originalWording: 'a few vegetarians',
  };

  it('sends the owner’s words, unparsed', async () => {
    const db = fakeDb({}, 'x');
    await jobRepository(db).save(job({ dietaries: [unresolved] }));

    const [row] = payloadOf(db).p_dietaries;
    expect(row?.['unresolved_note']).toBe('a few vegetarians');
    expect(row?.['guests_unresolved']).toBe(true);
    // "a few" was not turned into a number on the way out.
    expect(row?.['guest_ref']).toBeNull();
  });

  it('flags an allocated dietary as resolved, with no wording', async () => {
    const db = fakeDb({}, 'x');
    await jobRepository(db).save(job({ dietaries: [allocated('g1')] }));

    const [row] = payloadOf(db).p_dietaries;
    expect(row?.['guests_unresolved']).toBe(false);
    expect(row?.['unresolved_note']).toBeNull();
  });
});

describe('RULE 8 — a blank is null, never zero', () => {
  it('keeps a dish with no portions as null, distinct from zero', async () => {
    // Null means "let applyBuffetSplit derive it from the guest count". Zero
    // would mean "make none of this dish" — the opposite instruction.
    const db = fakeDb({}, 'x');
    await jobRepository(db).save(job({ dishes: [dish({ portions: null })] }));

    const [row] = payloadOf(db).p_dishes;
    expect(row?.['portions']).toBeNull();
    expect(row?.['portions']).not.toBe(0);
  });

  it('keeps an unpriced extra as null, so revenue goes null rather than free', async () => {
    const db = fakeDb({}, 'x');
    await jobRepository(db).save(
      job({
        extras: [
          { id: '' as JobExtraId, jobId: '' as JobId, label: 'Late finish', amountEach: null, quantity: 1 },
        ],
      }),
    );

    const [row] = payloadOf(db).p_extras;
    expect(row?.['amount_each']).toBeNull();
    expect(row?.['amount_each']).not.toBe(0);
  });

  it('keeps an unknown guest count as null', async () => {
    const db = fakeDb({}, 'x');
    await jobRepository(db).save(job({ guests: null }));

    expect(payloadOf(db).p_job['guests']).toBeNull();
  });
});

describe('RULE 11 — pricing crosses as a union, not a bare number', () => {
  it('sends no figure under the rate card, but does say the rate card applies', async () => {
    // `price_source` is stated rather than left null. That is what lets the audit
    // trigger log a later override AS an override (Rule 11) instead of as an
    // ordinary edit to a price that came from nowhere.
    const db = fakeDb({}, 'x');
    await jobRepository(db).save(job({ pricing: { kind: 'rate_card' } }));

    expect(payloadOf(db).p_job['price']).toBeNull();
    expect(payloadOf(db).p_job['price_source']).toBe('rate_card');
  });

  it('marks an override as manual, in euros for a numeric column', async () => {
    const db = fakeDb({}, 'x');
    await jobRepository(db).save(job({ pricing: { kind: 'override', amount: 46000 as Cents } }));

    expect(payloadOf(db).p_job['price']).toBe(460);
    expect(payloadOf(db).p_job['price_source']).toBe('manual');
  });
});

describe('RULE 15 — a closed job is still saveable', () => {
  it('sends a cancelled job like any other, with no lock and no special path', async () => {
    // Status is a state, not a lock. A late invoice or a misremembered guest
    // count still has to be correctable, and the trigger logs the correction.
    const db = fakeDb({}, 'j1');
    await jobRepository(db).save(job({ id: 'j1' as JobId, status: 'cancelled', guests: 12 }));

    expect(payloadOf(db).p_job['status']).toBe('cancelled');
    expect(payloadOf(db).p_job['guests']).toBe(12);
  });

  it('saves a paid job the same way', async () => {
    const db = fakeDb({}, 'j1');
    await jobRepository(db).save(job({ id: 'j1' as JobId, status: 'paid' }));

    expect(db.calls.filter((c) => c.op === 'rpc')).toHaveLength(1);
  });
});

describe('ordering', () => {
  it('numbers dish positions from the order on screen', async () => {
    const db = fakeDb({}, 'x');
    await jobRepository(db).save(
      job({
        dishes: [dish({ recipeId: 'curry' as RecipeId }), dish({ recipeId: 'lasagne' as RecipeId })],
      }),
    );

    expect(payloadOf(db).p_dishes.map((d) => d['position'])).toEqual([0, 1]);
  });
});

describe('remove', () => {
  it('deletes the job by id and lets the children cascade', async () => {
    const db = fakeDb();
    await jobRepository(db).remove('j1' as JobId);

    const call = db.calls.find((c) => c.op === 'delete');
    expect(call?.table).toBe('jobs');
    expect(call?.column).toBe('id');
    expect(call?.value).toBe('j1');
  });
});
