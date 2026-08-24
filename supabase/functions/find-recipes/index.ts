/**
 * Finding candidate recipes on the open web.
 *
 * A SEPARATE FUNCTION from `parse-image`, and now for a stronger reason than when
 * it was written: it is the only function here that does not call
 * `/v1/chat/completions`. Hosted web search lives on the RESPONSES API, so this
 * has a different request shape, a different response shape, and a different
 * model. Folding that behind a `mode` string would put two endpoint contracts in
 * one file.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ON `/v1/responses` AND NOT CHAT COMPLETIONS.
 *
 * The first version used `gpt-4o-search-preview` on `/v1/chat/completions`, which
 * was wrong twice over:
 *
 *   1. That model was SHUT DOWN on 2026-07-23, so every call returned 404
 *      `model_not_found` — a month after the code was written and days after it
 *      shipped.
 *   2. Even alive it would not have worked. The search-preview family supports
 *      `streaming`, `structured_outputs` and `image_input` — NOT function
 *      calling — and this function needs a structured candidate list. Fixing the
 *      model name alone would have turned the 404 into a 400.
 *
 * Hosted search is `tools: [{ type: 'web_search' }]` on `/v1/responses`, which is
 * also the only route that combines search with a schema-constrained answer.
 * `web_search_preview` is deliberately NOT used — it remains for legacy callers
 * and lacks the newer controls.
 *
 * A DATED DEPENDENCY. `MODEL` names a specific current model, and OpenAI retires
 * models on its own schedule. This is the one file in the repo whose correctness
 * expires. `tests/scan/guards.test.ts` pins the string so a deliberate change is
 * visible in review, but no test can prove OpenAI still serves it — see
 * ARCHITECTURE.md, which says when to re-check.
 * ---------------------------------------------------------------------------
 *
 * THE ONE THING THIS FUNCTION MUST NOT DO. A model asked to find a lasagne recipe
 * can answer from memory. It will produce a plausible ingredient list with
 * confident quantities, and NOTHING DOWNSTREAM CAN TELL THAT APART from a real
 * extraction — invention wearing the face of a citation. So every candidate must
 * carry the URL it came from: the prompt says it, the schema requires it, and
 * `src/scan/webRecipe.ts` refuses any candidate whose source is absent or is not
 * a real http(s) address. A prompt is a request; a type is a guarantee.
 *
 * METHOD TEXT IS NOT REQUESTED. Ingredient lists and quantities are facts.
 * Instructions are someone's writing, and copying them into a private database is
 * reproduction. The owner gets the link and reads the method at source.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

/**
 * Current, web-search capable, and the replacement OpenAI names for the retired
 * search-preview models. See the dated-dependency note above.
 */
const MODEL = 'gpt-5.6-terra';

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

/**
 * NOTE WHAT IS ABSENT from this schema.
 *
 * No guest count. No target portion count. No converted or scaled quantity. A
 * field the model could fill by computing is a field it will fill by computing,
 * and the same reasoning removed the price-per-pack field from the invoice mode.
 *
 * The recipe is imported at the SOURCE's own yield. `scaleRecipe` does the rest
 * later, once the owner has confirmed the figures are worth trusting.
 *
 * `strict: true` requires every property listed in `required` and
 * `additionalProperties: false` throughout, which is why every field is present
 * and nullable rather than optional. Nullable is the honest shape anyway: "the
 * page did not say" is a real answer.
 */
const CANDIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      description: 'Up to three recipes. Fewer is fine. Never invent one to reach three.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title',
          'sourceUrl',
          'course',
          'yieldType',
          'portionsPerBatch',
          'batchUnit',
          'ingredients',
        ],
        properties: {
          title: { type: ['string', 'null'] },
          sourceUrl: {
            type: 'string',
            description:
              'The full https address of the page this came from. REQUIRED. If you did not open a page, do not report the recipe at all.',
          },
          course: {
            type: ['string', 'null'],
            description:
              'main, side, dessert or breakfast, only if the page says so. Null otherwise — do not infer it from the dish.',
          },
          yieldType: {
            type: ['string', 'null'],
            description:
              'Exactly "per_person" or "batch", read off the page. "Serves 4" is batch. Null if the page does not say — never infer it from the quantities.',
          },
          portionsPerBatch: {
            type: ['number', 'null'],
            description:
              'How many the page says it serves, EXACTLY as stated. Do not scale it to anything.',
          },
          batchUnit: { type: ['string', 'null'] },
          ingredients: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'qty', 'unit'],
              properties: {
                name: { type: 'string', description: 'As the page names it.' },
                qty: {
                  type: ['number', 'null'],
                  description:
                    'The number as printed. Null when the page gives none — "a splash", "to taste", "1 onion" with no unit.',
                },
                unit: {
                  type: ['string', 'null'],
                  description:
                    'The unit as printed — g, kg, ml, cup, tbsp. Null if there is none. Do NOT convert it and do NOT invent one.',
                },
              },
            },
          },
        },
      },
    },
  },
};

