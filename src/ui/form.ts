/**
 * Form parsing, validation and formatting.
 *
 * PURE FUNCTIONS, no React. That is deliberate: it means the behaviour that
 * matters — what an empty money field becomes, whether a name is required, how
 * euros turn into cents — is tested in plain Node with no DOM, and the components
 * stay thin enough to be obvious by reading.
 *
 * The rule this file exists to protect is Rule 8. A blank field is UNKNOWN, and
 * unknown is null. Never 0, never ''. An unpriced rate is not a free one.
 */

import { toCents, toEuros } from '../data/mappers';
import type { Cents } from '../engine/types';

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Trimmed, or null when there is nothing there. Never an empty string. */
export function parseText(input: string): string | null {
  const trimmed = input.trim();
  return trimmed === '' ? null : trimmed;
}

/** For a field that must have a value. Returns the error, or null when valid. */
export function requireText(input: string, label: string): string | null {
  return parseText(input) === null ? `${label} is required` : null;
}

/** Null renders as an empty input, not as "null". */
export const textValue = (value: string | null): string => value ?? '';

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export interface MoneyParse {
  readonly cents: Cents | null;
  readonly error: string | null;
}

/**
 * Euros typed by the owner into `Cents`.
 *
 * Conversion goes through `toCents` from the mappers rather than a second
 * implementation, so the UI and the database agree by construction — the mapper
 * tests already pin that 20.15 becomes 2015 and that float truncation must not
 * lose a cent.
 *
 * An empty input is null, NOT zero. Zero euros is a real price meaning "free";
 * blank means the owner has not said. Rule 8, and Rule 11 depends on it: a rate
 * with neither figure set is unpriced, and revenue for a job under it is null.
 */
export function parseMoney(input: string): MoneyParse {
  const trimmed = input.trim().replace(/^€\s*/, '').replace(/,/g, '');
  if (trimmed === '') return { cents: null, error: null };

  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { cents: null, error: 'Enter a number, or leave blank' };
  if (value < 0) return { cents: null, error: 'Cannot be negative' };

  return { cents: toCents(value), error: null };
}

/** For an input's value. Blank when unknown, so the field looks unanswered. */
export function moneyValue(cents: Cents | null): string {
  const euros = toEuros(cents);
  return euros === null ? '' : String(euros);
}

/**
 * For display in a list.
 *
 * Null is NOT "€0.00". It renders as a stated absence so the owner can see the
 * difference between free and unknown at a glance.
 */
export function formatMoney(cents: Cents | null, whenUnknown = 'not set'): string {
  const euros = toEuros(cents);
  return euros === null ? whenUnknown : `€${euros.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Whole numbers
// ---------------------------------------------------------------------------

export interface CountParse {
  readonly value: number | null;
  readonly error: string | null;
}

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

/**
 * A pack, the absence of one, or a half-filled one.
 *
 * THREE states, and the third is the point. The form used to take
 * `parseCount(packSize).value` and drop the error beside it, so a refused input
 * became `null`, `null` became "no pack", and the save reported success. The pack
 * size stayed in the box on screen, which is why it took a scan reporting "no
 * pack size recorded" to notice it had never been stored.
 *
 * With only "value or nothing" there is nowhere for "you meant something and it
 * did not survive" to go. `error` is that place.
 */
export type PackParse =
  | { readonly kind: 'none' }
  | { readonly kind: 'pack'; readonly size: number; readonly unit: string }
  | {
      readonly kind: 'error';
      readonly sizeError: string | null;
      readonly unitError: string | null;
    };

/**
 * Both halves, or neither.
 *
 * A size is a MEASURED quantity, not a count: 2.5 kg packs are ordinary, and the
 * field is marked `inputMode="decimal"` precisely because they are. `parseCount`
 * was the wrong parser here — it exists for guests and eggs, where a fraction is
 * genuinely meaningless.
 *
 * Zero is refused rather than stored. `pricePerPack` multiplies by the pack size,
 * so a zero pack prices every recipe using the ingredient at nothing — and a
 * confident 0 is harder to spot than a blank.
 */
export function parsePack(sizeInput: string, unitInput: string): PackParse {
  const rawSize = sizeInput.trim();
  const unit = unitInput.trim();

  if (rawSize === '' && unit === '') return { kind: 'none' };

  if (rawSize === '') {
    return { kind: 'error', sizeError: 'Add the pack size — a pack needs both', unitError: null };
  }

  const size = Number(rawSize);
  if (!Number.isFinite(size)) {
    return { kind: 'error', sizeError: 'Enter a number, or leave blank', unitError: null };
  }
  if (size <= 0) {
    return { kind: 'error', sizeError: 'Must be more than zero', unitError: null };
  }

  if (unit === '') {
    return { kind: 'error', sizeError: null, unitError: 'Add the pack unit — a pack needs both' };
  }

  return { kind: 'pack', size, unit };
}

// ---------------------------------------------------------------------------
// Whole numbers, continued
// ---------------------------------------------------------------------------

/** A count of things. Blank is null — a guest count is never guessed (Rule 8). */
export function parseCount(input: string): CountParse {
  const trimmed = input.trim();
  if (trimmed === '') return { value: null, error: null };

  const value = Number(trimmed);
  if (!Number.isInteger(value)) return { value: null, error: 'Enter a whole number' };
  if (value < 0) return { value: null, error: 'Cannot be negative' };

  return { value, error: null };
}

/**
 * A measured quantity — 2.5 kg of mince, 0.75 l of stock.
 *
 * Distinct from `parseCount`, which requires a whole number because you cannot
 * have 2.5 eggs in a pack. Stock on a shelf is genuinely fractional, so rejecting
 * decimals here would force the owner to round, and a rounded stock figure feeds
 * straight into `required − stock − purchased`.
 *
 * Blank is null, NOT zero (Rule 8). For stock the two are different statements:
 * null is "I have not counted this" and 0 is "I counted, there is none".
 */
export function parseQuantity(input: string): CountParse {
  const trimmed = input.trim();
  if (trimmed === '') return { value: null, error: null };

  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { value: null, error: 'Enter a number, or leave blank' };
  if (value < 0) return { value: null, error: 'Cannot be negative' };

  return { value, error: null };
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/**
 * Case-insensitive, locale-aware, and stable on ties.
 *
 * A list the owner scans on a phone in a kitchen should not put "apples" after
 * "Zest" because of ASCII ordering.
 */
export function byName<T>(pick: (item: T) => string): (a: T, b: T) => number {
  return (a, b) => pick(a).localeCompare(pick(b), undefined, { sensitivity: 'base' });
}

// ---------------------------------------------------------------------------
// Destructive actions
// ---------------------------------------------------------------------------

export interface ReferenceCount {
  readonly label: string;
  readonly count: number;
}

/**
 * The sentence shown before a delete.
 *
 * Deleting a customer, property or supplier is `on delete set null` in the
 * schema, so anything pointing at it silently loses the reference. A job that
 * loses its customer has no client group, and under Rule 11 its revenue becomes
 * null — it stops being priceable.
 *
 * So the confirmation names the consequence rather than asking the owner to
 * guess at it.
 */
export function deleteWarning(
  what: string,
  references: readonly ReferenceCount[],
): string {
  const live = references.filter((r) => r.count > 0);
  if (live.length === 0) return `Delete this ${what}? Nothing else refers to it.`;

  const parts = live.map((r) => `${r.count} ${r.count === 1 ? r.label : `${r.label}s`}`);
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

  return `${list} refer to this ${what}. Deleting it will leave them with no ${what}.`;
}
