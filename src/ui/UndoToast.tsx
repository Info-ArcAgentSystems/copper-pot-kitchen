/**
 * ONE TOAST WITH AN UNDO, for actions that are easy to reverse — a tick, not a
 * delete. Deletes keep their confirm dialog; this is for the opposite case, where
 * a dialog would be friction on something he does forty times a shop.
 *
 * One at a time: a new one replaces the last, so a run of ticks never stacks a
 * column of toasts over the list. Six seconds with an Undo, a little over three
 * without. The clock PAUSES while a pointer rests on it and while the tab is in
 * the background, so the Undo is never gone before he could have reached it.
 *
 * Undo calls back into the screen, which makes the same write it always makes.
 * Nothing here touches data.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

interface Shown {
  readonly id: number;
  readonly text: string;
  readonly undo: (() => void) | null;
}

export function useUndoToast(): {
  readonly show: (text: string, undo?: () => void) => void;
  readonly toast: ReactNode;
} {
  const [shown, setShown] = useState<Shown | null>(null);
  const next = useRef(0);

  const show = useCallback((text: string, undo?: () => void) => {
    next.current += 1;
    setShown({ id: next.current, text, undo: undo ?? null });
  }, []);

  const toast = (
    <div className="toasts" aria-live="polite">
      {shown !== null && (
        <UndoToastView
          key={shown.id}
          text={shown.text}
          undo={shown.undo}
          onGone={() => setShown((current) => (current?.id === shown.id ? null : current))}
        />
      )}
    </div>
  );

  return { show, toast };
}

function UndoToastView({
  text,
  undo,
  onGone,
}: {
  readonly text: string;
  readonly undo: (() => void) | null;
  readonly onGone: () => void;
}): ReactNode {
  const total = undo === null ? 3200 : 6000;
  const left = useRef(total);
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [paused, setPaused] = useState(false);
  const gone = useRef(onGone);
  gone.current = onGone;

  const stop = useCallback(() => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
    left.current -= performance.now() - started.current;
    setPaused(true);
  }, []);

  const start = useCallback(() => {
    if (timer.current !== null) return;
    started.current = performance.now();
    timer.current = setTimeout(() => gone.current(), Math.max(0, left.current));
    setPaused(false);
  }, []);

  useEffect(() => {
    start();
    const onVisibility = (): void => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [start, stop]);

  return (
    <div
      className={undo === null ? 'toast' : 'toast has-action'}
      role="status"
      onPointerEnter={stop}
      onPointerLeave={start}
    >
      <span className="toast-text">{text}</span>
      {undo !== null && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            undo();
            gone.current();
          }}
        >
          Undo
        </button>
      )}
      {undo !== null && (
        <span
          className="toast-timer"
          aria-hidden="true"
          style={{
            animationDuration: `${total}ms`,
            animationPlayState: paused ? 'paused' : 'running',
          }}
        />
      )}
    </div>
  );
}