const SYSTEM = `You find recipes that already exist on the web. Search for them.

THE RULE THAT MATTERS: every recipe you report must come from a page you actually
opened, and you must give its full https address. If you did not open a page, do
not report a recipe. A recipe from memory is worse than no recipe here, because
nobody downstream can tell the difference.

You REPORT what a page says. You do not calculate:
- quantities are copied exactly as printed, never converted, never scaled
- "serves 4" is reported as 4, whatever anyone might want to cook
- a missing quantity is null. "A splash of oil" has no number. "1 onion" with no
  unit has no usable quantity either — report qty 1 and unit null, and let the
  code decide what to do with it
- if the page does not state a course, the course is null. Do not infer it

Do not return the method or the instructions. They are not wanted.

Never invent a recipe to reach three. Two real ones beat three with a guess.`;

serve(async (request: Request): Promise<Response> => {
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...CORS },
    });

  /**
   * WHAT THE UPSTREAM ACTUALLY SAID.
   *
   * This hole cost two diagnoses. `parse-image` reported "the model could not be
   * reached (404)" in August and this function reported "refused the request
   * (404)" today — both true, both useless, because the status alone does not
   * distinguish a retired model from a revoked key from a malformed payload. The
   * answer was in a body that was read and thrown away.
   *
   * Truncated because an upstream error page can be a megabyte of HTML, and
   * logged as well as returned so it survives in the dashboard even when the
   * screen has moved on.
   */
  const upstreamFailed = async (upstream: Response): Promise<Response> => {
    let said = '(the error body could not be read)';
    try {
      const raw = await upstream.text();
      if (raw.trim() !== '') said = raw.slice(0, 600);
    } catch {
      // Keep the placeholder. A failure to read the failure is not worth a throw.
    }

    console.error(`find-recipes: OpenAI ${upstream.status} — ${said}`);
    return json(
      { reason: `The search service refused the request (${upstream.status}). It said: ${said}` },
      502,
    );
  };

  // Answered before the method check. An OPTIONS falling through to "POST only"
  // is what broke the first ask-sous deploy, and it is invisible to curl.
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method !== 'POST') return json({ reason: 'POST only' }, 405);

  const key = Deno.env.get('OPENAI_API_KEY');
  if (key === undefined || key === '') {
    return json({ reason: 'OPENAI_API_KEY is not set on this function.' }, 500);
  }

  let payload: { dish?: unknown; exclude?: unknown };
  try {
    payload = await request.json();
  } catch {
    return json({ reason: 'The request body was not JSON.' }, 400);
  }

  const dish = typeof payload.dish === 'string' ? payload.dish.trim() : '';
  if (dish === '') return json({ reason: 'No dish was named.' }, 400);

  // Pages already shown, so "search again" finds DIFFERENT ones rather than
  // re-rolling the same three.
  const exclude = Array.isArray(payload.exclude)
    ? payload.exclude.filter((u): u is string => typeof u === 'string').slice(0, 30)
    : [];

  const ask =
    exclude.length === 0
      ? `Find up to three recipes for: ${dish}`
      : `Find up to three recipes for: ${dish}\n\nDo NOT report any of these pages, which have already been seen:\n${exclude.join('\n')}`;

  let upstream: Response;
  try {
    upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        // Hosted search. NOT `web_search_preview`, which remains only for legacy
        // callers and lacks the newer controls.
        tools: [{ type: 'web_search' }],
        input: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: ask },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'recipe_candidates',
            schema: CANDIDATE_SCHEMA,
            strict: true,
          },
        },
      }),
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'unknown';
    console.error(`find-recipes: could not reach OpenAI — ${detail}`);
    return json({ reason: `Could not reach the search service (${detail}).` }, 502);
  }

  if (!upstream.ok) return upstreamFailed(upstream);

  const body = (await upstream.json()) as {
    output?: { type?: string; content?: { type?: string; text?: string; refusal?: string }[] }[];
  };

  /*
   * THE RESPONSES SHAPE, and why this walks rather than indexes.
   *
   * With web search on, `output` holds a `web_search_call` item BEFORE the
   * message — so `output[0]` is the search, not the answer. Indexing would have
   * worked in testing and failed the moment a second search ran.
   */
  const contents = (body.output ?? []).flatMap((item) => item.content ?? []);

  const refusal = contents.find((c) => c.type === 'refusal')?.refusal;
  if (typeof refusal === 'string' && refusal.trim() !== '') {
    // A refusal is a real answer and is passed through as itself. It is not a
    // transport failure and re-searching will not fix it.
    console.error(`find-recipes: model refused — ${refusal}`);
    return json({ reason: `The search service declined: ${refusal}` }, 502);
  }

  const raw = contents.find((c) => c.type === 'output_text')?.text;
  if (typeof raw !== 'string') {
    // Reported rather than swallowed into an empty list. "Found nothing" and "the
    // reply was the wrong shape" are different, and only one is worth tapping
    // search again for.
    console.error(`find-recipes: no output_text in reply — ${JSON.stringify(body).slice(0, 600)}`);
    return json({ reason: 'The search service replied in a shape this could not read.' }, 502);
  }

  try {
    return json(JSON.parse(raw));
  } catch {
    console.error(`find-recipes: output_text was not JSON — ${raw.slice(0, 600)}`);
    return json({ reason: 'The search reply was not valid JSON.' }, 502);
  }
});
