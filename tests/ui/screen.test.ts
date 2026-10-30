/**
 * ONE BIG HEADING PER SCREEN, AND ONE SPACING RHYTHM.
 *
 * Both defects came from the same place: every screen built its own root.
 *
 * Service rendered `<h1>Service</h1>` and a description, then rendered
 * `Shopping` inside itself — which rendered `<h1>Shopping</h1>` and a second
 * description underneath, answering a question the first had already answered,
 * with a segmented control between them reading "Shopping" a third time.
 * Library did the same with Recipes and Ingredients. And thirty-one rules in
 * `app.css` each gave some block its own bottom margin, so the gap between two
 * blocks depended on which two they were and a new block got none.
 *
 * `src/ui/Screen.tsx` is the fix for both, and this is what holds it:
 *
 *   exactly one component renders an h1   — a title cannot be drawn twice
 *   every screen sits in the container    — so every screen has the rhythm
 *   the three shell views pass no title   — the duplicate cannot come back
 *   the container owns the gap            — not the blocks inside it
 *   the overline is SCOPED                — the part shipped wrong first time
 *
 * VERIFIED BY INVERSION. Each assertion below was run against the defect it
 * describes — the title restored, the prop deleted, the margin put back, the
 * scoping rule removed — and watched to go red before being kept.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RecordScreen } from '../../src/ui/RecordScreen';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));
const STYLES = join(SRC, 'styles');

const read = (path: string): string => readFileSync(join(SRC, path), 'utf8');

/**
 * Source with its comments taken out.
 *
 * Load-bearing here, and not by choice: the comments in `Screen.tsx` and
 * `RecordScreen.tsx` QUOTE the markup they replaced — `<h1>Service</h1>`,
 * `<h1>Recipes</h1>` — because that is how the defect is explained to the next
 * reader. Every assertion of the form "this must not appear" would otherwise
 * fail on the prose describing why it must not appear. That has happened five
 * times in this repo, so it is stripped first and the prose is left alone.
 */
const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const code = (path: string): string => strip(read(path));

const css = strip(
  readdirSync(STYLES)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(STYLES, f), 'utf8'))
    .join('\n'),
);

/** Every screen the tab shell routes to, by the file that draws it. */
const SCREENS = [
  'features/dashboard/Dashboard.tsx',
  'features/service/Service.tsx',
  'features/library/Library.tsx',
  'features/money/Money.tsx',
  'features/setup/Setup.tsx',
  'features/setup/Backup.tsx',
  'features/scan/ScanHub.tsx',
  'features/scan/ScanJobSheet.tsx',
  'features/scan/ScanRecipeCard.tsx',
  'features/scan/ScanInvoice.tsx',
  'features/scan/ScanMenu.tsx',
  'features/sous/AskSous.tsx',
  'features/shopping/Shopping.tsx',
  'features/prep/Prep.tsx',
  'features/packing/Packing.tsx',
  // Not a feature, but it is a screen and the rules are the rules: one title,
  // drawn by `Screen`, inside the container that owns the rhythm.
  'features/NotFound.tsx',
] as const;

/** The three rendered INSIDE the Service shell, which draws their title. */
const IN_SERVICE_SHELL = [
  'features/shopping/Shopping.tsx',
  'features/prep/Prep.tsx',
  'features/packing/Packing.tsx',
] as const;

describe('one component draws a page title', () => {
  it.each(SCREENS)('%s renders no h1 of its own', (file) => {
    /*
     * The positive version of this — "Service has one h1" — is what the app
     * already satisfied while rendering three. Counting them on one screen
     * cannot work either, because the duplicate was never in one file: it was
     * a shell and a child, each correct alone.
     *
     * So the invariant is structural instead. A screen does not render a title;
     * it ASKS for one, and the single component that draws it cannot draw two.
     */
    expect(code(file), `${file} draws its own title`).not.toContain('<h1');
  });

  it('is Screen, and Screen renders exactly one', () => {
    const screen = code('ui/Screen.tsx');
    const h1s = (screen.match(/<h1/g) ?? []).length;

    expect(h1s, 'Screen does not render a title').toBe(1);
    expect(screen, 'the title is rendered unconditionally').toContain('{title !== undefined && (');
  });

  it('leaves the two screens OUTSIDE the shell alone, and says which', () => {
    /*
     * Sign-in and the no-kitchen screen are not in the tab shell: no header, no
     * tabs, no reading column, and nothing above them to carry a title. They
     * keep their own, and naming them here is what stops "no screen has an h1"
     * being read later as "nothing may ever have one".
     */
    expect(code('auth/SignIn.tsx')).toContain('<h1>Copper Pot Kitchen</h1>');
    expect(code('auth/RequireKitchen.tsx')).toContain('<h1>No kitchen</h1>');
  });
});

