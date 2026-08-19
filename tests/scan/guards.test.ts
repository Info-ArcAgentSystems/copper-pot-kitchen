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

    for (const token of ['Math.round', 'Math.ceil', 'Math.floor', '../../../src']) {
      expect(code, `the function uses ${token}`).not.toContain(token);
    }
  });

  it('the edge function is told never to add up a dietary count (Rule 16)', () => {
    const code = readFileSync(EDGE, 'utf8');

    expect(code).toMatch(/do not add/i);
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
