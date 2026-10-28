/**
 * The kitchen constraints, checked rather than remembered.
 *
 * CLAUDE.md section 5: "Every screen works on an iPhone in Safari. Used
 * one-handed, in a kitchen and in a supermarket. Large touch targets, readable
 * numerals, no hover-dependent interaction."
 *
 * Most of that is a design judgement. Three parts of it are not, and those are
 * asserted here so a later screen cannot quietly undo them.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const STYLES = fileURLToPath(new URL('../../src/styles', import.meta.url));
const tokens = readFileSync(join(STYLES, 'tokens.css'), 'utf8');
const sheets = readdirSync(STYLES).filter((f) => f.endsWith('.css'));
const allCss = sheets.map((f) => readFileSync(join(STYLES, f), 'utf8')).join('\n');

/**
 * The same CSS with the comments taken out.
 *
 * Needed by every assertion of the form "this declaration must NOT appear",
 * because the comment that EXPLAINS why it must not appear contains it. The
 * strengthened viewport guard below failed on its own prose the first time it
 * ran: `min-height: 100dvh` was named in the comment describing the bug, and
 * the regex found it.
 *
 * `allCss` is left as it is. The other assertions here are positive ones, which
 * a comment cannot break in the same way — though a `not.toMatch` added to them
 * later would carry the same hole, which is why this exists to be used.
 */
const css = allCss.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * WCAG relative-luminance contrast, so a colour decision is CHECKED rather than
 * eyeballed.
 *
 * It lives here rather than inside one describe because three separate rules
 * now depend on a measured ratio — the absence grey, the chevron and the
 * destructive button's edge — and three copies of this would drift.
 */
const channel = (c: number): number => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string): number => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return (
    0.2126 * channel(r as number) + 0.7152 * channel(g as number) + 0.0722 * channel(b as number)
  );
};

const contrastOf = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** One theme's token block out of `tokens.css`. */
const palette = (theme: 'light' | 'dark'): string =>
  (theme === 'light'
    ? /:root\s*\{([\s\S]*?)\n\}/.exec(tokens)?.[1]
    : /prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([\s\S]*?)\n  \}/.exec(tokens)?.[1]) ?? '';

/** A hex token's value inside one of those blocks. */
const tokenValue = (block: string, name: string): string =>
  new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(block)?.[1] ?? '';

describe('touch targets', () => {
  it('defines a 44px floor', () => {
    expect(tokens).toMatch(/--touch-min:\s*44px/);
  });

  it('applies it to every interactive element by default', () => {
    // Declared once, so a new screen inherits it rather than having to remember.
    expect(tokens).toMatch(/min-height:\s*var\(--touch-min\)/);
  });

  it('never sets an interactive height below the floor', () => {
    // A wet thumb in a supermarket is not a mouse pointer. Any rule that pins a
    // control shorter than 44px is a regression, whatever it looks like.
    //
    // VISUALLY-HIDDEN CONTROLS ARE EXCLUDED, and precisely: only a rule that also
    // carries `clip-path: inset(` — the screen-reader-only idiom. The scan
    // button's file input is 1x1 and clipped because the LABEL is the 44px
    // target; the input still exists for the accessibility tree and the keyboard.
    // Skipping it is not a loophole in the floor, because a clipped element has
    // no touch target to be too small.
    const rules = [...allCss.matchAll(/\{([^}]*)\}/g)].map((m) => m[1] ?? '');

    for (const rule of rules) {
      if (/clip-path:\s*inset\(/.test(rule)) continue;

      for (const found of rule.matchAll(/(?:min-)?height:\s*(\d+)px/g)) {
        const px = Number(found[1]);
        if (px === 0) continue;
        expect(px, `a rule sets ${px}px, below the 44px floor`).toBeGreaterThanOrEqual(44);
      }
    }
  });

  it('keeps inputs at 16px so iOS Safari does not zoom the page on focus', () => {
    expect(tokens).toMatch(/font-size:\s*16px/);
  });

  it('no type-specific input rule sets a font-size below 16px', () => {
    // The base `input` rule is unqualified, so every type inherits 16px. A rule
    // targeting one type — `input[type='date']`, say — could quietly undercut it
    // and reintroduce the zoom on exactly one screen, which is the kind of
    // regression nobody notices until they are standing in a supermarket.
    for (const [rule] of allCss.matchAll(/input\[type=[^\]]+\][^{]*\{[^}]*\}/g)) {
      const size = /font-size:\s*(\d+)px/.exec(rule);
      if (size === null) continue;
      expect(Number(size[1]), `a type-specific input rule sets ${size[1]}px`).toBeGreaterThanOrEqual(16);
    }
  });
});

