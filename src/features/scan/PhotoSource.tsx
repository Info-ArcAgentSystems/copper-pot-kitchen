/**
 * Where a scanner's photo comes from: the camera, or one he already has.
 *
 * TWO CONTROLS, AND IT TOOK TWO FAILURES TO GET HERE.
 *
 * First `capture="environment"` was on the input. That attribute does not mean
 * "prefer the camera" — it means "this control IS a camera capture", so both
 * mobile browsers skipped the picker and the gallery vanished. Removing it
 * fixed the gallery and broke the camera: Chrome on Android 13+ routes a bare
 * `accept="image/*"` to the SYSTEM PHOTO PICKER, which shows Photos and Albums
 * and has no camera button at all. Camera-only became gallery-only.
 *
 * There is no single attribute combination that reliably offers both on Android.
 * `capture` forces one; its absence forces the other. So the choice is made
 * explicitly, in the app, where it is visible and cannot be undone by a browser
 * version:
 *
 *   Take a photo        capture="environment"  — straight to the camera
 *   Choose a photo      no capture             — the gallery / Files / Drive
 *
 * ONE COMPONENT RATHER THAN EIGHT INPUTS. Four scanners each needing both routes
 * is eight file inputs and eight copies of the same handler, which is eight
 * places for the next browser change to be half-fixed. `tests/scan/guards.test.ts`
 * asserts every scanner goes through here.
 *
 * On iOS this is belt and braces — Safari without `capture` already offers Photo
 * Library / Take Photo / Choose File in one sheet. Two buttons cost a little
 * space there and remove all doubt, which is the better trade on the one screen
 * where being unable to proceed is the whole failure.
 */

import type { ReactNode } from 'react';

export function PhotoSource({
  onFile,
  disabled,
}: {
  onFile: (file: File) => void;
  disabled: boolean;
}): ReactNode {
  /** Both inputs behave identically once a file exists. */
  const take = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file !== undefined) onFile(file);
    // Cleared so picking the SAME file twice still fires a change event — after a
    // failed scan, re-choosing the identical photo is the obvious thing to try.
    event.target.value = '';
  };

  return (
    <div className="photo-source">
      <label className="scan-button">
        {/* `capture` belongs HERE and only here. */}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled={disabled}
          onChange={take}
        />
        <span>Take a photo</span>
      </label>

      <label className="scan-button">
        {/* NO `capture`: this is the one that must reach the gallery. */}
        <input type="file" accept="image/*" disabled={disabled} onChange={take} />
        <span>Choose a photo</span>
      </label>
    </div>
  );
}
