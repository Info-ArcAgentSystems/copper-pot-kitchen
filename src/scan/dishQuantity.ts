/**
 * Split a stated per-dish count off a dish name.
 *
 * A job sheet writes a dish as "10 x Full Irish" or "Vegetable Lasagne x 6" — a
 * COUNT and a NAME in one line. The scanner used to keep the whole string as the
 * recipe name, which did two wrong things at once: it created a recipe called
 * "10 x Full Irish" that could never match the "Full Irish" he already had (so
 * the library fragmented into a new recipe per headcount), and it threw the "10"
 * away, leaving the buffet split to divide the guest count evenly across the
 * breakfast dishes instead of using the counts the sheet actually stated.
 *
 * So the count comes off here, BEFORE the name is matched. This is reading what
 * is written, not inventing — Rule 8 is about absent values, and the number is
 * present. A dish with no "x N" beside it is returned untouched with a null
 * count, and the split derives its portions the way it always has.
 *
 * DELIBERATELY NARROW. It splits only on an explicit `N x` / `x N` pattern with a
 * whole number. A bare leading number, a range, or anything else is left in the
 * name — a dish called "7 Up float" is not seven of anything, and guessing that
 * it is would be the invention this whole feature refuses.
 */

export interface ParsedDish {
  /** The dish name with any stated count stripped off. */
  readonly name: string;
  /** The count the sheet stated for this dish, or null when it stated none. */
  readonly portions: number | null;
}

/** `[x×]` with a whole number, at the front ("10 x Name") or the back ("Name x 6"). */
export function parseDishQuantity(raw: string): ParsedDish {
  const text = raw.trim();

  // "10 x Full Irish", "10x Full Irish", "10 × Full Irish"
  const leading = text.match(/^(\d+)\s*[x×]\s+(.+)$/i);
  if (leading) {
    const portions = Number(leading[1]);
    const name = leading[2].trim();
    if (portions > 0 && name !== '') return { name, portions };
  }

  // "Vegetable Lasagne x 6", "Vegetable Lasagne x6"
  const trailing = text.match(/^(.+?)\s+[x×]\s*(\d+)$/i);
  if (trailing) {
    const portions = Number(trailing[2]);
    const name = trailing[1].trim();
    if (portions > 0 && name !== '') return { name, portions };
  }

  return { name: text, portions: null };
}
