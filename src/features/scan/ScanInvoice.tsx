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
import { IngredientForm } from '../setup/Ingredients';
import { parseInvoice } from '../../scan/parseImage';
import { toScaledDataUrl } from './scaleImage';
import { PhotoGate } from './PhotoGate';
import { formatMoney } from '../../ui/form';
import { groupLines, groupWorking, lineNote } from '../../ui/invoiceView';
import { Screen } from '../../ui/Screen';
import { useAsync } from '../../ui/useAsync';
import type { DataSource } from '../../ui/sourceState';
import type { Cents, KitchenId, SupplierId } from '../../engine/types';
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

  const ingredientList = ingredients.state.status === 'ready' ? ingredients.state.data : [];
  const supplierList = suppliers.state.status === 'ready' ? suppliers.state.data : [];

  const review: InvoiceReview | null =
    read === null ? null : reviewInvoice(read, { ingredients: ingredientList, suppliers: supplierList });

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

  /** The ONLY thing on this screen that writes. Rule 7's separate call. */
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

  return (
    <Screen title="Scan an invoice">
      <p className="muted">
        Photograph the invoice. Prices are worked out from the quantity and the line total —
        nothing is saved until you have checked them.
      </p>

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
                    {isNew && named !== undefined && ingredientList.some((i) => i.name === named) && (
                      <p className="muted">
                        You added “{named}”, but it doesn’t match “{group.description}”, so this
                        line still isn’t linked. Keep the receipt’s words in the name to link it.
                      </p>
                    )}

                    {isNew && adding !== group.description && (
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
