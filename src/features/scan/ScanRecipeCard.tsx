/**
 * Scan a recipe card: photograph → review → confirm.
 *
 * The same three-step shell as the job sheet, and the same rule about who does
 * what. The model reports what it read; every name is matched HERE against the
 * owner's ingredients, by the same matcher Ask Sous uses.
 *
 * The section that matters is "kept by name". An ingredient whose quantity could
 * not be read is shown there — present, named, and carrying no number at all. It
 * is not an error state and the screen does not dress it as one: Rule 8 treats an
 * unmeasured item as a first-class thing to record, and a recipe with "seasoning"
 * and no figure is complete rather than half-entered.
 */

import { useState, type ReactNode } from 'react';
import { supabaseClient, supabaseDb } from '../../data/client';
import { ingredientRepository } from '../../data/repositories';
import { commitScannedRecipe } from '../../scan/commit';
import { parseRecipeCard } from '../../scan/parseImage';
import { reviewRecipeCard, type RecipeCardReview } from '../../scan/recipeCard';
import { toScaledDataUrl } from './scaleImage';
import { useAsync } from '../../ui/useAsync';

/** How a resolved name reads, in his terms rather than the type's. */
function resolutionOf(resolved: { kind: string; matches?: readonly string[] }): string {
  switch (resolved.kind) {
    case 'matched':
      return 'already in your ingredients';
    case 'new':
      return 'NEW — not in your ingredients yet';
    case 'ambiguous':
      return `matches ${(resolved.matches ?? []).join(', ')} — which is it?`;
    default:
      return 'could not be read';
  }
}

export function ScanRecipeCard(): ReactNode {
  const db = supabaseDb();
  const ingredients = useAsync(() => ingredientRepository(db).list(), []);

  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [review, setReview] = useState<RecipeCardReview | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const ready = ingredients.state.status === 'ready';

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
      const reply = await parseRecipeCard(image, {
        url: `${base}/functions/v1/parse-image`,
        token,
      });

      if (reply.kind === 'unresolved') {
        setRefusal(reply.reason);
        return;
      }

      // Matching happens here, never server-side. The model was never told which
      // ingredients exist.
      setReview(
        reviewRecipeCard(reply.read, {
          ingredients: ingredients.state.status === 'ready' ? ingredients.state.data : [],
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
    const result = await commitScannedRecipe(db, review);
    setBusy(false);

    if (result.ok) {
      setSaved(result.recipeId);
      setReview(null);
    } else {
      setRefusal(result.error);
    }
  };

  return (
    <section>
      <h1>Scan a recipe card</h1>
      <p className="muted">
        Photograph the card. Nothing is saved until you have read it back and confirmed it.
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

      {saved !== null && <p className="muted">Saved. It is in your recipes now.</p>}

      {review !== null && (
        <>
          <section className="units">
            <h2>What it read</h2>
            <ul className="records">
              <li>
                <strong>{review.name ?? 'name not read'}</strong>
                {review.course !== null && <span className="muted"> — {review.course}</span>}
              </li>
              <li>
                {review.yieldType === null ? (
                  <span className="unresolved">yield not read</span>
                ) : review.yieldType === 'batch' ? (
                  <>
                    <strong>one batch</strong>
                    <span className="muted">
                      {' '}
                      —{' '}
                      {review.portionsPerBatch === null
                        ? 'portions per batch not read'
                        : `${review.portionsPerBatch} portions${review.batchUnit === null ? '' : ` per ${review.batchUnit}`}`}
                    </span>
                  </>
                ) : (
                  <strong>per person</strong>
                )}
              </li>
            </ul>

            <h3>Quantities</h3>
            {review.components.length === 0 ? (
              <p className="muted">None with a readable quantity.</p>
            ) : (
              <ul className="records">
                {review.components.map((c) => (
                  <li key={c.read}>
                    <span className="num">
                      {c.qty} {c.unit}
                    </span>{' '}
                    <strong>{c.read}</strong>
                    <span className="muted"> — {resolutionOf(c.ingredient)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Rule 8 made visible. Not an error — a real way to record an
              ingredient he has never measured. */}
          {review.unquantified.length > 0 && (
            <section className="units">
              <h2>Kept by name, with no quantity</h2>
              <p className="muted">
                These are part of the recipe. No number was read for them and none has been
                invented — they will be listed for you to judge when you cook.
              </p>
              <ul className="records">
                {review.unquantified.map((u) => (
                  <li key={u.name}>
                    <strong>{u.name}</strong>
                    <span className="muted"> — {u.reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {review.newThings.length > 0 && (
            <section className="unresolved-block">
              <h2>New to your ingredients</h2>
              <p>
                These are not in your data. Add them in Ingredients first — the scanner will not
                create them for you.
              </p>
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
              {busy ? 'Saving…' : 'Confirm and save this recipe'}
            </button>
          </div>

          <p className="hint muted">
            Nothing is saved until you tap confirm. The scanner cannot save on its own.
          </p>
        </>
      )}
    </section>
  );
}
