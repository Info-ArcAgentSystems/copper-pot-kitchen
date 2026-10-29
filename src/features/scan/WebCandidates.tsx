/**
 * The candidates a web search came back with, and what each one would bring in.
 *
 * ONE RENDERER FOR TWO FLOWS, extracted rather than copied. `ScanMenu` finds
 * recipes for the dishes on a photographed menu; the Recipes editor finds one
 * for a stub that has no ingredients yet. Both ask the same function, get the
 * same `WebRecipeReview` back, and have to say the same things about it — the
 * source, the yield, what came through without a quantity, what is new to the
 * kitchen, and what is still outstanding.
 *
 * Two copies of that would drift, and Rule 5 is explicit that a second version
 * of a step is not allowed. The way it would drift is also predictable: the
 * list that happened to be edited would gain a warning the other one did not
 * show, and the owner would get a different account of the same page depending
 * on which screen he reached it from.
 *
 * WHAT IT DOES NOT DO IS DECIDE. It renders candidates and calls back when one
 * is picked; the caller decides what picking MEANS — a new recipe from a menu,
 * or filling the stub it was opened from. That division is why the same
 * component can serve a flow that inserts and a flow that updates.
 */

import type { ReactNode } from 'react';
import type { WebRecipeReview } from '../../scan/webRecipe';

/** How a candidate's yield reads, in his terms rather than the type's. */
function yieldOf(candidate: WebRecipeReview): string {
  if (candidate.yieldType === 'batch') {
    // `?` rather than a number: the page said it was a batch and did not say
    // how many. Rule 8 — the gap is shown, not filled.
    return `serves ${candidate.portionsPerBatch ?? '?'}`;
  }
  return candidate.yieldType === 'per_person' ? 'per person' : 'yield not stated';
}

export function WebCandidates({
  candidates,
  refused,
  onPick,
  pickLabel,
}: {
  readonly candidates: readonly WebRecipeReview[];
  /** Results that came back with no source link. Counted, never shown. */
  readonly refused: number;
  readonly onPick: (candidate: WebRecipeReview) => void;
  /** What picking does here — the two flows mean different things by it. */
  readonly pickLabel: string;
}): ReactNode {
  return (
    <>
      {candidates.map((candidate) => (
        <div key={candidate.sourceUrl} className="line">
          <strong>{candidate.title ?? 'untitled recipe'}</strong>

          {/* The source, always, and the one link in the app that keeps the
              accent — it genuinely leaves. He can open it and judge for
              himself, which is the whole basis on which he is being asked to
              trust any of this. */}
          <p className="hint muted">
            <a href={candidate.sourceUrl} target="_blank" rel="noreferrer noopener">
              {candidate.sourceUrl}
            </a>
          </p>

          <p className="muted num">
            {yieldOf(candidate)}
            {' · '}
            {candidate.components.length} with quantities
            {candidate.unquantified.length > 0 && ` · ${candidate.unquantified.length} without`}
          </p>

          {candidate.warnings.map((w) => (
            <p key={w} className="unresolved">
              {w}
            </p>
          ))}

          {candidate.newThings.length > 0 && (
            <p className="muted">
              New to your ingredients: {candidate.newThings.map((n) => n.read).join(', ')}
            </p>
          )}

          {candidate.gaps.length > 0 && (
            <ul className="unresolved-block">
              {candidate.gaps.map((g) => (
                <li key={g.field}>{g.label}</li>
              ))}
            </ul>
          )}

          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={!candidate.readyToSave}
              onClick={() => onPick(candidate)}
            >
              {pickLabel}
            </button>
          </div>
        </div>
      ))}

      {/* Counted rather than hidden. A result with no source cannot be shown —
          there is nothing to judge it by — but saying how many were dropped is
          the difference between a short list and a short list that looks
          complete. */}
      {refused > 0 && (
        <p className="unresolved">
          {refused} result{refused === 1 ? '' : 's'} came back with no source link and{' '}
          {refused === 1 ? 'was' : 'were'} not kept.
        </p>
      )}
    </>
  );
}
