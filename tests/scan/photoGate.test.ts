/**
 * NO SCANNER GREYS ITS PHOTO BUTTONS WITHOUT SAYING WHY.
 *
 * The defect: all four scanners rendered
 *
 *     <PhotoSource disabled={busy || !ready} />
 *
 * where `ready` was a boolean over `status === 'ready'` across two or three
 * repository reads. A read that FAILED held `ready` false for the rest of the
 * session, so the buttons sat greyed with nothing on the screen to explain
 * them, and the reason — which `useAsync` had captured — was never looked at.
 * ScanJobSheet reads customers, properties and recipes, so it had three ways in.
 *
 * This guard is structural rather than a search for message strings, because
 * the honest fix is not "remember to add a message". It is that a scanner can no
 * longer reach the control: `PhotoGate` owns it, derives disabled from
 * `sourceState`, and renders the words. So what is asserted is the shape that
 * makes the silent state unwritable:
 *
 *   only PhotoGate renders PhotoSource     — a scanner has nothing to grey
 *   every scanner renders PhotoGate        — none has quietly opted out
 *   PhotoGate gates on sourceState         — not on a local boolean
 *   PhotoGate renders both non-ready cases — loading says so, failure says why
 *   PhotoGate offers the retry             — and it is wired to the state's own
 *
 * VERIFIED BY INVERSION. Putting `<PhotoSource>` back in a scanner, dropping
 * PhotoGate's failure branch, and swapping its `disabled` back to a bare `busy`
 * each turn a test below red. A guard nobody has watched fail guards nothing.
 *
 * The behaviour under those states is proven in `tests/ui/sourceState.test.ts`,
 * which walks all 27 combinations of three reads under plain Node. Between the
 * two: the words exist for every non-ready state, and this is the only place
 * that can render the control they belong to.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCAN_UI = fileURLToPath(new URL('../../src/features/scan', import.meta.url));

const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const read = (file: string): string => strip(readFileSync(join(SCAN_UI, file), 'utf8'));

/** The four screens that take a photograph. Each needs its own records first. */
const SCANNERS = ['ScanJobSheet.tsx', 'ScanRecipeCard.tsx', 'ScanMenu.tsx', 'ScanInvoice.tsx'];

/** The component that owns the control, and the only file allowed to render it. */
const GATE = 'PhotoGate.tsx';

const everyScanFile = (): string[] =>
  readdirSync(SCAN_UI).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'));

describe('the four scanners are all here', () => {
  it('each file exists', () => {
    // Without this, a rename would make every assertion below vacuously pass —
    // the worst outcome for a regression guard.
    const present = everyScanFile();
    for (const scanner of SCANNERS) {
      expect(present, `${scanner} is missing — update this guard deliberately`).toContain(scanner);
    }
    expect(present).toContain(GATE);
    expect(present).toContain('PhotoSource.tsx');
  });
});

describe('only PhotoGate can render the photo buttons', () => {
  it('no other file renders PhotoSource', () => {
    for (const file of everyScanFile()) {
      if (file === GATE || file === 'PhotoSource.tsx') continue;

      expect(read(file), `${file} renders PhotoSource directly`).not.toContain('<PhotoSource');
      expect(read(file), `${file} imports PhotoSource directly`).not.toContain(
        "from './PhotoSource'",
      );
    }
  });

  it('PhotoGate renders it', () => {
    expect(read(GATE)).toContain('<PhotoSource');
  });
});

describe('every scanner goes through the gate', () => {
  it.each(SCANNERS)('%s renders PhotoGate with its own reads', (scanner) => {
    const code = read(scanner);

    expect(code).toContain('<PhotoGate');
    // The reads it cannot match names without, named in the owner's words.
    expect(code).toContain('sources={sources}');
    expect(code).toMatch(/const sources: readonly DataSource\[\] = \[/);
  });

  it.each(SCANNERS)('%s keeps no readiness boolean of its own', (scanner) => {
    const code = read(scanner);

    // The exact shape that went wrong. Narrowing a single state to reach its
    // data is still fine and still necessary; what is forbidden is a screen
    // deciding on its own that it is not ready.
    expect(code, `${scanner} computes its own readiness`).not.toMatch(/const ready\b/);
    expect(code, `${scanner} gates on a bare !ready`).not.toContain('!ready');
    expect(code, `${scanner} disables the photo control itself`).not.toMatch(
      /disabled=\{[^}]*\bready\b/,
    );
  });

  it.each(SCANNERS)('%s names each read and what it is for', (scanner) => {
    const code = read(scanner);

    // A `what` with no `why` is half a sentence: it tells him something failed
    // without telling him what it costs.
    const whats = code.match(/what: '/g) ?? [];
    const whys = code.match(/why: '/g) ?? [];
    const reloads = code.match(/reload: /g) ?? [];

    expect(whats.length).toBeGreaterThan(0);
    expect(whys.length).toBe(whats.length);
    // Every source carries its own reload, or "Try again" would be a dead button.
    expect(reloads.length).toBe(whats.length);
  });
});

describe('PhotoGate cannot be silently disabled', () => {
  const gate = (): string => read(GATE);

  it('derives disabled from the source state, not from a local boolean', () => {
    // Pinned exactly. `disabled={busy}` alone would restore the original defect
    // in a form that still reads correctly, which is why the whole expression is
    // asserted rather than its parts.
    expect(gate()).toContain("disabled={busy || state.kind !== 'ready'}");
    expect(gate()).toContain('sourceState(sources)');
  });

  it('renders the words for a FAILED read, with the failure’s own reason', () => {
    const code = gate();

    /*
     * ANCHORED ON THE OPENING BRACE, and that is the whole lesson of this file.
     * The first version of this assertion looked for `state.kind === 'failed'`
     * anywhere in the source — and passed against
     *
     *     {false && state.kind === 'failed' && (
     *
     * which is the defect restored with the evidence of the fix still in place.
     * Found by inverting this guard rather than by reasoning about it. Anchoring
     * on `{` pins the START of the JSX expression, so nothing can be put in
     * front of the condition without this going red.
     */
    expect(code).toContain("{state.kind === 'failed' && (");
    expect(code).toContain('failure.message');
    // The detail is the part that was being thrown away.
    expect(code).toContain('failure.detail');
    expect(code).toContain('role="alert"');
  });

  it('offers a retry wired to the state that failed', () => {
    const code = gate();

    expect(code).toContain('Try again');
    expect(code).toContain('onClick={state.retry}');
  });

  it('says it is loading while it is loading', () => {
    const code = gate();

    // Anchored for the same reason as the failure branch above.
    expect(code).toContain("{state.kind === 'loading' && ");
    expect(code).toContain('state.message');
  });

  it('holds no message copy of its own — the words come from one place', () => {
    // Four screens each inventing their own phrasing is how "could not be read"
    // ended up meaning three different things.
    expect(gate()).not.toMatch(/Could not load/);
    expect(gate()).not.toMatch(/Loading your/);
  });
});
