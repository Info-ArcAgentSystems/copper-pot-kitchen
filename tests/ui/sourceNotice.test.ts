/**
 * NO SCREEN GOES QUIET WHEN A READ FAILS.
 *
 * Ten screens wait on repository reads before they can show anything, and every
 * one of them handled a failed read differently and wrongly:
 *
 *   four scanners          greyed the photo buttons with NO message at all
 *   the dashboard          said "Loading…" FOREVER — the app's opening screen,
 *                          six reads, and a word that was not true
 *   shopping, prep,        "Could not load: Failed to fetch" — naming neither
 *   packing, money         which of their five or six reads failed nor what it
 *                          cost, and offering no way to try again
 *   ask sous               disabled the Ask button with no message
 *
 * The four middle ones also hunted the failure by hand — `.find(s => s.status
 * === 'error')` over a list of states maintained BESIDE a list of the same
 * states in `ready`. Two lists to keep in step, and a seventh read added to one
 * and forgotten in the other shows up as a permanent "Working it out…", which
 * is the original defect with extra steps.
 *
 * So there is now one decision (`sourceState`) and one renderer
 * (`SourceNotice`), and this guard asserts the shape that keeps it that way:
 *
 *   every gating screen declares `sources`, with a why and a reload per read
 *   as many sources as it has reads      — none silently left out of the gate
 *   it decides through sourceState       — not a boolean of its own
 *   it renders SourceNotice              — not words of its own
 *   nobody hunts the failure by hand     — the lists cannot drift apart
 *   SourceNotice says all three things   — which, why, and what it said
 *
 * VERIFIED BY INVERSION, including on the guard itself: an earlier version of
 * the scanner guard asserted a branch's condition appeared SOMEWHERE in the
 * file and passed happily against `{false && …}`. Assertions on a conditional
 * are anchored on the opening brace for that reason.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../src/${path}`, import.meta.url)), 'utf8');

const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const code = (path: string): string => strip(src(path));

/**
 * Every screen whose main view waits on repository reads, and how many reads it
 * waits on. The count is the point: it is checked against the `useAsync` calls
 * in the file, so a read added to the screen and forgotten in the gate fails
 * here rather than in a supermarket.
 *
 * `title` is the heading the notice carries when it REPLACES the screen.
 * `inline` means the notice sits inside a screen that still has something worth
 * showing — the scanners keep their instructions and Ask Sous keeps its
 * transcript.
 */
const GATED = [
  { file: 'features/dashboard/Dashboard.tsx', reads: 6, title: 'Today', gate: 'self' },
  { file: 'features/shopping/Shopping.tsx', reads: 6, title: 'Shopping', gate: 'self' },
  { file: 'features/prep/Prep.tsx', reads: 5, title: 'Prep', gate: 'self' },
  { file: 'features/packing/Packing.tsx', reads: 6, title: 'Packing', gate: 'self' },
  { file: 'features/money/Money.tsx', reads: 5, title: 'Money', gate: 'self' },
  { file: 'features/sous/AskSous.tsx', reads: 7, title: null, gate: 'self' },
  /*
   * The job form is the eleventh, and the one with the most to lose. Its six
   * reads fed a three-read `ready` boolean, so a failed read took the §4 impact
   * preview off the screen with NO words at all — the form still looked whole
   * and saveable, and the one thing that told him what a guest-count change
   * costs was simply absent.
   *
   * The other three reads were worse than silent. `nameOptions` falls back to
   * the blank option, so a failed customers read renders as "No customer" and
   * nothing else: a read that broke, presented as a kitchen with no customers
   * in it. He picks the only option there is, saves, and revenue goes null
   * because no rate could match.
   *
   * `title` is null: this notice sits INSIDE the form, under the heading
   * `RecordScreen` has already rendered.
   */
  { file: 'features/jobs/Jobs.tsx', reads: 6, title: null, gate: 'self' },
  /*
   * The recipe form, where a failed read does not stop at silence. Both of its
   * reads fall back to `[]`, so a broken ingredients read renders "Choose an
   * ingredient" with nothing to choose. He cannot add a line, so he saves the
   * recipe without one — and a recipe with no components costs null AND shows a
   * production bucket with no gap beside it. The failed read ends up as a tray
   * of something with no ingredients in it, two screens away.
   */
  { file: 'features/setup/Recipes.tsx', reads: 2, title: null, gate: 'self' },
  /*
   * Ingredients is the one where a failed read does not go quiet — it says
   * something FALSE. `onHandFor` returns undefined both when he has never
   * counted an ingredient and when the stock read broke, and the row renders
   * the undefined case as "not counted". One failed read therefore tells him
   * every shelf in the kitchen is uncounted, directly under a comment reading
   * "Rule 8 on the list too: not counted reads differently from none".
   *
   * Three reads at TWO sites: the list's stock read, and the form's suppliers
   * and its own stock read. The form's blank on-hand field is the same lie one
   * record deep, and the thing standing between it and a lost stock-take is
   * `existingStock !== undefined` in the save path — which protects the row by
   * accident, not by design.
   */
  { file: 'features/setup/Ingredients.tsx', reads: 3, title: null, gate: 'self' },
  /*
   * The scanners hand their reads to `PhotoGate`, which owns the photo control
   * and renders the notice for them — so THEY must not decide anything, and the
   * assertions below check the handover instead of the decision.
   * `tests/scan/photoGate.test.ts` covers the gate itself.
   */
  { file: 'features/scan/ScanJobSheet.tsx', reads: 3, title: null, gate: 'PhotoGate' },
  { file: 'features/scan/ScanRecipeCard.tsx', reads: 1, title: null, gate: 'PhotoGate' },
  { file: 'features/scan/ScanMenu.tsx', reads: 1, title: null, gate: 'PhotoGate' },
  { file: 'features/scan/ScanInvoice.tsx', reads: 2, title: null, gate: 'PhotoGate' },
] as const;

