/**
 * Reviewing a photographed supplier invoice.
 *
 * PURE. The line this file exists to hold: **the model reads two numbers off the
 * page, and `engine/costing.ts` divides them.**
 *
 * An invoice reads "5 kg — €45.00", and the useful figure is €9.00 a kilo.
 * Working that out is precisely the sort of helpful arithmetic a model performs
 * and occasionally gets wrong, and a wrong price here does not announce itself:
 * it propagates into every recipe using the ingredient and surfaces as a
 * plausible margin on a screen the owner trusts.
 *
 * So `InvoiceRead` has NO price-per-pack field. Not an optional one, not a
 * nullable one — none. A field a model could fill by dividing is a field it will
 * fill by dividing, and `tests/scan/invoice.test.ts` asserts the type stays that
 * way.
 *
 * Ingredients are MATCHED, never created, through the shared
 * `engine/nameMatch.ts`.
 */

import { pricePerPackFromInvoice, type InvoicePrice } from '../engine/costing';
import { matchByName } from '../engine/nameMatch';
import type { Cents, Ingredient, StockUnit, Supplier } from '../engine/types';
import type { Gap, Resolved } from './jobSheet';

/**
 * What the model reported, as printed on the page.
 *
 * Note what is absent: any per-unit or per-pack price. See the file comment.
 */
export interface InvoiceRead {
  readonly supplier: string | null;
  readonly invoiceDate: string | null;
  readonly lines: readonly {
    readonly description: string;
    /** How much was delivered, as printed. Null when unreadable. */
    readonly quantity: number | null;
    /** The unit on the invoice — not necessarily the owner's pack unit. */
    readonly unit: string | null;
    /**
     * The line total IN CENTS, already converted at the parse boundary.
     *
     * Named for its unit on purpose. The field it comes from is
     * `lineTotalPrinted` — euros as they appear on the page — and the whole
     * defect this rename closes was a scale ambiguity nobody could see in a name
     * like `lineTotal`.
     */
    readonly lineTotalCents: number | null;
  }[];
  readonly uncertain: readonly { readonly field: string; readonly saw: string | null }[];
}

/**
 * Why a line carries no price.
 *
 * A STATE OF ITS OWN, and the reason it exists is a real defect: this case used
 * to borrow the engine's `unreadable`, so a line whose ingredient simply is not
 * in the owner's data reported "could not be read" — a sentence about the
 * PHOTOGRAPH. It sent two days chasing the camera, the model and the parser while
 * the numbers were being read perfectly and the ingredient book was empty.
 *
 * The engine's `InvoicePrice` is right not to model this. Not knowing an
 * ingredient is not a costing outcome; it is a fact about the owner's data, and
 * it belongs to the layer that does the matching. Borrowing a neighbouring state
 * because it happens to be reachable is how a message comes to describe the wrong
 * world.
 */
export interface NoIngredient {
  readonly kind: 'no_ingredient';
  /** Which resolution failed. Each reads differently and fixes differently. */
  readonly reason: 'new' | 'ambiguous' | 'missing';
}

/**
 * Two or more lines for ONE ingredient that work out to different pack prices.
 *
 * THE DEFECT THIS EXISTS FOR. A supermarket receipt read "JUICE ORANGE FC 2L" as
 * 2 L at €2.79 on one line and 4 L at €2.79 on the next. Against a 2 L pack those
 * price at €2.79 and €1.40, and the save loop wrote every priced line in turn —
 * so whichever came LAST silently became the price. Neither is saved now; the
 * receipt is what needs checking.
 */
export interface LinesDisagree {
  readonly kind: 'disagrees';
  readonly packPrices: readonly Cents[];
}

/** Every outcome a line can have: the engine's four, the unmatched case, and a disagreement. */
export type LinePrice = InvoicePrice | NoIngredient | LinesDisagree;

/** The outcomes that need a sentence rather than a figure. */
export type UnpricedLine = Exclude<LinePrice, { kind: 'priced' }>;

