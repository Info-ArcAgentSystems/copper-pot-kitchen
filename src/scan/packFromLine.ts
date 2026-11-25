/**
 * A PACK SIZE THE RECEIPT PRINTS ON THE LINE ITSELF — "RASPBERRIES 125G".
 *
 * Read by this code, character by character — never by the model. The receipt
 * states the size of the pack he bought; this only finds where it says so. The
 * result is OFFERED to him ("The receipt says 125 g — use it as the pack
 * size?"), never written by itself.
 *
 * It says nothing — null — whenever the line is not one plain size:
 *
 *   "STRAWBERRY"            no size printed
 *   "COKE 6X330ML"          a multipack: is the pack 330 ml or 6 of them?
 *   "TOMATOES 400G 4PK"     the same question, written another way
 *   "CHICKEN 1KG 500G"      two sizes: which is the pack?
 *
 * Silence is the honest answer for all of those. A wrong pack size is a wrong
 * price in every recipe that uses the ingredient.
 *
 * Units are the ones `units.ts` converts (g, kg, ml, cl, l), so anything this
 * offers can actually be priced. Pure: no React, no Supabase.
 */

export type LinePackUnit = 'g' | 'kg' | 'ml' | 'cl' | 'l';

export interface LinePack {
  readonly size: number;
  readonly unit: LinePackUnit;
  /** Exactly as printed, for the sentence that quotes it back. */
  readonly said: string;
}

const SPELLINGS: Readonly<Record<string, LinePackUnit>> = {
  g: 'g',
  gr: 'g',
  grm: 'g',
  gram: 'g',
  grams: 'g',
  kg: 'kg',
  kgs: 'kg',
  ml: 'ml',
  cl: 'cl',
  l: 'l',
  lt: 'l',
  ltr: 'l',
  litre: 'l',
  litres: 'l',
  liter: 'l',
  liters: 'l',
};

/** A number glued to (or spaced from) a unit, not part of a longer word or number. */
const SIZE = /(?<![\p{L}\p{N}.,])(\d+(?:[.,]\d+)?)\s?([a-z]+)(?![\p{L}\p{N}])/giu;

/** "6X330ML", "2 x 2L", "6×500ml" — a count of packs. */
const MULTIPACK = /\d\s*[x×*]\s*\d/i;

/** "4PK", "6 PACK", "12PCK" — a count written after the size. */
const PACK_COUNT = /(?<![\p{L}\p{N}])\d+\s?(?:pk|pck|pack|packs)(?![\p{L}\p{N}])/iu;

export function packFromLine(description: string): LinePack | null {
  if (MULTIPACK.test(description) || PACK_COUNT.test(description)) return null;

  const found: LinePack[] = [];
  for (const m of description.matchAll(SIZE)) {
    const unit = SPELLINGS[(m[2] ?? '').toLowerCase()];
    if (unit === undefined) continue;
    const size = Number((m[1] ?? '').replace(',', '.'));
    if (!Number.isFinite(size) || size <= 0) return null;
    found.push({ size, unit, said: m[0] });
  }

  return found.length === 1 ? (found[0] ?? null) : null;
}
