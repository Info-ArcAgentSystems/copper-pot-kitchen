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

  it('EVERY @font-face swaps rather than blocking', () => {
    // `font-display: swap` is the difference between a slow font and invisible
    // text. FOIT on a supermarket connection is a blank screen.
    const faces = [...allCss.matchAll(/@font-face\s*\{([^}]+)\}/g)].map((m) => m[1] ?? '');

    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      expect(face, 'an @font-face does not declare font-display: swap').toMatch(
        /font-display:\s*swap/,
      );
    }
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

describe('viewport', () => {
  it('uses dvh, since the iOS Safari toolbar changes the viewport height', () => {
    expect(allCss).toMatch(/100dvh/);
    expect(allCss).not.toMatch(/min-height:\s*100vh/);
  });

  it('respects the safe area at both ends', () => {
    expect(allCss).toMatch(/env\(safe-area-inset-top\)/);
    expect(allCss).toMatch(/env\(safe-area-inset-bottom\)/);
  });
});
