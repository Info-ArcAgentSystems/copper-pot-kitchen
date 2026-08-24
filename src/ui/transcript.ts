/**
 * The Ask Sous conversation, as it is kept between screens.
 *
 * PURE — no React, so the rule that matters here is testable in plain Node. The
 * provider that holds it lives in `features/sous/SousContext.tsx`; this file is
 * the shape and the two operations on it.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY ABSENT, AND WHY IT IS THE POINT.
 *
 * Losing the transcript on navigation was an accident, but it was doing real
 * safety work: a proposal could not outlive the data it was computed against,
 * because it could not outlive the component. Persisting the conversation removes
 * that protection unless something replaces it.
 *
 * A proposal carries a diff and a job-as-it-would-be-saved, both worked out from
 * one snapshot. Keep those across a navigation, let the owner change a guest count
 * on another screen, come back and tap confirm — and the write lands from a
 * snapshot that has since moved, with a clean audit trail saying he approved it.
 *
 * So the CONVERSATION persists and the COMMITTABLE THING does not. What survives
 * is a `ProposalRecord`: the job it concerned and the changes the owner asked for,
 * both of which stay true however old they get. Nothing derived survives at all.
 *
 * The write path takes an object carrying its own evidence and re-checks it before
 * saving. A `ProposalRecord` cannot satisfy that check, because it does not carry
 * the evidence — by construction, not by a guard anybody has to remember. The
 * transcript simply has nothing to hand it.
 * ---------------------------------------------------------------------------
 */

import type { Answer } from './sousAnswer';
import type { Turn } from '../sous/intent';

/**
 * That a change was proposed, and what was asked for. Nothing worked out.
 *
 * `changes` are the owner's own request echoed back, so they read correctly
 * forever. A derived figure would not: it belonged to the data as it stood when
 * the question was asked, and showing it later as though it still held is the
 * stale-number failure Rule 8 exists to prevent.
 */
export interface ProposalRecord {
  readonly jobId: string;
  readonly changes: Readonly<Record<string, unknown>>;
}

/** One question and everything shown in reply to it. */
export interface Exchange {
  readonly question: string;
  /** The model's own words. Digit-free by validation, written before the engine ran. */
  readonly preamble: string | null;
  /** Rendered from engine output. Stays on this side of the model boundary. */
  readonly answer: Answer | null;
  readonly refusal: string | null;
  /** A record that a change was proposed — never the proposal itself. */
  readonly proposal: ProposalRecord | null;
  /** What goes BACK to the model next turn. Carries no answer. */
  readonly tool: Turn | null;
}

export interface Transcript {
  readonly exchanges: readonly Exchange[];
}

export const emptyTranscript = (): Transcript => ({ exchanges: [] });

export const addExchange = (transcript: Transcript, exchange: Exchange): Transcript => ({
  exchanges: [...transcript.exchanges, exchange],
});

export const clearTranscript = emptyTranscript;

/**
 * What the model is told about earlier turns: the questions and the tools they
 * chose, never what the engine answered.
 *
 * Feeding results back is the obvious way to build a chat and exactly how a
 * grounded assistant starts inventing — once a figure has been in the context, a
 * later turn can restate it, round it, or carry it into a question it does not
 * apply to. Follow-ups work by RE-ROUTING instead: the model sees the last tool
 * and its arguments, picks the same tool with new dates, and the engine runs
 * again from scratch.
 *
 * A transcript that survives navigation is a bigger temptation to send back
 * wholesale than one that does not, which is why this is a function rather than
 * a field somebody maps inline.
 */
export const turnsOf = (transcript: Transcript): readonly Turn[] =>
  transcript.exchanges
    .filter((e): e is Exchange & { tool: Turn } => e.tool !== null)
    .map((e) => e.tool);
