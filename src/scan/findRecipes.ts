/**
 * Asking the search function for candidate recipes.
 *
 * Node-pure: no browser globals, so the narrowing below is testable without a
 * network. Mirrors `parseImage.ts` — one transport, a validator that reports a
 * bad shape rather than swallowing it, and a refusal returned as a value rather
 * than thrown.
 *
 * THE NARROWING IS NOT DEFENSIVE PADDING. Anything absent or the wrong type
 * becomes null here, and `reviewWebRecipe` then routes it — a missing quantity to
 * the unquantified list, a missing source to an outright refusal. That division
 * of labour is the point: this file decides what was SAID, and the review decides
 * what it MEANS.
 */

import type { WebRecipeRead } from './webRecipe';

export type FindReply =
  | { readonly kind: 'found'; readonly candidates: readonly WebRecipeRead[] }
  | { readonly kind: 'unresolved'; readonly reason: string };

export interface FindOptions {
  readonly url: string;
  readonly token: string;
  /** Injected so this is testable without a network. */
  readonly send?: typeof fetch;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/**
 * A number, or null.
 *
 * Models quote numbers, so a cleanly-resolving numeric string is accepted — the
 * defect that made every invoice figure unreadable was a narrower that demanded
 * `typeof === 'number'`. Anything with residue after trimming is refused rather
 * than coerced: `parseFloat` would turn "about 2" into 2.
 */
function amount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed === '') return null;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function validateFind(raw: unknown): FindReply {
  if (typeof raw !== 'object' || raw === null) {
    return { kind: 'unresolved', reason: 'The search service replied with nothing readable.' };
  }

  const body = raw as Record<string, unknown>;

  // The function reports its own failures in `reason`. Passed through rather than
  // rewritten, so "the key is not set" does not become "no recipes found".
  const stated = text(body['reason']);
  if (stated !== null) return { kind: 'unresolved', reason: stated };

  if (!Array.isArray(body['candidates'])) {
    return { kind: 'unresolved', reason: 'The search service replied in an unexpected shape.' };
  }

  const candidates = body['candidates'].map((entry): WebRecipeRead => {
    const c = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    const yieldRead = text(c['yieldType']);

    return {
      title: text(c['title']),
      // Left exactly as reported, including absent. `reviewWebRecipe` is the only
      // thing allowed to decide a missing source is fatal, and it does.
      sourceUrl: text(c['sourceUrl']),
      course: text(c['course']),
      yieldType: yieldRead === 'per_person' || yieldRead === 'batch' ? yieldRead : null,
      portionsPerBatch: amount(c['portionsPerBatch']),
      batchUnit: text(c['batchUnit']),
      ingredients: Array.isArray(c['ingredients'])
        ? c['ingredients']
            .map((i) => {
              const item = (typeof i === 'object' && i !== null ? i : {}) as Record<string, unknown>;
              const name = text(item['name']);
              return name === null
                ? null
                : { name, qty: amount(item['qty']), unit: text(item['unit']) };
            })
            .filter((i): i is { name: string; qty: number | null; unit: string | null } => i !== null)
        : [],
      uncertain: [],
    };
  });

  return { kind: 'found', candidates };
}

/**
 * `exclude` carries the pages already shown, so "search again" finds DIFFERENT
 * recipes rather than re-rolling the same three.
 */
export async function findRecipes(
  dish: string,
  exclude: readonly string[],
  options: FindOptions,
): Promise<FindReply> {
  const send = options.send ?? fetch;

  let response: Response;
  try {
    response = await send(options.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.token}`,
      },
      body: JSON.stringify({ dish, exclude }),
    });
  } catch {
    return { kind: 'unresolved', reason: 'Could not reach the recipe search.' };
  }

  if (response.status === 404) {
    // A real state: the function ships on a separate deploy from the app, so the
    // screen can exist before the function does. Worded as itself.
    return { kind: 'unresolved', reason: 'Recipe search is not set up on this project yet.' };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: 'unresolved', reason: 'The search service replied with something unreadable.' };
  }

  return validateFind(body);
}
