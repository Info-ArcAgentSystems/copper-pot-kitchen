/**
 * Photograph a menu, find candidate recipes for each dish.
 *
 * The same scan → review → confirm shell as the other three scanners, with one
 * difference that runs through the whole screen: NOTHING HERE WRITES. A web
 * recipe is someone else's portions and someone else's ingredients, and it must
 * not reach shopping, prep or cost before the owner has looked at it. `confidence`
 * cannot enforce that — nothing in the engine reads it — so the guarantee is that
 * there is no write path at all. A candidate opens in the recipe editor as a
 * draft, and he saves it himself.
 *
 * EVERY CANDIDATE SHOWS WHERE IT CAME FROM. A model asked to find a recipe can
 * answer from memory, and the result is indistinguishable from a real extraction
 * unless something insists on the page. `reviewWebRecipe` refuses a candidate with
 * no usable source; the ones that survive show their link for him to open. The
 * screen says where this CLAIMS to be from — never that it is right.
 */

import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabaseClient, supabaseDb } from '../../data/client';
import { ingredientRepository } from '../../data/repositories';
import { parseMenu } from '../../scan/parseImage';
import { findRecipes } from '../../scan/findRecipes';
import { draftFromWebReview, reviewWebRecipe, type WebRecipeReview } from '../../scan/webRecipe';
import { toScaledDataUrl } from './scaleImage';
import { useAsync } from '../../ui/useAsync';
import type { Ingredient } from '../../engine/types';

interface DishState {
  readonly candidates: readonly WebRecipeReview[];
  /** Pages already shown, so "search again" finds different ones. */
  readonly seen: readonly string[];
  /** Candidates the review threw out for having no source. Counted, not hidden. */
  readonly refused: number;
  readonly busy: boolean;
  readonly error: string | null;
}

const emptyDish = (): DishState => ({
  candidates: [],
  seen: [],
  refused: 0,
  busy: false,
  error: null,
});

