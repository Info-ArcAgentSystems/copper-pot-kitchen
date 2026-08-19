/**
 * A scanned job sheet, reviewed against the owner's own data.
 *
 * PURE. No network, no React, no repository — the OCR result goes in, a review
 * goes out, and the screen renders it. Nothing here writes anything.
 *
 * FLAG, NEVER INVENT.
 *
 * A scanner is the easiest place in this system to breach Rule 8, because a
 * plausible value is always to hand: the date is probably this Saturday, the
 * guest count is probably the number beside the smudge, the customer is probably
 * whoever booked last time. Each of those guesses disappears the moment it is
 * saved — it stops looking like a guess and starts looking like something the
 * owner wrote — and each one moves a purchase quantity.
 *
 * So this file has exactly two ways of handling anything it is unsure of:
 *
 *   GAP        the value could not be read. It stays null and is surfaced for
 *              him to fill. Never defaulted, never inferred from another field.
 *   NEW        the name was read fine, but no such customer / property / dish
 *              exists in his data. Flagged for him to confirm, NEVER created.
 *
 * There is deliberately no third way, and in particular no "probably". A name
 * matching several records is `ambiguous` and becomes a gap — naming the
 * candidates is an answer, picking one is a guess (Rule 8).
 *
 * THE MODEL DOES NOT RESOLVE ANYTHING. It returns what it read, verbatim; the
 * matching against stored records happens here, in deterministic code, through
 * the same `matchByName` Ask Sous uses. Two matchers would eventually disagree
 * about whether a customer already exists, and the scanner would create a
 * duplicate of someone already in the book.
 */

import { matchByName } from '../engine/nameMatch';
import type { Customer, Property, Recipe } from '../engine/types';

/**
 * What the model says it READ. Every field nullable — that is Rule 8 arriving at
 * the boundary rather than being enforced after the fact.
 *
 * `guestsWording` exists because Rule 12 needs somewhere to put "a few". A vague
 * count is not a number and must never be parsed into one, but it is also not
 * nothing — it is what the owner wrote, and he needs to see it to resolve it.
 */
export interface JobSheetRead {
  readonly customer: string | null;
  readonly property: string | null;
  readonly serviceDate: string | null;
  readonly serviceTime: string | null;
  readonly serviceType: string | null;
  /** A figure ONLY when the sheet states one plainly. Otherwise null. */
  readonly guests: number | null;
  /** Vague wording, verbatim, never parsed (Rule 12). */
  readonly guestsWording: string | null;
  readonly dishes: readonly string[];
  /** Words, never counts (Rule 16). */
  readonly dietaries: readonly { readonly wording: string }[];
  readonly notes: string | null;
  /** Anything the model could not read confidently, named by field. */
  readonly uncertain: readonly { readonly field: string; readonly saw: string | null }[];
}

/**
 * One name, resolved against what the owner already has.
 *
 * Four outcomes and no fifth. `new` and `missing` are deliberately separate:
 * "new" invites him to create a record, and there is nothing to create when the
 * camera read nothing at all.
 */
export type Resolved<T> =
  | { readonly kind: 'matched'; readonly record: T; readonly read: string }
  | { readonly kind: 'new'; readonly read: string }
  | { readonly kind: 'ambiguous'; readonly read: string; readonly matches: readonly string[] }
  | { readonly kind: 'missing' };

/** Something the owner has to fill in or settle before this is a job. */
export interface Gap {
  readonly field: string;
  readonly label: string;
  /** What the camera saw, when it saw anything. Shown so he can judge it. */
  readonly saw: string | null;
}

/** A name read cleanly that is not in his data yet. Flagged, not created. */
export interface NewThing {
  readonly what: 'customer' | 'property' | 'dish';
  readonly read: string;
}

export interface OwnerData {
  readonly customers: readonly Customer[];
  readonly properties: readonly Property[];
  readonly recipes: readonly Recipe[];
}

export interface JobSheetReview {
  readonly customer: Resolved<Customer>;
  readonly property: Resolved<Property>;
  readonly serviceDate: string | null;
  readonly serviceTime: string | null;
  readonly serviceType: string | null;
  readonly guests: number | null;
  readonly dishes: readonly Resolved<Recipe>[];
  readonly dietaries: readonly { readonly wording: string }[];
  readonly notes: string | null;
  readonly gaps: readonly Gap[];
  readonly newThings: readonly NewThing[];
  /**
   * Nothing outstanding. NOT a permission to save without him — Rule 7 still
   * requires he taps confirm. It only says the screen has nothing to chase.
   */
  readonly readyToSave: boolean;
}