export interface ReviewedLine {
  readonly description: string;
  /*
   * The line's numbers exactly as read, kept for DISPLAY whatever the outcome.
   * An unmatched line used to show its name and nothing else, so the one thing
   * he wants from a receipt — what he paid — was read and then hidden.
   */
  readonly quantity: number | null;
  readonly unit: string | null;
  readonly lineTotalCents: number | null;
  readonly ingredient: Resolved<Ingredient>;
  /** The engine's four outcomes, or `no_ingredient` when there was nothing to price. */
  readonly price: LinePrice;
  /** What is stored now, so a jump is visible BEFORE saving rather than after. */
  readonly previousPrice: Cents | null;
}

export interface InvoiceOwnerData {
  readonly ingredients: readonly Ingredient[];
  readonly suppliers: readonly Supplier[];
}

export interface NewIngredient {
  readonly what: 'ingredient';
  readonly read: string;
}

export interface InvoiceReview {
  readonly supplier: Resolved<Supplier>;
  readonly invoiceDate: string | null;
  readonly lines: readonly ReviewedLine[];
  readonly gaps: readonly Gap[];
  readonly newThings: readonly NewIngredient[];
  /** Lines a person has to deal with by hand, in words. */
  readonly needsManualHandling: readonly string[];
  /** How many INGREDIENTS would have their price updated — not lines. */
  readonly priceableCount: number;
  readonly readyToSave: boolean;
}

function resolveIngredient(
  name: string,
  ingredients: readonly Ingredient[],
): Resolved<Ingredient> {
  const trimmed = name.trim();
  if (trimmed === '') return { kind: 'missing' };

  const matches = matchByName(ingredients, trimmed);

  if (matches.length === 0) return { kind: 'new', read: trimmed };
  if (matches.length > 1) {
    return { kind: 'ambiguous', read: trimmed, matches: matches.map((m) => m.name) };
  }

  return { kind: 'matched', record: matches[0] as Ingredient, read: trimmed };
}

function resolveSupplier(name: string | null, suppliers: readonly Supplier[]): Resolved<Supplier> {
  if (name === null || name.trim() === '') return { kind: 'missing' };

  const matches = matchByName(suppliers, name.trim());
  if (matches.length === 0) return { kind: 'new', read: name.trim() };
  if (matches.length > 1) {
    return { kind: 'ambiguous', read: name.trim(), matches: matches.map((m) => m.name) };
  }

  return { kind: 'matched', record: matches[0] as Supplier, read: name.trim() };
}

/**
 * `onePackEach` holds the descriptions of receipt lines the OWNER has said are
 * one of his packs per item — "1 × JUICE ORANGE FC 2L" is one 2 L pack.
 *
 * A shop receipt prints a count and no unit, and the engine rightly refuses to
 * price a count against a 2 L pack: nothing on the page says the item IS that
 * pack. His tap says so. The line is then restated in the pack's own unit —
 * quantity × pack size — and priced by the same engine function as every other
 * line, so the division still happens in exactly one place. Never applied
 * without his say-so, and never to a line that printed a unit of its own.
 */
