/**
 * Rule 16 — the meat-eating guest count.
 *
 * This is the one place in the engine that turns dietaries into a headcount, and
 * the only place allowed to subtract anything from a guest count. Written before
 * the implementation, per CLAUDE.md section 5.
 *
 * The defect this guards against: a guest who is both vegan and coeliac being
 * counted twice, so meat portions are under-ordered.
 */

import { describe, expect, it } from 'vitest';
import { meatEatingGuests } from '../../src/engine/rules';
import { allocated, makeJob, unresolved } from './factories';

const noMeat = { excludesMeat: true } as const;

describe('meatEatingGuests', () => {
  it("returns the owner's figure when set, ignoring the dietaries entirely", () => {
    const job = makeJob({
      guests: 27,
      meatEatingGuests: 22,
      // Deliberately inconsistent with 22. The owner's number still wins.
      dietaries: [allocated('g1', noMeat)],
    });

    expect(meatEatingGuests(job)).toBe(22);
  });

  it('derives 22 from 27 guests and 5 distinct meat-excluding guests', () => {
    // The CALC-NUCELLA-BBQ-SPLIT shape: 4 salmon vegetarians + 1 vegan.
    const job = makeJob({
      guests: 27,
      meatEatingGuests: null,
      dietaries: [
        allocated('g1', noMeat),
        allocated('g2', noMeat),
        allocated('g3', noMeat),
        allocated('g4', noMeat),
        allocated('g5', noMeat),
      ],
    });

    expect(meatEatingGuests(job)).toBe(22);
  });

  it('counts a guest with TWO requirements once, not twice', () => {
    // The Rule 16 defect in miniature. Summing categories would give 24.
    const job = makeJob({
      guests: 27,
      meatEatingGuests: null,
      dietaries: [
        allocated('g1', { ...noMeat, dietType: 'vegan' }),
        allocated('g1', { ...noMeat, dietType: 'coeliac' }),
        allocated('g2', { ...noMeat, dietType: 'vegan' }),
      ],
    });

    expect(meatEatingGuests(job)).toBe(25);
  });

  it('ignores dietaries that do not exclude meat', () => {
    const job = makeJob({
      guests: 10,
      meatEatingGuests: null,
      dietaries: [
        allocated('g1', { excludesMeat: false, dietType: 'nut allergy' }),
        allocated('g2', noMeat),
      ],
    });

    expect(meatEatingGuests(job)).toBe(9);
  });

  it('returns null when ANY dietary is unresolved (Rules 8 and 12)', () => {
    const job = makeJob({
      guests: 27,
      meatEatingGuests: null,
      dietaries: [
        allocated('g1', noMeat),
        unresolved('a few vegetarians', noMeat),
      ],
    });

    // 26 would be the plausible wrong answer: it treats "a few" as zero.
    expect(meatEatingGuests(job)).toBeNull();
  });

  it("returns the owner's figure even when a dietary is unresolved", () => {
    const job = makeJob({
      guests: 27,
      meatEatingGuests: 22,
      dietaries: [unresolved('a few vegetarians', noMeat)],
    });

    expect(meatEatingGuests(job)).toBe(22);
  });

  it('returns null when the guest count is unknown', () => {
    const job = makeJob({
      guests: null,
      meatEatingGuests: null,
      dietaries: [allocated('g1', noMeat)],
    });

    expect(meatEatingGuests(job)).toBeNull();
  });

  it('returns the full guest count when there are no dietaries', () => {
    expect(meatEatingGuests(makeJob({ guests: 12 }))).toBe(12);
  });

  it('never returns a negative count', () => {
    // More meat-excluding guests recorded than guests. Data is wrong, but the
    // engine must not hand back a negative headcount.
    const job = makeJob({
      guests: 2,
      meatEatingGuests: null,
      dietaries: [allocated('g1', noMeat), allocated('g2', noMeat), allocated('g3', noMeat)],
    });

    expect(meatEatingGuests(job)).toBe(0);
  });
});
