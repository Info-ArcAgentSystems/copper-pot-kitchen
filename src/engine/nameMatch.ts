/**
 * Matching the owner's words to a name he stored.
 *
 * PURE, and it decides nothing. It narrows a list of stored records to those a
 * typed or scanned name could mean, and hands every candidate back. Choosing
 * between candidates is the caller's problem, and under Rule 8 the answer is
 * usually to name them all rather than pick.
 *
 * WHY IT IS AN ENGINE MODULE AND NOT A LOCAL HELPER
 *
 * It was written inside `sous/tools.ts` for ingredients, and the job-sheet
 * scanner needs exactly the same thing for customers, properties and recipes.
 * Rule 5 forbids a second version of a step — and this step is one where a
 * second version fails *silently*: a scanner that matched slightly differently
 * from Ask Sous would flag a customer as new who is sitting in the owner's data,
 * and the two screens would disagree about what the kitchen contains.
 *
 * THE BUG IT CARRIES THE SCARS OF
 *
 * "How much soy sauce do I need" answered "you have no ingredient called soy
 * sauce" while Soy Sauce sat on the Ingredients screen. Case was never the
 * cause — the old matcher lowercased both sides. It compared CHARACTERS, asking
 * only whether the stored name contained the asked string verbatim:
 *
 *   "Sauce, Soy"   the same words, reordered, with a comma  → missed
 *   "Soy  Sauce"   one extra space                          → missed
 *   "Soy-sauce"    a hyphen                                 → missed
 *   "Soy"          stored name SHORTER than what was asked  → missed
 *
 * A supplier-style list ("Sauce, Soy") misses on every item. Scanned text makes
 * this worse, not better: OCR reads a handwritten job sheet, so spacing and
 * punctuation are whatever the camera made of the owner's pen.
 *
 * So names compare as WORDS — punctuation separates, runs of space collapse —
 * over tiers from strictest to loosest, STOPPING at the first tier that finds
 * anything. Stopping is what keeps an exact hit from being diluted into an
 * ambiguity by looser neighbours.
 *
 *   1  the id itself           callers are sometimes handed ids alongside names
 *   2  same words, same order  "soy sauce" = "Soy Sauce" = "Soy-Sauce"
 *   3  one runs inside the other, at word boundaries
 *   4  same words, any order   "soy sauce" = "Sauce, Soy"
 *
 * Word boundaries throughout, so "oil" cannot be found inside "boiled rice".
 */

/** Anything the owner named. Ids are branded strings, which are still strings. */
export interface NamedRecord {
  readonly id: string;
  readonly name: string;
}

/** Lowercase, punctuation to spaces, collapse, split. The whole normalisation. */
export const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w !== '');

/** Does `haystack` contain `needle` as a contiguous run of WHOLE words? */
const runOfWords = (haystack: readonly string[], needle: readonly string[]): boolean => {
  if (needle.length === 0 || needle.length > haystack.length) return false;

  return haystack.some((_, at) => needle.every((word, offset) => haystack[at + offset] === word));
};

const allWordsIn = (needle: readonly string[], haystack: readonly string[]): boolean =>
  needle.length > 0 && needle.every((w) => haystack.includes(w));

/**
 * Every stored record the asked name could mean.
 *
 * Empty means nothing matched — which for a scanner means "new to your data",
 * and for a question means "you have nothing by that name". Several means
 * several: this function never picks one (Rule 8).
 */
export function matchByName<T extends NamedRecord>(
  records: readonly T[],
  asked: string,
): readonly T[] {
  const wanted = words(asked);
  if (wanted.length === 0) return [];

  // The id, first and alone. An id is unambiguous, so it short-circuits.
  const byId = records.filter((r) => r.id === asked.trim());
  if (byId.length > 0) return byId;

  const named = records.map((r) => ({ record: r, words: words(r.name) }));

  const tiers = [
    (n: { words: string[] }) => n.words.join(' ') === wanted.join(' '),
    (n: { words: string[] }) => runOfWords(n.words, wanted) || runOfWords(wanted, n.words),
    (n: { words: string[] }) => allWordsIn(wanted, n.words) || allWordsIn(n.words, wanted),
  ];

  for (const tier of tiers) {
    const hits = named.filter(tier);
    // First tier that finds anything wins outright. A looser tier never adds
    // candidates to a tighter tier's answer.
    if (hits.length > 0) return hits.map((n) => n.record);
  }

  return [];
}

/**
 * What to offer when nothing matched: stored names sharing any word.
 *
 * Deliberately looser than the matcher, because it only ever produces a
 * suggestion a person reads. Nothing downstream may act on it.
 */
export function nearestNames(records: readonly NamedRecord[], asked: string): readonly string[] {
  const wanted = words(asked);

  return records.filter((r) => words(r.name).some((w) => wanted.includes(w))).map((r) => r.name);
}
