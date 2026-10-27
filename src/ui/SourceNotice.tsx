/**
 * The words for a screen that is not ready yet — ONE renderer, for all of them.
 *
 * Four scanners and six screens each had their own version of this, and every
 * version was a bit wrong in a different way:
 *
 *   the scanners        greyed the photo buttons with NO message at all
 *   the dashboard       said "Loading…" forever after a failed read
 *   shopping, prep,     said "Could not load: Failed to fetch" — true, and
 *   packing, money      naming neither which of their six reads failed nor what
 *                       it cost, with no way to try again short of reloading
 *                       the page, which is a poor instruction to a man holding
 *                       a phone in a supermarket
 *   ask sous            disabled the Ask button with no message
 *
 * Those four also hunted the failure themselves, with `.find(s => s.status ===
 * 'error')` over a hand-maintained list of states sitting next to a
 * hand-maintained `ready` — two lists to keep in step, and a read added to one
 * and forgotten in the other fails as a permanent "Working it out…".
 *
 * So the decision lives in `sourceState` and the words live here. A screen says
 * which reads it needs and what each is for; this renders whatever needs saying
 * about them, or nothing at all when everything landed.
 *
 * `title` is for the whole-screen case, where this REPLACES the screen: the
 * heading goes on so the owner is not looking at a bare error with no idea
 * which screen it belongs to. Left out, it renders inline — above the control
 * it is explaining, which is the scanners and Ask Sous.
 */

import type { ReactNode } from 'react';
import type { SourceState } from './sourceState';

export function SourceNotice({
  state,
  title,
}: {
  readonly state: SourceState;
  readonly title?: string;
}): ReactNode {
  if (state.kind === 'ready') return null;

  const body =
    state.kind === 'failed' ? (
      <div className="source-failure">
        {state.failures.map((failure) => (
          <p className="error" role="alert" key={failure.what}>
            {/* What failed, what it was for, and what the failure itself said.
                The last part is the one that used to be thrown away. */}
            {failure.message} <span className="muted">({failure.detail})</span>
          </p>
        ))}
        <button type="button" onClick={state.retry}>
          Try again
        </button>
      </div>
    ) : (
      // Naming what is outstanding rather than a bare "Loading…": on a
      // supermarket connection, "waiting on what you have already bought" is
      // the difference between slow and frozen.
      <p className="muted">{state.message}</p>
    );

  if (title === undefined) return body;

  return (
    <div>
      <h1>{title}</h1>
      {body}
    </div>
  );
}
