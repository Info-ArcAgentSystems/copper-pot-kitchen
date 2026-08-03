/**
 * Sign in, sign out, and the current session.
 *
 * This is the second and last file permitted to import the Supabase client —
 * `tests/data/purity.test.ts` names it explicitly rather than the rule being
 * widened. Auth is genuinely a client concern; everything else goes through a
 * repository.
 *
 * There is no sign-up. Rule: the app ships empty and has one owner plus named
 * collaborators, added through `kitchen_members` by someone who already has
 * access. A self-serve sign-up would create accounts with no kitchen, which is
 * exactly the state Rule 17 wants to be deliberate.
 */

import { supabaseClient } from '../data/client';

export interface SignedInUser {
  readonly id: string;
  readonly email: string | null;
}

export class SignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignInError';
  }
}

export async function signIn(email: string, password: string): Promise<SignedInUser> {
  const { data, error } = await supabaseClient().auth.signInWithPassword({ email, password });

  // Supabase deliberately does not say which of the two was wrong, and neither
  // does this — repeating the message back is the whole point.
  if (error !== null) throw new SignInError(error.message);
  if (data.user === null) throw new SignInError('Sign in returned no user.');

  return { id: data.user.id, email: data.user.email ?? null };
}

export async function signOut(): Promise<void> {
  const { error } = await supabaseClient().auth.signOut();
  if (error !== null) throw new SignInError(error.message);
}

export async function currentUser(): Promise<SignedInUser | null> {
  const { data } = await supabaseClient().auth.getUser();
  return data.user === null ? null : { id: data.user.id, email: data.user.email ?? null };
}

/** Fires on sign-in, sign-out and token refresh. Returns an unsubscribe. */
export function onAuthChange(handler: (user: SignedInUser | null) => void): () => void {
  const { data } = supabaseClient().auth.onAuthStateChange((_event, session) => {
    const user = session?.user ?? null;
    handler(user === null ? null : { id: user.id, email: user.email ?? null });
  });

  return () => data.subscription.unsubscribe();
}
