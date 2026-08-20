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
import type { InvoiceRead } from './invoice';
import type { RecipeCardRead } from './recipeCard';
import type { YieldType } from '../engine/types';

export type ScanReply =
  | { readonly kind: 'read'; readonly read: JobSheetRead }
  /** Stated in words the owner can act on, never a stack trace. */
  | { readonly kind: 'unresolved'; readonly reason: string };

export type RecipeCardReply =
  | { readonly kind: 'read'; readonly read: RecipeCardRead }
  | { readonly kind: 'unresolved'; readonly reason: string };

export type InvoiceReply =
  | { readonly kind: 'read'; readonly read: InvoiceRead }
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

/**
 * A measured amount, or null.
 *
 * Unlike `count`, decimals are legitimate — 1.5 kg of mince is an ordinary line
 * on a card. Everything else is refused: NaN and Infinity both survive a bare
 * `typeof === 'number'` and both reach the engine as a silently wrong figure.
 */
const amount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/** The three `uncertain` shapes are identical, so the narrowing is too. */
const uncertainties = (
  value: unknown,
): { field: string; saw: string | null }[] =>
  Array.isArray(value)
    ? value.map((u) => ({
        field: text((u as { field?: unknown })?.field) ?? 'something',
        saw: text((u as { saw?: unknown })?.saw),
      }))
    : [];

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
/**
 * The shared transport.
 *
 * One function for all three modes, because everything except the validator is
 * identical — the same endpoint, auth, and the same three failure sentences. A
 * copy per mode would be three places to fix the next one.
 */
async function postScan(
  image: string,
  mode: 'job_sheet' | 'recipe_card' | 'invoice',
  options: ScanOptions,
): Promise<{ ok: true; body: unknown } | { ok: false; reason: string }> {
  const send = options.send ?? fetch;

  let response: Response;
  try {
    response = await send(options.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.token}`,
      },
      body: JSON.stringify({ image, mode }),
    });
  } catch {
    return {
      ok: false,
      reason: 'Could not reach the scanner. Check the connection, or type it in directly.',
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      // "Not set up on this project yet" is a real state — the function ships on
      // a separate deploy from the app, so the UI can exist before it does.
      reason:
        response.status === 404
          ? 'The scanner is not set up on this project yet.'
          : `The scanner could not read that (${response.status}).`,
    };
  }

  try {
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false, reason: 'The scanner replied with something unreadable.' };
  }
}

/** The envelope check the three validators share. */
function unwrap(raw: unknown): { ok: true; read: Record<string, unknown> } | { ok: false; reason: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: 'The scanner did not reply with anything usable.' };
  }

  const candidate = raw as { read?: unknown; reason?: unknown };

  if (typeof candidate.reason === 'string' && candidate.read === undefined) {
    return { ok: false, reason: candidate.reason };
  }

  if (typeof candidate.read !== 'object' || candidate.read === null) {
    return { ok: false, reason: 'Nothing readable came back for that photo.' };
  }

  return { ok: true, read: candidate.read as Record<string, unknown> };
}

export async function parseJobSheet(image: string, options: ScanOptions): Promise<ScanReply> {
  const sent = await postScan(image, 'job_sheet', options);
  return sent.ok ? validateScan(sent.body) : { kind: 'unresolved', reason: sent.reason };
}

/**
 * A recipe card.
 *
 * `qty` is narrowed by `amount`, which lets a decimal through and refuses NaN.
 * A component whose qty survives as null is routed to `unquantified` by
 * `reviewRecipeCard` — deterministically, in code, not by the model (Rule 8).
 */
export function validateRecipeCard(raw: unknown): RecipeCardReply {
  const envelope = unwrap(raw);
  if (!envelope.ok) return { kind: 'unresolved', reason: envelope.reason };

  const r = envelope.read;
  const yieldRead = text(r['yieldType']);

  return {
    kind: 'read',
    read: {
      name: text(r['name']),
      course: text(r['course']),
      // Anything that is not one of the two known yields becomes null, which the
      // review turns into a gap. A yield defaulted to per_person would silently
      // rescale every quantity on the card.
      yieldType:
        yieldRead === 'per_person' || yieldRead === 'batch' ? (yieldRead as YieldType) : null,
      portionsPerBatch: count(r['portionsPerBatch']),
      batchUnit: text(r['batchUnit']),
      components: Array.isArray(r['components'])
        ? r['components']
            .map((c) => {
              const component = c as Record<string, unknown>;
              const name = text(component['name']);
              return name === null
                ? null
                : { name, qty: amount(component['qty']), unit: text(component['unit']) };
            })
            .filter((c): c is { name: string; qty: number | null; unit: string | null } => c !== null)
        : [],
      method: text(r['method']),
      uncertain: uncertainties(r['uncertain']),
    },
  };
}

export async function parseRecipeCard(
  image: string,
  options: ScanOptions,
): Promise<RecipeCardReply> {
  const sent = await postScan(image, 'recipe_card', options);
  return sent.ok ? validateRecipeCard(sent.body) : { kind: 'unresolved', reason: sent.reason };
}

/**
 * An invoice.
 *
 * Note what is NOT narrowed here, because it is not read: any price per unit or
 * per pack. `InvoiceRead` has no field for one, so there is nothing for a model
 * to have divided.
 */
export function validateInvoice(raw: unknown): InvoiceReply {
  const envelope = unwrap(raw);
  if (!envelope.ok) return { kind: 'unresolved', reason: envelope.reason };

  const r = envelope.read;

  return {
    kind: 'read',
    read: {
      supplier: text(r['supplier']),
      invoiceDate: text(r['invoiceDate']),
      lines: Array.isArray(r['lines'])
        ? r['lines']
            .map((l) => {
              const line = l as Record<string, unknown>;
              const description = text(line['description']);
              return description === null
                ? null
                : {
                    description,
                    quantity: amount(line['quantity']),
                    unit: text(line['unit']),
                    // Cents, so a fractional one is a misread rather than a price.
                    lineTotal: count(line['lineTotal']),
                  };
            })
            .filter(
              (l): l is {
                description: string;
                quantity: number | null;
                unit: string | null;
                lineTotal: number | null;
              } => l !== null,
            )
        : [],
      uncertain: uncertainties(r['uncertain']),
    },
  };
}

export async function parseInvoice(image: string, options: ScanOptions): Promise<InvoiceReply> {
  const sent = await postScan(image, 'invoice', options);
  return sent.ok ? validateInvoice(sent.body) : { kind: 'unresolved', reason: sent.reason };
}
