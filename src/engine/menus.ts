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

/**
 * SAVE THIS JOB'S DISHES AS HIS MENU — what to offer, or null.
 *
 * Saved menus are built from his own jobs rather than typed into Setup: once a
 * BBQ job has its dishes, one tap makes them "your BBQ menu", and every later
 * BBQ job — typed or scanned — is offered them.
 *
 * Offered only when there is something real to save and nothing to overwrite:
 *   - the job has a service type with letters in it
 *   - it has at least one dish
 *   - there is NO saved menu for that service type yet
 *
 * An existing menu is never replaced from a job. A one-off BBQ with an extra
 * dish would otherwise silently become the standard; changing the standard is
 * Setup → Saved menus, where he sees the whole menu he is changing.
 *
 * Dishes keep his order; a recipe listed twice is saved once.
 */
export function menuToSave(
  serviceType: string | null,
  recipeIds: readonly RecipeId[],
  templates: readonly MenuTemplate[],
): SavedMenu | null {
  if (serviceType === null) return null;
  const type = serviceType.trim();
  if (serviceTypeKey(type) === '') return null;
  const unique = recipeIds.filter((id, i) => recipeIds.indexOf(id) === i);
  if (unique.length === 0) return null;
  if (menuFor(type, templates) !== null) return null;
  return { serviceType: type, recipeIds: unique };
}

/**
 * THE REVERSE: a page lists dishes but never names the service.
 *
 * "10 x Full Irish, 3 x Pancakes" with no word for breakfast. If every one of
 * those dishes is on exactly ONE of his saved menus, that menu's service type
 * is offered. Never filled in by itself — the service type sets the price.
 *
 * Null — and nothing offered — when:
 *   - there are no dishes
 *   - a dish is on no saved menu (a new recipe, or one he never filed)
 *   - the dishes fit two menus or more: which one is a guess
 *
 * It works from his saved menus only. Nothing here reads a dish NAME: "pancakes"
 * says nothing about breakfast unless he has put Pancakes on a Breakfast menu.
 */
export function serviceTypeFromMenus(
  recipeIds: readonly RecipeId[],
  templates: readonly MenuTemplate[],
): string | null {
  if (recipeIds.length === 0) return null;
  const fits = savedMenus(templates).filter((m) =>
    recipeIds.every((id) => m.recipeIds.includes(id)),
  );
  return fits.length === 1 ? (fits[0]?.serviceType ?? null) : null;
}
