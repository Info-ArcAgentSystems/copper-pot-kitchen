/**
 * Scan a job sheet: photograph → review → confirm.
 *
 * THE REVIEW IS THE POINT. Nothing on this screen saves anything until the owner
 * taps confirm (Rule 7), and the confirm is refused while anything is
 * outstanding. The model read a photograph of handwriting; it is right most of
 * the time, and the times it is wrong are exactly the times a silent save would
 * cost him a job.
 *
 * So the screen is organised around doubt rather than around fields:
 *
 *   WHAT WAS READ      every value, with what it resolved to in his own data
 *   NEEDS YOU          gaps — unreadable, ambiguous, or not in his data yet
 *   NEW TO YOUR DATA   names read fine that he does not have. Flagged, never
 *                      created: adding a customer is his decision, made once,
 *                      not a side effect of pointing a camera at paper.
 *
 * The engine is not involved. A scanned sheet is not a calculation — it becomes
 * a job, and every quantity follows from the job through the one cascade, after
 * he has confirmed it.
 */

import { useState, type ReactNode } from 'react';
import { supabaseClient, supabaseDb } from '../../data/client';
import {
  customerRepository,
  propertyRepository,
  recipeRepository,
} from '../../data/repositories';
import { commitScannedJob } from '../../scan/commit';
import { reviewJobSheet, type JobSheetReview } from '../../scan/jobSheet';
import { parseJobSheet } from '../../scan/parseImage';
import { toScaledDataUrl } from './scaleImage';
import { EmptyState } from '../../ui/EmptyState';
import { useAsync } from '../../ui/useAsync';

/** What resolution to show beside a read name, in words rather than a code. */
const resolutionOf = (r: JobSheetReview['customer'] | JobSheetReview['property']): string => {
  switch (r.kind) {
    case 'matched':
      return `matched to ${r.record.name}`;
    case 'new':
      return 'not in your data yet';
    case 'ambiguous':
      return `matches ${r.matches.length} of your records`;
    case 'missing':
      return 'not read';
  }
};

const readValue = (r: JobSheetReview['customer'] | JobSheetReview['property']): string =>
  r.kind === 'missing' ? '—' : r.read;

export function ScanJobSheet(): ReactNode {
  const db = supabaseDb();

  const customers = useAsync(() => customerRepository(db).list(), []);
  const properties = useAsync(() => propertyRepository(db).list(), []);
  const recipes = useAsync(() => recipeRepository(db).list(), []);

  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [review, setReview] = useState<JobSheetReview | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const ready =
    customers.state.status === 'ready' &&
    properties.state.status === 'ready' &&
    recipes.state.status === 'ready';

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
      const reply = await parseJobSheet(image, {
        url: `${base}/functions/v1/parse-image`,
        token,
      });

      if (reply.kind === 'unresolved') {
        setRefusal(reply.reason);
        return;
      }

      // The model resolved nothing. Names are matched HERE, against his own
      // records, by the same matcher Ask Sous uses.
      setReview(
        reviewJobSheet(reply.read, {
          customers: customers.state.status === 'ready' ? customers.state.data : [],
          properties: properties.state.status === 'ready' ? properties.state.data : [],
          recipes: recipes.state.status === 'ready' ? recipes.state.data : [],
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
    const result = await commitScannedJob(db, review);
    setBusy(false);

    if (result.ok) {
      setSaved(result.jobId);
      setReview(null);
    } else {
      setRefusal(result.error);
    }
  };

  return (
    <section>
      <h1>Scan a job sheet</h1>
      <p className="muted">
        Photograph the sheet. Nothing is saved until you have checked it and tapped confirm.
      </p>

      <label className="check">
        <input
          type="file"
          accept="image/*"
          // Opens the camera directly on a phone, which is where this is used —
          // standing over a sheet of paper, one-handed.
          capture="environment"
          disabled={busy || !ready}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file !== undefined) void scan(file);
          }}
        />
        <span>Take or choose a photo</span>
      </label>

      {busy && <p className="muted">Reading it…</p>}

      {refusal !== null && (
        <p className="error" role="alert">
          {refusal}
        </p>
      )}

      {saved !== null && (
        <p role="status">
          Saved as a new enquiry. Open it on the Jobs screen to add portions and dietaries.
        </p>
      )}

      {review === null && !busy && refusal === null && saved === null && (
        <EmptyState
          title="Nothing scanned yet"
          description="A photo of a job sheet becomes a draft job you can check before saving."
        />
      )}

      {review !== null && (
        <>
          <section>
            <h2>What was read</h2>
            <ul className="records">
              <li>
                Customer: <strong>{readValue(review.customer)}</strong>{' '}
                <span className="muted">— {resolutionOf(review.customer)}</span>
              </li>
              <li>
                Property: <strong>{readValue(review.property)}</strong>{' '}
                <span className="muted">— {resolutionOf(review.property)}</span>
              </li>
              <li>
                Date: <strong>{review.serviceDate ?? 'not read'}</strong>
              </li>
              <li>
                Time: <strong>{review.serviceTime ?? 'not read'}</strong>
              </li>
              <li>
                Service: <strong>{review.serviceType ?? 'not read'}</strong>
              </li>
              <li>
                {/* Rule 8: blank, never a guess, and never a zero. */}
                Guests: <strong>{review.guests ?? 'not read'}</strong>
              </li>
              {review.dishes.map((d, at) => (
                <li key={at}>
                  Dish: <strong>{d.kind === 'missing' ? '—' : d.read}</strong>{' '}
                  <span className="muted">
                    — {d.kind === 'matched' ? 'one of your recipes' : 'not one of your recipes'}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {review.gaps.length > 0 && (
            <section className="needs-fixing">
              <h2>Needs you</h2>
              <p className="muted">
                Nothing here was guessed. These are the things the sheet did not say clearly.
              </p>
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

          {review.newThings.length > 0 && (
            <section className="unresolved-block">
              <h2>New to your data</h2>
              <p className="muted">
                Not created. Add them yourself first if they are right, then scan again.
              </p>
              <ul>
                {review.newThings.map((n, at) => (
                  <li key={at}>
                    {n.what}: <strong>{n.read}</strong>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <button type="button" disabled={busy || !review.readyToSave} onClick={() => void confirm()}>
            Confirm and save as a new job
          </button>
          {!review.readyToSave && (
            <p className="muted">
              Settle everything under “Needs you” first — on a photograph, an unanswered field is
              the one most likely to be wrong.
            </p>
          )}
        </>
      )}
    </section>
  );
}
