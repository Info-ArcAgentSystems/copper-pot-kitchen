/**
 * Scan a supplier invoice: photograph → review → confirm.
 *
 * The model read two numbers off each line. `engine/costing.ts` did the division.
 * That split is Rule 2 at its sharpest, and this screen shows the working so it
 * can be checked: the old price beside the new one, and the per-unit figure the
 * pack price came from.
 *
 * A line the engine refused to price is shown as refused, in the owner's terms —
 * a case invoiced against a kilo pack needs a decision, not a conversion factor
 * somebody invented.
 */

import { useState, type ReactNode } from 'react';
import { supabaseClient, supabaseDb } from '../../data/client';
import { ingredientRepository, supplierRepository } from '../../data/repositories';
import { commitScannedPrices } from '../../scan/commit';
import { reviewInvoice, type InvoiceRead, type InvoiceReview } from '../../scan/invoice';
import { tidyName } from '../../scan/jobDraft';
import { packFromLine } from '../../scan/packFromLine';
import { packSizeIn } from '../../engine/units';
import { IngredientForm } from '../setup/Ingredients';
import { AddAllIngredients, type BulkResult } from './AddAllIngredients';
import { parseInvoice } from '../../scan/parseImage';
import { toScaledDataUrl } from './scaleImage';
import { PhotoGate } from './PhotoGate';
import { formatMoney } from '../../ui/form';
import { groupLines, groupWorking, lineNote } from '../../ui/invoiceView';
import { Screen } from '../../ui/Screen';
import { useAsync } from '../../ui/useAsync';
import type { DataSource } from '../../ui/sourceState';
import type {
  Cents,
  Ingredient,
  KitchenId,
  PackDefinition,
  PurchaseUnit,
  SupplierId,
} from '../../engine/types';
import { useKitchen } from '../../auth/kitchenState';

const today = (): string => new Date().toISOString().slice(0, 10);

