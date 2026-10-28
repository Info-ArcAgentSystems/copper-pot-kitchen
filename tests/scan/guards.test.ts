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
import type { KitchenId, RecipeId } from '../../src/engine/types';

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

  it('the commit path REFUSES a draft with anything outstanding, WITHOUT touching the db', async () => {
    const { commitScannedDraft } = await import('../../src/scan/commit');
    const { creationsFromDraft, draftFromReview, draftGaps } = await import(
      '../../src/scan/jobDraft'
    );

    /*
     * THE DRAFT MATTERS AS MUCH AS THE DB DOES.
     *
     * An all-null sheet has gaps and NOTHING TO CREATE, so deleting the gap
     * check leaves the database untouched anyway — `draftToJob` refuses a
     * moment later and the test passes for the wrong reason. Verified by
     * deleting the check and watching this stay green, which is the second time
     * this same assertion has been fooled one layer out.
     *
     * So: gaps AND a customer the sheet named that he does not have. Now
     * skipping the check writes a real customer row for a sheet he never
     * confirmed — an orphan record created from an unread guest count — and
     * `reached` catches it.
     */
    const draft = draftFromReview(
      reviewJobSheet(
        {
          customer: 'Laura', property: null, serviceDate: null, serviceTime: null,
          serviceType: null, guests: null, guestsWording: null, dishes: [],
          dietaries: [], notes: null, uncertain: [],
        },
        empty,
      ),
    );

    // Gaps to settle, and something creatable sitting behind them.
    expect(draftGaps(draft).length).toBeGreaterThan(0);
    expect(creationsFromDraft(draft).customers).toEqual(['Laura']);

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
          throw new Error('the database was reached for a draft with gaps');
        },
      },
    ) as Parameters<typeof commitScannedDraft>[0];

    const result = await commitScannedDraft(db, draft, 'k1' as KitchenId);

    expect(reached, 'a draft with gaps reached the database').toBe(false);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('confirming');
  });

  it('a saved job never claims the guest count was confirmed', async () => {
    // He confirmed that the SCAN is a fair reading of the sheet. That is not the
    // same as confirming the sheet was right, and conflating them would tick a
    // readiness box nobody ticked.
    const { draftFromReview, draftToJob } = await import('../../src/scan/jobDraft');

    const draft = draftFromReview(
      reviewJobSheet(
        {
          customer: null, property: null, serviceDate: '2026-08-22', serviceTime: '18:00',
          serviceType: 'Buffet', guests: 24, guestsWording: null, dishes: ['x'],
          dietaries: [], notes: null, uncertain: [],
        },
        empty,
      ),
    );

    const built = draftToJob(draft, {
      customerId: null,
      propertyId: null,
      recipeIds: new Map([['x', 'r1' as RecipeId]]),
    });

    expect(built.ok).toBe(true);
    expect(built.ok && built.job.guestsConfirmed).toBe(false);
  });

  /*
   * THE REPLACED GUARANTEE. This read:
   *
   *   "a saved job carries no dietaries, because scanned wording is not a
   *    count"
   *
   * True, and it threw the wording away — and because `reviewJobSheet` raises a
   * gap for any dietary at all, the sheet could not be saved either, so the
   * assertion was describing a path nothing could reach. It is replaced, not
   * loosened: the wording survives VERBATIM as an unresolved requirement, there
   * is still no count anywhere, and the three fields a photograph cannot supply
   * are still never invented.
   */
  it('a saved job carries the scanned wording VERBATIM, and still no count', async () => {
    const { draftFromReview, draftToJob } = await import('../../src/scan/jobDraft');

    const draft = draftFromReview(
      reviewJobSheet(
        {
          customer: null, property: null, serviceDate: '2026-08-22', serviceTime: '18:00',
          serviceType: 'Buffet', guests: 24, guestsWording: null, dishes: ['x'],
          dietaries: [{ wording: '3 vegetarians' }], notes: null, uncertain: [],
        },
        empty,
      ),
    );

    // Rule 9: none of the three was read off the sheet, so he sets them.
    expect(draft.dietaries[0]?.dietType).toBe('');
    expect(draft.dietaries[0]?.severity).toBeNull();
    expect(draft.dietaries[0]?.excludesMeat).toBe(false);

    const built = draftToJob(
      {
        ...draft,
        dietaries: [
          { wording: '3 vegetarians', dietType: 'vegetarian', severity: 'moderate', excludesMeat: true },
        ],
      },
      { customerId: null, propertyId: null, recipeIds: new Map([['x', 'r1' as RecipeId]]) },
    );

    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const dietary = built.job.dietaries[0];
    expect(built.job.dietaries).toHaveLength(1);
    expect(dietary?.kind).toBe('unresolved');
    expect(dietary?.kind === 'unresolved' && dietary.originalWording).toBe('3 vegetarians');
    // Rule 16 — ONE row holding the words, and no field that could hold the 3.
    expect(Object.values(dietary ?? {}).some((v) => typeof v === 'number')).toBe(false);
  });

  it('a saved job cannot carry a dietary he never classified (Rule 9)', async () => {
    const { draftFromReview, draftToJob } = await import('../../src/scan/jobDraft');

    const draft = draftFromReview(
      reviewJobSheet(
        {
          customer: null, property: null, serviceDate: '2026-08-22', serviceTime: '18:00',
          serviceType: 'Buffet', guests: 24, guestsWording: null, dishes: ['x'],
          dietaries: [{ wording: 'severe nut allergy' }], notes: null, uncertain: [],
        },
        empty,
      ),
    );

    // The sheet says "severe" in so many words. That is still not the system's
    // decision to make, so the draft is refused rather than classified.
    const built = draftToJob(draft, {
      customerId: null,
      propertyId: null,
      recipeIds: new Map([['x', 'r1' as RecipeId]]),
    });

    expect(built.ok).toBe(false);
  });

  /*
   * THE OTHER REPLACED GUARANTEE. `commit.ts` said it refuses to create a
   * customer, property or recipe, because "a name flagged new is the owner's to
   * add, deliberately, somewhere else". Somewhere else was the whole problem.
   *
   * Creation is now allowed, and narrowly: ONLY a name the camera read cleanly
   * and could not find. The part Rule 8 cares about is untouched, and these two
   * assertions are what hold it there.
   */
  it('creates ONLY a name read cleanly and not found', async () => {
    const { draftFromReview, creationsFromDraft } = await import('../../src/scan/jobDraft');

    const draft = draftFromReview(
      reviewJobSheet(
        {
          customer: 'Laura', property: null, serviceDate: null, serviceTime: null,
          serviceType: null, guests: null, guestsWording: null, dishes: [],
          dietaries: [], notes: null, uncertain: [],
        },
        empty,
      ),
    );

    expect(creationsFromDraft(draft).customers).toEqual(['Laura']);
  });

  it('NEVER creates a name that matched more than one record, nor one it could not read', async () => {
    const { draftFromReview, creationsFromDraft } = await import('../../src/scan/jobDraft');

    const duplicated = {
      ...empty,
      customers: [
        { id: 'c1', kitchenId: 'k1', name: "O'Brien", phone: null, email: null, clientGroup: null, notes: null },
        { id: 'c2', kitchenId: 'k1', name: 'O Brien', phone: null, email: null, clientGroup: null, notes: null },
      ],
    } as unknown as Parameters<typeof reviewJobSheet>[1];

    // Ambiguous: two of his records match. Creating a THIRD is the worst of the
    // three possible wrong answers.
    const ambiguous = draftFromReview(
      reviewJobSheet(
        {
          customer: "O'Brien", property: null, serviceDate: null, serviceTime: null,
          serviceType: null, guests: null, guestsWording: null, dishes: [],
          dietaries: [], notes: null, uncertain: [],
        },
        duplicated,
      ),
    );

    expect(creationsFromDraft(ambiguous).customers).toEqual([]);

    // Unread: there is nothing to create. An empty name is not a new customer.
    const unread = draftFromReview(
      reviewJobSheet(
        {
          customer: null, property: null, serviceDate: null, serviceTime: null,
          serviceType: null, guests: null, guestsWording: null, dishes: [],
          dietaries: [], notes: null, uncertain: [],
        },
        empty,
      ),
    );

    expect(creationsFromDraft(unread).customers).toEqual([]);
  });

  it('there is only ONE way to commit a scanned sheet', () => {
    /*
     * Rule 5. `jobFromReview` and `commitScannedJob` were the read-only path and
     * are gone: two ways to turn a sheet into a job would eventually disagree
     * about what a scan saves, and the dead one would still read as a live
     * guarantee.
     */
    const commit = scanFiles().find((f) => f.file === 'commit.ts');

    expect(commit).toBeDefined();
    expect(commit?.code, 'the read-only commit path is back').not.toContain('commitScannedJob');
    expect(commit?.code, 'the read-only job builder is back').not.toContain('jobFromReview');
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

/**
 * `find-recipes` — the search function, and the two things it must never offer.
 *
 * The schema is where a temptation becomes a capability. A field the model could
 * fill by computing is a field it will fill by computing, and the invoice mode
 * already proved that: asking for cents inside a prompt saying "you do not
 * calculate" produced exactly the calculation it forbade.
 */
describe('find-recipes offers the model nothing to compute with', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../../supabase/functions/find-recipes/index.ts', import.meta.url)),
    'utf8',
  );

  it.each(['guests', 'scaleTo', 'targetPortions', 'portionsWanted', 'servings_needed'])(
    'has no %s field for a scaled quantity',
    (field) => {
      expect(source).not.toContain(field);
    },
  );

  it('REQUIRES a source URL on every candidate', () => {
    // The one guard between "found on a page" and "recalled from memory". The
    // client refuses a candidate without one; this makes the schema ask for it
    // too, so the refusal is not the only thing standing there.
    expect(source).toContain("'sourceUrl'");
    expect(source).toMatch(/required:\s*\[[^\]]*'sourceUrl'/);
  });

  it('does not ask for the method text', () => {
    // Ingredient lists and quantities are facts. Instructions are someone's
    // writing, and copying them into a private database is reproduction. The
    // owner gets the link instead.
    const schema = source.slice(source.indexOf('const FIND_TOOL'), source.indexOf('const SYSTEM'));

    expect(schema).not.toContain('method');
    expect(schema).not.toContain('instructions');
    expect(schema).not.toContain('steps');
  });

  it('answers the CORS preflight before the method check', () => {
    // The failure that broke the first ask-sous deploy, invisible to curl.
    const preflight = source.indexOf("request.method === 'OPTIONS'");
    const methodCheck = source.indexOf("request.method !== 'POST'");

    expect(preflight).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(methodCheck);
  });

  it('does no arithmetic of its own', () => {
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    for (const token of ['Math.round', 'Math.ceil', 'Math.floor', '* ', ' / ']) {
      expect(stripped, `find-recipes uses ${token}`).not.toContain(token);
    }
  });
});