/** Resolve one read name. Never picks between candidates. */
function resolve<T extends { id: string; name: string }>(
  records: readonly T[],
  read: string | null,
): Resolved<T> {
  if (read === null || read.trim() === '') return { kind: 'missing' };

  const matches = matchByName(records, read);

  if (matches.length === 0) return { kind: 'new', read };
  if (matches.length > 1) {
    return { kind: 'ambiguous', read, matches: matches.map((m) => m.name) };
  }

  return { kind: 'matched', record: matches[0] as T, read };
}

export function reviewJobSheet(read: JobSheetRead, owner: OwnerData): JobSheetReview {
  const customer = resolve(owner.customers, read.customer);
  const property = resolve(owner.properties, read.property);
  const dishes = read.dishes.map((d) => resolve(owner.recipes, d));

  const gaps: Gap[] = [];
  const newThings: NewThing[] = [];

  // What the camera saw for a field, if it said anything about it.
  const saw = (field: string): string | null =>
    read.uncertain.find((u) => u.field === field)?.saw ?? null;

  const nameGap = (
    field: string,
    label: string,
    resolved: Resolved<unknown>,
    what: NewThing['what'],
  ): void => {
    if (resolved.kind === 'missing') {
      gaps.push({ field, label: `${label} could not be read`, saw: saw(field) });
      return;
    }
    if (resolved.kind === 'ambiguous') {
      // Rule 8: several candidates is an answer; choosing one is a guess.
      gaps.push({
        field,
        label: `${label} matches more than one record`,
        saw: resolved.matches.join(', '),
      });
      return;
    }
    if (resolved.kind === 'new') {
      // NOT created here, and not created on confirm without him saying so.
      newThings.push({ what, read: resolved.read });
      gaps.push({ field, label: `${label} is not in your data yet`, saw: resolved.read });
    }
  };

  nameGap('customer', 'The customer', customer, 'customer');
  nameGap('property', 'The property', property, 'property');

  dishes.forEach((d, at) => {
    if (d.kind === 'new') {
      newThings.push({ what: 'dish', read: d.read });
      gaps.push({ field: `dish:${at}`, label: `"${d.read}" is not one of your recipes`, saw: d.read });
    }
    if (d.kind === 'ambiguous') {
      gaps.push({
        field: `dish:${at}`,
        label: `"${d.read}" matches more than one recipe`,
        saw: d.matches.join(', '),
      });
    }
  });

  if (read.dishes.length === 0) {
    gaps.push({ field: 'dishes', label: 'No dishes were read', saw: saw('dishes') });
  }

  // The guest count. THE field this whole design is about: it drives every
  // quantity downstream, and it is the one most often written vaguely.
  if (read.guests === null) {
    gaps.push({
      field: 'guests',
      label:
        read.guestsWording === null
          ? 'The guest count could not be read'
          : 'The guest count needs confirming',
      // Rule 12: his wording, verbatim. Never parsed, never rounded, never
      // turned into a number by this file or any other.
      saw: read.guestsWording ?? saw('guests'),
    });
  }

  for (const [field, label] of [
    ['serviceDate', 'The date'],
    ['serviceTime', 'The time'],
    ['serviceType', 'The service type'],
  ] as const) {
    if (read[field] === null) {
      gaps.push({ field, label: `${label} could not be read`, saw: saw(field) });
    }
  }

  // Rule 16: scanned dietary wording is never a count, so it always needs him to
  // allocate guests before it means anything operationally.
  if (read.dietaries.length > 0) {
    gaps.push({
      field: 'dietaries',
      label: 'Dietary requirements need allocating to guests',
      saw: read.dietaries.map((d) => d.wording).join('; '),
    });
  }

  // Anything the model flagged that has not already produced a gap of its own.
  for (const u of read.uncertain) {
    if (!gaps.some((g) => g.field === u.field)) {
      gaps.push({ field: u.field, label: `"${u.field}" was not read confidently`, saw: u.saw });
    }
  }

  return {
    customer,
    property,
    serviceDate: read.serviceDate,
    serviceTime: read.serviceTime,
    serviceType: read.serviceType,
    // Passed through untouched. There is no branch here that could produce a
    // number the sheet did not state.
    guests: read.guests,
    dishes,
    dietaries: read.dietaries,
    notes: read.notes,
    gaps,
    newThings,
    readyToSave: gaps.length === 0,
  };
}
