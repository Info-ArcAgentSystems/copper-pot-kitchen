/**
 * What the model is allowed to say.
 *
 * THIS TYPE IS THE RULE 2 BOUNDARY.
 *
 * The model reads a question and picks a tool. It does not answer. The engine
 * runs afterwards, in the browser, and the formatters render what it returned —
 * so there is no path by which a figure the model produced reaches the screen.
 * Rule 2 is not something the tests hunt for here; it is structurally
 * unavailable.
 *
 * Every field below is therefore an IDENTIFIER or a value the owner stated out
 * loud ("change it to 23 guests"). None is a result. A `total`, a `cost`, a
 * `batches` or an `outstanding` on this type would be the model doing arithmetic,
 * which is exactly what `tests/sous/guards.test.ts` refuses to allow.
 */

import type { IsoDate, JobId } from '../engine/types';

/** Every tool name, in one place. The schema sent to the model derives from this. */
export const TOOL_NAMES = [
  'how_much_ingredient',
  'shopping_for_range',
  'prep_for_range',
  'packing_for_job',
  'money_for_range',
  'job_details',
  // Renamed from `what_needs_attention`. The old name contained "needs" and
  // captured every "how much X do I NEED" question — the model picked it for a
  // quantity question and returned an anomalies object. Names weigh heavily in
  // tool selection, so removing the magnet mattered more than adding the
  // alternative. `tests/sous/guards.test.ts` now forbids "need" in any tool name.
  'problems_with_jobs',
  'propose_job_change',
  'clarify',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** A date window the owner asked about. Identifiers, not quantities. */
export interface RangeArgs {
  readonly from: IsoDate;
  readonly to: IsoDate;
}

export interface JobArgs {
  readonly jobId: JobId;
}

/**
 * "How much adobo do I need?"
 *
 * `ingredient` is the owner's word for it, resolved against the names in the
 * context. Dates are optional: without them the tool answers for a default
 * forward window rather than refusing, because "how much adobo" is a question
 * about the near future and demanding a date range to answer it is pedantry.
 */
export interface IngredientArgs {
  readonly ingredient: string;
  readonly from?: IsoDate;
  readonly to?: IsoDate;
}

/**
 * The model could not map the question, so it asks instead of guessing.
 *
 * The output is a QUESTION, never a fact. This is what stops "how many grams in
 * a kilo" being answered from the model's own knowledge: it has no tool for it,
 * and the only thing it can do with an unmappable question is hand it back.
 */
export interface ClarifyArgs {
  readonly question: string;
}

/**
 * A change the OWNER dictated, echoed back so the engine can diff it.
 *
 * `guests` here is what he said, not what the model worked out. The distinction
 * matters and is the reason this type carries no other numeric field: there is
 * nothing on it that could be a derived figure.
 */
export interface JobChangeArgs {
  readonly jobId: JobId;
  readonly guests?: number;
  readonly serviceDate?: IsoDate;
  readonly serviceType?: string;
  readonly status?: string;
}

export type Intent =
  | { readonly tool: 'how_much_ingredient'; readonly args: IngredientArgs }
  | { readonly tool: 'clarify'; readonly args: ClarifyArgs }
  | { readonly tool: 'shopping_for_range'; readonly args: RangeArgs }
  | { readonly tool: 'prep_for_range'; readonly args: RangeArgs }
  | { readonly tool: 'packing_for_job'; readonly args: JobArgs }
  | { readonly tool: 'money_for_range'; readonly args: RangeArgs }
  | { readonly tool: 'job_details'; readonly args: JobArgs }
  | { readonly tool: 'problems_with_jobs'; readonly args: RangeArgs }
  | { readonly tool: 'propose_job_change'; readonly args: JobChangeArgs };

/**
 * What the model could not answer.
 *
 * Rule 8 reaching the conversational layer: a question it cannot map to a tool
 * gets a refusal naming the reason, never a guess at which tool was meant. Asking
 * again is cheap; acting on the wrong job is not.
 */
export interface Unresolved {
  readonly kind: 'unresolved';
  readonly reason: string;
}

export type SousReply =
  | { readonly kind: 'intent'; readonly intent: Intent; readonly preamble: string | null }
  | Unresolved;

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

/**
 * One completed turn, as it is sent BACK to the model on the next question.
 *
 * THE MOST IMPORTANT TYPE IN THE CONVERSATIONAL DESIGN, because of what it does
 * not have: a result.
 *
 * A turn records what was ASKED and which tool ran. It never records what the
 * engine ANSWERED. Feeding results back into the model's context is the obvious
 * way to build a chat, and it is exactly how a grounded assistant starts
 * inventing — once a figure has been in the context, a later turn can restate it,
 * round it, or carry it into a question it does not apply to.
 *
 * So follow-ups work by RE-ROUTING, not by remembering. "What about Sunday?"
 * resolves because the model can see the last tool and its arguments, and emits
 * the same tool with new dates. The engine then runs again, fresh.
 */
export interface Turn {
  readonly question: string;
  readonly tool: ToolName;
  readonly args: Readonly<Record<string, unknown>>;
}

/**
 * What the model may say in its own words.
 *
 * Written BEFORE the engine runs, so it cannot contain a figure — there is none
 * to contain. It is conversational glue: "Sure, let me check Sunday:".
 *
 * NO DIGITS ALLOWED, enforced by `validateReply`. Glue does not need them, and
 * the rule is blunt precisely so it cannot be argued with: any digit in
 * model-authored prose is rejected rather than inspected.
 */
export type Preamble = string;
