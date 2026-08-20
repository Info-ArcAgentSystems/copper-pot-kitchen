/**
 * parse-image — read a photographed job sheet into fields. Nothing else.
 *
 * DENO, not the browser bundle. `OPENAI_API_KEY` is a Supabase function secret
 * read here at runtime, so it never enters the client build — the SAME secret
 * ask-sous uses, on the same project. It must NEVER be renamed with a `VITE_`
 * prefix: Vite inlines those into the bundle and the key would ship to every
 * visitor.
 *
 * THIS FUNCTION DOES NO ARITHMETIC AND IMPORTS NO ENGINE CODE (Rule 2).
 *
 * It also RESOLVES NOTHING. It returns what it read, verbatim — it is never told
 * which customers, properties or recipes exist, and could not match against them
 * if it were. That matching happens in the browser, in `src/scan/jobSheet.ts`,
 * through the same matcher Ask Sous uses. The reason is Rule 5: two matchers
 * would eventually disagree about whether a customer already exists, and the
 * scanner would quietly create a duplicate of someone already in the book.
 *
 * FLAG, NEVER INVENT (Rule 8). Every field in the schema is nullable and the
 * model is required to return an `uncertain` list. An unreadable guest count is
 * null plus an entry naming it — not the number it probably was. This is the
 * single most important instruction in the file, because a guessed figure here
 * becomes an ordinary-looking value the moment it is saved.
 *
 * `tool_choice: 'required'` forces the structured shape. The model cannot answer
 * in prose, so there is no free-text path that could carry a narrative summary
 * instead of fields.
 *
 * NOT DEPLOYED BY CLAUDE. Deploy with:
 *   npm run supabase:secrets -- OPENAI_API_KEY=sk-...   (already set for ask-sous)
 *   npm run supabase:deploy:parse-image
 * Both carry --project-ref vhzpwdzrlrcfhxrjawym. See ARCHITECTURE.md: this
 * machine has PCD PROD linked as well, and a bare CLI command goes to that one —
 * which is exactly where the first ask-sous deploy landed.
 */

// @ts-expect-error — Deno's remote import, resolved at deploy time, not by tsc.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

declare const Deno: { env: { get(key: string): string | undefined } };

/** Vision-capable, and the same model ask-sous already proved on this account. */
const MODEL = 'gpt-4o';

/**
 * CORS, and why every response carries it.
 *
 * The browser sends a preflight OPTIONS before the POST, because the request has
 * `authorization` and a JSON content-type. Without these headers the preflight
 * fails, `fetch` REJECTS rather than returning a status, and the client reports
 * "could not reach" — which is what the first ask-sous deploy did.
 *
 * They go on the error paths too. A 500 with no allow-origin is exactly as
 * invisible to the browser as a 405, so a genuine failure would present as the
 * same misleading "could not reach" instead of the real reason.
 *
 * Invisible to curl, which does not enforce CORS. That is why it shipped.
 */
const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

/**
 * The one tool. Every field nullable, `uncertain` required.
 *
 * Nullable is not laziness about types — it is the schema refusing to accept a
 * value the model is not sure of. A required `guests: number` would leave it
 * nothing to return but a guess.
 */
