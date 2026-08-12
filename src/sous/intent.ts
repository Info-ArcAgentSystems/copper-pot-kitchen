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
  'shopping_for_range',
  'prep_for_range',
  'packing_for_job',
  'money_for_range',
  'job_details',
  'what_needs_attention',
  'propose_job_change',
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
  | { readonly tool: 'shopping_for_range'; readonly args: RangeArgs }
  | { readonly tool: 'prep_for_range'; readonly args: RangeArgs }
  | { readonly tool: 'packing_for_job'; readonly args: JobArgs }
  | { readonly tool: 'money_for_range'; readonly args: RangeArgs }
  | { readonly tool: 'job_details'; readonly args: JobArgs }
  | { readonly tool: 'what_needs_attention'; readonly args: RangeArgs }
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

export type SousReply = { readonly kind: 'intent'; readonly intent: Intent } | Unresolved;
