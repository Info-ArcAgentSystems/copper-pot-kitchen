/**
 * The kitchen context's shape and its hook.
 *
 * Separate from the provider component so the module exports no components —
 * mixing a hook and a component in one file breaks React Fast Refresh, and oxlint
 * says so.
 *
 * THREE STATES, kept distinct on purpose:
 *
 *   signed_out       no session
 *   no_kitchen       signed in, but no `kitchen_members` row
 *   ready            signed in, with a kitchen
 *
 * Collapsing the middle one into "signed out", or into an empty app, is how "why
 * can't I see anything" becomes an hour of debugging. It is also Rule 17 working
 * exactly as intended: revoking access is deleting a row, and the app must say so
 * rather than showing a kitchen with nothing in it.
 */

import { createContext, useContext } from 'react';
import type { KitchenMembership } from '../data/repositories';
import type { SignedInUser } from './session';

export type KitchenState =
  | { readonly status: 'loading' }
  | { readonly status: 'signed_out' }
  | { readonly status: 'no_kitchen'; readonly user: SignedInUser }
  | {
      readonly status: 'ready';
      readonly user: SignedInUser;
      readonly membership: KitchenMembership;
    };

export interface KitchenContextValue {
  readonly state: KitchenState;
  /** Re-reads the membership. Call after anything that could change access. */
  readonly refresh: () => Promise<void>;
}

export const KitchenContext = createContext<KitchenContextValue | null>(null);

export function useKitchen(): KitchenContextValue {
  const value = useContext(KitchenContext);
  if (value === null) throw new Error('useKitchen must be used inside a KitchenProvider');
  return value;
}