const JOB_SHEET_TOOL = [
  {
    type: 'function',
    function: {
      name: 'job_sheet',
      description:
        'Report what is legible on a photographed catering job sheet. Report only what is written. Anything unreadable or absent is null, and named in `uncertain`.',
      parameters: {
        type: 'object',
        properties: {
          customer: {
            type: ['string', 'null'],
            description: 'The customer or client name, exactly as written. Do not correct spelling.',
          },
          property: {
            type: ['string', 'null'],
            description: 'The venue, house or address, exactly as written.',
          },
          serviceDate: {
            type: ['string', 'null'],
            description:
              'YYYY-MM-DD, ONLY if the sheet states an unambiguous date. A date with no year, or one you had to reason about, is null with an `uncertain` entry naming what you saw.',
          },
          serviceTime: { type: ['string', 'null'], description: 'HH:MM, 24-hour, if stated plainly.' },
          serviceType: {
            type: ['string', 'null'],
            description: 'Buffet, BBQ, canapes, and so on — the owner\'s own wording.',
          },
          guests: {
            type: ['integer', 'null'],
            description:
              'A guest count ONLY when a plain number is written. "a few", "approx 20", "20-25" and anything smudged are null — put the wording in guestsWording. NEVER estimate, round or pick the middle of a range.',
          },
          guestsWording: {
            type: ['string', 'null'],
            description: 'The vague or unclear guest wording, copied verbatim. Never interpreted.',
          },
          dishes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Each dish named on the sheet, as written. Do not add courses that are implied but not written.',
          },
          dietaries: {
            type: 'array',
            items: {
              type: 'object',
              properties: { wording: { type: 'string' } },
              required: ['wording'],
            },
            description:
              'Each dietary note, copied verbatim including any number in it. Never convert to a count — one guest can hold several requirements.',
          },
          notes: { type: ['string', 'null'], description: 'Any other legible note.' },
          uncertain: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string', description: 'Which field above.' },
                saw: { type: ['string', 'null'], description: 'What is actually there, if anything.' },
              },
              required: ['field', 'saw'],
            },
            description:
              'Every field you could not read confidently. A field that is null because it is illegible MUST appear here.',
          },
        },
        required: ['customer', 'property', 'serviceDate', 'serviceTime', 'serviceType', 'guests', 'guestsWording', 'dishes', 'dietaries', 'notes', 'uncertain'],
      },
    },
  },
];

const JOB_SHEET_SYSTEM = `You read photographs of handwritten catering job sheets and report what is on them.

YOU REPORT, YOU DO NOT INTERPRET. Copy what is written. Do not correct spelling, do not
expand abbreviations, do not tidy a name into the one you think was meant.

NEVER GUESS A VALUE. If something is smudged, cut off, ambiguous or simply not there, the
field is null and you name it in 'uncertain' with what you can see. A wrong number here
becomes food ordered for the wrong number of people, and once saved it is indistinguishable
from something the owner wrote himself. A null costs him ten seconds; a guess costs a job.

In particular:
- A guest count is a number ONLY when a plain number is written. "a few", "approx 20",
  "20-25", or anything you are reading through a smudge goes in guestsWording, verbatim,
  and guests stays null. Never take the middle of a range.
- A date is YYYY-MM-DD only when the sheet is unambiguous. If the year is missing, or you
  worked it out from a day name, that is a guess — null, and say what you saw.
- Dietary notes are copied word for word, including any number in them. Do not turn "3
  vegetarians" into a count of anything: one guest can be vegetarian and coeliac at once, so
  these numbers do not add up and are not yours to add.

You are not given the owner's customers, properties or recipes, and you do not need them.
Report the name as written. Matching it to his records happens elsewhere.

Return the job_sheet tool. There is nothing else to return.`;

/**
 * RECIPE CARD.
 *
 * Two refusals specific to this mode, and both are large if broken:
 *
 *   The YIELD is read, never inferred. "Serves 20" is a batch of 20; "150 g per
 *   person" is per person; anything else is null. Guessing it silently multiplies
 *   or divides every quantity on the card by the guest count.
 *
 *   An unreadable quantity leaves `qty` NULL. It does not become a number. The
 *   client routes every null-qty component into `unquantified` by name, so the
 *   ingredient survives without a figure attached to it.
 */
const RECIPE_CARD_TOOL = [
  {
    type: 'function',
    function: {
      name: 'recipe_card',
      description:
        'Report what is legible on a photographed recipe card. Report only what is written. Anything unreadable or absent is null, and named in `uncertain`.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: ['string', 'null'], description: 'The recipe name, as written.' },
          course: {
            type: ['string', 'null'],
            description: 'breakfast, main, side or dessert, ONLY if the card says so.',
          },
          yieldType: {
            type: ['string', 'null'],
            enum: ['per_person', 'batch', null],
            description:
              'READ from the card, never worked out. "Serves 20" or "makes 2 trays" is batch. "per person", "per head", "each" is per_person. If the card does not say which, this is null with an `uncertain` entry — do NOT infer it from how big the numbers look.',
          },
          portionsPerBatch: {
            type: ['integer', 'null'],
            description:
              'ONLY when the card states how many portions a batch makes. Never divide anything to get it.',
          },
          batchUnit: {
            type: ['string', 'null'],
            description: 'What one batch is called — tray, pot, gastro. As written.',
          },
          components: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'The ingredient, as written.' },
                qty: {
                  type: ['number', 'null'],
                  description:
                    'The number written beside it. NULL if smudged, absent, a range, or a word like "some". Never estimate from the other quantities.',
                },
                unit: {
                  type: ['string', 'null'],
                  description: 'g, kg, ml, each — as written. Null if not written.',
                },
              },
              required: ['name', 'qty', 'unit'],
            },
            description: 'Every ingredient listed, including ones with no quantity beside them.',
          },
          method: { type: ['string', 'null'], description: 'The method text, if legible.' },
          uncertain: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                saw: { type: ['string', 'null'] },
              },
              required: ['field', 'saw'],
            },
          },
        },
        required: ['name', 'course', 'yieldType', 'portionsPerBatch', 'batchUnit', 'components', 'method', 'uncertain'],
      },
    },
  },
];

