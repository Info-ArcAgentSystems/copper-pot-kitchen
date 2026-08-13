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
    //
    // Scraped from OpenAI's shape, where name and description sit under
    // `function: { ... }`. The pattern is provider-specific by necessity; what it
    // GUARDS is not, so it must keep biting after the swap — verified by renaming
    // a tool in the function and watching this go red.
    const code = readFileSync(EDGE, 'utf8');
    const offered = [...code.matchAll(/name: '([a-z_]+)',\s*\n\s*description/g)].map((m) => m[1]);

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

/**
 * CORS — the failure mode that shipped, and that no test caught.
 *
 * The first deploy answered the browser's preflight with 405 and no allow-origin,
 * so `fetch` REJECTED and the client reported "could not reach Sous" — a
 * misleading diagnosis for a function that was reachable and healthy.
 *
 * Nothing caught it because curl does not enforce CORS and every other test here
 * is offline. Source inspection is the only thing that can, so these are blunt
 * and they check ORDER as well as presence: an OPTIONS branch that sits after the
 * method check is the exact bug, and it looks fine at a glance.
 */
describe('CORS — the browser can actually reach it', () => {
  const code = readFileSync(EDGE, 'utf8');

  it('answers the preflight', () => {
    expect(code, 'no OPTIONS branch — the preflight will fall through').toContain(
      "request.method === 'OPTIONS'",
    );
  });

  it('answers it BEFORE the method check, which is where the bug was', () => {
    // `if (method !== 'POST') return 405` swallows the preflight when it comes
    // first. Presence alone would pass with the branch in the wrong place.
    const options = code.indexOf("request.method === 'OPTIONS'");
    const post = code.indexOf("request.method !== 'POST'");

    expect(options).toBeGreaterThan(-1);
    expect(post).toBeGreaterThan(-1);
    expect(options, 'the OPTIONS branch must come first').toBeLessThan(post);
  });

  it('sets an allow-origin header', () => {
    expect(code).toContain('access-control-allow-origin');
  });

  it('puts CORS on EVERY response, including the error paths', () => {
    // A 500 with no allow-origin is exactly as invisible to the browser as the
    // 405 was, so a real failure would present as the same wrong diagnosis. The
    // shared json helper is what makes that automatic.
    const helper = code.slice(code.indexOf('const json ='), code.indexOf('const json =') + 400);

    expect(helper, 'the json helper must spread the CORS headers').toContain('CORS');
  });

  it('allows the headers the client actually sends', () => {
    const allowed = /access-control-allow-headers':\s*'([^']+)'/.exec(code)?.[1] ?? '';

    expect(allowed).toContain('authorization');
    expect(allowed).toContain('content-type');
  });
});

describe('the API key never reaches the browser', () => {
  /**
   * A real key, not a vendor name.
   *
   * The obvious check — "does any file contain `sk-`" — fires on the function's
   * own name: **ask-sous contains sk-**. So the pattern requires a long token
   * after the prefix, which matches a key and not a filename. Both directions are
   * verified: a planted key fails, and a repo full of `ask-sous` passes.
   */
  const KEY_SHAPE = /\bsk-[A-Za-z0-9_-]{20,}/;

  it('no file under src/ mentions a provider key variable', () => {
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
        // Vendor-agnostic: naming both providers means switching again cannot
        // quietly disarm this guard.
        const code = strip(readFileSync(path, 'utf8'));
        if (/OPENAI|ANTHROPIC/i.test(code) || KEY_SHAPE.test(code)) {
          offenders.push(path.slice(path.indexOf('src/')));
        }
      }
    };
    walk(srcDir);

    expect(offenders).toEqual([]);
  });

  it('the edge function reads it from Deno, not from import.meta.env', () => {
    const code = readFileSync(EDGE, 'utf8');

    expect(code).toContain("Deno.env.get('OPENAI_API_KEY')");
    expect(code).not.toContain('import.meta.env');
    expect(code, 'a VITE_ prefix would inline the key into the bundle').not.toMatch(
      /VITE_(OPENAI|ANTHROPIC)/,
    );
  });

  it('no literal key is committed anywhere in the repo source', () => {
    // The edge function included. A key pasted in while debugging is the likeliest
    // way one ever lands in git.
    for (const path of [EDGE, join(SOUS_DIR, 'askSous.ts')]) {
      expect(KEY_SHAPE.test(readFileSync(path, 'utf8')), `${path} contains a key`).toBe(false);
    }
  });

  it('THE TRAP: the key pattern does not fire on "ask-sous"', () => {
    // `ask-sous` contains `sk-`. A naive check would flag every file naming the
    // function, and the usual response to a guard that cries wolf is to delete it.
    expect(KEY_SHAPE.test('supabase/functions/ask-sous/index.ts')).toBe(false);
    expect(KEY_SHAPE.test('npm run supabase:deploy:sous')).toBe(false);

    // And it does catch the real shape, both vendors.
    expect(KEY_SHAPE.test('sk-proj-AbCdEf0123456789AbCdEf0123456789')).toBe(true);
    expect(KEY_SHAPE.test('sk-ant-api03-AbCdEf0123456789AbCdEf')).toBe(true);
  });
});
