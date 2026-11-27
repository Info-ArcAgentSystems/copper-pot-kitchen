/**
 * A panel over the list: up from the bottom on a phone, in from the right on a
 * wide screen.
 *
 * WHY. Opening a record used to REPLACE the list, so editing one job meant
 * losing his place among forty and scrolling back to it afterwards. The list
 * now stays where it is underneath, and closing the panel returns him to it.
 *
 * WHAT CLOSES IT, and what deliberately does not. The X, Cancel, Save and the
 * Escape key all close it — each a thing he chose to do. A tap on the dimmed
 * list behind does NOT: half a recipe typed in is lost by a stray thumb, and
 * nothing here would tell him it had gone.
 *
 * UNSAVED WORK IS NEVER LOST SILENTLY. Once anything inside has been typed or
 * changed, the X and Escape ask "Discard your changes?" first. Cancel inside the
 * form still closes at once — that button IS the decision. ⌘S / Ctrl+S submits
 * the form in the panel, the same as tapping Save. `guardChanges={false}` turns
 * the question off for panels that are not forms (Ask Sous).
 *
 * No DOM globals: this file is compiled by the test build, which has none.
 * Escape is caught on the panel itself, where focus already is.
 */

import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react';

/** The few DOM members used here, typed structurally — the test build has no DOM lib. */
interface PanelEl {
  focus: () => void;
  querySelector: (selector: string) => { requestSubmit?: () => void } | null;
}

export function Sheet({
  title,
  onClose,
  children,
  guardChanges = true,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly guardChanges?: boolean;
}): ReactNode {
  const titleId = useId();
  const panel = useRef<PanelEl | null>(null);
  const keep = useRef<{ focus: () => void } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [asking, setAsking] = useState(false);

  const tryClose = (): void => {
    if (guardChanges && dirty) {
      setAsking(true);
      return;
    }
    onClose();
  };

  useEffect(() => {
    if (asking) keep.current?.focus();
  }, [asking]);

  // Focus moves into the panel, so a keyboard or screen-reader user is in it
  // rather than behind it, and Escape reaches it.
  useEffect(() => {
    panel.current?.focus();
  }, []);

  return (
    <div className="sheet-layer">
      <div className="sheet-scrim" aria-hidden="true" />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={panel as unknown as Ref<never>}
        onInput={() => {
          if (!dirty) setDirty(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            if (asking) setAsking(false);
            else tryClose();
            return;
          }
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
            const form = panel.current?.querySelector('form');
            if (form?.requestSubmit !== undefined) {
              e.preventDefault();
              form.requestSubmit();
            }
          }
        }}
      >
        <div className="sheet-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="sheet-close" aria-label="Close" onClick={tryClose}>
            ×
          </button>
        </div>
        {asking && (
          <div className="sheet-discard" role="alertdialog" aria-label="Unsaved changes">
            <span>Discard your changes?</span>
            <button
              type="button"
              ref={keep as unknown as Ref<never>}
              onClick={() => setAsking(false)}
            >
              Keep editing
            </button>
            <button type="button" onClick={onClose}>
              Discard
            </button>
          </div>
        )}
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
