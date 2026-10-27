/**
 * A scanned job sheet the owner can FIX, on the screen he is already looking at.
 *
 * The scan used to be read-only, which made it a dead end rather than a
 * shortcut. `reviewJobSheet` raises a gap for any dietary wording on the sheet,
 * `readyToSave` is `gaps.length === 0`, and `commitScannedJob` refuses while a
 * gap stands — so a sheet mentioning an allergy, which is most real sheets,
 * could not be saved at all, because there was nowhere to clear it. The owner's
 * only route was to photograph the sheet, read the result, and then type the
 * whole job again on another screen.
 *
 * So the review's values drop into editable fields and he corrects what is
 * wrong in place. The gaps are then recomputed FROM THE DRAFT rather than from
 * the photograph.
 *
 * NOTHING ABOUT RULE 8 IS RELAXED BY THAT. What changes is who may fill a gap,
 * not whether one may be guessed:
 *
 *   `from` is the review, kept verbatim and never written to. The sheet's own
 *   words are the evidence, and he needs them beside the box to judge it.
 *
 *   No field is prefilled from another field, from today's date, or from the
 *   last job. An unread date is an EMPTY box, not the coming Saturday — the
 *   most tempting default in the whole app, right often enough to be trusted
 *   and wrong often enough to move a shopping list.
 *
 *   A name the review refused to resolve is not resolved here. Several
 *   candidates stays several candidates; `choice` is `none` and he picks.
 *
 * PURE. No React, no repositories, no network. Values in, values out.
 */

import type { DietarySeverity } from '../engine/types';
import type { Gap, JobSheetReview, Resolved } from './jobSheet';

/**
 * What a record on the sheet turns into — pick one he has, or create one he
 * does not.
 *
 * A union rather than two nullable fields, because "picked AND to-create" is
 * not a state that should be expressible: it is how a scan ends up creating a
 * duplicate of someone already in the book.
 */
export type NameChoice =
  | { readonly kind: 'none' }
  | { readonly kind: 'existing'; readonly id: string; readonly name: string }
  | { readonly kind: 'create'; readonly name: string };

export interface NameDraft {
  /** Verbatim from the sheet. Never changed by editing — it is the evidence. */
  readonly read: string | null;
  /**
   * The candidates, when the read matched more than one. Naming them is an
   * answer; picking one would be a guess, so `choice` stays `none`.
   */
  readonly matches: readonly string[];
  readonly choice: NameChoice;
}

/**
 * One dietary requirement off the sheet.
 *
 * Three of these four fields CANNOT come off a photograph, and the scanner does
 * not pretend otherwise:
 *
 *   dietType      Rule 1 — a list of diet names in `src/` is business data
 *   severity      Rule 9 — reading "severe" off the page is still the model
 *                 deciding an allergy's gravity, and defaulting to `info` would
 *                 quietly downgrade a nut allergy to a note
 *   excludesMeat  it splits a BBQ's meat count from its sides count, so a guess
 *                 here changes how much mince he buys
 *
 * `wording` is the fourth and the only one the sheet can supply. Rule 12: kept
 * exactly as written, never parsed, and never turned into a count (Rule 16).
 */
export interface DietaryDraft {
  readonly wording: string;
  readonly dietType: string;
  readonly severity: DietarySeverity | null;
  readonly excludesMeat: boolean;
}

export interface JobSheetDraft {
  /** The review this came from, untouched. The chips are derived against it. */
  readonly from: JobSheetReview;

  readonly customer: NameDraft;
  readonly property: NameDraft;
  /** Form text, so an empty box is empty rather than a zero or a null guess. */
  readonly serviceDate: string;
  readonly serviceTime: string;
  readonly serviceType: string;
  readonly guests: string;
  /** Rule 12 — his words for a vague count, kept whatever he types in the box. */
  readonly guestsWording: string | null;
  readonly dishes: readonly NameDraft[];
  readonly dietaries: readonly DietaryDraft[];
  readonly notes: string;
}

/** The records a save would create, named for him to read BEFORE he confirms. */
export interface Creations {
  readonly customers: readonly string[];
  readonly properties: readonly string[];
  readonly recipes: readonly string[];
}

/**
 * How a field's current value came about. DERIVED by comparing the box with
 * what the sheet said, never stored — two copies of this would drift, and the
 * chip would end up describing an edit that did not happen.
 */
export type FieldOrigin = 'scanned' | 'blank' | 'edited';

export function originOf(read: string | null, now: string): FieldOrigin {
  const sheet = read ?? '';

  if (now.trim() === sheet.trim()) return sheet.trim() === '' ? 'blank' : 'scanned';
  return 'edited';
}

/** A resolved name as a choice. Matched becomes picked; new becomes creatable. */
function choiceOf<T extends { id: string; name: string }>(resolved: Resolved<T>): NameChoice {
  switch (resolved.kind) {
    case 'matched':
      return { kind: 'existing', id: resolved.record.id, name: resolved.record.name };
    case 'new':
      // Read cleanly, simply not in his data. The ONE case where creating on
      // save is honest, because nothing was guessed to get here.
      return { kind: 'create', name: resolved.read };
    default:
      /*
       * `ambiguous` and `missing` both land here, and neither may be turned
       * into a creation. Creating a third "Byrne" because two already matched
       * is the worst of the three possible wrong answers.
       */
      return { kind: 'none' };
  }
}

