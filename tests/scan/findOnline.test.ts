/**
 * "FIND IT ONLINE" — the structure, not the maths.
 *
 * `fillStub.test.ts` proves what the filled recipe CONTAINS. This proves the
 * two things a screen can get wrong around it:
 *
 *   1. that the two web-search flows share ONE renderer. `ScanMenu` finds
 *      recipes for the dishes on a photographed menu; the Recipes editor finds
 *      one for a stub. Both get the same `WebRecipeReview` back and have to say
 *      the same things about it. Two copies would drift — and predictably: the
 *      one that happened to be edited would gain a warning the other did not
 *      show, and the owner would get a different account of the same page
 *      depending on which screen he reached it from. Rule 5 forbids a second
 *      version of a step.
 *
 *   2. that picking a candidate in the editor FILLS the stub rather than
 *      cloning it — `fillStub`, which carries the id, and never
 *      `draftFromWebReview`, which does not.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../src/${path}`, import.meta.url)), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );

const MENU = 'features/scan/ScanMenu.tsx';
const EDITOR = 'features/setup/Recipes.tsx';
const SHARED = 'features/scan/WebCandidates.tsx';

describe('both web-search flows go through one renderer', () => {
  it.each([MENU, EDITOR])('%s renders the shared list rather than its own', (file) => {
    expect(src(file)).toContain('<WebCandidates');
  });

  it('neither rolls its own candidate markup', () => {
    /*
     * The tell is the source link: every candidate must show where it came
     * from, and a screen that built its own list would have its own copy of
     * that anchor. Only the shared renderer may have one.
     */
    for (const file of [MENU, EDITOR]) {
      expect(
        src(file),
        `${file} renders its own candidate source link`,
      ).not.toMatch(/candidate\.sourceUrl/);
    }

    expect(src(SHARED)).toMatch(/candidate\.sourceUrl/);
  });

  it('the shared renderer decides nothing — the caller says what picking means', () => {
    // It is the same list in front of two different consequences: a new recipe
    // from a menu, an update to the stub in the editor. If it navigated or
    // saved, it could only ever serve one of them.
    const shared = src(SHARED);

    expect(shared).toContain('onPick');
    expect(shared, 'the shared list navigates').not.toContain('navigate(');
    expect(shared, 'the shared list writes').not.toMatch(/repository|\.save\(/);
  });
});

