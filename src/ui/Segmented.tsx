/**
 * A segmented control over sibling views — Shopping/Prep/Packing, Recipes/Ingredients.
 *
 * `role="tablist"` rather than a row of `aria-pressed` buttons. The difference is
 * not cosmetic: pressed buttons announce as independent toggles, so a screen
 * reader says "Shopping, pressed" with no hint that choosing it UNCHOOSES Prep.
 * A tablist announces "tab 1 of 3, selected" and carries the relationship.
 *
 * It also brings the keyboard contract these need and buttons do not: arrow keys
 * move between tabs, Home/End jump to the ends, and only the selected tab is in
 * the tab order — so Tab lands on the control once and moves on, rather than
 * making a keyboard user walk through every option to get past it.
 *
 * The panel is NOT re-mounted on switch. Each view owns live state — a date
 * range, tick requests in flight — and remounting would throw that away.
 */

import { useRef, type ReactNode } from 'react';

export interface Segment<K extends string> {
  readonly key: K;
  readonly label: string;
  /** Shorter wording for a phone, where three labels share 375px. */
  readonly shortLabel?: string;
}

export function Segmented<K extends string>({
  label,
  segments,
  active,
  onChange,
}: {
  /** Names the control for a screen reader: "Service view". */
  label: string;
  segments: readonly Segment<K>[];
  active: K;
  onChange: (key: K) => void;
}): ReactNode {
  const refs = useRef(new Map<K, HTMLButtonElement>());

  /**
   * Arrow keys move and SELECT in one step.
   *
   * Automatic activation is the right pattern here: switching costs nothing —
   * no fetch, no unsaved form — so requiring a second keypress to confirm would
   * be friction with no payoff.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    const keys = segments.map((s) => s.key);
    const at = keys.indexOf(active);

    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? keys[(at + 1) % keys.length]
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? keys[(at - 1 + keys.length) % keys.length]
          : event.key === 'Home'
            ? keys[0]
            : event.key === 'End'
              ? keys[keys.length - 1]
              : undefined;

    if (next === undefined) return;

    event.preventDefault();
    onChange(next);
    // Focus follows selection, or the keyboard user loses their place.
    refs.current.get(next)?.focus();
  };

  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {segments.map((segment) => {
        const selected = segment.key === active;

        return (
          <button
            key={segment.key}
            type="button"
            role="tab"
            id={`seg-${segment.key}`}
            aria-selected={selected}
            aria-controls={`panel-${segment.key}`}
            /* Only the selected tab is reachable by Tab. The arrows move within. */
            tabIndex={selected ? 0 : -1}
            ref={(node) => {
              if (node === null) refs.current.delete(segment.key);
              else refs.current.set(segment.key, node);
            }}
            onClick={() => onChange(segment.key)}
            onKeyDown={onKeyDown}
          >
            <span className="seg-long">{segment.label}</span>
            {segment.shortLabel !== undefined && (
              <span className="seg-short">{segment.shortLabel}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The panel a segment controls. Labelled by its tab, so the pairing is announced. */
export function SegmentPanel({
  segment,
  children,
}: {
  segment: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div role="tabpanel" id={`panel-${segment}`} aria-labelledby={`seg-${segment}`} tabIndex={0}>
      {children}
    </div>
  );
}
