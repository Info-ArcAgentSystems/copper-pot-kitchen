/**
 * ask-sous — turn a question into a tool call. Nothing else.
 *
 * DENO, not the browser bundle. That is the point: `OPENAI_API_KEY` is a Supabase
 * function secret read here at runtime, so it never enters the client build. It
 * must NEVER be renamed with a `VITE_` prefix — Vite inlines those into the
 * bundle, and the key would ship to every visitor. The same trap caught the
 * integration credentials in August; there it leaked a test password, here it
 * would leak a billable API key.
 *
 * THIS FUNCTION DOES NO ARITHMETIC AND IMPORTS NO ENGINE CODE (Rule 2).
 *
 * It returns the model's chosen tool and arguments. Every number the owner
 * eventually sees is computed afterwards, in the browser, by the engine. There is
 * deliberately no path here that could produce a figure — not even a helpful one —
 * because a figure originating in this file is precisely what Rule 2 forbids.
 *
 * `tool_choice: 'required'` forces a tool call. The model cannot answer in prose,
 * which is what keeps Ask Sous a typed tool layer rather than a chat box (Rule 3).
 *
 * THE PROVIDER IS A DETAIL. This file talks to OpenAI; it used to talk to
 * Anthropic. Nothing outside it changed, because the model returns an INTENT and
 * never touches data — the contract the client parses is `{tool, args}` or
 * `{reason}`, and that is what this returns either way.
 *
 * NOT DEPLOYED BY CLAUDE. Deploy with:
 *   npm run supabase:secrets -- OPENAI_API_KEY=sk-...
 *   npm run supabase:deploy:sous
 * Both carry --project-ref vhzpwdzrlrcfhxrjawym. See ARCHITECTURE.md: this
 * machine has another project linked, and a bare CLI command goes to that one.
 */

// @ts-expect-error — Deno's remote import, resolved at deploy time, not by tsc.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

declare const Deno: { env: { get(key: string): string | undefined } };

/**
 * Confirm this on the first deploy — model availability differs by account, and
 * a name this account cannot reach returns 404 from OpenAI, which surfaces as
 * "The model could not be reached (404)".
 */
const MODEL = 'gpt-4o';

/**
 * CORS, and why every response carries it.
 *
 * The browser sends a preflight OPTIONS before the POST, because the request has
 * `authorization` and a JSON content-type. Without these headers the preflight
 * fails, `fetch` REJECTS rather than returning a status, and the client's catch
 * reports "could not reach Sous" — which is what the first deploy did.
 *
 * They go on the error paths too. A 500 with no allow-origin is exactly as
 * invisible to the browser as the 405 was, so a genuine failure would present as
 * the same misleading "could not reach" instead of the real reason.
 *
 * Invisible to curl, which does not enforce CORS. That is why it shipped.
 */
const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

/** The tool schema, in OpenAI's shape: name and description nested under `function`. */
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'shopping_for_range',
      description: 'What still needs buying between two dates.',
      parameters: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' } },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'prep_for_range',
      description: 'What to make on which day between two dates.',
      parameters: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' } },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'packing_for_job',
      description: 'The food and equipment to pack for one job.',
      parameters: {
        type: 'object',
        properties: { jobId: { type: 'string' } },
        required: ['jobId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'money_for_range',
      description: 'Revenue, food cost and margin between two dates.',
      parameters: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' } },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'job_details',
      description: 'Everything about one job, and whether it is ready.',
      parameters: {
        type: 'object',
        properties: { jobId: { type: 'string' } },
        required: ['jobId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'what_needs_attention',
      description: 'Anomalies and unresolved items across jobs between two dates.',
      parameters: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' } },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_job_change',
      description:
        'Propose a change to a job. Returns a before/after for the owner to confirm. Does NOT save.',
      parameters: {
        type: 'object',
        properties: {
          jobId: { type: 'string' },
          guests: { type: 'number' },
          serviceDate: { type: 'string' },
          serviceType: { type: 'string' },
          status: { type: 'string' },
        },
        required: ['jobId'],
      },
    },
  },
];

const SYSTEM = `You route questions about a catering business to one of a fixed set of tools.

YOU DO NOT ANSWER QUESTIONS AND YOU DO NOT CALCULATE ANYTHING. You choose a tool and its
arguments. Something else runs the tool and works out every number.

Never put a quantity, total, cost or count in your arguments unless the owner said that
exact figure out loud. "Change it to 23 guests" means guests: 23. "Add a couple more"
does not — you cannot work out what that means, so ask.

Resolve people, dates and jobs using the context you are given. It lists every job with
its id, date, customer and service type. Use those ids.

If you cannot tell which job or which dates are meant, do NOT guess. Guessing acts on the
wrong job. Say what is ambiguous instead.

Dates are YYYY-MM-DD. Today's date is in the context.`;

serve(async (request: Request): Promise<Response> => {
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...CORS },
    });

  // The preflight. Answered before anything else, including the method check —
  // an OPTIONS falling through to "POST only" is what broke the first deploy.
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method !== 'POST') return json({ reason: 'POST only' }, 405);

  const key = Deno.env.get('OPENAI_API_KEY');
  if (key === undefined || key === '') {
    // Named plainly. "Sous is broken" would send someone looking in the wrong
    // place for a secret that was simply never set.
    return json({ reason: 'OPENAI_API_KEY is not set on this function.' }, 500);
  }

  let payload: { message?: unknown; context?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ reason: 'Body was not JSON.' }, 400);
  }

  if (typeof payload.message !== 'string' || payload.message.trim() === '') {
    return json({ reason: 'No question was asked.' }, 400);
  }

  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: MODEL,
      tools: TOOLS,
      // Forces a tool call. No prose replies, so this stays a tool layer.
      tool_choice: 'required',
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `Context:\n${JSON.stringify(payload.context)}\n\nQuestion: ${payload.message}`,
        },
      ],
    }),
  });

  if (!upstream.ok) {
    return json({ reason: `The model could not be reached (${upstream.status}).` }, 502);
  }

  const result = (await upstream.json()) as {
    choices?: { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[];
  };

  const call = result.choices?.[0]?.message?.tool_calls?.[0]?.function;

  if (call === undefined || call.name === undefined) {
    return json({ reason: 'Sous could not match that to anything it can do.' });
  }

  /**
   * OpenAI returns arguments as a JSON STRING, where Anthropic returned an
   * object. So this parse exists, and so does a failure mode that did not before.
   *
   * A malformed payload is reported rather than thrown: the client's refusal path
   * turns a `reason` into a sentence on screen, where an exception here would be
   * a 500 the owner reads as "could not reach Sous" — the wrong diagnosis for a
   * function that was reached perfectly well.
   */
  let args: unknown;
  try {
    args = call.arguments === undefined ? {} : JSON.parse(call.arguments);
  } catch {
    return json({ reason: 'Sous chose a tool but its arguments were unreadable.' });
  }

  // Returned UNCHANGED, in the same shape the client has always parsed. No
  // inspection of the arguments, no filling in of blanks, and above all no
  // computing — the client validates the name against its own registry and the
  // engine does the rest.
  return json({ tool: call.name, args });
});
