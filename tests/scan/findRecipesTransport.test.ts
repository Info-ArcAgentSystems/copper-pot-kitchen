/**
 * THE SEARCH REQUEST ITSELF — how long it may take, and what it says when it
 * takes longer.
 *
 * `findRecipes.ts`'s other tests are about the SHAPE of a reply. This is about
 * the call: `fetch` has no timeout of its own, so a function that hangs left the
 * button reading "Searching…" for as long as the tab stayed open, with no way
 * back but a reload. There is no error to catch in that state and nothing on
 * screen changes, so it is indistinguishable from slow — and the real thing IS
 * slow: two live calls against the deployed function returned in 21.7s and
 * 22.6s, because it runs a hosted web search and then reads the pages it finds.
 *
 * These run in milliseconds against an injected `send`, so the behaviour is
 * proved without waiting a minute for it.
 */

import { describe, expect, it } from 'vitest';
import { FIND_TIMEOUT_MS, findRecipes } from '../../src/scan/findRecipes';

const options = (send: typeof fetch, timeoutMs?: number) => ({
  url: 'https://example.test/functions/v1/find-recipes',
  token: 'token',
  send,
  timeoutMs,
});

/** A `send` that never answers, and reports the signal it was handed. */
const hangs = (): { send: typeof fetch; signal: () => AbortSignal | undefined } => {
  let seen: AbortSignal | undefined;

  const send = ((_url: string, init?: RequestInit) => {
    seen = init?.signal ?? undefined;

    return new Promise<Response>((_resolve, reject) => {
      // Rejecting on abort is what a real fetch does, and it is the only way
      // out of this promise — nothing else resolves it.
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
  }) as unknown as typeof fetch;

  return { send, signal: () => seen };
};

const answers = (body: unknown): typeof fetch =>
  (() =>
    Promise.resolve({
      status: 200,
      json: () => Promise.resolve(body),
    } as unknown as Response)) as unknown as typeof fetch;

describe('a request that never finishes is stopped', () => {
  it('gives up, rather than waiting for ever', async () => {
    const { send } = hangs();

    const reply = await findRecipes('lasagne', [], options(send, 20));

    expect(reply.kind).toBe('unresolved');
    // The NUMBER is not asserted: it is this call's own 20ms, which is a test
    // fixture rather than anything the owner ever sees. What is asserted is
    // that it says it gave up waiting, and in how long.
    expect(reply.kind === 'unresolved' && reply.reason).toMatch(
      /did not answer within \d+ seconds?, so it was stopped/,
    );
  });

  it('ABORTS the request, instead of just walking away from it', async () => {
    /*
     * The difference matters and is not cosmetic. Racing a timer against the
     * promise would free the screen while the request carried on in the
     * background — and a reply landing after he had given up and pressed again
     * would set the candidate list from the attempt he had already abandoned.
     */
    const { send, signal } = hangs();

    await findRecipes('lasagne', [], options(send, 20));

    expect(signal(), 'no signal was passed to the request').toBeDefined();
    expect(signal()?.aborted, 'the request was abandoned but never cancelled').toBe(true);
  });

  it('says it TIMED OUT, not that it could not be reached', async () => {
    /*
     * They ask different things of him. "Could not reach" means check the
     * connection; a search that was reached, thought about it for a minute and
     * gave up means try a simpler name or write the components yourself. One
     * message for both sends him to the wrong one half the time.
     */
    const { send } = hangs();
    const timedOut = await findRecipes('lasagne', [], options(send, 20));

    const refused = (() => Promise.reject(new Error('network down'))) as unknown as typeof fetch;
    const unreachable = await findRecipes('lasagne', [], options(refused, 20));

    expect(timedOut.kind === 'unresolved' && timedOut.reason).not.toBe(
      unreachable.kind === 'unresolved' && unreachable.reason,
    );
    expect(unreachable.kind === 'unresolved' && unreachable.reason).toBe(
      'Could not reach the recipe search.',
    );
  });
});

describe('a request that DOES finish is left alone', () => {
  it('cancels its own timer, so a slow search is not killed after the fact', async () => {
    /*
     * Without `clearTimeout`, the abort still fires after the reply has landed.
     * Harmless for a one-shot call and not harmless at all for the next one:
     * the pending timer belongs to a controller nothing is watching any more,
     * and the bug it creates — an occasional cancelled search, only when the
     * owner searches twice inside a minute — is the kind nobody can reproduce.
     */
    let seen: AbortSignal | undefined;
    const send = ((_url: string, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ candidates: [] }),
      } as unknown as Response);
    }) as unknown as typeof fetch;

    const reply = await findRecipes('lasagne', [], options(send, 10));

    expect(reply.kind).toBe('found');

    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(seen?.aborted, 'the timer outlived the request it was guarding').toBe(false);
  });

  it('still returns the candidates it was given', async () => {
    const reply = await findRecipes(
      'lasagne',
      [],
      options(
        answers({
          candidates: [
            {
              title: 'Beef bourguignon',
              sourceUrl: 'https://example.test/bb',
              yieldType: 'batch',
              portionsPerBatch: 6,
              ingredients: [{ name: 'braising steak', qty: 1.6, unit: 'kg' }],
            },
          ],
        }),
      ),
    );

    expect(reply.kind).toBe('found');
    expect(reply.kind === 'found' && reply.candidates[0]?.ingredients[0]?.qty).toBe(1.6);
  });
});

describe('the default allows for how slow the real thing is', () => {
  it('leaves room above the measured time, rather than guessing low', () => {
    /*
     * 21.7s and 22.6s measured against the deployed function. A timeout set
     * near that would cancel searches that were about to succeed, which is
     * worse than slow: he retries, waits again, and the retry is no more likely
     * to land than the one that was killed.
     */
    expect(FIND_TIMEOUT_MS).toBeGreaterThan(23_000 * 2);
    // And an upper bound, because "no timeout" must not come back wearing a
    // number. Five minutes of a button saying "Searching…" is the old defect.
    expect(FIND_TIMEOUT_MS).toBeLessThanOrEqual(120_000);
  });
});