describe('picking in the editor fills the stub, and does not clone it', () => {
  it('the editor fills, and never builds a fresh draft', () => {
    /*
     * THE DUPLICATE-RECIPE BUG, guarded at the call site. `draftFromWebReview`
     * sets `id: ''`, which `save_recipe` inserts — correct for the menu flow,
     * catastrophic here: it would leave the stub empty and add a second recipe
     * carrying the website's title, with every job still pointing at the
     * original.
     */
    const editor = src(EDITOR);

    expect(editor).toContain('fillStub(');
    expect(editor, 'the editor builds a NEW recipe instead of filling the stub').not.toContain(
      'draftFromWebReview',
    );
  });

  it('the menu flow still inserts, because there is nothing there to fill', () => {
    // The contrast is what makes the assertion above mean something.
    const menu = src(MENU);

    expect(menu).toContain('draftFromWebReview');
    expect(menu, 'the menu flow fills a stub it never had').not.toContain('fillStub(');
  });

  it('the action is offered only on a recipe with no components', () => {
    const editor = src(EDITOR);

    // The stub condition the rest of the app uses, plus the second half: not
    // once he has started typing components of his own.
    expect(editor).toMatch(/recipe\.components\.length === 0/);
    expect(editor).toMatch(/lines\.length === 0/);
  });

  it('the search is asked by NAME, so it needs no photograph', () => {
    /*
     * The investigation's finding, pinned: `findRecipes` takes a plain string,
     * and the edge function reads `{dish, exclude}`. If that ever became
     * photo-coupled this flow would have no way to call it, and the failure
     * would look like a search that returns nothing rather than one that cannot
     * be asked.
     */
    expect(src(EDITOR)).toMatch(/findRecipes\(\s*name\.trim\(\)/);
  });

  it('a result with no source is counted, never shown', () => {
    // Provenance is the basis on which he is asked to trust any of this. A
    // candidate with no page behind it cannot be judged — but a short list that
    // looks complete is its own lie.
    /*
     * The CALL, not the declaration. `toContain('setRefusedCount')` matched the
     * `useState` line and passed happily with the call deleted — the count
     * would have stayed 0 for ever and the dropped results gone unmentioned.
     */
    expect(src(EDITOR), 'the refused count is never set').toMatch(/setRefusedCount\(\s*\S/);
    expect(src(SHARED)).toContain('refused');
  });
});

/**
 * RULE 8 AT THE SEARCH, and the empty result that used to say nothing.
 *
 * Both were found by reading the live flow against the database rather than by
 * a failing test, which is why they are pinned here.
 */
describe('a failed read is never dressed as an absence', () => {
  it('refuses to search at all until the ingredients have landed', () => {
    /*
     * THE DEFECT. `reviewWebRecipe` matches the page's ingredients against his,
     * and the owner list used to be
     *
     *     ingredients.state.status === 'ready' ? ingredients.state.data : []
     *
     * so a failed or still-loading read handed it an EMPTY library. Nothing
     * errored. Every ingredient simply failed to match and came back as
     * unquantified — character for character what the screen shows when none of
     * them are in his library. A broken read rendered as a legitimate absence,
     * which is the substitution Rule 8 exists to forbid.
     */
    expect(src(EDITOR), 'the empty-library fallback is back').not.toMatch(
      /ingredients\.state\.status === 'ready'\s*\?[^:]*:\s*\[\]/,
    );
    expect(src(EDITOR)).toContain("if (ingredients.state.status !== 'ready') {");
  });

  it('refuses BEFORE it searches, not after', () => {
    /*
     * Position, not presence. The same check written after the call still costs
     * him twenty seconds of waiting before it says no — and leaves the reply
     * sitting in a variable for the next edit to start using.
     */
    const code = src(EDITOR);
    const guard = code.indexOf("if (ingredients.state.status !== 'ready') {");
    const call = code.indexOf('await findRecipes(');

    expect(guard).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(-1);
    expect(guard, 'the guard runs after the search it is meant to prevent').toBeLessThan(call);
  });

  it('tells him WHICH it is, because the two need different things from him', () => {
    // "Wait a moment" and "this is broken" are different instructions, and a
    // single message covering both is neither.
    const code = src(EDITOR);

    expect(code).toContain("ingredients.state.status === 'error'");
    expect(code).toMatch(/could not be loaded/);
    expect(code).toMatch(/Still loading your ingredients/);
  });
});

describe('a search that found nothing says so', () => {
  it('sets a message when nothing survives review', () => {
    /*
     * `setCandidates([])` renders nothing and the button goes back to reading
     * "Find it online" — identical to never having pressed it. Twenty seconds of
     * waiting, and the screen looks like the tap missed.
     *
     * Anchored on the branch rather than on the words: the wording will be
     * edited, the branch is what must exist.
     */
    expect(src(EDITOR), 'an empty result is silent again').toMatch(
      /if \(kept\.length === 0\) \{[\s\S]{0,400}setFindError\(/,
    );
  });

  it('separates nothing-found from nothing-checkable from nothing-new', () => {
    // Three different facts. Collapsing them into "no results" tells him to try
    // a different name when the real answer is that the pages had no source
    // link, or that he has already seen everything there is.
    const code = src(EDITOR);

    expect(code).toMatch(/no source link/);
    expect(code).toMatch(/Found nothing for that name/);
    expect(code).toMatch(/already seen what the search can find/);
  });
});
