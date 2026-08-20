/**
 * The scanner's structural guarantees.
 *
 * Every one of these was learnt the expensive way on `ask-sous`, and every one
 * is enforced here by inspection rather than by intention. A prompt is a
 * request; these are properties of the repository.
 *
 * They cover the three things that actually went wrong before:
 *
 *   the key leaking into the browser bundle   (a VITE_ prefix would do it)
 *   the CORS preflight answered as 405        (invisible to curl, and it shipped)
 *   the deploy landing on the wrong project   (PCD PROD, because it was linked)
 *
 * Plus the one specific to a scanner: that OCR output cannot reach the database
 * without the owner confirming it (Rules 7 and 8).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateScan } from '../../src/scan/parseImage';
import { reviewJobSheet } from '../../src/scan/jobSheet';

const SCAN_DIR = fileURLToPath(new URL('../../src/scan', import.meta.url));
const EDGE = fileURLToPath(new URL('../../supabase/functions/parse-image/index.ts', import.meta.url));
const PACKAGE = fileURLToPath(new URL('../../package.json', import.meta.url));

const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const scanFiles = (): { file: string; code: string }[] =>
  readdirSync(SCAN_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((file) => ({ file, code: strip(readFileSync(join(SCAN_DIR, file), 'utf8')) }));

const empty = { customers: [], properties: [], recipes: [] };

// ---------------------------------------------------------------------------

describe('RULE 2 — the scanner never calculates', () => {
  it('has files to check', () => {
    expect(scanFiles().length).toBeGreaterThan(0);
  });

  it('the EDGE FUNCTION does no arithmetic and imports no engine code', () => {
    const code = strip(readFileSync(EDGE, 'utf8'));

    for (const token of ['Math.round', 'Math.ceil', 'Math.floor', 'toFixed', '../../../src']) {
      expect(code, `the function uses ${token}`).not.toContain(token);
    }
  });

  it('the edge function is told never to add up a dietary count (Rule 16)', () => {
    const code = readFileSync(EDGE, 'utf8');

    expect(code).toMatch(/do not add/i);
  });
});

/**
 * THE INVOICE DIVISION — the one operation this function must never perform.
 *
 * An invoice reads "5 kg — EUR 45.00" and the useful figure is EUR 9.00 a kilo.
 * Working that out is exactly the sort of helpful arithmetic a model performs and
 * occasionally gets wrong, and a wrong price does not announce itself: it
 * propagates into every recipe using the ingredient and shows up as a plausible
 * margin. So the model reads two printed numbers, and `engine/costing.ts`
 * divides.
 *
 * THE TRAP IN THE OBVIOUS CHECK: a bare search for "/" fires on
 * `https://api.openai.com/v1/chat/completions`, on every comment, and on the
 * regexes. Same shape as `ask-sous` containing `sk-`. So strings and comments are
 * stripped BEFORE looking, and what is looked for is division between operands.
 */