/**
 * THE DATED DEPENDENCY.
 *
 * `find-recipes` is the one file in this repo whose correctness expires. The
 * first version named `gpt-4o-search-preview`, which was correct when it was
 * written and SHUT DOWN on 2026-07-23 — so the feature shipped broken and
 * returned 404 on every call, a fortnight after the model went away.
 *
 * What a test can do here is narrow. It cannot prove OpenAI still serves a model;
 * only a live call can, and a unit suite must not make one. What it CAN do is
 * make the string a deliberate, visible choice rather than something that drifts:
 * a change here fails a test and has to be argued for in review, and the
 * "preview" ban stops the same class of model being reached for again.
 *
 * The rest is a calendar problem, and ARCHITECTURE.md says when to re-check.
 */
describe('find-recipes names a model on purpose', () => {
  /*
   * COMMENTS STRIPPED FIRST. The file's header explains why it left
   * `/v1/chat/completions` and why it does not use `web_search_preview`, so a
   * check over the raw text fires on the very prose that documents the fix — the
   * same false positive as a guard matching "window" inside `windowFrom`. The
   * comments are worth more than the convenience of a substring search.
   */
  const source = readFileSync(
    fileURLToPath(new URL('../../supabase/functions/find-recipes/index.ts', import.meta.url)),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Only line comments that START a line. A bare `\/\/.*$` eats the `//` inside
    // `https://api.openai.com/...` and deletes the very endpoint being checked —
    // the same trap that broke the string-stripper in the August guard work.
    .replace(/^\s*\/\/.*$/gm, '');

  it('pins the model string', () => {
    expect(source).toContain("const MODEL = 'gpt-5.6-terra'");
  });

  it('NEVER names a preview-class model', () => {
    // These are retired on short notice — OpenAI's own docs say as little as two
    // weeks. One already took this feature down.
    const model = /const MODEL = '([^']+)'/.exec(source)?.[1] ?? '';

    expect(model).not.toContain('preview');
  });

  it('uses the Responses endpoint, which is where hosted search lives', () => {
    expect(source).toContain('https://api.openai.com/v1/responses');
    expect(source).not.toContain('/v1/chat/completions');
  });

  it('asks for web_search, not the legacy web_search_preview', () => {
    // `web_search_preview` remains for legacy callers and lacks newer controls.
    expect(source).toContain("type: 'web_search'");
    expect(source).not.toContain('web_search_preview');
  });
});

