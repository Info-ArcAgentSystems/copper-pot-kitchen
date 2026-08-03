/**
 * Sign in.
 *
 * Email and password only. No sign-up: accounts are granted a kitchen through
 * `kitchen_members` by someone who already has access, so self-serve registration
 * would only ever produce the no_kitchen state (Rule 17).
 */

import { useState, type FormEvent, type ReactNode } from 'react';
import { signIn } from './session';
import { useKitchen } from './kitchenState';

export function SignIn(): ReactNode {
  const { refresh } = useKitchen();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await signIn(email.trim(), password);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="signin">
      <h1>Copper Pot Kitchen</h1>

      <form
        onSubmit={(e) => {
          void submit(e);
        }}
      >
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error !== null && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
