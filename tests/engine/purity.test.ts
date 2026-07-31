/**
 * The engine must run under plain Node, with no browser and no database.
 *
 * ARCHITECTURE.md calls this "the single most important structural constraint in
 * the repo" — it is what lets the golden regression pack execute on every commit.
 * Until now it was convention. This makes it enforced.
 *
 * oxlint 1.75 has no no-restricted-imports rule, so the check lives here instead.
 * A test is the stronger place for it anyway: it can assert the actual rule
 * ("imports nothing outside src/engine"), which no off-the-shelf lint rule states.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ENGINE_DIR = fileURLToPath(new URL('../../src/engine', import.meta.url));

const engineFiles = readdirSync(ENGINE_DIR).filter((f) => f.endsWith('.ts'));

/** Matches `import ... from '<spec>'`, `export ... from '<spec>'` and `import('<spec>')`. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;

function specifiersIn(source: string): string[] {
  return [...source.matchAll(SPECIFIER)].map((m) => m[1] as string);
}

describe('engine purity', () => {
  it('has engine files to check', () => {
    expect(engineFiles.length).toBeGreaterThan(0);
  });

  it.each(engineFiles)('%s imports nothing outside src/engine', (file) => {
    const source = readFileSync(join(ENGINE_DIR, file), 'utf8');

    for (const spec of specifiersIn(source)) {
      // Bare specifiers are packages — react, @supabase/supabase-js, lodash, all
      // equally forbidden. Node builtins too: the engine takes data in and returns
      // data out, so it has no business reading a file or a clock.
      expect(spec.startsWith('.'), `${file} imports package "${spec}"`).toBe(true);

      // Relative, but must not climb out of src/engine.
      expect(spec.startsWith('../'), `${file} imports "${spec}" outside src/engine`).toBe(
        false,
      );
    }
  });

  it.each(engineFiles)('%s contains no browser or database globals', (file) => {
    const source = readFileSync(join(ENGINE_DIR, file), 'utf8');
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    for (const forbidden of ['window', 'document', 'localStorage', 'fetch(', 'supabase']) {
      expect(withoutComments.includes(forbidden), `${file} references ${forbidden}`).toBe(
        false,
      );
    }
  });
});