/**
 * NEVER SWALLOW AN UPSTREAM ERROR AGAIN.
 *
 * Twice now a 404 from OpenAI reached the owner as a status code with no body:
 * `parse-image` in August, `find-recipes` in the same month. Both messages were
 * true and both were useless, because a status alone does not distinguish a
 * retired model from a revoked key from a malformed payload. The second diagnosis
 * had to be done from documentation because the answer had been read and thrown
 * away.
 */
describe('every function surfaces what the upstream actually said', () => {
  it.each(['parse-image', 'ask-sous', 'find-recipes'])('%s reports the error body', (fn) => {
    const source = readFileSync(
      fileURLToPath(new URL(`../../supabase/functions/${fn}/index.ts`, import.meta.url)),
      'utf8',
    );

    // Read the body, cap it, log it, and return it. All four, or the next
    // diagnosis is another documentation trawl.
    expect(source, `${fn} does not read the error body`).toMatch(/upstream\.text\(\)/);
    expect(source, `${fn} does not truncate it`).toMatch(/\.slice\(0, \d+\)/);
    expect(source, `${fn} does not log it`).toContain('console.error');
    expect(source, `${fn} does not return it`).toContain('It said:');
  });
});

/**
 * THE SCANNERS REACH THE CAMERA **AND** THE GALLERY.
 *
 * Two live failures got here, and they are opposites — which is why this guard
 * asserts a pair rather than an absence.
 *
 * FIRST: `capture="environment"` was on the input. It does not mean "prefer the
 * camera", it means "this control IS a camera capture", so both mobile browsers
 * skipped the picker. Gallery, Files, iCloud and Drive all disappeared, and the
 * button saying "Take or choose a photo" could only take.
 *
 * SECOND: removing it fixed the gallery and broke the camera. Chrome on Android
 * 13+ routes a bare `accept="image/*"` to the SYSTEM PHOTO PICKER — Photos and
 * Albums, no camera button anywhere. Camera-only became gallery-only, which was
 * no better and arguably worse: the job sheet scanner exists to be used standing
 * over a sheet of paper.
 *
 * There is no attribute combination that reliably offers both on Android, so the
 * app makes the choice explicit with two controls. What has to hold:
 *
 *   exactly one input carries `capture`      — the camera route
 *   exactly one input carries no `capture`   — the gallery route
 *   both filter to images
 *
 * Losing either is a regression, and they fail in opposite directions, so a
 * guard that only forbade `capture` would have passed the second outage
 * cheerfully.
 */