describe('numerals', () => {
  it('defines tabular numerals', () => {
    expect(tokens).toMatch(/--num:\s*tabular-nums/);
  });

  it('exposes a class that applies them', () => {
    // 1111 must occupy the same width as 8888, or a shopping list cannot be
    // scanned down a column.
    expect(tokens).toMatch(/\.num\s*\{[^}]*font-variant-numeric:\s*var\(--num\)/);
  });
});

describe('no hover-dependent interaction', () => {
  it('pairs every hover rule with a focus-visible rule', () => {
    // A touch screen has no hover. Anything revealed by hover alone is invisible
    // on the device this is actually used on.
    const hovers = (allCss.match(/:hover/g) ?? []).length;
    const focus = (allCss.match(/:focus-visible/g) ?? []).length;

    expect(focus, 'every :hover needs a :focus-visible counterpart').toBeGreaterThanOrEqual(
      hovers,
    );
  });

  it('does not reveal content on hover', () => {
    expect(allCss).not.toMatch(/:hover[^{]*\{[^}]*(display:\s*(block|flex)|visibility:\s*visible)/);
  });
});

/**
 * WEB FONTS, AND THE RULE THEY DO NOT GET TO BREAK.
 *
 * This used to be a flat ban: no `@font-face`, no `@import url`, ever. The ban
 * came from CLAUDE.md section 5 — "used in a kitchen and in a supermarket" — and
 * the thing it was really protecting was never the absence of fonts. It was that
 * the owner must never wait on one, and must never see blank text on 4G.
 *
 * So the ban is replaced by the property it stood for, which is a stronger guard
 * rather than a weaker one: fonts may be loaded, and every one of them must be
 * self-hosted, swap-on-load, and backed by a system stack.
 *
 * WORTH RECORDING: the old guard only ever read `src/styles/*.css`, so a
 * `<link>` to Google Fonts in `index.html` would have sailed straight past it.
 * Routing around a guard that way is worse than changing it, because the next
 * person reads the guard and believes it.
 */
describe('loads on a supermarket connection', () => {
  it('keeps BODY text on the system stack, so it never waits', () => {
    // The one family that must render instantly. Headings and labels can swap;
    // the sentence the owner is reading cannot.
    expect(tokens).toMatch(/--font:\s*-apple-system/);
  });

  it('EVERY family token ends in a system stack', () => {
    // If both files fail to load, the app renders in New York and SF Mono and
    // nothing about it breaks.
    const families = [...tokens.matchAll(/--font[a-z-]*:\s*([^;]+);/g)].map((m) => m[1] ?? '');

    // Two now: the system sans everything is set in, and the mono for labels.
    expect(families.length).toBeGreaterThanOrEqual(2);
    for (const stack of families) {
      expect(stack, `"${stack}" has no generic fallback`).toMatch(
        /(sans-serif|serif|monospace)\s*$/,
      );
    }
  });

  it('EVERY @font-face REFUSES TO HIDE TEXT — swap or optional, never the default', () => {
    /*
     * This read `toMatch(/font-display:\s*swap/)` and was widened to admit
     * `optional`. That is not a loosening, and the distinction matters enough
     * to record.
     *
     * The property being protected is that text is never invisible: FOIT on a
     * supermarket connection is a blank screen. Measured against THAT, the two
     * values are not equal — `optional` is STRICTER. It gives the font a ~100ms
     * window and then commits to the fallback for the whole page load, so the
     * text is never hidden AND never repaints later. `swap` leaves the door
     * open to a reflow at any moment the file happens to arrive.
     *
     * What is forbidden is unchanged and is the only thing that was ever the
     * danger: the DEFAULT, `block` and `fallback` — the three that can leave a
     * word invisible for up to three seconds.
     */
    const faces = [...allCss.matchAll(/@font-face\s*\{([^}]+)\}/g)].map((m) => m[1] ?? '');

    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      const declared = /font-display:\s*([a-z]+)/.exec(face)?.[1] ?? 'none declared';

      expect(
        ['swap', 'optional'],
        `an @font-face declares "${declared}", which can hide text`,
      ).toContain(declared);
    }
  });

  it('the DISPLAY family is policed by the fallback rule, not exempt from it', () => {
    /*
     * The mock named this token `--display`. The fallback guard above matches
     * `--font[a-z-]*`, so `--display` would have escaped it entirely and been
     * free to ship with no system stack behind it — a silent blank heading if
     * the file ever failed. The NAME is the enforcement.
     */
    expect(tokens, 'the display family is named so the fallback guard misses it').not.toMatch(
      /^\s*--display:/m,
    );
    expect(tokens).toMatch(/--font-display:\s*'Archivo'/);
  });

  it('BODY still never waits on a web font', () => {
    // Archivo is for headings. The sentence the owner is reading is still the
    // system stack, which is the rule that stopped Inter shipping.
    const body = /--font:\s*([^;]+);/.exec(tokens)?.[1] ?? '';

    expect(body, 'a web font reached body text').not.toMatch(/Archivo|Inter/);
  });

  it('fetches fonts from THIS origin, never a third party', () => {
    // Self-hosted: no extra DNS lookup and TLS handshake to fonts.gstatic.com
    // before the first word paints.
    for (const face of allCss.matchAll(/@font-face\s*\{([^}]+)\}/g)) {
      const src = face[1] ?? '';
      expect(src, 'a font is fetched from another origin').not.toMatch(/url\(['"]?https?:/);
    }

    expect(allCss, 'a stylesheet is imported from a URL').not.toMatch(/@import\s+url/);
  });

  it('every font file it names actually exists', () => {
    // A typo'd path is a silent fallback to the system stack — the app still
    // works, looks wrong, and nothing says why.
    const urls = [...allCss.matchAll(/url\(['"]?(\/fonts\/[^'")]+)['"]?\)/g)].map(
      (m) => m[1] ?? '',
    );

    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      const onDisk = fileURLToPath(new URL(`../../public${url}`, import.meta.url));
      expect(existsSync(onDisk), `${url} is referenced but not in public/`).toBe(true);
    }
  });

  it('THE FONT SWAP CANNOT MOVE AN INPUT BELOW 16px', () => {
    // The no-zoom rule is set on the ELEMENT in absolute pixels, not inherited
    // from a family or a ramp step, so a webfont landing mid-session cannot drag
    // it under the threshold. Asserted as an absolute value on purpose: a
    // `var(--size-body)` here would be one token edit away from zooming the page
    // on every focus.
    const inputRule = /button,[\s\S]*?textarea\s*\{([^}]+)\}/.exec(tokens)?.[1] ?? '';

    expect(inputRule).toMatch(/font-size:\s*16px/);
    expect(inputRule, 'the 16px rule was made relative to a token').not.toMatch(
      /font-size:\s*var\(/,
    );
  });
});

