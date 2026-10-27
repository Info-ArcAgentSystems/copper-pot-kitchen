/**
 * Readiness as a VALUE, not a boolean — so a dead control cannot be silent.
 *
 * A screen that needs two or three repository reads before it can act used to
 * write this:
 *
 *     const ready = a.state.status === 'ready' && b.state.status === 'ready';
 *     <Control disabled={busy || !ready} />
 *
 * Which is correct and useless. `ready` is false while loading AND false
 * forever after a failed read, and the boolean cannot tell the two apart. The
 * owner gets a greyed control and no words, on a screen that looks broken
 * rather than one that says what went wrong — while `useAsync` is still holding
 * the error that explains it.
 *
 * So the gate returns a union. `loading` carries the names of what is still
 * coming; `failed` carries, per read, what failed, why the screen needs it, and
 * the error's own message. There is no non-ready value without words in it,
 * which is the property that makes the silent state unrepresentable rather than
 * merely discouraged.
 *
 * `failed` BEATS `loading`. One read errored while another is in flight is a
 * broken screen, not a slow one, and reporting the slow half would reproduce
 * the original defect — a true word hiding a dead control.
 *
 * Pure: no React, no repositories, no I/O. It takes states in and returns a
 * description out, so `tests/ui/sourceState.test.ts` can walk all 27
 * combinations of three reads under plain Node.
 */

import type { AsyncState } from './useAsync';

/**
 * One read a screen depends on, in the owner's words.
 *
 * `what` names it as he would — "your ingredients", not `ingredientRepository`.
 * `why` is the clause that follows the dash, and it earns its place: "could not
 * load your ingredients" tells him something failed, and the clause tells him
 * what he loses by it.
 */
export interface DataSource {
  readonly what: string;
  readonly why: string;
  readonly state: AsyncState<unknown>;
  readonly reload: () => void;
}

export interface SourceFailure {
  readonly what: string;
  readonly why: string;
  /** The whole sentence, composed once here rather than in four screens. */
  readonly message: string;
  /** The error's own message. Carried, never swallowed. */
  readonly detail: string;
}

export type SourceState =
  | { readonly kind: 'ready' }
  | { readonly kind: 'loading'; readonly message: string }
  | {
      readonly kind: 'failed';
      readonly failures: readonly SourceFailure[];
      readonly retry: () => void;
    };

/** "a", "a and b", "a, b and c" — a sentence, not a comma-joined dump. */
const asSentence = (parts: readonly string[]): string =>
  parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] as string}`;

/**
 * An error with nothing to say is reported as having nothing to say.
 *
 * Rule 8 in miniature. `new Error('')` happens — a rejected fetch with no body,
 * a thrown string — and inventing a plausible cause for it would be the same
 * defect as the greyed button, one layer down.
 */
const detailOf = (error: Error): string => {
  const message = error.message.trim();
  return message === '' ? 'no reason given' : message;
};

export function sourceState(sources: readonly DataSource[]): SourceState {
  const broken = sources.filter((s) => s.state.status === 'error');

  if (broken.length > 0) {
    return {
      kind: 'failed',
      failures: broken.map((s) => ({
        what: s.what,
        why: s.why,
        message: `Could not load ${s.what} — ${s.why}.`,
        // The filter above establishes this; the check is what narrows the union.
        detail: s.state.status === 'error' ? detailOf(s.state.error) : 'no reason given',
      })),
      // Only what failed. A read still in flight does not need restarting.
      retry: () => {
        for (const s of broken) s.reload();
      },
    };
  }

  const outstanding = sources.filter((s) => s.state.status === 'loading');

  if (outstanding.length > 0) {
    return {
      kind: 'loading',
      message: `Loading ${asSentence(outstanding.map((s) => s.what))}…`,
    };
  }

  return { kind: 'ready' };
}
