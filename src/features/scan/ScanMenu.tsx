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
import { WebCandidates } from './WebCandidates';
import { toScaledDataUrl } from './scaleImage';
import { PhotoGate } from './PhotoGate';
import { Screen } from '../../ui/Screen';
import { useAsync } from '../../ui/useAsync';
import type { DataSource } from '../../ui/sourceState';
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

  const sources: readonly DataSource[] = [
    {
      what: 'your ingredients',
      why: 'a recipe found on the web is matched against them before you see it',
      state: ingredients.state,
      reload: ingredients.reload,
    },
  ];

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
    <Screen title="Find recipes from a menu">
      <p className="muted">
        Photograph a menu and Sous will look for recipes for each dish. Nothing is saved — each
        one opens in the recipe editor for you to check and adjust to your own portions first.
      </p>

      <PhotoGate sources={sources} busy={busy} onFile={(file) => void scan(file)} />

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

                {/* ONE renderer, shared with the Recipes editor's "find it
                    online". What picking MEANS differs — here it opens a NEW
                    recipe; there it fills the stub it was opened from — so the
                    caller decides that and the list only reports. */}
                <WebCandidates
                  candidates={state.candidates}
                  refused={state.refused}
                  pickLabel="Open in editor"
                  onPick={(candidate) =>
                    navigate('/recipes', { state: { draft: draftFromWebReview(candidate) } })
                  }
                />

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
    </Screen>
  );
}
