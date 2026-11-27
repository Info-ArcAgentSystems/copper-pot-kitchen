/**
 * CLIENT GROUPS — the rules behind Setup → Client groups and the two dropdowns
 * that pick from it (Customers, Rate card). Pure: no React, no Supabase.
 *
 * Sameness is letters and digits, the key rates are matched by (`rateFor`) and
 * the database's unique index uses: "Priority", "priority" and "Priority." are
 * one group.
 */

import { serviceTypeKey as groupKey } from '../engine/menus';
import type { ClientGroup, ClientGroupId, ClientRate, Customer } from '../engine/types';

/** What stops this name being saved, or null. `self` is the group being renamed. */
export function groupNameProblem(
  name: string,
  groups: readonly ClientGroup[],
  self: ClientGroupId | null,
): string | null {
  const key = groupKey(name);
  if (key === '') return 'Give it a name with letters or numbers.';
  const clash = groups.find((g) => g.id !== self && groupKey(g.name) === key);
  return clash === undefined ? null : `“${clash.name}” already exists.`;
}

export interface GroupUse {
  readonly customers: number;
  readonly rates: number;
}

/** How many customers and rates name this group. */
export function groupUse(
  group: ClientGroup,
  customers: readonly Customer[],
  rates: readonly ClientRate[],
): GroupUse {
  const key = groupKey(group.name);
  return {
    customers: customers.filter((c) => groupKey(c.clientGroup ?? '') === key).length,
    rates: rates.filter((r) => groupKey(r.clientGroup) === key).length,
  };
}

/** "2 customers · 1 rate", or "Not used yet". */
export function describeUse(use: GroupUse): string {
  const parts = [
    use.customers > 0 ? `${use.customers} customer${use.customers === 1 ? '' : 's'}` : null,
    use.rates > 0 ? `${use.rates} rate${use.rates === 1 ? '' : 's'}` : null,
  ].filter((p): p is string => p !== null);
  return parts.length === 0 ? 'Not used yet' : parts.join(' · ');
}

export interface GroupChoice {
  readonly options: readonly { readonly value: string; readonly label: string }[];
  /** The option to show as chosen for the record's current value. */
  readonly selected: string;
}

/**
 * The options of a "Client group" dropdown, for a record whose current group is
 * `current`.
 *
 * - `none` is the label of the empty choice, or null where a group is required
 *   (a rate always has one).
 * - A current value that matches a group by key shows as that group's spelling.
 * - A current value that matches NO group is kept as an option, labelled, so
 *   opening and saving a record never silently changes its group.
 */
export function groupChoice(
  groups: readonly ClientGroup[],
  current: string | null,
  none: string | null,
): GroupChoice {
  const value = (current ?? '').trim();
  const match = groups.find((g) => groupKey(g.name) === groupKey(value));
  const orphan = value !== '' && match === undefined;
  return {
    options: [
      ...(none === null ? [] : [{ value: '', label: none }]),
      ...(orphan ? [{ value, label: `${value} (not in Client groups)` }] : []),
      ...groups.map((g) => ({ value: g.name, label: g.name })),
    ],
    selected: match?.name ?? value,
  };
}
