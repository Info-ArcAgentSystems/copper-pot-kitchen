/**
 * THE SHORT "DONE" MOVE a ticked row makes before it settles in the done list,
 * shared by Shopping and Prep.
 *
 * About a third of a second, and only where it helps:
 *   - a TAP plays it — the box fills and the row slides off, so the thumb sees
 *     the tick land;
 *   - a KEYBOARD tick does not: someone pressing Space down a list wants the
 *     result, not a show;
 *   - reduced motion does not.
 *
 * It never stands in for the write. The screen awaits the write AND this move
 * together, and only then re-reads, so a line moves to "done" because it is
 * saved, not because it animated. `settle(id, false)` puts a failed row back.
 */

import { useCallback, useRef, useState, type PointerEvent } from 'react';

const LEAVE_MS = 350; // check 150ms + slide 200ms — matches .is-leaving in app.css
const FLASH_MS = 900;

export function useTickMotion(): {
  readonly leave: (id: string) => Promise<void>;
  readonly settle: (id: string, ok: boolean) => void;
  readonly classFor: (id: string) => string;
  readonly isLeaving: (id: string) => boolean;
  readonly pointerProps: { readonly onPointerDown: (e: PointerEvent) => void };
} {
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [arrived, setArrived] = useState<string | null>(null);
  const lastPointer = useRef(0);

  const leave = useCallback((id: string): Promise<void> => {
    const tapped = performance.now() - lastPointer.current < 800;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!tapped || reduced) return Promise.resolve();
    setLeaving((prev) => new Set(prev).add(id));
    return new Promise((resolve) => setTimeout(resolve, LEAVE_MS));
  }, []);

  const settle = useCallback((id: string, ok: boolean): void => {
    setLeaving((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (!ok) return;
    setArrived(id);
    setTimeout(() => setArrived((current) => (current === id ? null : current)), FLASH_MS);
  }, []);

  return {
    leave,
    settle,
    classFor: (id) => (leaving.has(id) ? ' is-leaving' : arrived === id ? ' is-arrived' : ''),
    isLeaving: (id) => leaving.has(id),
    pointerProps: {
      onPointerDown: () => {
        lastPointer.current = performance.now();
      },
    },
  };
}
