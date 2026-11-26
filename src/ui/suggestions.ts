/**
 * NAMES HE ALREADY USES — offered as a dropdown under a free-text box.
 *
 * Rates are found by client group + service type matched EXACTLY
 * (`src/engine/costing.ts`). "Priority" on the customer and "priority " on the
 * rate are two different groups, and the job silently has no price. Offering
 * the spellings already in use makes the matching one a tap away instead of a
 * thing to retype perfectly.
 *
 * Suggestions only. The box stays free text — a new group or service type is
 * typed as before — and nothing is ever filled in by itself.
 *
 * WHY THESE READS ARE NOT IN A SCREEN'S `sources` GATE. The gate exists so a
 * failed read is never shown as an empty or partial answer. A suggestion list
 * is not an answer: if its read fails, the box is simply a plain text box again,
 * exactly as it was before this existed. Nothing on the screen says less than
 * the truth, so there is nothing for the gate to warn about.
 */

import { useEffect, useState } from 'react';
import { serviceTypeKey } from '../engine/menus';

/**
 * One spelling per name, first-come: callers list the most authoritative source
 * first (the rate card), so a job's "B.B.Q" is offered as the rate's "BBQ".
 * Blank and null entries are dropped; letters-and-digits decide sameness, the
 * same key saved menus use.
 */
export function distinctNames(...lists: readonly (readonly (string | null)[])[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list) {
      const name = raw?.trim() ?? '';
      const key = serviceTypeKey(name);
      if (key === '' || seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

/** Load once; a failure is an empty list — the box still works as plain text. */
export function useSuggestions(load: () => Promise<readonly string[]>): readonly string[] {
  const [names, setNames] = useState<readonly string[]>([]);
  useEffect(() => {
    let live = true;
    load().then(
      (got) => {
        if (live) setNames(got);
      },
      () => {
        if (live) setNames([]);
      },
    );
    return () => {
      live = false;
    };
    // Loaded once per form; the lists change only when he saves elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return names;
}