const NOTICE = 'ui/SourceNotice.tsx';
const PHOTO_GATE = 'features/scan/PhotoGate.tsx';

const count = (source: string, pattern: RegExp): number => (source.match(pattern) ?? []).length;

/**
 * The 40 characters in front of `needle`, for asking what it is rendered behind.
 *
 * Newlines included, deliberately: an operator put on the line above is the
 * same operator.
 */
const before = (source: string, needle: string): string => {
  const at = source.indexOf(needle);
  return at === -1 ? '' : source.slice(Math.max(0, at - 40), at);
};

describe.each(GATED)('$file', ({ file, reads, title, gate }) => {
  it('declares every read it waits on, in the owner’s words', () => {
    const source = code(file);

    expect(source).toContain('const sources: readonly DataSource[] = [');

    const whats = count(source, /what: '/g);
    const whys = count(source, /why: '/g);
    const reloads = count(source, /reload: /g);

    expect(whats, 'the declared reads do not match the gate').toBe(reads);
    // A `what` with no `why` is half a sentence: it says something failed
    // without saying what it costs. A `what` with no reload is a dead retry.
    expect(whys).toBe(whats);
    expect(reloads).toBe(whats);
  });

  it('leaves NO read out of the gate', () => {
    /*
     * The drift that this catches: a seventh `useAsync` added to a screen, used
     * in the view, and never added to `sources`. The screen then renders before
     * that read lands — or renders "ready" while it is broken.
     *
     * Counted off the file rather than trusted, so adding a read to a screen
     * forces a deliberate decision here.
     */
    expect(count(code(file), /useAsync\(/g), 'a read is missing from sources').toBe(reads);
  });

  it('decides through sourceState, never a boolean of its own', () => {
    const source = code(file);

    // Either the screen asks `sourceState` itself, or it hands the whole
    // question to the gate. What it may not do is answer it on its own.
    expect(source).toContain(gate === 'self' ? 'sourceState(sources)' : 'sources={sources}');

    // The exact shape that went wrong, in all ten files.
    expect(source, 'hand-rolled readiness over the raw states').not.toMatch(
      /status === 'ready' &&[\s\S]{0,40}status === 'ready'/,
    );
  });

  it('renders the notice rather than words of its own', () => {
    const source = code(file);

    expect(source).toContain(gate === 'self' ? '<SourceNotice' : '<PhotoGate');

    if (gate === 'self') {
      // ANCHORED, for the THIRD time. `toContain('<SourceNotice')` passes
      // against
      //
      //     {false && <SourceNotice state={sourceState(sources)} />}
      //
      // which is the silence restored with the fix still visible above it, and
      // inverting this assertion is how that was found — in the job form, after
      // the same trick had already beaten the scanner guard and the renderer
      // guard. The lesson did not transfer twice because each anchor was
      // written for one file's syntax. This one is written for the operator.
      expect(before(source, '<SourceNotice'), 'the notice is rendered behind a condition').not.toMatch(
        /(&&|\|\||\?)\s*$/,
      );
    }

    if (title !== null) {
      /*
       * The whole-screen shape, pinned as one line. A looser check lets the
       * RETURN be gated instead of the element — `if (false && !ready) return
       * <SourceNotice …>` — which is the same defect moved left by one
       * operator.
       */
      expect(source, 'the whole-screen notice has drifted off its one shape').toMatch(
        new RegExp(`if \\(!ready\\) return <SourceNotice state=\\{loaded\\} title="${title}" />;`),
      );
    }

    for (const copy of ['Could not load', 'Working it out', 'Loading…']) {
      expect(source, `${file} carries its own "${copy}" copy`).not.toContain(copy);
    }
  });

  it('does not hunt the failure by hand', () => {
    const source = code(file);

    // Two lists of the same states, maintained side by side, is how a read gets
    // into `ready` and not into the error branch.
    expect(source).not.toMatch(/\.find\(\s*\(?s\)?\s*=>\s*s\.status === 'error'\)/);
    expect(source, 'reads an error off a state directly').not.toMatch(/\.state\.error\b/);
  });
});

describe('the scanners’ gate goes through the same renderer', () => {
  it('PhotoGate renders SourceNotice rather than its own words', () => {
    // Otherwise there are two sets of words for the same four states, which is
    // how "could not be read" ended up meaning three different things.
    const source = code(PHOTO_GATE);

    expect(source).toContain('sourceState(sources)');
    expect(source).toContain('<SourceNotice state={state} />');
    // Same anchor, same reason: the gate owns the photo control for all four
    // scanners, so a dead condition here is four silent screens.
    expect(before(source, '<SourceNotice'), 'the notice is rendered behind a condition').not.toMatch(
      /(&&|\|\||\?)\s*$/,
    );
    expect(source).not.toMatch(/Could not load/);
    expect(source).not.toMatch(/Try again/);
  });
});

describe('the one renderer says all three things', () => {
  const notice = (): string => src(NOTICE);

  it('names the read, what it was for, and what the failure said', () => {
    const source = notice();

    // message is "could not load <what> — <why>."; detail is the error's own
    // words, which is the part four screens were throwing away.
    expect(source).toContain('failure.message');
    expect(source).toContain('failure.detail');
    expect(source).toContain('role="alert"');
  });

  it('offers a retry wired to the state that failed', () => {
    expect(notice()).toContain('Try again');
    expect(notice()).toContain('onClick={state.retry}');
  });

  it('says what is still coming while it is coming', () => {
    expect(notice()).toContain('state.message');
  });

  it('branches on the failure, with nothing in front of the condition', () => {
    /*
     * ANCHORED, and the anchor is load-bearing. The first version of this check
     * in `tests/scan/photoGate.test.ts` looked for the condition anywhere in the
     * file and passed against
     *
     *     {false && state.kind === 'failed' && (
     *
     * which is the defect restored with the fix still visible above it. Found by
     * inverting the guard, not by reading it.
     */
    /*
     * The anchor is `const body =` with nothing but whitespace between it and
     * the condition. A bare `toContain("state.kind === 'failed' ? (")` passes
     * against `false && state.kind === 'failed' ? (` — which is exactly what
     * inverting this assertion showed, for the SECOND time in this change. The
     * first was in the scanner guard, and the lesson did not transfer because
     * the anchor there was a `{` this file does not have.
     */
    expect(notice()).toMatch(/const body =\s*state\.kind === 'failed' \? \(/);
  });

  it('renders NOTHING when every read landed', () => {
    // Otherwise every screen in the app carries a spare empty element, and the
    // inline cases would push their own content down for no reason.
    expect(notice()).toContain("if (state.kind === 'ready') return null;");
  });

  it('holds no copy of its own — the words are composed in one place', () => {
    const source = notice();

    expect(source).not.toMatch(/Could not load \w/);
    expect(source).not.toMatch(/Loading your/);
  });
});