describe('RULE 2 — the invoice division happens in the engine, not the function', () => {
  /**
   * Strip comments and string literals in ONE pass, tracking state.
   *
   * Regex passes are not good enough here and the failure is instructive: a
   * line-comment regex eats `//api.openai.com/...` inside the endpoint URL,
   * leaving an unterminated quote that mis-pairs every string after it. The
   * guard then reported a division inside an HTTP header.
   *
   * A single left-to-right walk cannot make that mistake, because it knows it is
   * inside a string when it meets the `//`.
   */
  const code = (): string => {
    const src = readFileSync(EDGE, 'utf8');
    let out = '';
    let i = 0;

    while (i < src.length) {
      const two = src.slice(i, i + 2);

      if (two === '/*') {
        const end = src.indexOf('*/', i + 2);
        i = end === -1 ? src.length : end + 2;
        out += ' ';
        continue;
      }

      if (two === '//') {
        const end = src.indexOf('\n', i);
        i = end === -1 ? src.length : end;
        out += ' ';
        continue;
      }

      const ch = src[i] as string;
      if (ch === '"' || ch === "'" || ch === '`') {
        i += 1;
        while (i < src.length && src[i] !== ch) {
          i += src[i] === '\\' ? 2 : 1;
        }
        i += 1;
        // A quote-free placeholder: substituting '' would insert the very syntax
        // being stripped.
        out += ' S ';
        continue;
      }

      out += ch;
      i += 1;
    }

    return out;
  };

  it('divides nothing', () => {
    // `x / y` between identifiers, numbers or closing brackets. A URL cannot
    // reach here — it was a string literal and is now ''.
    expect(code(), 'the edge function performs a division').not.toMatch(
      /[\w)\]]\s*\/\s*[\w(]/,
    );
  });

  it('names no price field it could have divided into', () => {
    // The schema has no per-unit or per-pack field. A field a model could fill by
    // dividing is a field it will fill by dividing.
    const raw = readFileSync(EDGE, 'utf8');
    const invoiceTool = raw.slice(raw.indexOf('INVOICE_TOOL'), raw.indexOf('INVOICE_SYSTEM'));

    for (const forbidden of ['pricePerPack', 'pricePerUnit', 'unitPrice', 'perUnit']) {
      expect(invoiceTool, `the invoice schema offers "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it('tells the model in words not to work a price out', () => {
    const raw = readFileSync(EDGE, 'utf8');
    const prompt = raw.slice(raw.indexOf('INVOICE_SYSTEM'), raw.indexOf('const MODES'));

    expect(prompt.toUpperCase()).toContain('DO NOT WORK OUT A PRICE');
  });
});

describe('the three modes', () => {
  const raw = (): string => readFileSync(EDGE, 'utf8');

  it.each(['job_sheet', 'recipe_card', 'invoice'])('offers %s', (mode) => {
    expect(raw()).toContain(`name: '${mode}'`);
  });

  it('REFUSES an unknown mode rather than falling back to a default', () => {
    // Reading an invoice with the job-sheet schema would return a confidently
    // empty sheet — a silent wrong answer rather than a visible failure.
    expect(raw()).toMatch(/mode === undefined/);
    expect(raw()).toContain('is not something this scanner can read');
  });

  it('the recipe card yield is READ, not inferred', () => {
    const raw2 = raw();
    const tool = raw2.slice(raw2.indexOf('RECIPE_CARD_TOOL'), raw2.indexOf('RECIPE_CARD_SYSTEM'));

    expect(tool).toContain('never worked out');
    expect(tool).toContain('do NOT infer it');
  });

  it('the recipe card tool has no separate unquantified list for the model to choose', () => {
    // Which list a component belongs in is decided in `reviewRecipeCard`, from
    // whether the quantity survived. Asking the model to choose would put that
    // judgement against a smudged photograph.
    const raw2 = raw();
    const tool = raw2.slice(raw2.indexOf('RECIPE_CARD_TOOL'), raw2.indexOf('RECIPE_CARD_SYSTEM'));

    expect(tool).not.toContain('unquantified');
  });
});

describe('the API key never reaches the browser', () => {
  it('no file under src/scan names a provider or carries a key', () => {
    const KEY_SHAPE = /\bsk-[A-Za-z0-9-]{8,}/;

    for (const { file, code } of scanFiles()) {
      expect(code.toLowerCase(), `${file} names a provider`).not.toMatch(/openai|anthropic/);
      expect(code, `${file} carries a key-shaped string`).not.toMatch(KEY_SHAPE);
    }
  });

  it('the secret is NOT a VITE_ name — Vite would inline it into the bundle', () => {
    const code = readFileSync(EDGE, 'utf8');

    expect(code).toContain("Deno.env.get('OPENAI_API_KEY')");
    expect(code).not.toContain('VITE_OPENAI');
  });
});

describe('CORS — the browser can actually reach it', () => {
  const code = readFileSync(EDGE, 'utf8');

  it('answers the preflight', () => {
    expect(code).toContain("request.method === 'OPTIONS'");
    expect(code).toContain('access-control-allow-origin');
  });

  it('answers OPTIONS BEFORE the method check', () => {
    // The wrong order looks fine at a glance and fails only in a browser: the
    // preflight falls through to "POST only", fetch REJECTS rather than
    // returning a status, and the owner is told the function is unreachable.
    // curl does not enforce CORS, which is why this shipped once already.
    expect(code.indexOf("=== 'OPTIONS'")).toBeLessThan(code.indexOf("!== 'POST'"));
  });

  it('carries the headers on the ERROR paths too', () => {
    // A 500 with no allow-origin is exactly as invisible as a 405.
    expect(code).toMatch(/headers:\s*\{\s*'content-type': 'application\/json', \.\.\.CORS \}/);
  });
});

describe('the deploy cannot default to the wrong project', () => {
  const scripts = JSON.parse(readFileSync(PACKAGE, 'utf8')).scripts as Record<string, string>;

  it('has a pinned deploy script for parse-image', () => {
    // The first ask-sous deploy went to PCD PROD because that project was
    // linked on this machine. `project_id` in config.toml does not prevent it —
    // the flag is the only reliable guard.
    expect(scripts['supabase:deploy:parse-image']).toContain('parse-image');
    expect(scripts['supabase:deploy:parse-image']).toContain(
      '--project-ref vhzpwdzrlrcfhxrjawym',
    );
  });

  it('every supabase script names the ref explicitly', () => {
    for (const [name, command] of Object.entries(scripts)) {
      if (!name.startsWith('supabase:')) continue;
      expect(command, `${name} could deploy to whatever is linked`).toContain(
        '--project-ref vhzpwdzrlrcfhxrjawym',
      );
    }
  });
});

describe('RULE 7 — OCR cannot reach the database on its own', () => {
  it('neither the read nor the review path imports a repository', () => {
    for (const { file, code } of scanFiles()) {
      if (file === 'commit.ts') continue;
      expect(code, `${file} can write`).not.toContain('repositories');
    }
  });

  it('the commit path REFUSES a review with anything outstanding, WITHOUT touching the db', async () => {
    const { commitScannedJob } = await import('../../src/scan/commit');

    const review = reviewJobSheet(
      {
        customer: null, property: null, serviceDate: null, serviceTime: null,
        serviceType: null, guests: null, guestsWording: null, dishes: [],
        dietaries: [], notes: null, uncertain: [],
      },
      empty,
    );

    // A db that RECORDS being reached rather than one that throws.
    //
    // This distinction is the whole test. Passing a null db and asserting
    // `ok === false` looks equivalent and is not: the write would still be
    // attempted, throw, and be caught into the same `{ok: false}` — so the
    // assertion passes against a commit path with its gap check deleted.
    // Verified by deleting it, watching this stay green, and rewriting it.
    let reached = false;
    const db = new Proxy(
      {},
      {
        get() {
          reached = true;
          throw new Error('the database was reached for a review with gaps');
        },
      },
    ) as Parameters<typeof commitScannedJob>[0];

    const result = await commitScannedJob(db, review);

    expect(reached, 'a review with gaps reached the database').toBe(false);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('confirming');
  });

  it('refuses an object that never came from the review path', async () => {
    const { commitScannedJob } = await import('../../src/scan/commit');
    const db = null as unknown as Parameters<typeof commitScannedJob>[0];

    const result = await commitScannedJob(db, { readyToSave: true } as never);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('not a review');
  });

  it('a saved job never claims the guest count was confirmed', async () => {
    // He confirmed that the SCAN is a fair reading of the sheet. That is not the
    // same as confirming the sheet was right, and conflating them would tick a
    // readiness box nobody ticked.
    const { jobFromReview } = await import('../../src/scan/commit');

    const review = reviewJobSheet(
      {
        customer: null, property: null, serviceDate: '2026-08-22', serviceTime: '18:00',
        serviceType: 'Buffet', guests: 24, guestsWording: null, dishes: [],
        dietaries: [], notes: null, uncertain: [],
      },
      empty,
    );

    expect(jobFromReview(review).guestsConfirmed).toBe(false);
  });

  it('a saved job carries no dietaries, because scanned wording is not a count', async () => {
    const { jobFromReview } = await import('../../src/scan/commit');

    const review = reviewJobSheet(
      {
        customer: null, property: null, serviceDate: null, serviceTime: null,
        serviceType: null, guests: null, guestsWording: null, dishes: [],
        dietaries: [{ wording: '3 vegetarians' }], notes: null, uncertain: [],
      },
      empty,
    );

    // Rule 16: allocating those guests is a decision, made on the job screen.
    expect(jobFromReview(review).dietaries).toEqual([]);
  });
});

describe('RULE 8 — a malformed reply becomes a gap, never a value', () => {
  it('refuses a reply that is not a read', () => {
    expect(validateScan(null).kind).toBe('unresolved');
    expect(validateScan({ reason: 'no' }).kind).toBe('unresolved');
  });

  it('drops a guest count that is not a whole number', () => {
    // `Number("a few")` is NaN, and a NaN reaching the engine is a silent zero.
    for (const bad of ['24', 'a few', 24.5, -3, null]) {
      const reply = validateScan({ read: { guests: bad } });

      expect(reply.kind).toBe('read');
      if (reply.kind !== 'read') return;
      expect(reply.read.guests, `${JSON.stringify(bad)} became a count`).toBeNull();
    }
  });

  it('keeps a plain whole number', () => {
    const reply = validateScan({ read: { guests: 24 } });

    expect(reply.kind).toBe('read');
    if (reply.kind !== 'read') return;
    expect(reply.read.guests).toBe(24);
  });

  it('an absent field is null, not undefined — "not on the sheet" is a statement', () => {
    const reply = validateScan({ read: {} });

    expect(reply.kind).toBe('read');
    if (reply.kind !== 'read') return;
    expect(reply.read.customer).toBeNull();
    expect(reply.read.serviceDate).toBeNull();
    expect(reply.read.dishes).toEqual([]);
  });
});
