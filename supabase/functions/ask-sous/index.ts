/**
 * ask-sous — turn a question into a tool call. Nothing else.
 *
 * DENO, not the browser bundle. That is the point: `ANTHROPIC_API_KEY` is a
 * Supabase function secret read here at runtime, so it never enters the client
 * build. It must NEVER be renamed with a `VITE_` prefix — Vite inlines those into
 * the bundle, and the key would ship to every visitor. The same trap caught the
 * integration credentials in August; there it leaked a test password, here it
 * would leak a billable API key.
 *
 * THIS FUNCTION DOES NO ARITHMETIC AND IMPORTS NO ENGINE CODE (Rule 2).
 *
 * It returns the model's chosen tool and arguments, unchanged. Every number the
 * owner eventually sees is computed afterwards, in the browser, by the engine.
 * There is deliberately no path here that could produce a figure — not even a
 * helpful one — because a figure originating in this file is precisely what Rule
 * 2 forbids.
 *
 * `tool_choice: { type: 'any' }` forces a tool call. The model cannot answer in
 * prose, which is what keeps Ask Sous a typed tool layer rather than a chat box
 * (Rule 3).
 *
 * NOT DEPLOYED YET. Deploy with:
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 *   supabase functions deploy ask-sous
 */

// @ts-expect-error — Deno's remote import, resolved at deploy time, not by tsc.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

declare const Deno: { env: { get(key: string): string | undefined } };

const MODEL = 'claude-sonnet-5';

/**
 * The tool schema.
 *
 * Kept in step with `src/sous/tools.ts` by `tests/sous/guards.test.ts`, which
 * reads both files and fails if the names diverge. A tool offered here but absent
 * from the registry would be chosen by the model and then refused by the
 * dispatcher — a dead end the owner would experience as Sous ignoring them.
 */
const TOOLS = [
  {
    name: 'shopping_for_range',
    description: 'What still needs buying between two dates.',
    input_schema: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' } },
      required: ['from', 'to'],
    },
  },
  {
    name: 'prep_for_range',
    description: 'What to make on which day between two dates.',
    input_schema: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' } },
      required: ['from', 'to'],
    },
  },
  {
    name: 'packing_for_job',
    description: 'The food and equipment to pack for one job.',
    input_schema: {
      type: 'object',
      properties: { jobId: { type: 'string' } },
      required: ['jobId'],
    },
  },
  {
    name: 'money_for_range',
    description: 'Revenue, food cost and margin between two dates.',
    input_schema: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' } },
      required: ['from', 'to'],
    },
  },
  {
    name: 'job_details',
    description: 'Everything about one job, and whether it is ready.',
    input_schema: {
      type: 'object',
      properties: { jobId: { type: 'string' } },
      required: ['jobId'],
    },
  },
  {
    name: 'what_needs_attention',
    description: 'Anomalies and unresolved items across jobs between two dates.',
    input_schema: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' } },
      required: ['from', 'to'],
    },
  },
  {
    name: 'propose_job_change',
    description:
      'Propose a change to a job. Returns a before/after for the owner to confirm. Does NOT save.',
    input_schema: {
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
      headers: { 'content-type': 'application/json' },
    });

  if (request.method !== 'POST') return json({ reason: 'POST only' }, 405);

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (key === undefined || key === '') {
    // Named plainly. "Sous is broken" would send someone looking in the wrong
    // place for a secret that was simply never set.
    return json({ reason: 'ANTHROPIC_API_KEY is not set on this function.' }, 500);
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

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: TOOLS,
      // Forces a tool call. No prose replies, so this stays a tool layer.
      tool_choice: { type: 'any' },
      messages: [
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
    content?: { type: string; name?: string; input?: unknown }[];
  };

  const call = (result.content ?? []).find((block) => block.type === 'tool_use');

  if (call === undefined || call.name === undefined) {
    return json({ reason: 'Sous could not match that to anything it can do.' });
  }

  // Returned UNCHANGED. No inspection of the arguments, no filling in of blanks,
  // and above all no computing — the client validates the name against its own
  // registry and the engine does the rest.
  return json({ tool: call.name, args: call.input ?? {} });
});
