/**
 * The data layer's structural constraints.
 *
 * The OTHER direction — engine must not import src/data — is already enforced by
 * `tests/engine/purity.test.ts`, which fails any engine import beginning with
 * `../`. This file guards the constraints specific to `src/data`.
 *
 * The load-bearing one is the client confinement. If any file other than
 * `client.ts` can construct a Supabase client, application code can write to
 * `jobs` without going through a repository — and while the audit trigger would
 * still fire, the whole point of a single doorway is that there is one place to
 * reason about.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DATA_DIR = fileURLToPath(new URL('../../src/data', import.meta.url));
const dataFiles = readdirSync(DATA_DIR).filter((f) => f.endsWith('.ts'));

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;

const read = (file: string): string =>
  readFileSync(join(DATA_DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

const importsIn = (source: string): string[] =>
  [...source.matchAll(SPECIFIER)].map((m) => m[1] as string);

describe('src/data purity', () => {
  it('has files to check', () => {
    expect(dataFiles.length).toBeGreaterThan(0);
  });

  it.each(dataFiles)('%s does not import React or a UI layer', (file) => {
    for (const spec of importsIn(read(file))) {
      expect(spec, `${file} imports "${spec}"`).not.toMatch(/^react/);
      expect(spec, `${file} imports "${spec}"`).not.toContain('features');
      expect(spec, `${file} imports "${spec}"`).not.toContain('sous');
    }
  });

  it.each(dataFiles)('%s reaches into src/ no further than the engine types', (file) => {
    for (const spec of importsIn(read(file))) {
      if (!spec.startsWith('../')) continue;
      // Mappers produce domain types, so importing them is the documented
      // direction. Anything else outside src/data is not.
      expect(spec, `${file} imports "${spec}" from outside src/data`).toBe('../engine/types');
    }
  });

  it('confines the Supabase client to client.ts', () => {
    const offenders = dataFiles.filter(
      (f) => f !== 'client.ts' && read(f).includes('@supabase/supabase-js'),
    );

    expect(offenders, 'only client.ts may import @supabase/supabase-js').toEqual([]);
  });

  it('confines the Supabase client to src/data entirely', () => {
    // Nothing outside src/data may construct one either — that is what keeps every
    // job write on the audited path through a repository.
    const srcDir = fileURLToPath(new URL('../../src', import.meta.url));
    const outside: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'data') walk(path);
          continue;
        }
        if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
        if (readFileSync(path, 'utf8').includes('@supabase/supabase-js')) outside.push(path);
      }
    };
    walk(srcDir);

    expect(outside).toEqual([]);
  });

  it('does not hand-filter kitchen_id — RLS scopes reads and writes', () => {
    // A hand-written filter would be a second copy of the my_kitchen_id() policy,
    // free to drift from it, and it would mask a misconfigured policy rather than
    // expose one.
    //
    // Checked as a QUOTED string literal, not as a call shape. An earlier version
    // matched `eq('kitchen_id'` and sailed past
    // `selectWhere(table, 'kitchen_id', v)`, where the column is the second
    // argument — a guard that did not guard. Any filter must name the column as a
    // string, so the literal is the thing to look for.
    //
    // `kitchen_id` as an unquoted identifier is fine: mappers build row objects
    // with it, and jobRepository destructures it out of a patch precisely so it is
    // never written.
    const offenders = dataFiles.filter(
      (f) => f !== 'rows.ts' && /['"]kitchen_id['"]/.test(read(f)),
    );

    expect(offenders, 'no repository may name kitchen_id in a query').toEqual([]);
  });

  it('exposes no way for application code to write job_changes', () => {
    // Rule 10: the trail is not optional. An insert or delete against job_changes
    // from application code would make it decorative.
    const source = read('repositories.ts');
    expect(source).not.toMatch(/insert\s*\(\s*T\.jobChanges/);
    expect(source).not.toMatch(/deleteWhere\s*\(\s*T\.jobChanges/);
  });
});
