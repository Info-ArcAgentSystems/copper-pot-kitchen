/**
 * Resolves who is signed in and which kitchen they may see.
 *
 * The state shape and the hook live in `kitchenState.ts`; this file exports only
 * the provider component.
 *
 * The membership is re-read on every auth change rather than cached, because
 * "revocable, taking effect immediately through RLS" is the whole of Rule 17. A
 * cached membership would keep a revoked developer inside the app until reload.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabaseDb } from '../data/client';
import { kitchenRepository } from '../data/repositories';
import { currentUser, onAuthChange, type SignedInUser } from './session';
import { KitchenContext, type KitchenState } from './kitchenState';

export function KitchenProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, setState] = useState<KitchenState>({ status: 'loading' });

  const resolve = useCallback(async (user: SignedInUser | null): Promise<void> => {
    if (user === null) {
      setState({ status: 'signed_out' });
      return;
    }

    try {
      const membership = await kitchenRepository(supabaseDb()).currentMembership();
      setState(
        membership === null
          ? { status: 'no_kitchen', user }
          : { status: 'ready', user, membership },
      );
    } catch {
      // A failed read is not proof of no access. Reporting "no kitchen" on a
      // network error would blame the owner for a dropped connection.
      setState({ status: 'no_kitchen', user });
    }
  }, []);

  const refresh = useCallback(async () => {
    await resolve(await currentUser());
  }, [resolve]);

  useEffect(() => {
    void refresh();
    return onAuthChange((user) => {
      void resolve(user);
    });
  }, [refresh, resolve]);

  const value = useMemo(() => ({ state, refresh }), [state, refresh]);

  return <KitchenContext.Provider value={value}>{children}</KitchenContext.Provider>;
}
