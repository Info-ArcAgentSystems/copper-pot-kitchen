/**
 * NAMES ANOTHER SCREEN OWNS — the options of a real dropdown.
 *
 * One screen names a thing as free text; every other screen PICKS it. The Rate
 * card names client groups, and a customer's group is chosen from them, so a
 * customer can never carry a group no rate is looked up by. That makes the
 * mismatch impossible instead of merely suggesting the right spelling.
 *
 * WHY THIS READ IS NOT IN A SCREEN'S `sources` GATE. The gate exists so a failed
 * read is never shown as an empty or partial answer. These are options, not an
 * answer: if the read fails, the dropdown offers "No group" and whatever the
 * record already holds, and nothing changes unless he picks. The screen that
 * names the groups (the Rate card) gates its own read in full.
 */

import { useEffect, useState } from 'react';
import { serviceTypeKey } from '../engine/menus';

/**
 * One spelling per name, first-come. Blank and null entries are dropped;
 * letters-and-digits decide sameness — the same key rates and saved menus are
 * matched by, so two spellings of one group are offered once.
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

/** Load once; a failure is an empty list — see above for why that is safe. */
export function useLoadedNames(load: () => Promise<readonly string[]>): readonly string[] {
  return useLoaded(load);
}

/** The same, for records rather than names (client groups for a dropdown). */
export function useLoaded<T>(load: () => Promise<readonly T[]>): readonly T[] {
  const [names, setNames] = useState<readonly T[]>([]);
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
