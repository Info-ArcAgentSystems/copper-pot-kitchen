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

import { readFileSync, readdirSync } from 'node:fs';
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

describe('loads on a supermarket connection', () => {
  it('uses a system font stack rather than fetching a webfont', () => {
    expect(tokens).toMatch(/--font:\s*-apple-system/);
    expect(allCss).not.toMatch(/@import\s+url|@font-face/);
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
