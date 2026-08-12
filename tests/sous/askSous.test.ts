/**
 * The client half: what it sends, and what it refuses.
 *
 * `askSous` never throws — every failure is a stated refusal, because this screen
 * is reached by someone in a kitchen who needs to know whether to look elsewhere,
 * not a stack trace.
 */

import { describe, expect, it } from 'vitest';
import { askSous, buildContext } from '../../src/sous/askSous';
import type { Customer, CustomerId, IsoDate, Job, JobId, KitchenId } from '../../src/engine/types';

const KITCHEN = 'k1' as KitchenId;

const job = (over: Partial<Job> = {}): Job => ({
  id: 'j1' as JobId,
  kitchenId: KITCHEN,
  customerId: 'c1' as CustomerId,
  propertyId: null,
  jobGroup: null,
  serviceDate: '2026-08-20' as IsoDate,
  serviceTime: null,
  serviceType: 'Buffet',
  guests: 10,
  guestsConfirmed: true,
  meatEatingGuests: null,
  pricing: { kind: 'rate_card' },
  status: 'confirmed',
  notes: null,
  dishes: [],
  dietaries: [],
  extras: [],
  ...over,
});

const customer: Customer = {
  id: 'c1' as CustomerId,
  kitchenId: KITCHEN,
  name: 'Nolan',
  phone: null,
  email: null,
  clientGroup: 'private',
  notes: null,
};

const reply = (body: unknown, status = 200) =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

const options = (send: typeof fetch) => ({ url: 'https://x/functions/v1/ask-sous', token: 't', send });

describe('the context sent to the model', () => {
  it('names jobs by id, with the labels needed to resolve "the Nolan job"', () => {
    const context = buildContext([job()], [], [], [customer], '2026-08-20');

    expect(context.jobs[0]?.jobId).toBe('j1');
    expect(context.jobs[0]?.customer).toBe('Nolan');
    expect(context.jobs[0]?.serviceDate).toBe('2026-08-20');
  });

  it('includes the guest count, which is a FACT the owner typed', () => {
    // Not a derived figure. The distinction is the whole of Rule 2.
    const context = buildContext([job()], [], [], [customer], '2026-08-20');
    expect(context.jobs[0]?.guests).toBe(10);
  });

  it('handles a job with no customer without inventing one', () => {
    const context = buildContext([job({ customerId: null })], [], [], [], '2026-08-20');
    expect(context.jobs[0]?.customer).toBeNull();
  });

  it('carries today, so the model can resolve "this weekend"', () => {
    expect(buildContext([], [], [], [], '2026-08-20').today).toBe('2026-08-20');
  });
});

describe('refusals, never throws', () => {
  it('refuses when the edge function is not deployed', async () => {
    // A real state right now, so it is worded as itself.
    const result = await askSous('x', buildContext([], [], [], [], 'd'), options(reply({}, 404)));

    expect(result.kind).toBe('unresolved');
    if (result.kind !== 'unresolved') return;
    expect(result.reason).toContain('not set up');
  });

  it('refuses when the network fails', async () => {
    const boom = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    const result = await askSous('x', buildContext([], [], [], [], 'd'), options(boom));

    expect(result.kind).toBe('unresolved');
    if (result.kind !== 'unresolved') return;
    expect(result.reason).toContain('Could not reach');
  });

  it('refuses a body that is not JSON', async () => {
    const bad = (async () => new Response('not json', { status: 200 })) as unknown as typeof fetch;

    expect((await askSous('x', buildContext([], [], [], [], 'd'), options(bad))).kind).toBe(
      'unresolved',
    );
  });

  it('REFUSES a tool the registry does not have, rather than running it', async () => {
    const result = await askSous(
      'x',
      buildContext([], [], [], [], 'd'),
      options(reply({ tool: 'commit', args: {} })),
    );

    expect(result.kind).toBe('unresolved');
  });

  it('accepts a registered tool', async () => {
    const result = await askSous(
      'x',
      buildContext([], [], [], [], 'd'),
      options(reply({ tool: 'shopping_for_range', args: { from: 'a', to: 'b' } })),
    );

    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.tool).toBe('shopping_for_range');
  });
});
