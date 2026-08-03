/**
 * Run a repository call and track its state.
 *
 * Deliberately not a cache. One user, one device, ten screens — a cache layer
 * would add an API to learn and a class of staleness bugs to debug, for a
 * refetch that takes 200ms. `reload` is enough.
 *
 * `status` is a union rather than three booleans, so "loading and errored" is
 * unrepresentable.
 */

import { useCallback, useEffect, useState } from 'react';

export type AsyncState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: Error }
  | { readonly status: 'ready'; readonly data: T };

export interface Async<T> {
  readonly state: AsyncState<T>;
  readonly reload: () => void;
}

export function useAsync<T>(run: () => Promise<T>, deps: readonly unknown[] = []): Async<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });

    run()
      .then((data) => {
        // A late response from a superseded render must not overwrite the current
        // one — the classic list-then-detail race.
        if (live) setState({ status: 'ready', data });
      })
      .catch((cause: unknown) => {
        if (live) {
          setState({
            status: 'error',
            error: cause instanceof Error ? cause : new Error(String(cause)),
          });
        }
      });

    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps]);

  return { state, reload };
}
