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
import { ingredientRepository, jobRepository, recipeRepository } from '../data/repositories';
import type { JobSheetReview } from './jobSheet';
import type { InvoiceReview } from './invoice';
import type { RecipeCardReview } from './recipeCard';
import type {
  CustomerId,
  Ingredient,
  IngredientId,
  IsoDate,
  IsoTime,
  Job,
  JobId,
  KitchenId,
  PropertyId,
  Recipe,
  RecipeId,
  RecipeLineId,
} from '../engine/types';

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

// ---------------------------------------------------------------------------
// Recipe cards and invoices
// ---------------------------------------------------------------------------

/**
 * Turn a reviewed card into the recipe that would be saved.
 *
 * Unquantified components survive as NAMES, in `unquantified`, with no quantity
 * field to hold a number. That is the shape `Recipe` already has for exactly this
 * reason — Rule 8 treats an unmeasured item as first-class rather than as a
 * missing measurement.
 *
 * Only MATCHED ingredients become components. A "new" one has no id to reference,
 * and creating it here would be the silent creation the scanner exists to avoid —
 * the owner adds it in Ingredients first.
 */
export function recipeFromReview(review: RecipeCardReview): Recipe {
  const matched = review.components.filter(
    (c): c is typeof c & { ingredient: { kind: 'matched'; record: Ingredient } } =>
      c.ingredient.kind === 'matched',
  );

  return {
    id: '' as RecipeId,
    kitchenId: '' as KitchenId,
    name: review.name ?? '',
    course: (review.course as Recipe['course']) ?? null,
    yieldType: review.yieldType ?? 'per_person',
    portionsPerBatch: review.portionsPerBatch,
    batchUnit: review.batchUnit,
    // Scanned, therefore unconfirmed. He has confirmed the READING is fair, which
    // is not the same as confirming the card was right.
    confidence: 'confirm',
    makeAheadDays: 0,
    sameDayOnly: true,
    freezable: false,
    onsiteFinish: false,
    method: review.method,
    note: null,
    components: matched.map((c, position) => ({
      id: '' as RecipeLineId,
      kind: 'ingredient' as const,
      ingredientId: c.ingredient.record.id as IngredientId,
      displayName: c.read,
      qty: c.qty,
      unit: c.unit,
      position,
    })),
    unquantified: review.unquantified.map((u) => ({
      id: '' as RecipeLineId,
      item: u.name,
      reason: u.reason,
    })),
  };
}

/** Its own type: a recipe id in a field called `jobId` is a trap for the reader. */
export type RecipeCommitResult =
  | { readonly ok: true; readonly recipeId: RecipeId }
  | { readonly ok: false; readonly error: string };

export async function commitScannedRecipe(
  db: Db,
  review: RecipeCardReview,
): Promise<RecipeCommitResult> {
  if (typeof review !== 'object' || review === null || !Array.isArray(review.gaps)) {
    return { ok: false, error: 'That is not a review the owner was shown, so it cannot be saved.' };
  }

  if (!review.readyToSave || review.gaps.length > 0) {
    return {
      ok: false,
      error: `${review.gaps.length} thing${review.gaps.length === 1 ? '' : 's'} still need confirming before this can be saved.`,
    };
  }

  try {
    return { ok: true, recipeId: await recipeRepository(db).save(recipeFromReview(review)) };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : 'Could not save the recipe.',
    };
  }
}

/**
 * Write the prices an invoice established.
 *
 * ONLY the lines the engine could price. An unconvertible unit or an unmatched
 * ingredient is left exactly as it was — the review already told him which, and
 * writing a partial price would be worse than writing none.
 *
 * The old price moves to `previousPrice` and `priceChecked` is stamped, so a rise
 * stays visible after the fact. `ingredient_price_history` also exists in the
 * schema and is NOT written here — it has no repository, and adding one is its
 * own change rather than something to slip into a scanner.
 */
export async function commitScannedPrices(
  db: Db,
  review: InvoiceReview,
  today: string,
): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  if (typeof review !== 'object' || review === null || !Array.isArray(review.lines)) {
    return { ok: false, error: 'That is not a review the owner was shown, so it cannot be saved.' };
  }

  if (!review.readyToSave) {
    return {
      ok: false,
      error: 'Some lines still need settling before these prices can be saved.',
    };
  }

  const repo = ingredientRepository(db);
  let updated = 0;

  try {
    for (const line of review.lines) {
      if (line.price.kind !== 'priced' || line.ingredient.kind !== 'matched') continue;

      const ingredient = line.ingredient.record;
      await repo.update(ingredient.id, {
        ...ingredient,
        pricePerPack: line.price.pricePerPack,
        previousPrice: ingredient.pricePerPack,
        priceChecked: today as Ingredient['priceChecked'],
      });
      updated += 1;
    }

    return { ok: true, updated };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : 'Could not save the prices.',
    };
  }
}