export function ScanInvoice(): ReactNode {
  const db = supabaseDb();
  const ingredients = useAsync(() => ingredientRepository(db).list(), []);
  const suppliers = useAsync(() => supplierRepository(db).list(), []);

  const { state: kitchen } = useKitchen();

  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  /*
   * What the scanner READ is the state; the review is DERIVED from it against
   * his current ingredients and suppliers on every render. So adding an
   * ingredient from a receipt line re-matches the whole receipt the moment the
   * list reloads — the photo is not sent again, and nothing is re-read.
   */
  const [read, setRead] = useState<InvoiceRead | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  /** The receipt line whose "Add as ingredient" form is open. */
  const [adding, setAdding] = useState<string | null>(null);
  /** The name he gave each ingredient added from a line, to explain a non-match. */
  const [addedAs, setAddedAs] = useState<Readonly<Record<string, string>>>({});
  const [supplierNote, setSupplierNote] = useState<string | null>(null);
  /** Receipt lines he has said are one of his packs per item. His word, per line. */
  const [onePackEach, setOnePackEach] = useState<ReadonlySet<string>>(new Set());
  /** The "Add all new lines" checklist is open. */
  const [bulkOpen, setBulkOpen] = useState(false);
  /** What the checklist did, said after it closes. */
  const [bulkNote, setBulkNote] = useState<BulkResult | null>(null);

  const ingredientList = ingredients.state.status === 'ready' ? ingredients.state.data : [];
  const supplierList = suppliers.state.status === 'ready' ? suppliers.state.data : [];

  const review: InvoiceReview | null =
    read === null
      ? null
      : reviewInvoice(read, { ingredients: ingredientList, suppliers: supplierList }, onePackEach);

  const togglePackEach = (description: string): void =>
    setOnePackEach((prev) => {
      const next = new Set(prev);
      if (next.has(description)) next.delete(description);
      else next.add(description);
      return next;
    });

  const sources: readonly DataSource[] = [
    {
      what: 'your ingredients',
      why: 'the scanner matches each invoice line against them',
      state: ingredients.state,
      reload: ingredients.reload,
    },
    {
      what: 'your suppliers',
      why: 'a price belongs to a supplier, so the scanner matches the one on the invoice',
      state: suppliers.state,
      reload: suppliers.reload,
    },
  ];

  const scan = async (file: File): Promise<void> => {
    setBusy(true);
    setRefusal(null);
    setRead(null);
    setSaved(null);
    setAdding(null);
    setAddedAs({});
    setSupplierNote(null);
    setOnePackEach(new Set());
    setBulkOpen(false);
    setBulkNote(null);

    try {
      const base = import.meta.env.VITE_SUPABASE_URL ?? '';
      const session = await supabaseClient().auth.getSession();
      const token = session.data.session?.access_token ?? '';

      const image = await toScaledDataUrl(file);
      const reply = await parseInvoice(image, {
        url: `${base}/functions/v1/parse-image`,
        token,
      });

      if (reply.kind === 'unresolved') {
        setRefusal(reply.reason);
        return;
      }

      // The division happens in the review, in the engine — not on the server,
      // and not by the model.
      setRead(reply.read);
    } catch (cause) {
      setRefusal(cause instanceof Error ? cause.message : 'Could not read that photo.');
    } finally {
      setBusy(false);
    }
  };

  /*
   * THE SIZE THE RECEIPT PRINTS — "RASPBERRIES 125G".
   *
   * His ingredient has no pack size, so the line cannot be priced; but the line
   * says what the pack was. Found by code (`packFromLine`), offered as a button,
   * and written to the ingredient only on his tap. Confirmed, not "assumed": it
   * is printed on the receipt for the very pack he bought.
   *
   * Offered only when it can actually price the line — a 125 g pack on an
   * ingredient he counts "each" would be refused by the costing, so it says why
   * instead of offering a button that changes nothing.
   */
  const packOffer = (record: Ingredient, description: string): ReactNode => {
    const read = packFromLine(description);
    if (read === null) return null;
    const pack: PackDefinition = { size: read.size, unit: read.unit as PurchaseUnit, assumed: false };

    if (packSizeIn({ ...record, pack }, record.stockUnit) === null) {
      return (
        <p className="muted">
          The receipt says “{read.said}”, but you count {record.name} in {record.stockUnit}, so it
          can’t be its pack size. Set the pack in Ingredients.
        </p>
      );
    }

    return (
      <p className="muted">
        The receipt says “{read.said}”.{' '}
        <button type="button" className="sm" disabled={busy} onClick={() => void applyPack(record, pack, description)}>
          Use {read.size} {read.unit} as the pack size
        </button>
      </p>
    );
  };

  /*
   * One tap, two facts — both printed on this line. "RASPBERRIES 125G, 1" is ONE
   * pack of 125 g: the size the line prints IS the pack, so its count is a count
   * of packs. Without the second, the line would still ask "is each one one
   * pack?" about a size it has just told us. Undoable on the line, like any other
   * "one pack each".
   */
  const applyPack = async (record: Ingredient, pack: PackDefinition, description: string): Promise<void> => {
    setBusy(true);
    setRefusal(null);
    try {
      await ingredientRepository(db).update(record.id, { ...record, pack });
      setOnePackEach((prev) => new Set(prev).add(description));
      ingredients.reload();
    } catch (cause) {
      setRefusal(cause instanceof Error ? cause.message : `Could not set the pack size for ${record.name}.`);
    } finally {
      setBusy(false);
    }
  };

  /** The ONLY thing on this screen that writes PRICES. Rule 7's separate call. */
  const confirm = async (): Promise<void> => {
    if (review === null) return;

    setBusy(true);
    const result = await commitScannedPrices(db, review, today());
    setBusy(false);

    if (result.ok) {
      setSaved(result.updated);
      setRead(null);
      ingredients.reload();
    } else {
      setRefusal(result.error);
    }
  };

  /** One tap: the supplier exactly as printed, tidied only if in capitals. */
  const addSupplier = async (name: string): Promise<void> => {
    if (kitchen.status !== 'ready') return;
    setSupplierNote(null);
    try {
      const created = await supplierRepository(db).create({
        kitchenId: kitchen.membership.kitchenId as KitchenId,
        name: tidyName(name),
        notes: null,
      });
      if (created === null) setSupplierNote(`Couldn’t add ${name} — nothing was saved.`);
    } catch (cause) {
      setSupplierNote(cause instanceof Error ? cause.message : `Couldn’t add ${name}.`);
    }
    suppliers.reload();
  };

  const matchedSupplierId: SupplierId | null =
    review?.supplier.kind === 'matched' ? review.supplier.record.id : null;

  /** Receipt lines whose ingredient he has not added yet — the checklist's rows. */
  const newLines: readonly string[] =
    review === null
      ? []
      : groupLines(review.lines)
          .filter((g) => {
            const p = g.lines[0]?.price;
            return p !== undefined && p.kind === 'no_ingredient' && p.reason === 'new';
          })
          .map((g) => g.description);

  const bulkDone = (result: BulkResult): void => {
    setBulkOpen(false);
    setBulkNote(result);
    // A printed pack makes the line's count a count of packs — the same rule as
    // the one-line "Use 125 g as the pack size".
    setOnePackEach((prev) => {
      const next = new Set(prev);
      for (const a of result.added) if (a.printed) next.add(a.description);
      return next;
    });
    ingredients.reload();
  };

  return (
    <Screen
      title="Scan an invoice"
      description="Photograph the invoice. Prices are worked out from the quantity and the line total — nothing is saved until you have checked them."
    >

      <PhotoGate sources={sources} busy={busy} onFile={(file) => void scan(file)} />

      {busy && <p className="muted">Reading it…</p>}

      {refusal !== null && (
        <p className="error" role="alert">
          {refusal}
        </p>
      )}

      {saved !== null && (
        <p className="muted">
          Saved. {saved} price{saved === 1 ? '' : 's'} updated.
        </p>
      )}

      {review !== null && (
        <>
          <section className="units">
            <h2>What it read</h2>
            <p className="muted">
              {review.invoiceDate ?? 'Date not read'}
              {review.supplier.kind === 'matched' && ` · ${review.supplier.record.name}`}
            </p>

            {review.supplier.kind === 'new' && (
              <div className="invoice-supplier">
                <p className="muted">“{review.supplier.read}” isn’t one of your suppliers yet.</p>
                <button
                  type="button"
                  className="sm"
                  disabled={busy}
                  onClick={() => void addSupplier(review.supplier.kind === 'new' ? review.supplier.read : '')}
                >
                  Add {tidyName(review.supplier.read)} as a supplier
                </button>
                {supplierNote !== null && <p className="unresolved">{supplierNote}</p>}
              </div>
            )}
            {review.supplier.kind === 'missing' && (
              <p className="muted">No supplier name was read.</p>
            )}
            {review.supplier.kind === 'ambiguous' && (
              <p className="unresolved">
                “{review.supplier.read}” matches {review.supplier.matches.join(' and ')}.
              </p>
            )}

            {bulkNote !== null && (
              <div className="bulk-note" role="status">
                {bulkNote.added.length > 0 && (
                  <p>
                    Added {bulkNote.added.length} ingredient{bulkNote.added.length === 1 ? '' : 's'}:{' '}
                    {bulkNote.added.map((a) => a.name).join(', ')}.
                  </p>
                )}
                {bulkNote.added.length > 0 && (
                  <p className="unresolved">
                    None of {bulkNote.added.length === 1 ? 'it' : 'them'} has allergens recorded yet —
                    that is not the same as having none. Check {bulkNote.added.length === 1 ? 'it' : 'them'} in
                    Library → Ingredients.
                  </p>
                )}
                {bulkNote.failed.length > 0 && (
                  <p className="error">
                    Not added: {bulkNote.failed.map((f) => `${f.name} (${f.why})`).join('; ')}.
                  </p>
                )}
              </div>
            )}

            {newLines.length >= 2 && !bulkOpen && (
              <button type="button" disabled={busy || adding !== null} onClick={() => setBulkOpen(true)}>
                Add all {newLines.length} new lines as ingredients
              </button>
            )}

            {bulkOpen && (
              <AddAllIngredients
                descriptions={newLines}
                existing={ingredientList}
                kitchenId={(kitchen.status === 'ready' ? kitchen.membership.kitchenId : '') as KitchenId}
                supplierId={matchedSupplierId}
                onDone={bulkDone}
                onCancel={() => setBulkOpen(false)}
              />
            )}

            <ul className="invoice-lines">
              {groupLines(review.lines).map((group) => {
                const first = group.lines[0];
                if (first === undefined) return null;
                const price = first.price;
                const isNew = price.kind === 'no_ingredient' && price.reason === 'new';
                const named = addedAs[group.description];

                return (
                  <li key={group.description} className="invoice-line">
                    <div className="invoice-line-head">
                      <strong>{group.description}</strong>
                      {group.lines.length > 1 && (
                        <span className="muted num">{group.lines.length} lines</span>
                      )}
                    </div>

                    {/* What the receipt said, always — matched or not. */}
                    <p className="muted num invoice-line-read">{groupWorking(group)}</p>

                    {price.kind === 'priced' ? (
                      <p className="num">
                        {formatMoney(price.pricePerPack as Cents, 'not known')} a pack
                        <span className="muted">
                          {' '}
                          — {formatMoney(price.pricePerUnit as Cents, '')} a unit
                          {first.previousPrice !== null &&
                            `, was ${formatMoney(first.previousPrice, 'not priced')}`}
                        </span>
                      </p>
                    ) : (
                      // Every unpriced outcome gets its OWN sentence, from one
                      // exhaustive function.
                      <p className="unresolved">{lineNote(price)}</p>
                    )}

                    {/* Only once the reloaded list holds it — before that, "doesn't
                        match" would just mean "not re-read yet". */}
                    {/* A receipt count against his pack: priced only on his word. */}
                    {first.ingredient.kind === 'matched' &&
                      first.ingredient.record.pack !== null &&
                      first.unit === null &&
                      (onePackEach.has(group.description) ||
                        (price.kind === 'unconvertible' && price.invoiceUnit === '')) && (
                        <button
                          type="button"
                          className="sm"
                          disabled={busy}
                          onClick={() => togglePackEach(group.description)}
                        >
                          {onePackEach.has(group.description)
                            ? 'Undo — not one pack each'
                            : `Each one is one ${first.ingredient.record.pack.size} ${first.ingredient.record.pack.unit} pack`}
                        </button>
                      )}

                    {first.ingredient.kind === 'matched' &&
                      first.ingredient.record.pack === null &&
                      packOffer(first.ingredient.record, group.description)}

                    {isNew && named !== undefined && ingredientList.some((i) => i.name === named) && (
                      <p className="muted">
                        You added “{named}”, but it doesn’t match “{group.description}”, so this
                        line still isn’t linked. Keep the receipt’s words in the name to link it.
                      </p>
                    )}

                    {isNew && !bulkOpen && adding !== group.description && (
                      <button
                        type="button"
                        className="sm"
                        disabled={busy || adding !== null}
                        onClick={() => setAdding(group.description)}
                      >
                        Add as ingredient
                      </button>
                    )}

                    {adding === group.description && (
                      <div className="invoice-add">
                        <p className="muted">
                          The receipt says: {groupWorking(group)}. Set how you count and buy it
                          below — the pack size and price are yours to enter, not read off the
                          receipt.
                        </p>
                        <IngredientForm
                          ingredient={null}
                          prefill={{ name: tidyName(group.description), supplierId: matchedSupplierId }}
                          packHint={packFromLine(group.description)}
                          done={() => {
                            setAdding(null);
                            ingredients.reload();
                          }}
                          onSavedName={(name) =>
                            setAddedAs((prev) => ({ ...prev, [group.description]: name }))
                          }
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Refusals, in his terms. Each names what to do about it. */}
          {review.needsManualHandling.length > 0 && (
            <section className="unresolved-block">
              <h2>Enter these by hand</h2>
              <p>
                No honest conversion exists for these, and one has not been invented. A guessed
                factor here would put a wrong price into every recipe using the ingredient.
              </p>
              <ul>
                {[...new Set(review.needsManualHandling)].map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </section>
          )}

          {review.gaps.length > 0 && (
            <section className="needs-fixing">
              <h2>Needs settling before saving</h2>
              <ul>
                {review.gaps.map((g) => (
                  <li key={g.field}>
                    {g.label}
                    {g.saw !== null && <span className="muted"> — saw “{g.saw}”</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={busy || !review.readyToSave}
              onClick={() => void confirm()}
            >
              {busy
                ? 'Saving…'
                : `Confirm and update ${review.priceableCount} price${review.priceableCount === 1 ? '' : 's'}`}
            </button>
          </div>

          <p className="hint muted">
            Only the lines priced above are saved. Nothing is saved until you tap confirm.
          </p>
        </>
      )}
    </Screen>
  );
}