describe('every screen sits in the container, so every screen has the rhythm', () => {
  it.each(SCREENS)('%s renders a Screen', (file) => {
    const source = code(file);

    // The depth of the path is not the point and varies — `features/NotFound.tsx`
    // sits one level up from the rest. That it is THE shared Screen is.
    expect(source, `${file} does not import Screen`).toMatch(
      /import \{ Screen \} from '(\.\.\/)+ui\/Screen';/,
    );
    expect(source, `${file} imports Screen without rendering one`).toContain('<Screen');
  });
});

describe('a shell draws the title once, and its views do not draw it again', () => {
  it.each(IN_SERVICE_SHELL)('%s passes no title and no description', (file) => {
    const source = code(file);

    /*
     * THE DEFECT, PINNED, and pinned on the OPENING TAG rather than on the
     * file. `not.toContain('description=')` was the first version of this and
     * it failed honestly: `EmptyState` takes a `description` too, so the
     * assertion was reading a prop on another component and calling it a page
     * subtitle. Compared as a whole tag instead, which says what it means —
     * nothing is passed — and cannot be satisfied by moving a prop onto a
     * second line.
     */
    const open = /<Screen[^>]*>/.exec(source)?.[0] ?? '';

    expect(open, `${file} no longer renders a container`).not.toBe('');
    expect(open, `${file} passes a title or description the shell already drew`).toBe('<Screen>');
  });

  it('Service is the one that carries them', () => {
    const service = code('features/service/Service.tsx');

    expect(service).toContain('title="Service"');
    expect(service).toContain('description="Shopping, prep and packing for the jobs in these dates."');
  });

  it('and the dates caption still says what the window means per view', () => {
    // The one thing each view genuinely has of its own, and the reason dropping
    // their titles costs nothing: Prep's window is the service date minus
    // make-ahead days, which is NOT Shopping's window.
    expect(code('features/service/Service.tsx')).toContain('{RANGE_CAPTION[view]}');
  });
});

describe('the record screen gives its title up to a shell', () => {
  const RECORD = 'ui/RecordScreen.tsx';

  const CALLERS_IN_SHELL = ['features/setup/Recipes.tsx', 'features/setup/Ingredients.tsx'] as const;

  const CALLERS_STANDALONE = [
    'features/jobs/Jobs.tsx',
    'features/setup/Customers.tsx',
    'features/setup/Properties.tsx',
    'features/setup/Suppliers.tsx',
    'features/setup/RateCard.tsx',
    'features/setup/ServiceTemplates.tsx',
  ] as const;

  it.each(CALLERS_IN_SHELL)('%s asks for the title to be suppressed', (file) => {
    expect(code(file), `${file} draws a title Library has already drawn`).toMatch(/^\s+inShell$/m);
  });

  it.each(CALLERS_STANDALONE)('%s keeps its own title', (file) => {
    /*
     * The failure this catches is the lazy fix: `inShell` defaulted to true, or
     * pasted into all eight callers, which would take the title off Customers,
     * Properties, Suppliers, the rate card and the service templates — five
     * screens reached from Setup with nothing above them to name them.
     */
    expect(code(file), `${file} has given up a title nothing else draws`).not.toMatch(
      /^\s+inShell$/m,
    );
  });

  it('defaults to drawing it, so a new caller cannot lose its title by silence', () => {
    expect(code(RECORD)).toContain('inShell = false');
  });

  it('suppresses the heading when it is in a shell — rendered, not read', () => {
    /*
     * The structural assertions above are about which files say `inShell`.
     * This one is about whether saying it does anything, which is a different
     * question and the one that matters. `renderToStaticMarkup` reaches the
     * not-ready branch, which is exactly where the heading used to be drawn by
     * `SourceNotice` — the branch most easily forgotten, since the screen is
     * only in it for a moment.
     */
    const render = (inShell: boolean): string =>
      renderToStaticMarkup(
        createElement(RecordScreen, {
          title: 'Recipes',
          why: 'the menu is built from them',
          emptyDescription: 'x',
          addLabel: 'Add a recipe',
          inShell,
          // Never resolves, so the render stays in the not-ready branch. Typed,
          // or `T` infers `unknown` and the props below stop type-checking.
          load: () => new Promise<string[]>(() => {}),
          keyOf: () => 'k',
          renderRow: () => null,
          renderForm: () => null,
        }),
      );

    expect(render(false), 'a standalone screen has lost its title').toContain('<h1>Recipes</h1>');
    expect(render(true), 'the title is drawn under the shell’s own').not.toContain('<h1');

    // Both still SAY something — suppressing a heading must not suppress the
    // reason the screen is not ready.
    expect(render(true)).toContain('Loading your recipes…');
  });
});

