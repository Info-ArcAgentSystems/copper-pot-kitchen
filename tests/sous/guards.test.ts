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
import { buildContext, buildHistory, cleanPreamble, validateReply } from '../../src/sous/askSous';
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
  today: '2026-08-20',
  horizon: '2026-08-27',
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

// ---------------------------------------------------------------------------

/**
 * ROUTING — the surface a "how much X" question lands on.
 *
 * The bug: "how much adobo do I need" returned a {from, to, anomalies} object,
 * which is `what_needs_attention`'s shape. Two causes, and fixing either alone
 * leaves it half-present — the NAME captured "need", and no tool could answer an
 * ingredient-scoped question at all.
 *
 * These guard the surface. Whether the model actually PICKS the right tool needs
 * the deployed function, and is not something a unit test can claim.
 */
describe('routing surface for quantity questions', () => {
  it('has a tool for one ingredient at a time', () => {
    expect(TOOL_NAMES).toContain('how_much_ingredient');
  });

  it('NO TOOL NAME contains "need" — that was the magnet', () => {
    // `what_needs_attention` captured every "how much X do I NEED". Names weigh
    // heavily in tool selection, so this is the guard that stops the collision
    // coming back under another name.
    for (const name of TOOL_NAMES) {
      expect(name, `"${name}" contains "need" and will capture quantity questions`).not.toMatch(
        /need/i,
      );
    }
  });

  it('exactly ONE description claims the "how much" phrasings', () => {
    // Two tools advertising the same phrasing is the ambiguity that caused this.
    const claiming = TOOL_NAMES.filter((n) => /how much|how many/i.test(TOOLS[n].description));

    expect(claiming).toEqual(['how_much_ingredient']);
  });

  it('the quantity tool advertises the phrasings a person actually uses', () => {
    const description = TOOLS.how_much_ingredient.description.toLowerCase();

    for (const phrasing of ['how much', 'how many', 'enough']) {
      expect(description, `does not mention "${phrasing}"`).toContain(phrasing);
    }
  });

  /**
   * A MISSING DATE RANGE IS NOT AN AMBIGUITY.
   *
   * The second half of the same defect. With the routing fixed, "how much adobo do
   * I need" stopped returning anomalies and started returning "could you specify
   * the dates?" — `clarify`, because both its description and the system prompt
   * listed dates beside job and ingredient as something to ask about.
   *
   * That is worse friction than the Shopping screen, which just opens on today to
   * a week ahead. Clarify is for a NAME matching several things, where picking one
   * would be a guess about which thing he meant (Rule 8). A date he did not
   * mention is not a guess.
   */
  it('the quantity tool takes dates as OPTIONAL, so a dateless question is answerable', () => {
    const required = (TOOLS.how_much_ingredient.parameters as { required?: string[] }).required;

    expect(required).toEqual(['ingredient']);
  });

  it('clarify does NOT advertise itself for missing dates', () => {
    // The word "dates" in the list of things clarify handles was enough on its own
    // to capture a dateless quantity question.
    const description = TOOLS.clarify.description;

    expect(description).not.toMatch(/which job, ingredient or dates/i);
    expect(description, 'clarify must say dates are not its job').toMatch(/not for missing dates/i);
  });

  it('the quantity tool tells the model not to ask for dates', () => {
    const description = TOOLS.how_much_ingredient.description.toLowerCase();

    // "Dates are optional" alone read as permission to ask anyway.
    expect(description).toContain('optional');
    expect(description).toContain('never ask him for dates');
  });

  it('the EDGE PROMPT says a missing date range gets a default window, not a question', () => {
    // The client registry and the prompt must agree. The prompt is the stronger
    // instruction of the two, and it was the one telling the model to ask.
    const code = readFileSync(EDGE, 'utf8');

    expect(code, 'the prompt must state that missing dates are not ambiguous').toMatch(
      /MISSING DATES ARE NOT AMBIGUOUS/,
    );
    expect(code, 'the edge copy of clarify must match the registry').toMatch(
      /NOT for missing dates/,
    );
    expect(
      code,
      'the prompt must not list dates as a thing to clarify',
    ).not.toMatch(/which job or which dates are meant/);
  });

  it('the edge function offers it too, with the same phrasings', () => {
    const code = readFileSync(EDGE, 'utf8');

    expect(code).toContain('how_much_ingredient');
    expect(code).toContain('how much');
    expect(code, 'the renamed tool must not linger').not.toContain('what_needs_attention');
  });
});

// ---------------------------------------------------------------------------

