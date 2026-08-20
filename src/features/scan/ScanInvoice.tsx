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
import { reviewInvoice, type InvoiceReview } from '../../scan/invoice';
import { parseInvoice } from '../../scan/parseImage';
import { toScaledDataUrl } from './scaleImage';
import { formatMoney } from '../../ui/form';
import { useAsync } from '../../ui/useAsync';
import type { Cents } from '../../engine/types';

const today = (): string => new Date().toISOString().slice(0, 10);

export function ScanInvoice(): ReactNode {
  const db = supabaseDb();
  const ingredients = useAsync(() => ingredientRepository(db).list(), []);
  const suppliers = useAsync(() => supplierRepository(db).list(), []);

  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [review, setReview] = useState<InvoiceReview | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  const ready = ingredients.state.status === 'ready' && suppliers.state.status === 'ready';

  const scan = async (file: File): Promise<void> => {
    if (!ready) return;

    setBusy(true);
    setRefusal(null);
    setReview(null);
    setSaved(null);

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

      // The division happens in here, in the engine — not on the server, and not
      // by the model.
      setReview(
        reviewInvoice(reply.read, {
          ingredients: ingredients.state.status === 'ready' ? ingredients.state.data : [],
          suppliers: suppliers.state.status === 'ready' ? suppliers.state.data : [],
        }),
      );
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
      setReview(null);
    } else {
      setRefusal(result.error);
    }
  };

  return (
    <section>
      <h1>Scan an invoice</h1>
      <p className="muted">
        Photograph the invoice. Prices are worked out from the quantity and the line total —
        nothing is saved until you have checked them.
      </p>

      <label className="check">
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled={busy || !ready}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file !== undefined) void scan(file);
          }}
        />
        Take or choose a photo
      </label>

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
              {review.invoiceDate ?? 'date not read'}
              {review.supplier.kind === 'matched'
                ? ` — ${(review.supplier as { record: { name: string } }).record.name}`
                : ' — supplier not matched'}
            </p>

            <ul className="records">
              {review.lines.map((line) => (
                <li key={line.description}>
                  <strong>{line.description}</strong>

                  {line.price.kind === 'priced' ? (
                    <>
                      <span className="num">
                        {' '}
                        {formatMoney(line.price.pricePerPack as Cents, 'not known')} a pack
                      </span>
                      {/* The working, so the sum is checkable rather than trusted. */}
                      <span className="muted">
                        {' '}
                        — {formatMoney(line.price.pricePerUnit as Cents, '')} a unit
                        {line.previousPrice !== null &&
                          `, was ${formatMoney(line.previousPrice, 'not priced')}`}
                      </span>
                    </>
                  ) : (
                    <span className="unresolved">
                      {' '}
                      —{' '}
                      {line.price.kind === 'unconvertible'
                        ? `invoiced in ${line.price.invoiceUnit}, stocked in ${line.price.packUnit}`
                        : line.price.kind === 'no_pack'
                          ? 'no pack size recorded'
                          : 'could not be read'}
                    </span>
                  )}
                </li>
              ))}
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
                {review.needsManualHandling.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </section>
          )}

          {review.newThings.length > 0 && (
            <section className="unresolved-block">
              <h2>New to your ingredients</h2>
              <p>Add these in Ingredients first — the scanner will not create them.</p>
              <ul>
                {review.newThings.map((n) => (
                  <li key={n.read}>{n.read}</li>
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
    </section>
  );
}
