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

export interface ReviewedLine {
  readonly description: string;
  readonly ingredient: Resolved<Ingredient>;
  /** Straight from the engine. Four outcomes, each fixed somewhere different. */
  readonly price: InvoicePrice;
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
  /** How many lines would actually update a price. */
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

export function reviewInvoice(read: InvoiceRead, owner: InvoiceOwnerData): InvoiceReview {
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
    const price: InvoicePrice =
      ingredient.kind === 'matched'
        ? pricePerPackFromInvoice(ingredient.record, {
            quantity: line.quantity,
            unit: (line.unit ?? '') as StockUnit,
            lineTotal: line.lineTotalCents === null ? null : (line.lineTotalCents as Cents),
          })
        : { kind: 'unreadable', missing: ['ingredient'] };

    if (price.kind === 'unconvertible') {
      // Surfaced in the owner's terms, naming BOTH units — the fix is either a
      // different pack size or a hand-entered price, and he cannot choose without
      // knowing what did not reconcile.
      needsManualHandling.push(
        `"${line.description}" is invoiced in ${price.invoiceUnit} but stocked in ${price.packUnit} packs. Enter its price by hand.`,
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
      ingredient,
      price,
      previousPrice: ingredient.kind === 'matched' ? ingredient.record.pricePerPack : null,
    });
  }

  const priceableCount = lines.filter((l) => l.price.kind === 'priced').length;

  return {
    supplier: resolveSupplier(read.supplier, owner.suppliers),
    invoiceDate: read.invoiceDate,
    lines,
    gaps,
    newThings,
    needsManualHandling,
    priceableCount,
    // Something must actually be priceable, and nothing may be outstanding.
    // An invoice where every line needs hand-entering is not a saveable scan.
    readyToSave: gaps.length === 0 && needsManualHandling.length === 0 && priceableCount > 0,
  };
}
