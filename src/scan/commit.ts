/**
 * Saving a reviewed job sheet (Rule 7).
 *
 * "Any write triggered by AI requires human confirmation. Ask Sous and THE
 * SCANNERS produce a proposal with a before/after diff and downstream impact. A
 * separate explicit commit call, fired by the owner tapping confirm, performs the
 * write."
 *
 * A scan has no "before" — the job does not exist yet — so the diff the owner is
 * shown is the whole review: every field, every gap, every name that is new to
 * his data. That is what he is confirming, and this file will not write anything
 * it cannot show came from one.
 *
 * FOUR INDEPENDENT THINGS keep OCR off the database, mirroring `sous/commit.ts`:
 *
 *   1. Nothing in `parseImage.ts` or `jobSheet.ts` imports a repository, so the
 *      read and review paths have no way to write — source-inspected.
 *   2. This function takes a `JobSheetReview`, which only `reviewJobSheet`
 *      builds, and re-checks its shape before writing.
 *   3. It REFUSES a review with outstanding gaps. An unread guest count cannot
 *      be saved as null by accident and then be forgotten.
 *   4. It refuses to create a customer, property or recipe. A name flagged new
 *      is the owner's to add, deliberately, somewhere else.
 *
 * The write goes through `jobRepository.save`, exactly as the Jobs screen does,
 * so the audit triggers fire identically. A scanned job is not a special kind of
 * write — it is an ordinary write that needed a confirmation first.
 */

import type { Db } from '../data/db';
import { jobRepository } from '../data/repositories';
import type { JobSheetReview } from './jobSheet';
import type { CustomerId, IsoDate, IsoTime, Job, JobId, PropertyId } from '../engine/types';

export type ScanCommitResult =
  | { readonly ok: true; readonly jobId: JobId }
  | { readonly ok: false; readonly error: string };

/**
 * Turn a reviewed sheet into the job that would be saved.
 *
 * Exported so the screen can show the owner the exact rows before he confirms,
 * rather than a summary of them. PURE — it writes nothing, and it invents
 * nothing: every value here came off the sheet or was typed by him afterwards.
 */
export function jobFromReview(review: JobSheetReview): Job {
  return {
    // Empty means "new" to `save_job`, which mints the id. Kitchen comes from
    // `my_kitchen_id()` inside the RPC, never from here.
    id: '' as JobId,
    kitchenId: '' as Job['kitchenId'],
    customerId: review.customer.kind === 'matched' ? (review.customer.record.id as CustomerId) : null,
    propertyId: review.property.kind === 'matched' ? (review.property.record.id as PropertyId) : null,
    jobGroup: null,
    serviceDate: review.serviceDate as IsoDate | null,
    serviceTime: review.serviceTime as IsoTime | null,
    serviceType: review.serviceType,
    guests: review.guests,
    // FALSE, always. The count came off a photograph, and the owner confirming
    // that the scan is a fair reading of the sheet is not the same as confirming
    // the sheet was right. He ticks that on the job itself.
    guestsConfirmed: false,
    meatEatingGuests: null,
    pricing: { kind: 'rate_card' },
    status: 'enquiry',
    notes: review.notes,
    // Only dishes matching a recipe he already has. A dish flagged `new` is not
    // silently created as a recipe, and a job cannot reference one that has no
    // row — so it is left off and stays on the review as something to add.
    dishes: review.dishes.flatMap((d, position) =>
      d.kind === 'matched'
        ? [
            {
              id: '' as Job['dishes'][number]['id'],
              jobId: '' as JobId,
              recipeId: d.record.id,
              // Null lets applyBuffetSplit derive portions from the guest count.
              // Zero would mean "make none of this dish".
              portions: null,
              note: null,
              position,
            },
          ]
        : [],
    ),
    // Rule 16: scanned wording is never a count, and this file will not invent
    // the per-guest allocation that would make it one. Dietaries are added on
    // the job screen, where guests can actually be named.
    dietaries: [],
    extras: [],
  };
}

function looksLikeReview(value: unknown): value is JobSheetReview {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Partial<JobSheetReview>;
  return (
    typeof candidate.customer === 'object' &&
    candidate.customer !== null &&
    Array.isArray(candidate.dishes) &&
    Array.isArray(candidate.gaps) &&
    Array.isArray(candidate.newThings) &&
    typeof candidate.readyToSave === 'boolean'
  );
}

/**
 * Save a confirmed review.
 *
 * Called by the confirm handler in `ScanJobSheet.tsx` and nowhere else.
 */
export async function commitScannedJob(
  db: Db,
  review: JobSheetReview,
): Promise<ScanCommitResult> {
  if (!looksLikeReview(review)) {
    return { ok: false, error: 'That is not a review the owner was shown, so it cannot be saved.' };
  }

  if (!review.readyToSave || review.gaps.length > 0) {
    // Rule 8 with teeth. Saving around a gap is how a guessed value gets in —
    // not by being invented here, but by being absent and then forgotten.
    return {
      ok: false,
      error: `${review.gaps.length} thing${review.gaps.length === 1 ? '' : 's'} still need confirming before this can be saved.`,
    };
  }

  try {
    return { ok: true, jobId: await jobRepository(db).save(jobFromReview(review)) };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : 'Could not save the job.',
    };
  }
}
