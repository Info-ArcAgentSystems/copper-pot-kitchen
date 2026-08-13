/**
 * Asking the question, and refusing what comes back when it is not a tool call.
 *
 * The client half of Rule 3. The edge function returns an intent; this validates
 * it against the registry BEFORE anything runs. A name that is not a registered
 * tool is refused rather than executed — which is the mechanism that makes
 * `{tool: 'commit'}` a no-op rather than a write.
 *
 * NO PROVIDER KEY IS REACHABLE FROM HERE. It lives in a Supabase function
 * secret, read by Deno inside the edge function. It is deliberately not a
 * `VITE_` variable: Vite INLINES those into the browser bundle at build time, so
 * a key named that way would ship to every visitor. `tests/sous/guards.test.ts`
 * asserts no file under `src/` names a provider or carries a key-shaped string.
 *
 * This file does not know or care which provider answers. That is why swapping
 * from Anthropic to OpenAI changed nothing outside the edge function.
 */

import { TOOL_NAMES, type Intent, type SousReply, type ToolName } from './intent';
import type { ClientRate, Customer, Ingredient, Job, Recipe } from '../engine/types';

/**
 * What the model is told about the kitchen.
 *
 * IDENTIFIERS AND LABELS ONLY. No total, no cost, no batch count, no outstanding
 * quantity. Sending a computed figure would invite the model to restate it, and a
 * restated figure is the model calculating by the back door — the exact thing
 * this design exists to prevent.
 *
 * A guest count IS included: that is a fact the owner typed, not a result. The
 * distinction is the whole of Rule 2, and `guards.test.ts` pins it by refusing
 * any key matching total/cost/margin/batches/outstanding/revenue/surplus.
 */
export interface SousContext {
  readonly today: string;
  readonly jobs: readonly {
    readonly jobId: string;
    readonly serviceDate: string | null;
    readonly serviceType: string | null;
    readonly customer: string | null;
    readonly status: string;
    readonly guests: number | null;
  }[];
  readonly recipes: readonly { readonly recipeId: string; readonly name: string }[];
  readonly ingredients: readonly { readonly ingredientId: string; readonly name: string }[];
}

export function buildContext(
  jobs: readonly Job[],
  recipes: readonly Recipe[],
  ingredients: readonly Ingredient[],
  customers: readonly Customer[],
  today: string,
  _rates: readonly ClientRate[] = [],
): SousContext {
  const customerById = new Map(customers.map((c) => [c.id as string, c]));

  return {
    today,
    jobs: jobs.map((j) => ({
      jobId: j.id,
      serviceDate: j.serviceDate,
      serviceType: j.serviceType,
      customer: j.customerId === null ? null : (customerById.get(j.customerId)?.name ?? null),
      status: j.status,
      guests: j.guests,
    })),
    recipes: recipes.map((r) => ({ recipeId: r.id, name: r.name })),
    ingredients: ingredients.map((i) => ({ ingredientId: i.id, name: i.name })),
  };
}

/**
 * Is this something the registry can actually run?
 *
 * Checked against `TOOL_NAMES` rather than trusting the reply. The model is not
 * an adversary here, but it is a component that can be wrong, and the cost of
 * running an unrecognised instruction against the owner's data is high enough
 * that "refuse anything unfamiliar" is the only sensible posture.
 */
export function validateReply(raw: unknown): SousReply {
  if (typeof raw !== 'object' || raw === null) {
    return { kind: 'unresolved', reason: 'Sous did not reply with anything usable.' };
  }

  const candidate = raw as { tool?: unknown; args?: unknown; reason?: unknown };

  if (typeof candidate.reason === 'string' && candidate.tool === undefined) {
    return { kind: 'unresolved', reason: candidate.reason };
  }

  if (typeof candidate.tool !== 'string') {
    return { kind: 'unresolved', reason: 'Sous did not choose one of its tools.' };
  }

  if (!(TOOL_NAMES as readonly string[]).includes(candidate.tool)) {
    // The load-bearing refusal. `commit` lands here, as does anything invented.
    return {
      kind: 'unresolved',
      reason: `"${candidate.tool}" is not something Sous can do. Ask another way, or use the screen directly.`,
    };
  }

  if (typeof candidate.args !== 'object' || candidate.args === null) {
    return { kind: 'unresolved', reason: 'Sous chose a tool but gave it nothing to work with.' };
  }

  return {
    kind: 'intent',
    intent: { tool: candidate.tool as ToolName, args: candidate.args } as Intent,
  };
}

export interface AskOptions {
  readonly url: string;
  readonly token: string;
  /** Injected so the client is testable without a network. */
  readonly send?: typeof fetch;
}

/**
 * Send the question. Returns an intent or a stated refusal, never a throw.
 *
 * The edge function is not deployed yet, so "unavailable" is a real state the
 * owner will meet. It is worded as itself rather than as a generic failure.
 */
export async function askSous(
  message: string,
  context: SousContext,
  options: AskOptions,
): Promise<SousReply> {
  const send = options.send ?? fetch;

  let response: Response;
  try {
    response = await send(options.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.token}`,
      },
      body: JSON.stringify({ message, context }),
    });
  } catch {
    return {
      kind: 'unresolved',
      reason: 'Could not reach Sous. Check the connection, or use the screens directly.',
    };
  }

  if (!response.ok) {
    return {
      kind: 'unresolved',
      reason:
        response.status === 404
          ? 'Ask Sous is not set up on this project yet.'
          : `Sous could not answer (${response.status}).`,
    };
  }

  try {
    return validateReply(await response.json());
  } catch {
    return { kind: 'unresolved', reason: 'Sous replied with something unreadable.' };
  }
}