const RECIPE_CARD_SYSTEM = `You read photographs of recipe cards and report what is on them.

YOU REPORT, YOU DO NOT INTERPRET. Copy what is written, including spelling.

NEVER GUESS A QUANTITY. A number you are reading through a smudge, a range, or a word like
"some" or "a handful" means qty is null. The ingredient still goes in the list — it is kept
by name, with no figure. A null costs the owner ten seconds; a guessed 2 kg costs him a
delivery.

THE YIELD IS READ, NOT WORKED OUT. "Serves 20" or "makes 2 trays" is batch. "per person" is
per_person. If the card does not say, yieldType is null and you say so in 'uncertain'. Do not
infer it from how large the numbers look: guessing it multiplies or divides every quantity on
the card by the guest count, and the error is invisible.

Do not convert units. 1.5 kg stays 1.5 kg; it does not become 1500 g.

You are not given the owner's ingredients and do not need them. Report each name as written.
Matching happens elsewhere.

Return the recipe_card tool. There is nothing else to return.`;

/**
 * INVOICE.
 *
 * The mode with the sharpest refusal. There is NO price-per-pack field on this
 * schema and no per-unit field either, because a field the model could fill by
 * dividing is a field it will fill by dividing. It reports the two figures
 * printed on the page; `engine/costing.ts` does the division (Rule 2).
 */
const INVOICE_TOOL = [
  {
    type: 'function',
    function: {
      name: 'invoice',
      description:
        'Report the lines on a photographed supplier invoice, exactly as printed. Do NOT work out any price per unit or per pack — report only the figures on the page.',
      parameters: {
        type: 'object',
        properties: {
          supplier: { type: ['string', 'null'], description: 'The supplier name, as printed.' },
          invoiceDate: {
            type: ['string', 'null'],
            description: 'YYYY-MM-DD, only if the invoice states an unambiguous date.',
          },
          lines: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                description: { type: 'string', description: 'The line description, as printed.' },
                quantity: {
                  type: ['number', 'null'],
                  description: 'How much was delivered. The number in the quantity column, as printed.',
                },
                unit: {
                  type: ['string', 'null'],
                  description: 'The unit in that column — kg, g, L, each, case. As printed.',
                },
                lineTotalPrinted: {
                  type: ['number', 'null'],
                  description:
                    'The line total EXACTLY AS PRINTED, in the currency on the page. A line reading 45.00 is 45.00. Do NOT convert it, do not scale it, do not add up the column. Read the figure and nothing else.',
                },
              },
              required: ['description', 'quantity', 'unit', 'lineTotal'],
            },
          },
          uncertain: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                saw: { type: ['string', 'null'] },
              },
              required: ['field', 'saw'],
            },
          },
        },
        required: ['supplier', 'invoiceDate', 'lines', 'uncertain'],
      },
    },
  },
];

const INVOICE_SYSTEM = `You read photographs of supplier invoices and report the lines on them.

YOU REPORT NUMBERS THAT ARE PRINTED. You do not calculate.

DO NOT WORK OUT A PRICE PER UNIT OR PER PACK. There is no field for one, and there is no
field for one on purpose. Report the quantity delivered and the line total exactly as they
appear. Something else divides them, and it does it the same way every time.

Do not add up columns, do not reconcile a total against its lines, do not apply VAT, do not
convert units or currencies. If a figure is unreadable it is null and you name it in
'uncertain'.

Report every figure EXACTLY AS PRINTED. A total reading 45.00 is 45.00. A quantity reading 5
is 5. Scaling, rounding or reformatting them is calculation, and calculation is not your job
here — something else does it, the same way every time.

You are not given the owner's ingredients or suppliers. Report each description as printed.
Matching happens elsewhere.

Return the invoice tool. There is nothing else to return.`;

