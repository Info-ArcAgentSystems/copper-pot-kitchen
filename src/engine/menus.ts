/**
 * Saved menus and service types — matched by their letters, never guessed.
 *
 * His notebook says "B.B.Q"; his rate card and his saved menu say "BBQ". They
 * are the same word written two ways, and an exact text comparison treats them
 * as strangers: the job gets no rate, no packing list and no menu, and nothing
 * on screen says why.
 *
 * So service types are compared by a KEY: letters and digits only, lower case.
 * "B.B.Q", "bbq" and "B B Q" all key to "bbq". That is formatting, not meaning
 * — "Barbecue" does NOT match "BBQ", and nothing here tries to make it. Pure:
 * no React, no Supabase.
 */

import type { MenuTemplate, RecipeId } from './types';

export const serviceTypeKey = (serviceType: string): string =>
  serviceType.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export interface SavedMenu {
  /** His own spelling, from the first dish saved under it. */
  readonly serviceType: string;
  /** In his order. */
  readonly recipeIds: readonly RecipeId[];
}

/** Every saved menu, one per service type key, each in his order. */
export function savedMenus(templates: readonly MenuTemplate[]): readonly SavedMenu[] {
  const byKey = new Map<string, MenuTemplate[]>();
  for (const t of templates) {
    const key = serviceTypeKey(t.serviceType);
    if (key === '') continue;
    byKey.set(key, [...(byKey.get(key) ?? []), t]);
  }

  return [...byKey.values()]
    .map((rows) => {
      const sorted = [...rows].sort((a, b) => a.position - b.position);
      return {
        serviceType: sorted[0]?.serviceType ?? '',
        recipeIds: sorted.map((r) => r.recipeId),
      };
    })
    .sort((a, b) => a.serviceType.localeCompare(b.serviceType));
}

/** The saved menu for a job's service type, or null when there is none. */
export function menuFor(
  serviceType: string | null,
  templates: readonly MenuTemplate[],
): SavedMenu | null {
  if (serviceType === null) return null;
  const key = serviceTypeKey(serviceType);
  if (key === '') return null;
  return savedMenus(templates).find((m) => serviceTypeKey(m.serviceType) === key) ?? null;
}

/**
 * His own spelling of a service type the sheet wrote differently — "BBQ" for a
 * read "B.B.Q" — or null when it already matches or matches nothing he uses.
 * Offered to him as a choice; never swapped in by itself.
 */
export function ownSpelling(read: string | null, known: readonly string[]): string | null {
  if (read === null) return null;
  const key = serviceTypeKey(read);
  if (key === '') return null;
  const match = known.find((k) => serviceTypeKey(k) === key);
  return match === undefined || match === read ? null : match;
}
