/**
 * The Ask Sous transcript, and the thing it must never let happen.
 *
 * Losing the conversation on navigation was an accident, but it was doing real
 * safety work: a proposal could not outlive the data it was computed against,
 * because it could not outlive the component. Persisting the transcript takes
 * that protection away unless something replaces it.
 *
 * ---------------------------------------------------------------------------
 * THE FAILURE THIS FILE EXISTS TO PREVENT.
 *
 * A `Proposal` carries `impact` (a changeImpact diff) and `after` (the job as it
 * would be saved) — both computed from one snapshot of the data. Persist that,
 * navigate to Jobs, change the guest count, come back, tap confirm, and
 * `jobRepository.save(proposal.after)` writes a job built from data that has since
 * moved. Silently, and with a clean audit trail saying the owner approved it.
 *
 * So the transcript and the committable proposal are DIFFERENT PIECES OF STATE.
 * The transcript persists and holds a `ProposalRecord` — jobId and the owner's own
 * requested changes, nothing derived. The live `Proposal` lives in component state
 * and dies on unmount.
 *
 * The refusal is therefore structural rather than checked: the transcript has
 * nothing to hand `commitProposal`. `looksLikeProposal` demands `impact` and
 * `after`, and a `ProposalRecord` has neither — by construction, not by a guard
 * somebody has to remember.
 * ---------------------------------------------------------------------------
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  addExchange,
  emptyTranscript,
  turnsOf,
  type Exchange,
  type ProposalRecord,
} from '../../src/ui/transcript';
import { commitProposal } from '../../src/sous/commit';
import type { Db } from '../../src/data/db';
import type { Proposal } from '../../src/sous/tools';

const answer = { lead: 'You need 4 kg of Beef mince.', detail: [], flags: [] };

const record: ProposalRecord = { jobId: 'job-1', changes: { guests: 24 } };

const proposalTurn: Exchange = {
  question: 'change the dinner party to 24 guests',
  preamble: 'Sure, let me work that out:',
  answer: null,
  refusal: null,
  proposal: record,
  tool: { question: 'change the dinner party to 24 guests', tool: 'propose_job_change', args: {} },
};

/**
 * A db that records being reached.
 *
 * Asserting `ok === false` against a null db would pass even with the refusal
 * deleted, because the write would throw and be caught into the same shape. This
 * distinguishes "refused" from "tried and failed" — the same discipline
 * `commitScannedJob`'s test uses, and for the same reason.
 */
function watchfulDb(): { db: Db; reached: () => boolean } {
  let touched = false;
  const db = new Proxy(
    {},
    {
      get: () => {
        touched = true;
        return () => {
          throw new Error('the database must not be reached');
        };
      },
    },
  ) as Db;

  return { db, reached: () => touched };
}

// ---------------------------------------------------------------------------

describe('AN OLD PROPOSAL IN A PERSISTED TRANSCRIPT CANNOT BE COMMITTED', () => {
  it('refuses a persisted proposal record, without reaching the database', async () => {
    const transcript = addExchange(emptyTranscript(), proposalTurn);
    const persisted = transcript.exchanges[0]?.proposal;

    const { db, reached } = watchfulDb();
    // The cast is the whole point of the test: it is exactly what a future screen
    // would write if it believed the transcript held something committable.
    const result = await commitProposal(db, persisted as unknown as Proposal);

    expect(result.ok).toBe(false);
    expect(reached(), 'the database was reached — the refusal did not fire first').toBe(false);
  });

  it("says the owner was never shown it, rather than blaming the data", async () => {
    const { db } = watchfulDb();
    const result = await commitProposal(db, record as unknown as Proposal);

    if (result.ok) throw new Error('expected a refusal');
    expect(result.error).toContain('not a proposal the owner was shown');
  });

  /**
   * THE INVERSION, KEPT IN THE SUITE RATHER THAN RUN ONCE AND DESCRIBED.
   *
   * The test above passes trivially if `commitProposal` refuses everything. This
   * one adds `impact` and `after` back — reconstructing what the persisted type
   * would look like if someone widened it — and shows the refusal LIFTS. That is
   * what proves the two tests above are about the missing fields, and not about
   * an unrelated failure somewhere earlier.
   */
  it('the refusal is caused by the missing fields, and nothing else', async () => {
    const widened = {
      ...record,
      impact: { ingredients: [], batches: [], revenue: null, gapsIntroduced: [] },
      after: { id: 'job-1', guests: 24 },
    };

    const { db } = watchfulDb();
    const narrow = await commitProposal(db, record as unknown as Proposal);
    const wide = await commitProposal(db, widened as unknown as Proposal);

    // Both fail — the second on the write, which is refused here deliberately.
    // What matters is that they fail DIFFERENTLY: adding `impact` and `after`
    // lifts the shape refusal and nothing else does. That is what proves the two
    // tests above turn on the missing fields rather than on some earlier error.
    if (narrow.ok || wide.ok) throw new Error('expected both to fail');

    expect(narrow.error).toContain('not a proposal the owner was shown');
    expect(wide.error, 'widening the record did not lift the shape refusal').not.toContain(
      'not a proposal the owner was shown',
    );
  });
});

