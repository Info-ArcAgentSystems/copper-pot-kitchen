# Integration tests — require a live Supabase

These cannot run in CI. They need a real database, a signed-in user, and the migrations applied.
They are skipped automatically when `VITE_SUPABASE_URL` is absent, so they show as skipped rather
than silently missing.

They are not decoration. **They are the only proof of two things the unit tests cannot reach:**

1. **RLS actually scopes rows to the caller's kitchen.** No repository filters by `kitchen_id` —
   that is deliberate, because a hand-written filter would be a second copy of the policy, free
   to drift, and would mask a broken one. The cost of that decision is that nothing in CI proves
   the policy works. Only these do.

2. **The audit triggers fire.** Rules 10 and 14 are enforced by
   `supabase/migrations/20260803000100_job_change_audit.sql`, not by TypeScript. Until these run
   green against the real database, **the audit guarantee is written but unverified.**

## Running them

```bash
# .env.local must hold VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY,
# and the migration must have been applied.
npx vitest run tests/integration
```

They write and then delete their own data. They must never be pointed at a database holding real
owner data — create a scratch project, or run them before the kitchen has anything in it.

## Why they are not in `npm run test`

`npm run test` must stay runnable by anyone who has cloned the repo, with no credentials. A suite
that fails without a database would train people to ignore failures.