describe('the title and its description are one block', () => {
  it('sits in a page-head, which is what keeps them tight', () => {
    expect(code('ui/Screen.tsx')).toContain('className="page-head"');
    expect(css).toMatch(/\.page-head > h1 \{[^}]*margin: 0;/);
  });

  it('the description hangs 4px under the title, not a rhythm step', () => {
    const rule = /\.page-sub \{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(rule, '.page-sub has no rule').not.toBe('');
    expect(rule, 'the description has drifted into the rhythm').toContain(
      'margin: var(--space-1) 0 0',
    );
  });

  it('no longer reaches sideways for a sibling to decide its own margin', () => {
    // `h1:has(+ .page-sub)` was a selector compensating for structure that was
    // not there. The structure is there now, and leaving both is how two rules
    // for one decision drift.
    expect(css, 'the :has() compensator outlived the structure it stood in for').not.toContain(
      'h1:has(+ .page-sub)',
    );
  });
});

describe('the container owns the gap, not the blocks inside it', () => {
  it('states the rhythm once, on the column', () => {
    expect(css).toMatch(/\.content > \* \+ \*,\s*\.screen > \* \+ \* \{\s*margin-top: var\(--space-5\);/);
  });

  /*
   * Nine of the thirty-one, and the nine that were ROOT-LEVEL blocks: a
   * supplier group at 24px, a needs-fixing card at 16px and a money row at
   * 12px, stacked in that order, gave three different gaps down one screen.
   *
   * The rest stay. `.field`, `.line` and `fieldset.units` are gaps INSIDE a
   * form, where the container is the form and not the screen, and
   * `.danger-zone` declares 32px deliberately — adjacent margins collapse, so a
   * block asking for more than the rhythm still gets it.
   */
  it.each([
    ['.needs-fixing', '--space-4'],
    ['.pack-job', '--space-4'],
    ['.money-summary', '--space-4'],
    ['.money-row', '--space-3'],
    ['.tiles', '--space-4'],
    ['.chat-log', '--space-5'],
    ['.segmented', '--space-4'],
  ])('%s keeps its edge and gives up its gap', (selector) => {
    const rule = new RegExp(`\\${selector} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';

    expect(rule, `${selector} has no rule to check`).not.toBe('');
    expect(rule, `${selector} still spaces itself`).not.toMatch(/margin-bottom|margin-top/);
  });

  it.each(['.supplier-group', '.prep-day'])(
    '%s has no rule left at all, because spacing was the whole of it',
    (selector) => {
      /*
       * These two differ from the seven above: they drew no border and no
       * ground, so `margin-bottom` was the only declaration either of them had.
       * Trimming it leaves an empty rule, which is a rule that says nothing and
       * invites the next person to put something in it.
       *
       * The class is still live — `.supplier-group h2` and `.prep-day h2` are
       * asserted further down — so this is not a rename slipping through.
       */
      expect(css, `${selector} is still spacing itself`).not.toContain(`${selector} {`);
    },
  );

  it.each([
    '.records',
    'fieldset.units',
    '.impact',
    '.unresolved-block,\n.warn',
    '.needs-fixing',
    '.pack-job',
    '.money-summary',
    '.money-row',
    '.tiles',
    '.chat-log',
    '.segmented',
    '.scan-grid',
    '.empty',
    '.card',
  ])('%s declares no top margin, so the container decides the gap', (selector) => {
    /*
     * FOUND BY MEASURING, NOT BY READING, and it is the failure the rest of this
     * describe block could not see. Three rules still declared `margin: 0 0 x`
     * — a shorthand that also sets margin-TOP to zero. At (0,1,1) that beats the
     * rhythm at (0,1,0), so `fieldset.units` and `.impact` sat FLUSH against the
     * block above them and `.records` sat flush under a page title, while every
     * assertion here passed: each of those rules does what it says, and none of
     * them mentions a gap at all.
     *
     * Nobody chose those zeros. They came free with the shorthand, which is why
     * the rule is now "no top margin here" rather than "no gap here" — the first
     * is checkable, the second is three different declarations away.
     *
     * `.danger-zone` is the one deliberate exception and is absent from this
     * list: it asks for 32px, states why, and adjacent margins collapse so it
     * gets it.
     */
    // Escaped properly rather than by sticking a backslash on the front: the
    // first version did that and turned `fieldset.units` into `\f`, a form
    // feed, so the one selector in the list that does not begin with a dot
    // matched nothing and reported itself as having no rule.
    const pattern = selector
      .split('\n')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s*');
    const rule = new RegExp(`${pattern} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';

    expect(rule, `${selector} has no rule to check`).not.toBe('');
    expect(rule, `${selector} sets its own top gap`).not.toContain('margin-top');
    expect(rule, `${selector} zeroes its top gap through a shorthand`).not.toMatch(
      /margin:\s*[^;]*;/,
    );
  });

  it('and the one deliberate exception still asks for more', () => {
    const rule = /\.danger-zone \{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(rule).toMatch(/margin-top: var\(--space-6\)/);
  });

  it('a tile is as tall as what it has to say', () => {
    // Grid rows stretch by default, so the tile holding one figure was drawn to
    // the height of the tile holding four — a tall box of empty card, which
    // reads as something missing rather than as something short.
    const rule = /\.tiles \{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(rule).toMatch(/align-items:\s*start/);
  });
});

describe('the section overline is scoped to section labels', () => {
  /*
   * THE PART THAT WAS SHIPPED WRONG. The rule below alone restyled every h2 in
   * the app: the warning block's amber category label, the empty state's title,
   * the impact preview's heading and every form section heading shrank to 12px
   * uppercase with the supplier names. It was reverted and comes back here with
   * its other half.
   */
  const h2 = /\bh2 \{([^}]*)\}/.exec(css)?.[1] ?? '';

  it('makes a bare section label quiet and small', () => {
    expect(h2).toMatch(/font-size: var\(--size-micro\)/);
    expect(h2).toMatch(/text-transform: uppercase/);
    expect(h2).toMatch(/color: var\(--text-muted\)/);
  });

  it.each([
    '.card > h2',
    'fieldset.units > h2',
    '.empty > h2',
    '.impact > h2',
    '.needs-fixing > h2',
    '.money-summary > h2',
    '.money-row > h2',
    '.pack-job > h2',
  ])('%s keeps its weight, because its block already has an edge', (selector) => {
    // Each of these is a container that draws its own border or ground. Its
    // heading is the title of the thing it sits in, not a divider on the page,
    // and a 12px overline leaves the block looking headless.
    expect(css, `${selector} is not in the rule that restores weight`).toContain(selector);
  });

  it('restores a SIZE and a CASE, not just a size', () => {
    /*
     * `text-transform` is the load-bearing one. Restoring the font-size alone
     * leaves a 16px heading in capitals, which is louder than what it replaced
     * — and it is the owner's own words in there: a job heading, a supplier, a
     * dish off a menu.
     */
    const restore = /\.card > h2,[\s\S]*?\{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(restore, 'the weight-restoring rule is gone').not.toBe('');
    expect(restore).toMatch(/text-transform: none/);
    expect(restore).toMatch(/font-size: var\(--size-body\)/);
  });

  it('the warning label keeps its amber, and keeps its case', () => {
    const warn = /\.unresolved-block > h2,\s*\.warn > h2,\s*\.warn-label \{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(warn, 'the warning label rule is gone').not.toBe('');
    expect(warn).toMatch(/color: var\(--warn\)/);
    expect(warn).toMatch(/text-transform: none/);
  });

  it('a supplier and a prep day take the overline rather than restating it', () => {
    /*
     * They ARE the true section labels — a name over a run of rows, on the page
     * surface, with no edge of their own. Their rule used to set a size, a
     * weight and a colour of its own, which is the same decision in two places.
     */
    const rule = /\.supplier-group h2,\s*\.prep-day h2 \{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(rule, 'the section-label rule is gone').not.toBe('');
    expect(rule).toMatch(/border-bottom: 1px solid var\(--border-strong\)/);
    expect(rule, 'restates the base rule, so the two can drift').not.toMatch(/font-size|color:/);
  });
});
