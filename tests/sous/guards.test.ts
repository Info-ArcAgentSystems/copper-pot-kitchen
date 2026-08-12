/**
 * RULES 2, 3 AND 7 — the three constraints on the one feature where a model
 * touches the owner's data.
 *
 * Each is enforced structurally rather than by prompt instruction. A prompt is a
 * request; these are guarantees. Every guard below was verified by inversion —
 * planting the violation and confirming the test goes red — because a guard
 * nobody has watched fail is a guard nobody has checked.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TOOL_NAMES } from '../../src/sous/intent';
import { TOOLS, runIntent, toolSchema, type SousData } from '../../src/sous/tools';
import { buildContext, validateReply } from '../../src/sous/askSous';
import type { Intent } from '../../src/sous/intent';

const SOUS_DIR = fileURLToPath(new URL('../../src/sous', import.meta.url));
const EDGE = fileURLToPath(new URL('../../supabase/functions/ask-sous/index.ts', import.meta.url));

const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const sousFiles = (): { file: string; code: string }[] =>
  readdirSync(SOUS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((file) => ({ file, code: strip(readFileSync(join(SOUS_DIR, file), 'utf8')) }));

const empty: SousData = {
  jobs: [],
  recipes: [],
  ingredients: [],
  customers: [],
  rates: [],
  stock: [],
  templates: [],
};

// ---------------------------------------------------------------------------

describe('RULE 2 — Ask Sous never calculates', () => {
  it('has files to check', () => {
    expect(sousFiles().length).toBeGreaterThan(0);
  });

  it.each(['Math.round', 'Math.ceil', 'Math.floor', 'Math.max', 'Math.min'])(
    'no file under src/sous uses %s',
    (token) => {
      for (const { file, code } of sousFiles()) {
        expect(code, `${file} uses ${token}`).not.toContain(token);
      }
    },
  );

  it('the EDGE FUNCTION does no arithmetic and imports no engine code', () => {
    // The model-facing half. A figure originating here is precisely what Rule 2
    // forbids, and it would be the hardest place to notice one.
    const code = strip(readFileSync(EDGE, 'utf8'));

    for (const token of ['Math.', 'reduce(', '+=', '*=']) {
      expect(code, `the edge function uses ${token}`).not.toContain(token);
    }
    expect(code, 'the edge function imports engine code').not.toMatch(/from\s+['"].*engine/);
  });

  it('THE CONTEXT CARRIES NO DERIVED FIGURE', () => {
    // Sending a computed number would invite the model to restate it, and a
    // restated figure is the model calculating by the back door. Owner-entered
    // facts (a guest count) are fine — those are inputs, not results.
    const context = buildContext([], [], [], [], '2026-08-20');
    const serialised = JSON.stringify(context);

    for (const forbidden of [
      'total',
      'cost',
      'margin',
      'batches',
      'outstanding',
      'revenue',
      'surplus',
      'portions',
    ]) {
      expect(serialised, `the context exposes "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it('the context builder names no derived field in its own source', () => {
    const code = strip(readFileSync(join(SOUS_DIR, 'askSous.ts'), 'utf8'));
    const builder = code.slice(code.indexOf('export function buildContext'));

    for (const forbidden of ['rangeMoney', 'outstandingShopping', 'productionBuckets']) {
      expect(builder, `buildContext calls ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('the intent type exposes no result field', () => {
    // What the model may say. A `total` or `batches` here would be it answering
    // rather than routing.
    const code = strip(readFileSync(join(SOUS_DIR, 'intent.ts'), 'utf8'));

    for (const forbidden of ['total', 'cost:', 'margin', 'batches', 'outstanding']) {
      expect(code, `the Intent type carries "${forbidden}"`).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------

describe('RULE 3 — a fixed set of typed tools, not a chat box', () => {
  it('every registered tool is read or propose — there is no third kind', () => {
    for (const name of TOOL_NAMES) {
      expect(['read', 'propose'], `${name} has an unexpected kind`).toContain(TOOLS[name].kind);
    }
  });

  it('the schema sent to the model IS the registry', () => {
    // Built from it rather than hand-written, so the two cannot drift. A
    // hand-maintained copy eventually offers a tool that does not exist.
    expect(toolSchema().map((t) => t.name)).toEqual([...TOOL_NAMES]);
  });

  it('the EDGE FUNCTION offers exactly the same tools', () => {
    // A tool offered there but missing here would be chosen by the model and then
    // refused by the dispatcher — which the owner experiences as Sous ignoring
    // them, with nothing in the UI explaining why.
    const code = readFileSync(EDGE, 'utf8');
    const offered = [...code.matchAll(/name: '([a-z_]+)',\n\s*description/g)].map((m) => m[1]);

    expect(offered.sort()).toEqual([...TOOL_NAMES].sort());
  });

  it('REFUSES a tool name that is not registered', () => {
    const reply = validateReply({ tool: 'delete_everything', args: {} });

    expect(reply.kind).toBe('unresolved');
    if (reply.kind !== 'unresolved') return;
    expect(reply.reason).toContain('delete_everything');
  });

  it('refuses a reply that chose no tool at all', () => {
    expect(validateReply({ answer: 'about 12 kg' }).kind).toBe('unresolved');
  });

  it('refuses a tool call with no arguments object', () => {
    expect(validateReply({ tool: 'shopping_for_range' }).kind).toBe('unresolved');
  });

  it('passes an unresolved reason through rather than inventing a tool', () => {
    // Rule 8 at the conversational layer: asking again is cheap, acting on the
    // wrong job is not.
    const reply = validateReply({ reason: 'Which Saturday did you mean?' });

    expect(reply.kind).toBe('unresolved');
    if (reply.kind !== 'unresolved') return;
    expect(reply.reason).toContain('Saturday');
  });
});

// ---------------------------------------------------------------------------

describe('RULE 7 — the model has no path to commit', () => {
  it('commit is NOT in the registry', () => {
    expect(Object.keys(TOOLS)).not.toContain('commit');
    expect([...TOOL_NAMES] as string[]).not.toContain('commit');
  });

  it('commit is NOT in the schema the model receives', () => {
    expect(toolSchema().map((t) => t.name)).not.toContain('commit');
  });

  it('commit is not offered by the edge function either', () => {
    expect(readFileSync(EDGE, 'utf8')).not.toContain('commit');
  });

  it('THE DISPATCHER REFUSES a commit intent', () => {
    // The mechanism. Names resolve against the registry, so this finds nothing.
    const forged = { tool: 'commit', args: { jobId: 'j1' } } as unknown as Intent;

    expect(runIntent(empty, forged)).toBeNull();
  });

  it('validateReply refuses commit before it ever reaches the dispatcher', () => {
    expect(validateReply({ tool: 'commit', args: { jobId: 'j1' } }).kind).toBe('unresolved');
  });

  it('NOTHING IN THE TOOL PATH IMPORTS commit.ts', () => {
    // The independent check. Even if a name slipped through, the executors have
    // no reference to the module that writes.
    for (const { file, code } of sousFiles()) {
      if (file === 'commit.ts') continue;
      expect(code, `${file} imports commit`).not.toMatch(/from\s+['"]\.\/commit['"]/);
    }
  });

  it('no tool executor writes through a repository', () => {
    const code = strip(readFileSync(join(SOUS_DIR, 'tools.ts'), 'utf8'));

    for (const write of ['.save(', '.create(', '.update(', '.remove(', 'Repository']) {
      expect(code, `tools.ts references ${write}`).not.toContain(write);
    }
  });

  it('the propose tool returns a diff and writes nothing', () => {
    // It is allowed to be the one that touches change — but only as a proposal.
    expect(TOOLS.propose_job_change.kind).toBe('propose');
    expect(TOOLS.propose_job_change.description.toLowerCase()).toContain('does not save');
  });
});

// ---------------------------------------------------------------------------

describe('the API key never reaches the browser', () => {
  it('no file under src/ mentions ANTHROPIC', () => {
    // It lives in a Supabase function secret. Naming it VITE_ANYTHING would make
    // Vite inline it into the bundle — the same trap the integration credentials
    // hit, except this one is billable.
    const srcDir = fileURLToPath(new URL('../../src', import.meta.url));
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.(ts|tsx|css)$/.test(entry.name)) continue;
        // Comments stripped first. The prose explaining WHY the key is not here
        // is not a leak, and an earlier version of this guard flagged exactly
        // that — the same false positive the engine purity guard hit on the
        // sentence describing its own rule.
        if (/ANTHROPIC/i.test(strip(readFileSync(path, 'utf8')))) {
          offenders.push(path.slice(path.indexOf('src/')));
        }
      }
    };
    walk(srcDir);

    expect(offenders).toEqual([]);
  });

  it('the edge function reads it from Deno, not from import.meta.env', () => {
    const code = readFileSync(EDGE, 'utf8');

    expect(code).toContain("Deno.env.get('ANTHROPIC_API_KEY')");
    expect(code).not.toContain('import.meta.env');
    expect(code, 'a VITE_ prefix would inline the key into the bundle').not.toContain(
      'VITE_ANTHROPIC',
    );
  });
});