/**
 * The three modes.
 *
 * One function, because everything around the tool is identical — the same key,
 * the same CORS, the same argument parse, the same error surface. Three
 * deployments of the same skeleton would be three places to fix the next CORS
 * bug.
 */
const MODES: Record<string, { tools: unknown; system: string; ask: string }> = {
  job_sheet: { tools: JOB_SHEET_TOOL, system: JOB_SHEET_SYSTEM, ask: 'Read this job sheet.' },
  recipe_card: { tools: RECIPE_CARD_TOOL, system: RECIPE_CARD_SYSTEM, ask: 'Read this recipe card.' },
  invoice: { tools: INVOICE_TOOL, system: INVOICE_SYSTEM, ask: 'Read this invoice.' },
};

serve(async (request: Request): Promise<Response> => {
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...CORS },
    });

  // The preflight. Answered before anything else, including the method check —
  // an OPTIONS falling through to "POST only" is what broke the first ask-sous
  // deploy, and it is invisible to curl.
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method !== 'POST') return json({ reason: 'POST only' }, 405);

  const key = Deno.env.get('OPENAI_API_KEY');
  if (key === undefined || key === '') {
    // Named plainly. "The scanner is broken" would send someone looking in the
    // wrong place for a secret that was simply never set.
    return json({ reason: 'OPENAI_API_KEY is not set on this function.' }, 500);
  }

  let payload: { image?: unknown; mode?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ reason: 'Body was not JSON.' }, 400);
  }

  // A data URL, downscaled by the browser before it got here. Checked for shape
  // rather than trusted: a bare base64 blob or a remote URL would both be sent
  // to OpenAI as-is, and the second would make this function fetch whatever a
  // caller named.
  if (typeof payload.image !== 'string' || !payload.image.startsWith('data:image/')) {
    return json({ reason: 'No image was sent, or it was not an image data URL.' }, 400);
  }

  // The mode picks the tool and the prompt. Resolved against MODES rather than
  // trusted, so an unknown mode is refused rather than falling through to a
  // default — silently reading an invoice with the job-sheet schema would return
  // a confidently empty sheet.
  const requested = typeof payload.mode === 'string' ? payload.mode : 'job_sheet';
  const mode = MODES[requested];

  if (mode === undefined) {
    return json({ reason: `"${requested}" is not something this scanner can read.` }, 400);
  }

  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: MODEL,
      tools: mode.tools,
      tool_choice: 'required',
      messages: [
        { role: 'system', content: mode.system },
        {
          role: 'user',
          content: [
            { type: 'text', text: mode.ask },
            // The vision shape. Everything else about this request is the same
            // as ask-sous, which is the point — one provider, one auth header,
            // one error surface.
            { type: 'image_url', image_url: { url: payload.image, detail: 'high' } },
          ],
        },
      ],
    }),
  });

  if (!upstream.ok) {
    return json({ reason: `The model could not be reached (${upstream.status}).` }, 502);
  }

  const result = (await upstream.json()) as {
    choices?: {
      message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] };
    }[];
  };

  const call = result.choices?.[0]?.message?.tool_calls?.[0]?.function;

  if (call === undefined || call.name === undefined) {
    return json({ reason: 'Nothing readable came back for that photo.' });
  }

  /**
   * OpenAI returns arguments as a JSON STRING. Already solved in ask-sous, and
   * the same failure mode applies: a malformed payload is REPORTED rather than
   * thrown, because the client turns a `reason` into a sentence on screen where
   * an exception here would be a 500 the owner reads as "could not reach" — the
   * wrong diagnosis for a function that was reached perfectly well.
   */
  let read: unknown;
  try {
    read = call.arguments === undefined ? {} : JSON.parse(call.arguments);
  } catch {
    return json({ reason: 'The photo was read but the result was unreadable.' });
  }

  // Returned UNCHANGED. No filling in of blanks, no resolving of names against
  // anything, and above all no computing — the browser validates the shape, the
  // review matches the names, and the owner confirms before a row is written.
  return json({ read });
});