const nameDraft = <T extends { id: string; name: string }>(resolved: Resolved<T>): NameDraft => ({
  read: resolved.kind === 'missing' ? null : resolved.read,
  matches: resolved.kind === 'ambiguous' ? resolved.matches : [],
  choice: choiceOf(resolved),
});

/** Empty string for an unread value — never a default, never another field. */
const box = (value: string | null): string => value ?? '';

export function draftFromReview(review: JobSheetReview): JobSheetDraft {
  return {
    from: review,
    customer: nameDraft(review.customer),
    property: nameDraft(review.property),
    serviceDate: box(review.serviceDate),
    serviceTime: box(review.serviceTime),
    serviceType: box(review.serviceType),
    // A figure the sheet stated plainly, as text for the box. Null stays empty:
    // `String(null)` would put the word "null" in front of him.
    guests: review.guests === null ? '' : String(review.guests),
    /*
     * Rule 12. Taken from the gap the review raised for it, because that is
     * where `reviewJobSheet` puts the wording — and it is kept even after he
     * fills the box, so the next person reading the job can see that the sheet
     * said "a few" and 18 was his answer to it.
     */
    guestsWording: review.gaps.find((g) => g.field === 'guests')?.saw ?? null,
    dishes: review.dishes.map(nameDraft),
    dietaries: review.dietaries.map((d) => ({
      wording: d.wording,
      dietType: '',
      severity: null,
      excludesMeat: false,
    })),
    notes: box(review.notes),
  };
}

/** Whole numbers only, and nothing else — not a rounding, not a "probably". */
const guestCount = (text: string): number | null => {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!/^[0-9]+$/.test(trimmed)) return null;
  return Number(trimmed);
};

/**
 * What still stands between this draft and a job — recomputed from the BOXES.
 *
 * This replaces `review.gaps` as the save gate. The review's gaps describe the
 * photograph; these describe what he has in front of him now, which is the only
 * thing he can act on.
 *
 * Deliberately NOT a gap any more: a dish with no recipe. It used to make the
 * sheet unsaveable; it is now a stub he is told about before he confirms, and
 * `creationsFromDraft` is what tells him.
 */
export function draftGaps(draft: JobSheetDraft): readonly Gap[] {
  const gaps: Gap[] = [];

  const nameGap = (field: string, label: string, name: NameDraft): void => {
    if (name.choice.kind !== 'none') return;

    gaps.push({
      field,
      label: name.matches.length > 0 ? `${label} matches more than one record` : `${label} is not set`,
      // The candidates, or what the camera saw. Either way, something to judge.
      saw: name.matches.length > 0 ? name.matches.join(', ') : name.read,
    });
  };

  nameGap('customer', 'The customer', draft.customer);
  nameGap('property', 'The property', draft.property);

  if (draft.serviceDate.trim() === '') {
    gaps.push({ field: 'serviceDate', label: 'The date is not set', saw: draft.from.serviceDate });
  }
  if (draft.serviceTime.trim() === '') {
    gaps.push({ field: 'serviceTime', label: 'The time is not set', saw: draft.from.serviceTime });
  }
  if (draft.serviceType.trim() === '') {
    gaps.push({
      field: 'serviceType',
      label: 'The service type is not set',
      saw: draft.from.serviceType,
    });
  }

  if (guestCount(draft.guests) === null) {
    gaps.push({
      field: 'guests',
      label: 'The guest count is not set',
      // Rule 12: his wording, if that is what is holding it up.
      saw: draft.guestsWording,
    });
  }

  if (draft.dishes.length === 0) {
    gaps.push({ field: 'dishes', label: 'No dishes were read', saw: null });
  }

  draft.dishes.forEach((dish, at) => {
    if (dish.choice.kind !== 'none') return;

    gaps.push({
      field: `dish:${at}`,
      label:
        dish.matches.length > 0
          ? `"${dish.read ?? ''}" matches more than one recipe`
          : 'A dish is not set',
      saw: dish.matches.length > 0 ? dish.matches.join(', ') : dish.read,
    });
  });

  /*
   * RULES 9 AND 12 TOGETHER. The wording came off the sheet; what kind of
   * requirement it is and how serious it is did not, and cannot. Until he has
   * said both, this requirement cannot be weighed against a dish — so it blocks
   * the save rather than being stored half-made.
   */
  draft.dietaries.forEach((dietary, at) => {
    const named = dietary.dietType.trim() !== '';
    if (named && dietary.severity !== null) return;

    gaps.push({
      field: `dietary:${at}`,
      label: named
        ? 'A dietary requirement needs its severity'
        : 'A dietary requirement needs naming and its severity',
      saw: dietary.wording,
    });
  });

  return gaps;
}

/** Deduplicated, in sheet order — a sheet listing a dish twice creates it once. */
const creations = (names: readonly string[]): readonly string[] => [...new Set(names)];

export function creationsFromDraft(draft: JobSheetDraft): Creations {
  const toCreate = (name: NameDraft): readonly string[] =>
    name.choice.kind === 'create' ? [name.choice.name] : [];

  return {
    customers: creations(toCreate(draft.customer)),
    properties: creations(toCreate(draft.property)),
    recipes: creations(draft.dishes.flatMap(toCreate)),
  };
}