describe('the type system enforces the split too', () => {
  it('a ProposalRecord is not assignable to a Proposal', () => {
    /*
     * THE COMPILE-TIME HALF OF THE GUARANTEE, and it fails in the useful
     * direction: `@ts-expect-error` is itself an error when the line below stops
     * erroring. So widening `ProposalRecord` to carry `impact` and `after` — the
     * exact change that would make an old proposal committable — breaks the build
     * here, before any test runs.
     *
     * The runtime tests above prove `commitProposal` refuses one. This proves a
     * screen cannot even hand it over by accident.
     */
    // @ts-expect-error a persisted record carries none of a proposal's evidence
    const asProposal: Proposal = record;

    expect(asProposal).toBeDefined();
  });
});

describe('what the transcript is allowed to remember', () => {
  it('keeps the requested changes, which are the owner s own words', () => {
    const t = addExchange(emptyTranscript(), proposalTurn);

    expect(t.exchanges[0]?.proposal?.changes).toEqual({ guests: 24 });
  });

  it('KEEPS NO DERIVED FIGURE from a proposal', () => {
    // `changes` are what he asked for and stay true forever. `impact` is derived
    // from data that may since have moved, and a stale before/after rendered as
    // current is the failure this app keeps finding (Rule 8).
    const t = addExchange(emptyTranscript(), proposalTurn);
    const persisted = t.exchanges[0]?.proposal as unknown as Record<string, unknown>;

    expect(Object.keys(persisted).sort()).toEqual(['changes', 'jobId']);
  });
});

describe('history still carries QUESTIONS, never ANSWERS', () => {
  it('turnsOf yields only question, tool and args', () => {
    // The grounding property, now asserted at the boundary where persistence
    // could quietly widen it: a transcript that survives navigation is a bigger
    // temptation to feed back wholesale than one that does not.
    const t = addExchange(emptyTranscript(), {
      question: 'how much beef mince',
      preamble: null,
      answer,
      refusal: null,
      proposal: null,
      tool: { question: 'how much beef mince', tool: 'how_much_ingredient', args: { ingredient: 'beef mince' } },
    });

    const [turn] = turnsOf(t);
    expect(Object.keys(turn ?? {}).sort()).toEqual(['args', 'question', 'tool']);
  });

  it('no rendered answer text appears anywhere in what goes back to the model', () => {
    const t = addExchange(emptyTranscript(), {
      question: 'how much beef mince',
      preamble: null,
      answer,
      refusal: null,
      proposal: null,
      tool: { question: 'how much beef mince', tool: 'how_much_ingredient', args: {} },
    });

    expect(JSON.stringify(turnsOf(t))).not.toContain('4 kg');
  });

  it('an exchange that produced no tool contributes no turn', () => {
    const t = addExchange(emptyTranscript(), {
      question: 'what is the capital of France',
      preamble: null,
      answer: null,
      refusal: 'Sous only answers from your kitchen data.',
      proposal: null,
      tool: null,
    });

    expect(turnsOf(t)).toHaveLength(0);
  });
});

describe('the transcript module cannot reach the write path', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../../src/ui/transcript.ts', import.meta.url)),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  /*
   * Word boundaries, not substrings. `ProposalRecord` is the type this file
   * exists to define, and a bare `toContain('Proposal')` fires on it — the same
   * false positive as a guard matching "window" inside `windowFrom`. `\bProposal\b`
   * does not match `ProposalRecord`, because the R is a word character.
   */
  it.each([
    ['commitProposal', /\bcommitProposal\b/],
    ['the Proposal type', /\bProposal\b/],
    ['impact', /\bimpact\b/],
    ['after', /\bafter\b/],
  ])('never names %s', (_label, pattern) => {
    expect(source).not.toMatch(pattern);
  });
});
