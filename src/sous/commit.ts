/**
 * Performing a proposed change (Rule 7).
 *
 * "Any write triggered by AI requires human confirmation. Ask Sous and the
 * scanners produce a PROPOSAL with a before/after diff and downstream impact. A
 * separate explicit commit call, fired by the owner tapping confirm, performs the
 * write. THE MODEL CANNOT CALL COMMIT."
 *
 * That last sentence is the whole reason this file is separate rather than a
 * `kind: 'commit'` entry in the registry. Four things enforce it, and they are
 * independent — no single edit removes the guarantee:
 *
 *   1. This is not in `TOOLS`, so it is not in the schema the model receives.
 *   2. `runIntent` resolves names against `TOOLS`; a model returning
 *      `{tool: 'commit'}` finds nothing and is refused.
 *   3. Nothing in `tools.ts` imports this module — source-inspected.
 *   4. `commitProposal` accepts only a `Proposal`, which only the propose path
 *      constructs, and re-checks it before writing.
 *
 * The write itself goes through `jobRepository.save`, exactly as the Jobs screen
 * does, so the audit triggers fire identically. An AI-originated change is not a
 * special kind of write — it is an ordinary write that needed a confirmation
 * first, and Rule 10's trail records it like any other.
 */

import type { Db } from '../data/db';
import { jobRepository } from '../data/repositories';
import type { Proposal } from './tools';
import type { Job, JobId } from '../engine/types';

export type CommitResult =
  | { readonly ok: true; readonly jobId: JobId }
  | { readonly ok: false; readonly error: string };

/**
 * Does this object actually carry a proposal's evidence?
 *
 * Not paranoia about a hostile caller — there is one user and one bundle. It is
 * about the honest mistake: a future screen calling `commitProposal` with a
 * hand-built object would skip the diff the owner was shown, and Rule 7 is
 * specifically that he saw the before/after. An object with no `impact` was never
 * shown to anyone.
 */
function looksLikeProposal(value: unknown): value is Proposal {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Partial<Proposal>;
  return (
    typeof candidate.jobId === 'string' &&
    candidate.jobId !== '' &&
    typeof candidate.changes === 'object' &&
    candidate.changes !== null &&
    typeof candidate.impact === 'object' &&
    candidate.impact !== null &&
    typeof candidate.after === 'object' &&
    candidate.after !== null
  );
}

/**
 * Write a confirmed proposal.
 *
 * Called by the confirm handler in `AskSous.tsx` and nowhere else. It takes the
 * `Db` port rather than reaching for a client, so the write is the same audited
 * path every other screen uses.
 */
export async function commitProposal(db: Db, proposal: Proposal): Promise<CommitResult> {
  if (!looksLikeProposal(proposal)) {
    return {
      ok: false,
      error: 'That is not a proposal the owner was shown, so it cannot be saved.',
    };
  }

  if (Object.keys(proposal.changes).length === 0) {
    // Nothing to do is worth saying rather than writing an identical row and
    // producing an audit entry for a change that did not happen.
    return { ok: false, error: 'This proposal changes nothing.' };
  }

  try {
    const saved = await jobRepository(db).save(proposal.after as Job);
    return { ok: true, jobId: saved };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : 'Could not save the change.',
    };
  }
}