describe('a scanner can reach the camera and the gallery', () => {
  const SCANNERS = ['ScanJobSheet', 'ScanRecipeCard', 'ScanInvoice', 'ScanMenu'] as const;

  const scanDir = fileURLToPath(new URL('../../src/features/scan', import.meta.url));
  const sourceOf = (name: string): string => readFileSync(join(scanDir, `${name}.tsx`), 'utf8');
  const shared = readFileSync(join(scanDir, 'PhotoSource.tsx'), 'utf8');
  const gate = readFileSync(join(scanDir, 'PhotoGate.tsx'), 'utf8');

  /*
   * A SCANNER NOW REACHES THE CONTROL THROUGH `PhotoGate`, not directly.
   *
   * The scanners used to render `<PhotoSource disabled={busy || !ready} />`
   * themselves, where `ready` was a boolean over two or three repository reads —
   * false while loading and false FOREVER after a failed one. A failure left the
   * buttons greyed with no message and the reason discarded. `PhotoGate` owns
   * the control and the words for every non-ready state, and
   * `tests/scan/photoGate.test.ts` is the guard for that.
   *
   * This guard is unchanged in what it protects: ONE definition of the two photo
   * routes, with no scanner rolling its own file input. It follows the extra hop,
   * and asserts the hop actually arrives.
   */
  /** Every `<input type="file" ... />` in a file, as its own text. */
  const fileInputs = (source: string): string[] =>
    [...source.matchAll(/<input\b[^>]*type="file"[^>]*\/>/gs)].map((m) => m[0]);

  it('covers every scanner, checked against the source tree', () => {
    // A fifth scanner that never appears in this list would be left broken while
    // the suite stayed green, so the list is derived rather than trusted.
    const rendering = readdirSync(scanDir)
      .filter((f) => f.endsWith('.tsx') && f !== 'PhotoSource.tsx' && f !== 'PhotoGate.tsx')
      .filter((f) => readFileSync(join(scanDir, f), 'utf8').includes('<PhotoGate'))
      .map((f) => f.replace('.tsx', ''))
      .sort();

    expect(rendering).toEqual([...SCANNERS].sort());
  });

  it('the gate reaches the shared control, so the hop is not a dead end', () => {
    expect(gate).toContain('<PhotoSource');
    expect(fileInputs(gate), 'the gate rolls its own file input').toHaveLength(0);
  });

  it.each(SCANNERS)('%s goes through the shared control', (name) => {
    // One definition, so the next browser change is fixed once rather than in
    // four places with one forgotten.
    expect(sourceOf(name)).toContain('<PhotoGate');
    expect(fileInputs(sourceOf(name)), 'a scanner rolls its own file input').toHaveLength(0);
  });

  it('offers exactly two routes', () => {
    expect(fileInputs(shared)).toHaveLength(2);
  });

  it('ONE route goes to the camera', () => {
    const withCapture = fileInputs(shared).filter((i) => /\scapture=/.test(i));

    expect(withCapture, 'no input opens the camera — Android will show only the gallery').toHaveLength(1);
    expect(withCapture[0]).toContain('capture="environment"');
  });

  it('ONE route reaches the gallery', () => {
    const withoutCapture = fileInputs(shared).filter((i) => !/\scapture=/.test(i));

    expect(
      withoutCapture,
      'every input forces the camera — the gallery is unreachable',
    ).toHaveLength(1);
  });

  it('both routes filter to images', () => {
    for (const input of fileInputs(shared)) {
      expect(input).toContain('accept="image/*"');
    }
  });

  it('names both routes plainly', () => {
    // "Take or choose a photo" described one control that did both. Two controls
    // have to say which is which.
    expect(shared).toContain('Take a photo');
    expect(shared).toContain('Choose a file');
  });

  it('THE CAMERA BUTTON IS GATED ON A DEVICE THAT HAS ONE', () => {
    /*
     * `capture` is not implemented on desktop — `'capture' in
     * HTMLInputElement.prototype` is false there — so both buttons would open
     * the identical file dialog and "Take a photo" would be a label describing
     * something that cannot happen. A file input reaches no webcam on any
     * platform; that needs getUserMedia, which is not wired here.
     *
     * So the camera input renders only behind the pointer check. Without this
     * the honest-on-mobile control becomes a lie on a laptop.
     */
    expect(shared).toContain("matchMedia('(pointer: coarse)')");
    expect(shared, 'the camera input is not gated').toMatch(/hasCamera && \(/);
  });

  it('the file route is NEVER gated — it works everywhere', () => {
    /*
     * Whatever the device, one route must always be present, or a desktop with
     * no touch input has no way to pick a photo at all.
     *
     * COUNTED, not matched. The first version of this test located "the gated
     * block" with a non-greedy regex and asserted it did not contain the file
     * button — which passed happily when the file button was wrapped in a
     * SECOND gate, because the regex kept matching the first one. Gating
     * everything is exactly the failure that most needs catching, and the guard
     * waved it through. Counting the gates cannot be fooled that way.
     */
    const gates = [...shared.matchAll(/hasCamera && \(/g)];

    expect(gates, 'more than one pointer gate — something else was hidden too').toHaveLength(1);

    const camera = /hasCamera && \(([\s\S]*?)\n      \)\}/.exec(shared)?.[1] ?? '';
    expect(camera, 'the one gate does not wrap the camera input').toContain(
      'capture="environment"',
    );
  });

  it('NEVER nests the input inside its label — that fires the picker twice', () => {
    /*
     * THE BUG, found live by the owner: choosing a file opened the native
     * picker twice.
     *
     * Not a stray `input.click()` — there is none. `<label><input/>…</label>`
     * is the ordinary idiom and it fires twice on its own. Instrumented on a
     * copy of this control:
     *
     *   label click   target=SPAN     the real tap
     *   input click   trusted         the label forwards activation
     *   label click   target=INPUT    the forwarded click BUBBLES BACK UP
     *                                 through the label, because the input is
     *                                 inside it
     *
     * The third event is the second picker. Pairing by `for`/`id` with the
     * input OUTSIDE the label removes it; measured on the same page, the third
     * line is simply gone.
     *
     * Asserted structurally rather than by counting pickers, because a picker
     * opening is not observable from a test. What is observable is the shape
     * that causes it.
     */
    /*
     * ANCHORED ON THE CLOSING TAG. A bare `[\s\S]*?` between the two spans
     * right across `</label>`, so it matches a label followed by any LATER
     * sibling input — which is the fixed arrangement, and the first version of
     * this assertion failed on it. The tempered match stops at the close.
     */
    const nested = /<label\b[^>]*>(?:(?!<\/label>)[\s\S])*?<input\b[^>]*type="file"/.exec(
      shared,
    );

    expect(nested, 'a file input is inside a label again').toBeNull();

    // And every input is still paired to a label, or the control is unlabelled
    // and the 44px target does nothing.
    for (const input of fileInputs(shared)) {
      expect(input, 'a file input has no id to pair a label to').toMatch(/id=\{/);
    }
    expect([...shared.matchAll(/htmlFor=\{/g)], 'a label lost its pairing').toHaveLength(
      fileInputs(shared).length,
    );
  });

  it('keeps a visible focus ring now that the input is outside the label', () => {
    /*
     * `:focus-within` stopped working the moment the input moved out, and the
     * input itself is clipped to 1x1 — so without a replacement the keyboard
     * lands on an invisible control with no ring anywhere. The input is
     * rendered BEFORE its label precisely so an adjacent sibling can carry it.
     */
    const css = readFileSync(
      fileURLToPath(new URL('../../src/styles/app.css', import.meta.url)),
      'utf8',
    );

    expect(css).toMatch(/\.scan-button-input:focus-visible \+ \.scan-button/);
  });

  it('clears the input so the same photo can be picked twice', () => {
    // After a failed scan, re-choosing the identical file is the obvious next
    // move — and without this it fires no change event at all.
    expect(shared).toMatch(/\.value = ''/);
  });
});
