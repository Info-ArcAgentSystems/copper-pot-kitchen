import { defineConfig } from 'vitest/config';

/**
 * The live suite, run deliberately with `npm run test:integration`.
 *
 * A separate config rather than a flag on the default run. `vite.config.ts`
 * excludes `tests/integration` so that `npm run test` stays fast, offline and
 * identical on every machine — and a CLI `--exclude` appends to that list rather
 * than replacing it, so there is no way to opt back in from the command line.
 *
 * Timeouts are generous because every assertion here is a round trip to Supabase.
 * The default 5s test / 10s hook limits already truncated a cleanup mid-run once,
 * leaving rows in the database and reporting success.
 */
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // One file, sequential: these share a signed-in session and write real rows.
    fileParallelism: false,
  },
});
