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
    const heights = [...allCss.matchAll(/(?:min-)?height:\s*(\d+)px/g)]
      .map((m) => Number(m[1]))
      .filter((px) => px > 0);

    for (const px of heights) {
      expect(px, `a rule sets ${px}px, below the 44px floor`).toBeGreaterThanOrEqual(44);
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

    expect(families.length).toBeGreaterThanOrEqual(3);
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
 * COPPER CARRIES THE BRAND. AMBER CARRIES THE WARNING.
 *
 * `--accent` (#b87333) and `--unresolved` (#7f6115) contrast against each other
 * at 1.33:1 — the eye cannot separate them by brightness at all. The separation
 * is by TREATMENT, and this is the guard that keeps it:
 *
 *   copper  text, rules, borders, tick fills — never a filled background
 *   amber   a filled block                   — never bare text on the page
 *
 * Without this, "a little amber here as an accent" is one plausible commit away,
 * and the day it lands every warning in the app stops being the loudest thing on
 * its screen. Rule 8 is what is actually being protected.
 */
describe('amber is reserved for the unresolved signal', () => {
  /** Rules that mention amber at all. */
  const amberRules = [...allCss.matchAll(/([^{}]+)\{([^}]*--unresolved[^}]*)\}/g)].map((m) => ({
    selector: (m[1] ?? '').trim().split('\n').pop()?.trim() ?? '',
    body: m[2] ?? '',
  }));

  it('is used somewhere, or this guard is guarding nothing', () => {
    expect(amberRules.length).toBeGreaterThan(0);
  });

  it('NEVER appears without its own background', () => {
    // Amber as bare text on parchment would sit at the same brightness as copper
    // and read as ordinary chrome.
    for (const rule of amberRules) {
      const usesAmberInk = /color:\s*var\(--unresolved\)/.test(rule.body);
      if (!usesAmberInk) continue;

      const hasOwnGround =
        /background:\s*var\(--unresolved-bg\)/.test(rule.body) ||
        /border-left:[^;]*var\(--unresolved\)/.test(rule.body) ||
        // A child of a block that already set the ground.
        /unresolved-block/.test(rule.selector);

      expect(hasOwnGround, `${rule.selector} uses amber with no amber ground`).toBe(true);
    }
  });

  it('is NEVER used as an accent, a border colour or a tab indicator', () => {
    // The specific misuses. Each of these would put amber somewhere the eye
    // learns to ignore.
    for (const forbidden of [
      /--accent[a-z-]*:\s*var\(--unresolved/,
      /\.tabs[^{]*\{[^}]*var\(--unresolved/,
      /box-shadow:[^;]*var\(--unresolved\)/,
    ]) {
      expect(allCss, `amber is used decoratively: ${String(forbidden)}`).not.toMatch(forbidden);
    }
  });

  it('and copper is never used as the unresolved signal', () => {
    // The mirror image. A warning in copper is a warning nobody sees.
    expect(allCss).not.toMatch(/--unresolved[a-z-]*:\s*var\(--accent/);
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
