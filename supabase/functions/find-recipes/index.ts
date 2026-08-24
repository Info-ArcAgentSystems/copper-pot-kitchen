/**
 * Finding candidate recipes on the open web.
 *
 * A SEPARATE FUNCTION from `parse-image`, on purpose. Everything around the model
 * is copied verbatim — the same secret, the same CORS with OPTIONS answered
 * before the method check, the same "report the failure rather than swallow it"
 * error surface — but the call itself is a different shape: no image, and a
 * hosted web-search tool rather than vision. Folding that into the mode registry
 * would put two endpoint shapes behind one `mode` string, and the next person
 * debugging a CORS failure would have to work out which one they were in.
 *
 * ---------------------------------------------------------------------------
 * THE ONE THING THIS FUNCTION MUST NOT DO.
 *
 * A model asked to find a lasagne recipe can answer from memory. It will produce
 * a plausible ingredient list with confident quantities, and NOTHING DOWNSTREAM
 * CAN TELL THAT APART from a real extraction — it is invention wearing the face
 * of a citation, and it would land in the owner's recipe book looking exactly as
 * authoritative as a page he chose himself.
 *
 * So every candidate must carry the URL it came from. The prompt says it, the
 * schema requires it, and `src/scan/webRecipe.ts` REFUSES any candidate whose
 * source is absent or is not a real http(s) address. The client is the backstop,
 * because a prompt is a request and a type is a guarantee.
 *
 * The function cannot verify that a URL says what the model claims. Nothing here
 * pretends otherwise: the review screen shows the link for the owner to open, and
 * the system says where it CLAIMS to have got this — never that it is right.
 * ---------------------------------------------------------------------------
 *
 * METHOD TEXT IS NOT REQUESTED. Ingredient lists and quantities are facts.
 * Instructions are someone's writing, and copying them wholesale into a private
 * database is reproduction. The schema has no field for them; the owner gets the
 * link and reads the method at source.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

/** Search-capable. The vision model in parse-image cannot browse. */
const MODEL = 'gpt-4o-search-preview';

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
 */
const FIND_TOOL = [
  {
    type: 'function',
    function: {
      name: 'report_recipes',
      description:
        'Report recipes you actually found on the web, each with the page it came from.',
      parameters: {
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
                  enum: ['per_person', 'batch', null],
                  description:
                    'Read off the page. "Serves 4" is batch. Null if the page does not say — never infer it from the quantities.',
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
      },
    },
  },
];

const SYSTEM = `You find recipes that already exist on the web.

THE RULE THAT MATTERS: every recipe you report must come from a page you actually
found, and you must give its full https address. If you did not open a page, do
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

Never invent a recipe to reach three. Two real ones beat three with a guess.

Return the report_recipes tool. There is nothing else to return.`;

serve(async (request: Request): Promise<Response> => {
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...CORS },
    });

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
    upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        tools: FIND_TOOL,
        tool_choice: { type: 'function', function: { name: 'report_recipes' } },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: ask },
        ],
      }),
    });
  } catch (cause) {
    return json(
      { reason: `Could not reach the search service (${cause instanceof Error ? cause.message : 'unknown'}).` },
      502,
    );
  }

  if (!upstream.ok) {
    return json({ reason: `The search service refused the request (${upstream.status}).` }, 502);
  }

  const body = (await upstream.json()) as {
    choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[];
  };

  const raw = body.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (typeof raw !== 'string') {
    // Reported rather than swallowed into an empty list. "Found nothing" and
    // "the reply was the wrong shape" are different, and only one is worth
    // tapping search again for.
    return json({ reason: 'The search service replied in a shape this could not read.' }, 502);
  }

  try {
    return json(JSON.parse(raw));
  } catch {
    return json({ reason: 'The search reply was not valid JSON.' }, 502);
  }
});
