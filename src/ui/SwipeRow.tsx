/**
 * A list row that can be swiped left on a touch screen, or held, to select.
 *
 * SHORTCUTS, NEVER THE ONLY WAY. Every action here is also on a visible button
 * — "Select to delete" and the bar it opens — so nothing depends on a gesture
 * he might never discover, and a mouse or keyboard user loses nothing. Swipe
 * listens to touch and pen only; a mouse drags text, as it always has.
 *
 *   swipe left  reveals Select and Delete. Delete does NOT delete: it opens the
 *               same confirmation as the bar, so a wet thumb cannot remove a
 *               job by itself.
 *   hold        ~half a second starts selecting, with this row ticked.
 *   locked      (Rule 15's closed jobs) the swipe reveals why, and offers
 *               nothing to press.
 *
 * No DOM globals: this file is compiled by the test build, which has none.
 */

import { useRef, useState, type ReactNode } from 'react';

const OPEN = 176; // two 88px actions
const HOLD_MS = 500;

export function SwipeRow({
  locked,
  onOpen,
  onSelect,
  onDelete,
  children,
}: {
  /** Why this row cannot be deleted, or null when it can. */
  readonly locked: string | null;
  readonly onOpen: () => void;
  readonly onSelect: () => void;
  readonly onDelete: () => void;
  readonly children: ReactNode;
}): ReactNode {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; base: number } | null>(null);
  const moved = useRef(false);
  const held = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHold = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };

  const close = (): void => setDx(0);

  return (
    <div className={`swipe${dx !== 0 || dragging ? ' is-revealed' : ''}`}>
      <div className="swipe-actions" aria-hidden={dx === 0}>
        {locked !== null ? (
          <span className="swipe-locked">Can’t be deleted: {locked}</span>
        ) : (
          <>
            <button
              type="button"
              className="swipe-select"
              tabIndex={-1}
              onClick={() => {
                close();
                onSelect();
              }}
            >
              Select
            </button>
            <button
              type="button"
              className="swipe-delete"
              tabIndex={-1}
              onClick={() => {
                close();
                onDelete();
              }}
            >
              Delete
            </button>
          </>
        )}
      </div>

      <button
        type="button"
        className={`record swipe-front${dragging ? ' is-dragging' : ''}`}
        style={dx === 0 ? undefined : { transform: `translateX(${dx}px)` }}
        onPointerDown={(e) => {
          moved.current = false;
          held.current = false;
          start.current = { x: e.clientX, y: e.clientY, base: dx };
          clearHold();
          timer.current = setTimeout(() => {
            if (!moved.current) {
              held.current = true;
              onSelect();
            }
          }, HOLD_MS);
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (s === null) return;
          const mx = e.clientX - s.x;
          const my = e.clientY - s.y;
          if (Math.abs(mx) > 6 || Math.abs(my) > 6) {
            moved.current = true;
            clearHold();
          }
          if (e.pointerType === 'mouse') return;
          if (!dragging && Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my)) setDragging(true);
          if (dragging || (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my))) {
            setDx(Math.max(-OPEN - 24, Math.min(0, s.base + mx)));
          }
        }}
        onPointerUp={() => {
          clearHold();
          start.current = null;
          if (dragging) {
            setDragging(false);
            setDx((d) => (d < -OPEN / 2 ? -OPEN : 0));
          }
        }}
        onPointerCancel={() => {
          clearHold();
          start.current = null;
          setDragging(false);
          setDx(0);
        }}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          // A swipe or a hold is not also a tap.
          if (moved.current || held.current) return;
          if (dx !== 0) {
            close();
            return;
          }
          onOpen();
        }}
      >
        {children}
      </button>
    </div>
  );
}