/**
 * THE CONVERSATION, and why it cannot become free-form.
 *
 * The model may now write a line of prose and see earlier turns. Neither loosens
 * Rules 2, 3 or 7, because of WHEN it speaks and WHAT it remembers:
 *
 *   it speaks BEFORE the engine runs, so it has no figure to restate
 *   it remembers QUESTIONS, never answers, so no figure re-enters its context
 *
 * Both are asserted here rather than trusted.
 */
describe('conversational path stays grounded', () => {
  it('THE NO-DIGITS RULE: a preamble with a number is dropped', () => {
    // Glue does not need digits. A digit in model prose is either invented or
    // carried from a previous turn, and both are wrong.
    expect(cleanPreamble('Sure, let me check Sunday:')).toBe('Sure, let me check Sunday:');
    expect(cleanPreamble('You need about 3 kg of adobo')).toBeNull();
    expect(cleanPreamble('That is €360 for the weekend')).toBeNull();
    expect(cleanPreamble('Checking the 24th')).toBeNull();
  });

  it('drops the preamble but KEEPS the tool call', () => {
    // Losing a pleasantry costs nothing. Losing the answer would be a worse trade,
    // so a bad preamble degrades the chat rather than breaking it.
    const reply = validateReply({
      tool: 'how_much_ingredient',
      args: { ingredient: 'adobo' },
      preamble: 'You need 3 kg',
    });

    expect(reply.kind).toBe('intent');
    if (reply.kind !== 'intent') return;
    expect(reply.preamble).toBeNull();
    expect(reply.intent.tool).toBe('how_much_ingredient');
  });

  it('keeps a clean preamble', () => {
    const reply = validateReply({
      tool: 'how_much_ingredient',
      args: { ingredient: 'adobo' },
      preamble: 'Let me look:',
    });

    expect(reply.kind).toBe('intent');
    if (reply.kind !== 'intent') return;
    expect(reply.preamble).toBe('Let me look:');
  });

  it('HISTORY CARRIES QUESTIONS, NEVER ANSWERS', () => {
    // The load-bearing line of the whole design. Feeding results back is the
    // obvious way to build a chat and exactly how a grounded assistant starts
    // inventing: once a figure has been in the context, a later turn can restate
    // it, round it, or carry it into a question it does not apply to.
    const history = buildHistory([
      {
        question: 'how much adobo do I need',
        tool: 'how_much_ingredient',
        args: { ingredient: 'adobo' },
        // A result deliberately smuggled onto the turn — it must not survive.
        result: { outstanding: 3.15, packs: 4 },
      } as never,
    ]);

    const serialised = JSON.stringify(history);

    expect(serialised).toContain('how much adobo');
    expect(serialised, 'an engine figure reached the model context').not.toContain('3.15');
    expect(serialised).not.toContain('outstanding');
    expect(serialised).not.toContain('result');
  });

  it('trims the transcript rather than growing it forever', () => {
    const turns = Array.from({ length: 20 }, (_, i) => ({
      question: `q${i}`,
      tool: 'shopping_for_range' as const,
      args: {},
    }));

    expect(buildHistory(turns).length).toBeLessThanOrEqual(6);
  });

  it('a question it cannot map goes to clarify, which returns a QUESTION', () => {
    // "How many grams in a kilo" has no tool. The only thing the model can do with
    // it is hand it back — it is not a source of facts here.
    expect(TOOL_NAMES).toContain('clarify');

    const result = runIntent(empty, {
      tool: 'clarify',
      args: { question: 'Which Saturday did you mean?' },
    });

    expect(result?.kind).toBe('clarify');
    if (result?.kind !== 'clarify') return;
    expect(result.value.question).toBe('Which Saturday did you mean?');
  });

  it('RULE 7 SURVIVES THE CHAT: no turn sequence reaches commit', () => {
    // A multi-turn conversation ending in a proposal is still a proposal. The
    // dispatcher resolves against the registry, so no amount of conversational
    // build-up produces a write.
    for (const tool of ['commit', 'commitProposal', 'save', 'confirm']) {
      expect(validateReply({ tool, args: {} }).kind, `${tool} was accepted`).toBe('unresolved');
      expect(runIntent(empty, { tool, args: {} } as never)).toBeNull();
    }
  });

  it('the conversational path adds no new write to the registry', () => {
    // The chat brought two new tools. Both must be reads.
    expect(TOOLS.how_much_ingredient.kind).toBe('read');
    expect(TOOLS.clarify.kind).toBe('read');
  });
});
