/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    /**
     * `tests/integration` is EXCLUDED from the default run.
     *
     * Those tests sign in and write to the live database. Left in, `npm run test`
     * would mutate the owner's data every time anyone ran the unit suite on a
     * machine that happens to have credentials — and would mean something
     * different on a machine that does not, since the suite silently changes
     * shape depending on whether `.env.local` exists.
     *
     * `CLAUDE.md` §6 defines `npm run test` as the unit tests. It stays that:
     * fast, offline, and identical for everyone. Run the live suite deliberately
     * with `npm run test:integration`.
     */
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/integration/**'],
  },
});
