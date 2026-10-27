/**
 * Where a scanner's photo comes from.
 *
 * TWO CONTROLS ON A PHONE, ONE ON A LAPTOP, AND THE REASON IS THE SAME REASON.
 *
 * `capture="environment"` does not mean "prefer the camera". It means "this
 * control IS a camera capture", so Chrome on Android skips the picker entirely
 * and the gallery vanishes. Removing it fixed the gallery and broke the camera:
 * a bare `accept="image/*"` routes to the Android system photo picker, which
 * shows Photos and Albums and has no camera button at all. Both outages were
 * live. There is no attribute combination that offers both on Android, so the
 * phone gets two buttons and the choice is explicit.
 *
 * ON A LAPTOP THE CAMERA BUTTON WOULD BE A LIE. `capture` is not implemented on
 * desktop — verified, not assumed: `'capture' in HTMLInputElement.prototype` is
 * FALSE there, so the attribute sits inertly in the DOM and both buttons open
 * the identical file dialog. A file input cannot reach a webcam on any platform;
 * that needs `getUserMedia`, which is a different API and not wired here. So on
 * a pointer-fine device the camera button is not rendered at all, rather than
 * shown with a sub-line describing something that does not happen.
 *
 * `pointer: coarse` rather than a width query or a user-agent string: the
 * question is "does this device have a touch input the OS will hand a camera
 * to", which is exactly what the media feature reports. A narrow laptop window
 * is still a laptop.
 */

import { useEffect, useState, type ReactNode } from 'react';

/*
 * PLACEHOLDER ICONS — the app has no icon system. `public/icons.svg` is
 * leftover Vite-starter scaffolding referenced nowhere. Sized in `em` so they
 * ride the type ramp.
 */
const Icon = ({ d }: { d: string }): ReactNode => (
  <svg className="scan-button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CAMERA = 'M4 8h3l2-2h6l2 2h3v11H4z M12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z';
const FOLDER = 'M4 6h5l2 2h9v10H4z';

/**
 * Does the OS have a camera to hand this control?
 *
 * Read once on mount AND kept live: a tablet with a detachable keyboard changes
 * answer, and so does dragging a window between a touchscreen and an external
 * monitor. Defaults to `false` so a device that cannot answer gets the honest
 * single button rather than a camera that does nothing.
 */
function useHasCamera(): boolean {
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia('(pointer: coarse)');
    setCoarse(query.matches);

    const onChange = (event: MediaQueryListEvent): void => setCoarse(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return coarse;
}

export function PhotoSource({
  onFile,
  disabled,
}: {
  onFile: (file: File) => void;
  disabled: boolean;
}): ReactNode {
  const hasCamera = useHasCamera();

  const take = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file !== undefined) onFile(file);
    // Cleared so picking the SAME file twice still fires a change event — after
    // a failed scan, re-choosing the identical photo is the obvious thing to try.
    event.target.value = '';
  };

  return (
    <div className="photo-source">
      {/* Only where the OS will actually open a camera. */}
      {hasCamera && (
        <label className="scan-button">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={disabled}
            onChange={take}
          />
          <Icon d={CAMERA} />
          <span className="scan-button-label">Take a photo</span>
          <span className="scan-button-sub">Opens the camera</span>
        </label>
      )}

      <label className="scan-button">
        {/* NO `capture`: this is the one that must reach the gallery. */}
        <input type="file" accept="image/*" disabled={disabled} onChange={take} />
        <Icon d={FOLDER} />
        <span className="scan-button-label">Choose a file</span>
        <span className="scan-button-sub">
          {hasCamera ? 'Gallery or Files' : 'From this computer'}
        </span>
      </label>
    </div>
  );
}