/**
 * AN ABSENCE WHISPERS. A WARNING SPEAKS ONCE.
 *
 * These are two different things and the app used to render them identically —
 * both as filled amber. That was wrong in both directions: "food cost not known
 * yet" is an honest statement of fact and was alarming, while a genuine "check
 * this yourself" had to shout over it to be noticed. A screen where everything
 * is urgent has nothing urgent on it.
 *
 * So the two are separated here, and the separation is what these guards hold:
 *
 *   .unresolved        grey, normal weight, NO fill, NO warn colour
 *   .unresolved-block  a left rule, a faint tint, one mono label in warn
 *
 * The accent is a third thing again — it means "you can act on this", not "look
 * at this". Collapsing any pair of the three is how a signal stops signalling.
 */
describe('an absence is never dressed as a warning', () => {
  /** The inline treatment for a value nobody has entered. */
  const absence = /\.unresolved\s*\{([^}]*)\}/.exec(allCss)?.[1] ?? '';

  it('has a rule to check', () => {
    expect(absence.trim()).not.toBe('');
  });

  it('carries NO background fill', () => {
    // The filled pill is what made every screen look like it had a problem.
    expect(absence).not.toMatch(/background/);
  });

  it('is NEVER given the warning colour', () => {
    expect(absence).not.toMatch(/var\(--warn/);
  });

  it('is never given the accent either — it is not actionable', () => {
    expect(absence).not.toMatch(/var\(--accent/);
  });

  it('is grey secondary text at normal weight', () => {
    expect(absence).toMatch(/color:\s*var\(--text-muted\)/);
    expect(absence).not.toMatch(/font-weight:\s*(600|700|bold)/);
  });
});

describe('the warning is its own signal, distinct from the accent', () => {
  it('the warn colour is never the accent, and the accent is never the warn colour', () => {
    // If these ever alias, "you can act on this" and "you must look at this"
    // become the same colour, and the app has one fewer thing it can say.
    expect(tokens).not.toMatch(/--warn[a-z-]*:\s*var\(--accent/);
    expect(tokens).not.toMatch(/--accent[a-z-]*:\s*var\(--warn/);
  });

  it('the warning block sets a ground, so its colour is never bare on the page', () => {
    const block = /\.unresolved-block,\s*\.warn\s*\{([^}]*)\}/.exec(allCss)?.[1] ?? '';

    expect(block).toMatch(/background:\s*var\(--warn-bg\)/);
    expect(block).toMatch(/border-left:[^;]*var\(--warn-border\)/);
  });

  it('KEEPS THE BODY TEXT IN NORMAL INK', () => {
    // Amber on amber is what made the old treatment vibrate. Colour marks the
    // edge and names the category; the content reads like content.
    const block = /\.unresolved-block,\s*\.warn\s*\{([^}]*)\}/.exec(allCss)?.[1] ?? '';

    expect(block).toMatch(/color:\s*var\(--text\)/);
  });

  it('defines a warn colour that is actually used', () => {
    expect(tokens).toMatch(/--warn:/);
    expect(allCss).toMatch(/color:\s*var\(--warn\)/);
  });
});

/**
 * COPPER IS A SIGNATURE, NOT A SIGNAL.
 *
 * Five colours in this app MEAN something: amber warns, grey says nobody
 * entered it, blue says you can act, red says destructive, green says fine. A
 * sixth colour that looked like one of them would be a sixth thing to read on
 * a screen he is holding one-handed in a supermarket.
 *
 * So copper appears exactly once, as a 26px stroke under the kitchen name. It
 * is decoration: no state, nothing to act on. These guards hold it there, and
 * the point of counting rather than eyeballing is that the SECOND use is the
 * one that does the damage — one flourish reads as a brand mark, two read as a
 * category nobody has explained.
 */
describe('copper is used once, and never to mean anything', () => {
  /**
   * Every rule as (selector, body).
   *
   * Counting `var(--copper)` occurrences was the first version of this and it
   * was wrong twice over: the stroke is drawn as
   * `linear-gradient(var(--copper), var(--copper))`, which names the token
   * twice in ONE use, and a bare `a` or `button` in a selector list matched as
   * a SUBSTRING — `.app-header span:first-child` contains an "a". What matters
   * is how many rules carry it, and which.
   */
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selector, body]) => ({
    selector: (selector ?? '').trim(),
    body: body ?? '',
  }));

  const carriers = rules.filter((r) => /var\(--copper\)/.test(r.body));

  it('is declared in both themes', () => {
    // Light and dark need different values: #c47a3d is 4.50 on the ink chrome,
    // which is fine by day and thin at night, so dark lightens it to #d08c52.
    expect([...tokens.matchAll(/--copper:/g)]).toHaveLength(2);
  });

  it('is carried by EXACTLY ONE rule', () => {
    /*
     * The second use is the one that does the damage: one flourish reads as a
     * brand mark, two read as a category nobody has explained.
     */
    expect(
      carriers.map((r) => r.selector),
      `copper is carried by ${carriers.length} rules`,
    ).toHaveLength(1);
  });

  it('and that rule is the brand', () => {
    expect(carriers[0]?.selector).toBe('.app-header span:first-child');
  });

  it('never touches anything that carries meaning', () => {
    /*
     * Checked against the one rule that has it rather than by scanning for
     * selectors, which is both simpler and impossible to fool: if copper is on
     * an absence, a warning or a control, it is by definition not on the brand
     * alone and the assertion above has already failed.
     *
     * This states the consequence the other two are protecting, in the terms
     * that matter: copper on an absence would make "not known" look like a
     * warning; on a warning it would put two warm colours in one block; on a
     * control it would make decoration look tappable.
     */
    for (const word of ['unresolved', 'warn', 'needs-fixing', 'tabs', 'primary']) {
      expect(
        carriers[0]?.selector ?? '',
        `copper reached a ${word} rule`,
      ).not.toContain(word);
    }
  });
});

