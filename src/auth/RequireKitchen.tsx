/**
 * Route guard.
 *
 * Renders children only in the `ready` state. The other three each get their own
 * screen, because they are genuinely different situations and telling them apart
 * is the difference between "sign in" and "your access was removed".
 */

import type { ReactNode } from 'react';
import { useKitchen } from './kitchenState';
import { SignIn } from './SignIn';
import { signOut } from './session';

export function RequireKitchen({ children }: { children: ReactNode }): ReactNode {
  const { state, refresh } = useKitchen();

  if (state.status === 'loading') {
    return (
      <main className="centred">
        <p>Loading…</p>
      </main>
    );
  }

  if (state.status === 'signed_out') return <SignIn />;

  if (state.status === 'no_kitchen') {
    // Rule 17 working as designed: the account is real, the membership is not.
    // Showing an empty kitchen here would be a lie, and showing the sign-in screen
    // would send someone round a loop they cannot escape.
    return (
      <main className="centred">
        <h1>No kitchen</h1>
        <p>
          You are signed in as <strong>{state.user.email ?? state.user.id}</strong>, but this
          account has not been given access to a kitchen.
        </p>
        <p className="muted">
          Access is granted per person through <code>kitchen_members</code>, and removing that
          row revokes it immediately. If this is unexpected, ask whoever administers the
          kitchen.
        </p>
        <button
          type="button"
          onClick={() => {
            void refresh();
          }}
        >
          Check again
        </button>
        <button
          type="button"
          onClick={() => {
            void signOut();
          }}
        >
          Sign out
        </button>
      </main>
    );
  }

  return <>{children}</>;
}
