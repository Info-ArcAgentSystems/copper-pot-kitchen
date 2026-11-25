/**
 * "ADD ALL NEW LINES" — one checklist instead of a form per receipt line.
 *
 * A real receipt had ten lines that were not in his ingredients yet, each behind
 * its own "Add as ingredient" form. This turns them into rows he goes down once:
 * a name, how he counts it, and the pack — then one tap adds every row that is
 * complete.
 *
 * WHAT IS FILLED IN, AND WHAT IS NOT:
 *
 *   name        from the receipt, tidied ("BASMATI RICE 1KG" → "Basmati Rice
 *               1KG"). Keeping the receipt's words is what lets the line match
 *               the new ingredient the moment it exists.
 *   pack        ONLY where the line prints one plain size (`packFromLine`, code,
 *               never the model) — the size of the pack he bought. Clearable.
 *   stock unit  NEVER. How he counts it on hand is not on the receipt; "1KG"
 *               says what the bag holds, not whether he counts bags or kilos.
 *               A row without one is not added.
 *   allergens   NEVER, and the screen says so afterwards — an ingredient added
 *               in bulk with no tags must not read as "no allergens" (Rule 9).
 *
 * Nothing here writes. Pure: no React, no Supabase.
 */

import { sameName } from '../engine/nameMatch';
import { packSizeIn } from '../engine/units';
import type {
  Ingredient,
  IngredientId,
  KitchenId,
  PurchaseUnit,
  StockUnit,
  SupplierId,
} from '../engine/types';
import { tidyName } from './jobDraft';
import { packFromLine } from './packFromLine';

/** The one problem every fresh row starts with — its box already asks. */
export const NEEDS_COUNT = 'Say how you count it — kg, L, each, bag…';

export interface BulkRow {
  /** The receipt line this row came from. Its key. */
  readonly description: string;
  readonly include: boolean;
  readonly name: string;
  readonly stockUnit: string;
  readonly packSize: string;
  readonly packUnit: string;
}

/** One row per new receipt line, with only what the receipt itself says. */
export function startRows(descriptions: readonly string[]): BulkRow[] {
  return descriptions.map((description) => {
    const printed = packFromLine(description);
    return {
      description,
      include: true,
      name: tidyName(description),
      stockUnit: '',
      packSize: printed === null ? '' : String(printed.size),
      packUnit: printed === null ? '' : printed.unit,
    };
  });
}

type RowPack =
  | { readonly kind: 'none' }
  | { readonly kind: 'pack'; readonly size: number; readonly unit: string }
  | { readonly kind: 'error'; readonly why: string };

function rowPack(row: BulkRow): RowPack {
  const size = row.packSize.trim();
  const unit = row.packUnit.trim();
  if (size === '' && unit === '') return { kind: 'none' };
  if (size === '' || unit === '') return { kind: 'error', why: 'a pack needs both a size and a unit' };
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) return { kind: 'error', why: 'the pack size must be a number above zero' };
  return { kind: 'pack', size: n, unit };
}

/**
 * What stops this row being added — or null when it is ready.
 *
 * `others` is every OTHER included row, so two rows naming the same thing are
 * caught before both are created.
 */
export function rowProblem(
  row: BulkRow,
  existing: readonly Ingredient[],
  others: readonly BulkRow[],
): string | null {
  const name = row.name.trim();
  if (name === '') return 'Give it a name';

  const have = existing.find((i) => sameName(i.name, name));
  if (have !== undefined) return `“${have.name}” is already one of your ingredients`;
  if (others.some((o) => o.include && sameName(o.name, name))) {
    return 'Another row has the same name';
  }

  const stock = row.stockUnit.trim();
  if (stock === '') return NEEDS_COUNT;

  const pack = rowPack(row);
  if (pack.kind === 'error') return `Pack: ${pack.why}`;
  if (pack.kind === 'pack' && packSizeIn(draftOf(row, stock, pack), stock as StockUnit) === null) {
    return `A ${pack.size} ${pack.unit} pack can’t be priced against ${stock} — change one, or clear the pack`;
  }
  return null;
}

function draftOf(
  row: BulkRow,
  stock: string,
  pack: { readonly size: number; readonly unit: string },
): Ingredient {
  return {
    ...rowToIngredient(row, '' as KitchenId, null),
    stockUnit: stock as StockUnit,
    pack: { size: pack.size, unit: pack.unit as PurchaseUnit, assumed: false },
  };
}

/** The ingredient a READY row becomes. Price comes from the receipt's confirm. */
export function rowToIngredient(
  row: BulkRow,
  kitchenId: KitchenId,
  supplierId: SupplierId | null,
): Ingredient {
  const pack = rowPack(row);
  return {
    id: '' as IngredientId,
    kitchenId,
    name: row.name.trim(),
    category: null,
    stockUnit: row.stockUnit.trim() as StockUnit,
    recipeUnit: null,
    recipeUnitsPerStockUnit: null,
    pack:
      pack.kind === 'pack'
        ? {
            size: pack.size,
            unit: pack.unit as PurchaseUnit,
            // The printed size of the pack he bought, kept on his tap: confirmed.
            // A size he typed himself is his own figure, but unchecked: assumed.
            assumed: !packIsPrinted(row),
          }
        : null,
    supplierId,
    pricePerPack: null,
    previousPrice: null,
    priceChecked: null,
    allergens: [],
  };
}

/**
 * Is the row's pack exactly the size printed on its line?
 *
 * When it is, the line's count is a count of PACKS ("BASMATI RICE 1KG, 1" is one
 * 1 kg bag), so the receipt can price it at once. When he typed a different
 * pack, the count's meaning is his to say, on the line.
 */
export function packIsPrinted(row: BulkRow): boolean {
  const printed = packFromLine(row.description);
  const pack = rowPack(row);
  return (
    printed !== null &&
    pack.kind === 'pack' &&
    pack.size === printed.size &&
    pack.unit.toLowerCase() === printed.unit
  );
}