/**
 * THE ABSENCE IS BODY TEXT, SO IT HAS TO BE READABLE AS BODY TEXT.
 *
 * "not known" is a statement the owner reads and acts on — it is the reason he
 * opens Ingredients and types a price. It is not a decoration, and a grey that
 * only just reads in good light is the same defect as hiding it.
 *
 * COMPUTED, NOT ASSERTED BY EYE. The Steel direction's own mock proposed
 * #8c96a0 for this, which measures 2.80 on the page — it reads fine on a
 * designer's monitor and fails outright on a phone in a supermarket. The value
 * that shipped was derived by walking the same hue down until it passed on all
 * three grounds it is actually used against.
 */
describe('the absence colour is legible on every ground it lands on', () => {
  const channel = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };

  const luminance = (hex: string): number => {
    const h = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return (
      0.2126 * channel(r as number) + 0.7152 * channel(g as number) + 0.0722 * channel(b as number)
    );
  };

  const contrast = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };

  /** Read a token's value out of a block of `tokens.css`. */
  const valueOf = (block: string, name: string): string =>
    new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(block)?.[1] ?? '';

  const light = /:root\s*\{([\s\S]*?)\n\}/.exec(tokens)?.[1] ?? '';
  const dark = /prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([\s\S]*?)\n  \}/.exec(tokens)?.[1] ?? '';

  it('reads both palettes', () => {
    expect(valueOf(light, 'text-muted')).not.toBe('');
    expect(valueOf(dark, 'text-muted')).not.toBe('');
  });

  it.each([
    ['light', () => light],
    ['dark', () => dark],
  ])('clears 4.5:1 on the page, a card and the warning tint — %s', (_name, get) => {
    const block = get();
    const muted = valueOf(block, 'text-muted');

    // The three grounds an absence actually appears on. The warning tint is in
    // the list because an unresolved value sits inside a warning block.
    for (const ground of ['bg', 'card', 'warn-bg']) {
      const against = valueOf(block, ground);
      const ratio = contrast(muted, against);

      expect(
        ratio,
        `the absence colour ${muted} is ${ratio.toFixed(2)}:1 on --${ground} ${against}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

/**
 * BLUE IS FOR ACTING, NOT FOR GOING.
 *
 * The dashboard had five bright-blue links on it — "Open the shopping list",
 * "Open Money", "Open backup", "All jobs" and every job row — so the loudest
 * colour on the screen was spent on its least urgent content, and the one
 * primary button had nothing left to be louder than. An accent that appears
 * everywhere is a texture.
 *
 * Blue now means one of three things and nothing else: the active nav tab, the
 * one primary action on a screen, and a link that LEAVES the app. Navigation
 * within the app is ink plus a chevron.
 */
describe('blue is reserved for acting', () => {
  /*
   * COMMENTS STRIPPED, for the fifth time in this codebase. The comment on that
   * screen explains that the link USED to be `<Link to="/jobs">` — and the raw
   * scan below read that sentence as a sixth link and failed on the very prose
   * documenting the fix. JSX comments are `{/* … *\/}`, so the block-comment
   * strip catches them.
   */
  const dashboard = readFileSync(
    fileURLToPath(new URL('../../src/features/dashboard/Dashboard.tsx', import.meta.url)),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '');

  it('the dashboard navigates quietly', () => {
    /*
     * Every `<Link>` and in-page `<a>` on the dashboard carries `qlink` or is a
     * whole-row `record` target. Counted off the file rather than listed, so a
     * sixth link added later is caught rather than assumed.
     */
    const links = [...dashboard.matchAll(/<(?:Link|a)\b([^>]*)>/g)].map((m) => m[1] ?? '');

    /*
     * Three recognised quiet forms, and nothing else:
     *
     *   qlink   text plus a chevron
     *   record  a whole row, as in the jobs list
     *   tile    a whole card, as in "At a glance"
     *
     * `tile` was added when the two summaries became tiles — and this guard is
     * what noticed, which is the point of listing the forms rather than
     * checking for the absence of blue. A fourth form has to be argued for
     * here before it can ship.
     */
    expect(links.length).toBeGreaterThan(3);
    for (const attrs of links) {
      expect(
        /className="[^"]*\b(qlink|record|tile)\b/.test(attrs),
        `a dashboard link is none of the three quiet forms: ${attrs.trim()}`,
      ).toBe(true);
    }
  });

  it('a quiet link is ink, never the accent', () => {
    const rule = /\n\.qlink \{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(rule).not.toBe('');
    expect(rule, 'the quiet link went blue again').not.toMatch(/var\(--accent/);
    expect(rule).toMatch(/color:\s*var\(--label\)/);
  });

  it('a whole-row target is ink, so the card is the affordance', () => {
    const rule = /a\.record \{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(rule, 'a.record has no rule, so it inherits the accent').not.toBe('');
    expect(rule).toMatch(/color:\s*var\(--text\)/);
  });

  it('the chevron clears the 3:1 floor for a glyph that carries meaning', () => {
    // It says "there is more through here". The mock's #9aa3ac is 2.56.
    for (const theme of ['light', 'dark'] as const) {
      const block = palette(theme);
      const ratio = contrastOf(tokenValue(block, 'chevron'), tokenValue(block, 'card'));

      expect(ratio, `${theme} chevron is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
  });

  it('THE CHROME FOLLOWS THE THEME, and is legible on it in both', () => {
    /*
     * The header and the tab bar were a fixed `--ink: #20262d` in BOTH themes,
     * which took a hairline to rescue in dark: 1.25:1 against the page, a bar
     * that all but vanished into its own background.
     *
     * Three colours written for that dark bar failed outright when it went
     * light — #9fd0ff at 1.62, #b8bfc7 at 1.86, #8d97a2 at 2.97 — which is why
     * this checks the TEXT on the chrome and not just that the chrome exists.
     * A background swap alone would have shipped an invisible header.
     */
    for (const theme of ['light', 'dark'] as const) {
      const block = palette(theme);
      const chrome = tokenValue(block, 'chrome');

      expect(chrome, `${theme} has no --chrome`).not.toBe('');

      for (const [what, token, floor] of [
        ['the brand', 'text', 4.5],
        ['the idle tab', 'text-muted', 4.5],
        ['the active tab', 'accent', 4.5],
        ['the copper mark', 'copper', 3],
      ] as const) {
        const ratio = contrastOf(tokenValue(block, token), chrome);
        expect(
          ratio,
          `${theme}: ${what} is ${ratio.toFixed(2)}:1 on the chrome`,
        ).toBeGreaterThanOrEqual(floor);
      }
    }
  });

  it('the chrome BELONGS TO THE SURFACE STACK, rather than floating above it', () => {
    /*
     * FOUND BY INVERTING. The assertion above checks that text is legible ON
     * the chrome — and forcing the dark chrome back to the old fixed
     * `#20262d` passed it comfortably, because white-on-ink was never the
     * problem. The problem was that the ink belonged to no palette: it sat
     * LIGHTER than the dark theme's own cards, so the header read as a foreign
     * slab laid over the app rather than as part of it, and a hairline was
     * doing the work the fill should have done.
     *
     * So the real invariant is positional, not a ratio: the chrome sits
     * somewhere between the page and the card, in the same stack as every
     * other surface. `#20262d` is outside it; `#11161b` is inside it.
     */
    for (const theme of ['light', 'dark'] as const) {
      const block = palette(theme);
      const [page, card, chrome] = (['bg', 'card', 'chrome'] as const).map((t) =>
        luminance(tokenValue(block, t)),
      ) as [number, number, number];

      const low = Math.min(page, card);
      const high = Math.max(page, card);

      expect(
        chrome >= low && chrome <= high,
        `${theme}: the chrome sits outside the page/card stack — it is a slab, not a surface`,
      ).toBe(true);
    }
  });

  it('the chrome is separated by a border, never by its fill alone', () => {
    // In both themes the step between chrome and page is slight by design —
    // 1.12 light, 1.05 dark. The border is what draws the edge, and the old
    // chrome needed one too despite being a far bigger value jump.
    for (const theme of ['light', 'dark'] as const) {
      expect(tokenValue(palette(theme), 'chrome-border'), `${theme} has no --chrome-border`).not.toBe(
        '',
      );
    }

    expect(css).toMatch(/border-bottom: 1px solid var\(--chrome-border\)/);
    expect(css).toMatch(/border-top: 1px solid var\(--chrome-border\)/);
  });

  it('no colour written for the old dark bar survives in the chrome', () => {
    /*
     * Counted off the rules rather than trusted. These three were hardcoded
     * hex, not tokens, so a theme change could not reach them — and each was
     * unreadable the moment the bar went light.
     */
    for (const dead of ['#9fd0ff', '#b8bfc7', '#8d97a2', 'var(--on-ink', 'var(--ink']) {
      expect(css, `the chrome still carries ${dead}, written for a dark bar`).not.toContain(dead);
    }
  });

  it('a destructive button is identified by its edge, so the edge is visible', () => {
    /*
     * `danger` lost its solid fill — a red button on every setup form is the
     * loudest thing on a screen he opened to change a price. With the fill gone
     * the border is what says "this one deletes", so it is held to the 3:1
     * component floor. The mock's #e3b4ae is 1.84 and would have made the
     * control indistinguishable from a secondary.
     */
    for (const theme of ['light', 'dark'] as const) {
      const block = palette(theme);
      const edge = contrastOf(tokenValue(block, 'danger-border'), tokenValue(block, 'card'));
      const text = contrastOf(tokenValue(block, 'danger'), tokenValue(block, 'card'));

      expect(edge, `${theme} danger edge is ${edge.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
      expect(text, `${theme} danger text is ${text.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }

    expect(css, 'the danger button is a solid fill again').not.toMatch(
      /button\.danger \{[^}]*background:\s*var\(--danger\)/,
    );
  });

  it('AN EMPTY STATE IS NEVER THE LOUDEST THING ON THE SCREEN', () => {
    /*
     * `.money-summary` was `border: 1px solid var(--accent)` over
     * `background: var(--accent-subtle)`. On a fresh kitchen every figure in it
     * reads "not known", so the single block the dashboard highlighted hardest
     * was the one with nothing to say.
     *
     * This guard was MISSING when the change shipped — inverting (b) found both
     * of its decisions unguarded, which is why it exists now rather than later.
     */
    const rule = /\.money-summary \{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(rule, '.money-summary has no rule').not.toBe('');
    expect(rule, 'the empty-state card is highlighted in the accent again').not.toMatch(
      /var\(--accent/,
    );
  });

  it('a tile is a card you tap, not a blue sentence', () => {
    const tile = /\n\.tile \{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(tile, '.tile has no rule').not.toBe('');
    expect(tile).toMatch(/color:\s*var\(--text\)/);
    expect(tile, 'a tile went blue').not.toMatch(/var\(--accent/);
  });

  it('every chevron is the chevron colour, so one of them cannot drift blue', () => {
    /*
     * Two of them — `.qlink::after` and `.tile-go::after` — and they say the
     * same thing, so they must look the same. Asserted over both rather than
     * one, because the second is exactly the kind that gets changed alone.
     */
    const chevrons = [...css.matchAll(/::after \{([^}]*content:\s*'›'[^}]*)\}/g)].map(
      (m) => m[1] ?? '',
    );

    expect(chevrons.length, 'the chevrons moved or multiplied').toBe(2);
    for (const rule of chevrons) {
      expect(rule, 'a chevron is not the chevron token').toMatch(/color:\s*var\(--chevron\)/);
    }
  });

  it('a button never shrinks below the touch floor to look small', () => {
    const small = /button\.sm \{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(small, 'there is no small variant').not.toBe('');
    expect(small, 'the small button sets a height').not.toMatch(/height:/);
  });
});

/**
 * EVERY SCREEN SAYS WHAT IT IS FOR.
 *
 * The four-step hierarchy from the Steel pass had a hole between step 1 and
 * step 2: a title, then straight into content. "Service" is a tab name, not an
 * answer — the owner arriving on it had to infer from the controls what the
 * screen was about.
 *
 * So every page carries one line under its title. The guard is that they EXIST
 * and that none of them is filler: a description that restates its own title
 * has cost a line of screen and said nothing.
 */
describe('every screen says what it is for', () => {
  const SCREENS = [
    ['features/dashboard/Dashboard.tsx', 'Today'],
    ['features/service/Service.tsx', 'Service'],
    ['features/money/Money.tsx', 'Money'],
    ['features/library/Library.tsx', 'Library'],
    ['features/scan/ScanHub.tsx', 'Scan'],
    ['features/setup/Setup.tsx', 'Setup'],
    ['features/shopping/Shopping.tsx', 'Shopping'],
    ['features/prep/Prep.tsx', 'Prep'],
    ['features/packing/Packing.tsx', 'Packing'],
    ['features/sous/AskSous.tsx', 'Ask Sous'],
  ] as const;

  const sourceOf = (file: string): string =>
    readFileSync(fileURLToPath(new URL(`../../src/${file}`, import.meta.url)), 'utf8');

  it.each(SCREENS)('%s carries a description that is not its own title', (file, title) => {
    const source = sourceOf(file);
    const description = /<p className="page-sub">([^<]+)<\/p>/.exec(source)?.[1] ?? '';

    expect(description, `${file} has no page description`).not.toBe('');
    // Long enough to carry a thought. "Your jobs." is not a description.
    expect(description.split(' ').length, `${file}: "${description}" is not a sentence`,).toBeGreaterThan(5);
    expect(
      description.toLowerCase().replace(/[^a-z ]/g, '').trim(),
      `${file}: the description just restates the title`,
    ).not.toBe(title.toLowerCase());
  });

  it('no two screens describe themselves the same way', () => {
    /*
     * The cheapest way to satisfy ten required strings is to paste one into all
     * ten, and it would pass every assertion above. Ten identical descriptions
     * is one description and nine screens that lie about what they do.
     */
    const all = SCREENS.map(
      ([file]) => /<p className="page-sub">([^<]+)<\/p>/.exec(sourceOf(file))?.[1] ?? '',
    );

    expect(new Set(all).size, 'two screens share a description').toBe(all.length);
  });

  it('the description is styled as a subtitle, not as content', () => {
    const rule = /\.page-sub \{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(rule, '.page-sub has no rule').not.toBe('');
    expect(rule).toMatch(/color:\s*var\(--text-muted\)/);
  });
});

describe('viewport', () => {
  it('uses dvh, since the iOS Safari toolbar changes the viewport height', () => {
    expect(allCss).toMatch(/100dvh/);
    expect(allCss).not.toMatch(/min-height:\s*100vh/);
  });

  it('respects the safe area at both ends', () => {
    expect(allCss).toMatch(/env\(safe-area-inset-top\)/);
    expect(allCss).toMatch(/env\(safe-area-inset-bottom\)/);
  });

  /*
   * THE SHELL IS THE VIEWPORT, AND ONE THING INSIDE IT SCROLLS.
   *
   * `min-height: 100dvh` passed the assertion above for months and was the bug:
   * "at least the viewport" lets the shell grow to its content, so on the Jobs
   * dashboard `#root` measured 2677px against an 812px viewport. The PAGE
   * scrolled, `.app-main` did not — its `scrollTop` stayed 0, so its
   * `overflow-y: auto` was dead code — and the tab bar, last in a column taller
   * than the screen, sat 2272px below the fold. Reaching the navigation meant
   * scrolling to the end of the content.
   *
   * Both halves are asserted because either one alone leaves it broken: without
   * `min-height: 0`, a flex item refuses to shrink below its content and
   * `.app-main` pushes past the shell even when the shell is exactly the
   * viewport. Verified by inversion, both ways round.
   */
  it('makes the shell exactly the viewport, not at least it', () => {
    expect(css, 'the shell can grow past the viewport again').not.toMatch(
      /min-height:\s*100dvh/,
    );
    expect(css).toMatch(/#root\s*\{[^}]*\bheight:\s*100dvh/);
  });

  it('lets the content area shrink below its content, so it is the thing that scrolls', () => {
    const main = /\.app-main\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(main, '.app-main has no rule').not.toBe('');
    expect(main).toMatch(/\boverflow-y:\s*auto/);
    // Without this a flex item's `min-height: auto` keeps it as tall as its
    // content, and the overflow above never engages.
    expect(main, '.app-main cannot shrink, so nothing scrolls inside the shell').toMatch(
      /\bmin-height:\s*0\b/,
    );
  });

  it('pins the tab bar by layout rather than by overlaying the content', () => {
    const tabs = /\n\.tabs\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(tabs, '.tabs has no rule').not.toBe('');
    /*
     * A row of a viewport-height column, not a fixed overlay. `position: fixed`
     * would take the bar out of flow, and the content would then need bottom
     * padding equal to the bar's height to clear it — a 44px dead strip that
     * has to be kept in step with the bar by hand.
     */
    expect(tabs, 'the tab bar overlays the content again').not.toMatch(/position:\s*fixed/);
    expect(tabs).toMatch(/\bflex:\s*none/);
    // The home indicator. Not the bar's own height — nothing hides behind it.
    expect(tabs).toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom\)/);
  });
});