export function reviewInvoice(
  read: InvoiceRead,
  owner: InvoiceOwnerData,
  onePackEach: ReadonlySet<string> = new Set(),
): InvoiceReview {
  const gaps: Gap[] = [];
  const newThings: NewIngredient[] = [];
  const needsManualHandling: string[] = [];
  const lines: ReviewedLine[] = [];

  for (const line of read.lines) {
    const ingredient = resolveIngredient(line.description, owner.ingredients);

    if (ingredient.kind === 'new') {
      newThings.push({ what: 'ingredient', read: ingredient.read });
    }
    if (ingredient.kind === 'ambiguous') {
      gaps.push({
        field: `ingredient:${line.description}`,
        label: `"${line.description}" matches ${ingredient.matches.join(', ')} — which is it?`,
        saw: line.description,
      });
    }

    // No matched ingredient means no pack, and no pack means nothing to convert
    // into. Pricing it anyway would mean inventing the pack as well.
    //
    // It reports `no_ingredient`, NOT `unreadable`. The numbers on this line may
    // be perfectly legible; what is absent is the ingredient to price them
    // against, and saying otherwise points the owner at his camera.
    const pack = ingredient.kind === 'matched' ? ingredient.record.pack : null;
    const asPacks =
      pack !== null &&
      line.unit === null &&
      line.quantity !== null &&
      onePackEach.has(line.description);

    const price: LinePrice =
      ingredient.kind === 'matched'
        ? pricePerPackFromInvoice(ingredient.record, {
            quantity: asPacks ? (line.quantity as number) * pack.size : line.quantity,
            unit: (asPacks ? pack.unit : (line.unit ?? '')) as StockUnit,
            lineTotal: line.lineTotalCents === null ? null : (line.lineTotalCents as Cents),
          })
        : { kind: 'no_ingredient', reason: ingredient.kind };

    if (price.kind === 'unconvertible') {
      // Surfaced in the owner's terms, naming BOTH units — the fix is either a
      // different pack size or a hand-entered price, and he cannot choose without
      // knowing what did not reconcile.
      needsManualHandling.push(
        price.invoiceUnit === ''
          ? `"${line.description}" has no unit on the receipt, and your pack is ${price.packUnit}. If each one is one of your packs, say so on its line; otherwise enter its price by hand.`
          : `"${line.description}" is invoiced in ${price.invoiceUnit} but stocked in ${price.packUnit} packs. Enter its price by hand.`,
      );
    }
    if (price.kind === 'no_pack') {
      needsManualHandling.push(
        `"${line.description}" has no pack size recorded, so a price per pack cannot be worked out. Set one in Ingredients.`,
      );
    }
    if (price.kind === 'unreadable' && ingredient.kind === 'matched') {
      gaps.push({
        field: `line:${line.description}`,
        label: `Could not read the ${price.missing.join(' and ')} for "${line.description}".`,
        saw: read.uncertain.find((u) => u.field.includes(line.description))?.saw ?? null,
      });
    }

    lines.push({
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      lineTotalCents: line.lineTotalCents,
      ingredient,
      price,
      previousPrice: ingredient.kind === 'matched' ? ingredient.record.pricePerPack : null,
    });
  }

  /*
   * ONE PRICE PER INGREDIENT. Lines that agree are the same price written more
   * than once, which is harmless; lines that disagree mean the receipt was read
   * inconsistently, and choosing between them would be a guess. All of that
   * ingredient's lines become `disagrees`, and none of them is saved.
   */
  const pricesFor = new Map<string, Set<number>>();
  for (const l of lines) {
    if (l.price.kind !== 'priced' || l.ingredient.kind !== 'matched') continue;
    const id = l.ingredient.record.id;
    const seen = pricesFor.get(id) ?? new Set<number>();
    seen.add(l.price.pricePerPack as number);
    pricesFor.set(id, seen);
  }

  const settled: ReviewedLine[] = lines.map((l) => {
    if (l.price.kind !== 'priced' || l.ingredient.kind !== 'matched') return l;
    const seen = pricesFor.get(l.ingredient.record.id);
    if (seen === undefined || seen.size < 2) return l;
    return {
      ...l,
      price: { kind: 'disagrees', packPrices: [...seen].sort((a, b) => b - a) as Cents[] },
    };
  });

  for (const [id, seen] of pricesFor) {
    if (seen.size < 2) continue;
    const name = settled.find((l) => l.ingredient.kind === 'matched' && l.ingredient.record.id === id);
    needsManualHandling.push(
      `The lines for "${name?.description ?? id}" work out to different prices per pack, so none of them is saved. Check the receipt and enter the price by hand.`,
    );
  }

  const priceableCount = new Set(
    settled
      .filter((l) => l.price.kind === 'priced' && l.ingredient.kind === 'matched')
      .map((l) => (l.ingredient.kind === 'matched' ? l.ingredient.record.id : '')),
  ).size;

  return {
    supplier: resolveSupplier(read.supplier, owner.suppliers),
    invoiceDate: read.invoiceDate,
    lines: settled,
    gaps,
    newThings,
    needsManualHandling,
    priceableCount,
    /*
     * Something must be priceable, and no gap may stand. A line needing hand
     * entry NO LONGER blocks the rest: it is listed, and it is simply not saved.
     * Blocking made a receipt with one unpacked item save nothing at all — and
     * on a first receipt, where most items are new, that was every receipt.
     * Skipping writes nothing wrong; only a priced line is ever written.
     */
    readyToSave: gaps.length === 0 && priceableCount > 0,
  };
}