export function ScanMenu(): ReactNode {
  const db = supabaseDb();
  const navigate = useNavigate();
  const ingredients = useAsync(() => ingredientRepository(db).list(), []);

  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [dishes, setDishes] = useState<readonly string[]>([]);
  const [byDish, setByDish] = useState<Readonly<Record<string, DishState>>>({});

  const ready = ingredients.state.status === 'ready';
  const ownerIngredients: readonly Ingredient[] =
    ingredients.state.status === 'ready' ? ingredients.state.data : [];

  const endpoint = (name: string): string =>
    `${import.meta.env.VITE_SUPABASE_URL ?? ''}/functions/v1/${name}`;

  const token = async (): Promise<string> =>
    (await supabaseClient().auth.getSession()).data.session?.access_token ?? '';

  const scan = async (file: File): Promise<void> => {
    setBusy(true);
    setRefusal(null);
    setDishes([]);
    setByDish({});

    try {
      const reply = await parseMenu(await toScaledDataUrl(file), {
        url: endpoint('parse-image'),
        token: await token(),
      });

      if (reply.kind === 'unresolved') {
        setRefusal(reply.reason);
        return;
      }

      setDishes(reply.dishes);
      setByDish(Object.fromEntries(reply.dishes.map((d) => [d, emptyDish()])));
    } catch (cause) {
      setRefusal(cause instanceof Error ? cause.message : 'Could not read that photo.');
    } finally {
      setBusy(false);
    }
  };

  /** Three more, excluding everything already shown for this dish. */
  const search = async (dish: string): Promise<void> => {
    const current = byDish[dish] ?? emptyDish();
    setByDish((prior) => ({ ...prior, [dish]: { ...current, busy: true, error: null } }));

    const reply = await findRecipes(dish, current.seen, {
      url: endpoint('find-recipes'),
      token: await token(),
    });

    if (reply.kind === 'unresolved') {
      setByDish((prior) => ({
        ...prior,
        [dish]: { ...current, busy: false, error: reply.reason },
      }));
      return;
    }

    // THE GUARD. A candidate with no page to point at never becomes a review, so
    // it cannot be shown, opened or saved. The count is surfaced rather than
    // swallowed — "two of three came back without a source" is worth knowing.
    const reviewed: WebRecipeReview[] = [];
    let refused = 0;

    for (const candidate of reply.candidates) {
      const outcome = reviewWebRecipe(candidate, { ingredients: ownerIngredients });
      if (outcome.kind === 'reviewed') reviewed.push(outcome.review);
      else refused += 1;
    }

    setByDish((prior) => ({
      ...prior,
      [dish]: {
        candidates: reviewed,
        seen: [...current.seen, ...reviewed.map((r) => r.sourceUrl)],
        refused,
        busy: false,
        error: null,
      },
    }));
  };

  return (
    <section>
      <h1>Find recipes from a menu</h1>
      <p className="muted">
        Photograph a menu and Sous will look for recipes for each dish. Nothing is saved — each
        one opens in the recipe editor for you to check and adjust to your own portions first.
      </p>

      <label className="scan-button">
        <input
          type="file"
          accept="image/*"
          /* NO `capture` HERE, DELIBERATELY.

             It does not mean "prefer the camera" — it means "this control IS a
             camera capture", so Android Chrome and iOS Safari both skip the
             picker and the gallery, Files, iCloud and Drive all disappear.

             A supplier emails an invoice photo; a client sends a menu as a
             screenshot. Those cannot be re-photographed off a screen, and should
             not have to be. `tests/scan/guards.test.ts` keeps it out. */
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

      {dishes.length > 0 && (
        <>
          <h2>What it read</h2>
          {dishes.map((dish) => {
            const state = byDish[dish] ?? emptyDish();

            return (
              <section key={dish} className="pack-job">
                <h2>{dish}</h2>

                {state.error !== null && <p className="error">{state.error}</p>}

                {state.candidates.map((candidate) => (
                  <div key={candidate.sourceUrl} className="line">
                    <strong>{candidate.title ?? 'untitled recipe'}</strong>

                    {/* The source, always. He can open it and judge for himself. */}
                    <p className="hint muted">
                      <a href={candidate.sourceUrl} target="_blank" rel="noreferrer noopener">
                        {candidate.sourceUrl}
                      </a>
                    </p>

                    <p className="muted num">
                      {candidate.yieldType === 'batch'
                        ? `serves ${candidate.portionsPerBatch ?? '?'}`
                        : candidate.yieldType === 'per_person'
                          ? 'per person'
                          : 'yield not stated'}
                      {' · '}
                      {candidate.components.length} with quantities
                      {candidate.unquantified.length > 0 &&
                        ` · ${candidate.unquantified.length} without`}
                    </p>

                    {candidate.warnings.map((w) => (
                      <p key={w} className="unresolved">
                        {w}
                      </p>
                    ))}

                    {candidate.newThings.length > 0 && (
                      <p className="muted">
                        New to your ingredients: {candidate.newThings.map((n) => n.read).join(', ')}
                      </p>
                    )}

                    {candidate.gaps.length > 0 && (
                      <ul className="unresolved-block">
                        {candidate.gaps.map((g) => (
                          <li key={g.field}>{g.label}</li>
                        ))}
                      </ul>
                    )}

                    <div className="actions">
                      <button
                        type="button"
                        className="primary"
                        disabled={!candidate.readyToSave}
                        onClick={() =>
                          navigate('/recipes', {
                            state: { draft: draftFromWebReview(candidate) },
                          })
                        }
                      >
                        Open in editor
                      </button>
                    </div>
                  </div>
                ))}

                {state.refused > 0 && (
                  <p className="unresolved">
                    {state.refused} result{state.refused === 1 ? '' : 's'} came back with no source
                    link and {state.refused === 1 ? 'was' : 'were'} not kept.
                  </p>
                )}

                <button type="button" disabled={state.busy} onClick={() => void search(dish)}>
                  {state.busy
                    ? 'Searching…'
                    : state.candidates.length === 0
                      ? 'Find recipes'
                      : 'Search again'}
                </button>
              </section>
            );
          })}
        </>
      )}

      <p className="hint muted">
        Nothing on this screen is saved. A recipe found here is someone else's portions and
        someone else's ingredients — it only counts once you have checked it and saved it
        yourself.
      </p>
    </section>
  );
}
