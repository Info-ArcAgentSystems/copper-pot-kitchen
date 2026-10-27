/**
 * The photo buttons, and the honest state of the data they need.
 *
 * THE ONLY PLACE IN THE APP THAT RENDERS `PhotoSource`, and that is the point
 * rather than tidiness. Each scanner needs its own records loaded before a
 * photograph is any use — the model resolves nothing, so every name it reads is
 * matched here against the owner's own data. Until those reads land there is
 * nothing to match against, and the buttons are correctly dead.
 *
 * What was wrong was the dead part being silent. All four scanners gated on
 * `ready`, a boolean over `status === 'ready'`, which is false while loading and
 * false forever after a FAILED read. A failure left two greyed buttons, no
 * message, and the reason sitting unused inside `useAsync`. The screen looked
 * like the feature was broken. ScanJobSheet reads three repositories, so it had
 * three ways in.
 *
 * Routing it through one component makes the silent state impossible to write:
 * a scanner cannot grey the buttons on its own, because it cannot reach them.
 * It hands over its reads, named in the owner's words, and gets back the
 * control plus whatever needs saying about it. `tests/scan/photoGate.test.ts`
 * holds that line.
 *
 * Still loading says so and stays disabled, which is honest — the wait is real
 * and short. A failure says which read failed, what the scanner wanted it for,
 * what the failure itself said, and offers to run it again. Both sets of words
 * come from `SourceNotice`, which the six non-scanner screens share, so the
 * owner is never told the same thing two ways.
 */

import type { ReactNode } from 'react';
import { PhotoSource } from './PhotoSource';
import { SourceNotice } from '../../ui/SourceNotice';
import { sourceState, type DataSource } from '../../ui/sourceState';

export function PhotoGate({
  sources,
  busy,
  onFile,
}: {
  /** The reads this scanner cannot match names without. */
  readonly sources: readonly DataSource[];
  readonly busy: boolean;
  readonly onFile: (file: File) => void;
}): ReactNode {
  const state = sourceState(sources);

  return (
    <>
      {/* ABOVE the buttons, because it is the reason they are dead: the
          explanation has to reach the eye before the thing it explains. Renders
          nothing at all when every read landed. */}
      <SourceNotice state={state} />

      <PhotoSource
        // Disabled is never the whole story here — the line above says why.
        disabled={busy || state.kind !== 'ready'}
        onFile={(file) => {
          if (state.kind === 'ready') onFile(file);
        }}
      />
    </>
  );
}
