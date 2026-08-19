/**
 * Sending the photo, and refusing what comes back when it is not a job sheet.
 *
 * The client half of the scanner. It mirrors `sous/askSous.ts` deliberately —
 * same failure wording, same "returns a reason, never throws" contract — because
 * the two features fail in the same places and the owner should not have to
 * learn two vocabularies for the same problem.
 *
 * NO PROVIDER KEY IS REACHABLE FROM HERE. It lives in a Supabase function
 * secret, read by Deno inside the edge function. It is deliberately not a
 * `VITE_` variable: Vite INLINES those into the browser bundle at build time.
 *
 * This file does not know which provider read the photo, and nothing in `src/`
 * does. The function returns fields; who produced them is not our business.
 *
 * NO BROWSER GLOBALS. Downscaling the photo needs a canvas, so it lives beside
 * the screen in `features/scan/scaleImage.ts` rather than here. That is not
 * tidiness: `tsconfig.test.json` compiles without `lib: DOM` precisely so that a
 * test needing a browser global fails to build, and this module is imported by
 * tests. The split keeps the validation — the part with the Rule 8 decisions in
 * it — runnable under plain Node.
 */

import type { JobSheetRead } from './jobSheet';

export type ScanReply =
  | { readonly kind: 'read'; readonly read: JobSheetRead }
  /** Stated in words the owner can act on, never a stack trace. */
  | { readonly kind: 'unresolved'; readonly reason: string };

/** A string field, or null. Anything else the model produced is discarded. */
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

/**
 * A count, or null.
 *
 * Rule 8 at the parse boundary: a non-integer, a negative, or a string that
 * happens to look like a number all become null rather than being coerced.
 * `Number("a few")` is NaN, and a NaN reaching the engine is a silent zero.
 */
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(text).filter((s): s is string => s !== null) : [];

/**
 * Validate the reply into the shape the review expects.
 *
 * Every field is narrowed rather than trusted. The model is not an adversary,
 * but it is a component that can be wrong, and a malformed field that reached
 * the review as `undefined` would read as "not on the sheet" — which is a
 * different statement from "the model returned rubbish here".
 */
export function validateScan(raw: unknown): ScanReply {
  if (typeof raw !== 'object' || raw === null) {
    return { kind: 'unresolved', reason: 'The scanner did not reply with anything usable.' };
  }

  const candidate = raw as { read?: unknown; reason?: unknown };

  if (typeof candidate.reason === 'string' && candidate.read === undefined) {
    return { kind: 'unresolved', reason: candidate.reason };
  }

  if (typeof candidate.read !== 'object' || candidate.read === null) {
    return { kind: 'unresolved', reason: 'Nothing readable came back for that photo.' };
  }

  const r = candidate.read as Record<string, unknown>;

  return {
    kind: 'read',
    read: {
      customer: text(r['customer']),
      property: text(r['property']),
      serviceDate: text(r['serviceDate']),
      serviceTime: text(r['serviceTime']),
      serviceType: text(r['serviceType']),
      guests: count(r['guests']),
      guestsWording: text(r['guestsWording']),
      dishes: strings(r['dishes']),
      dietaries: Array.isArray(r['dietaries'])
        ? r['dietaries']
            .map((d) => text((d as { wording?: unknown })?.wording))
            .filter((w): w is string => w !== null)
            .map((wording) => ({ wording }))
        : [],
      notes: text(r['notes']),
      uncertain: Array.isArray(r['uncertain'])
        ? r['uncertain'].map((u) => ({
            field: text((u as { field?: unknown })?.field) ?? 'something',
            saw: text((u as { saw?: unknown })?.saw),
          }))
        : [],
    },
  };
}

export interface ScanOptions {
  readonly url: string;
  readonly token: string;
  /** Injected so the client is testable without a network. */
  readonly send?: typeof fetch;
}

/**
 * Send the photo. Returns a read or a stated refusal, never a throw.
 *
 * "Not set up on this project yet" is a real state — the function ships on a
 * separate deploy from the app, so the UI can exist before it does. Worded as
 * itself rather than as a generic failure.
 */
export async function parseJobSheet(image: string, options: ScanOptions): Promise<ScanReply> {
  const send = options.send ?? fetch;

  let response: Response;
  try {
    response = await send(options.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.token}`,
      },
      body: JSON.stringify({ image }),
    });
  } catch {
    return {
      kind: 'unresolved',
      reason: 'Could not reach the scanner. Check the connection, or type the job in directly.',
    };
  }

  if (!response.ok) {
    return {
      kind: 'unresolved',
      reason:
        response.status === 404
          ? 'The scanner is not set up on this project yet.'
          : `The scanner could not read that (${response.status}).`,
    };
  }

  try {
    return validateScan(await response.json());
  } catch {
    return { kind: 'unresolved', reason: 'The scanner replied with something unreadable.' };
  }
}
