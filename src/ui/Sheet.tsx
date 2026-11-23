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
 * No DOM globals: this file is compiled by the test build, which has none.
 * Escape is caught on the panel itself, where focus already is.
 */

import { useEffect, useId, useRef, type ReactNode, type Ref } from 'react';

export function Sheet({
  title,
  onClose,
  children,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}): ReactNode {
  const titleId = useId();
  const panel = useRef<{ focus: () => void } | null>(null);

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
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="sheet-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
