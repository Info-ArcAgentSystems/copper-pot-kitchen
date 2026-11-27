import { describe, expect, it } from 'vitest';
import { tickedAt } from '../../src/ui/tickedAt';

// Local-time constructors on both sides, so the test holds in any time zone.
const now = new Date(2026, 10, 28, 19, 5); // Sat 28 Nov 2026, 19:05

describe('tickedAt', () => {
  it('shows only the time for a tick made today', () => {
    expect(tickedAt(new Date(2026, 10, 28, 18, 42).toISOString(), now)).toBe('18:42');
  });

  it('adds the weekday for a tick made on another day', () => {
    expect(tickedAt(new Date(2026, 10, 24, 9, 5).toISOString(), now)).toBe('Tue 09:05');
  });

  it('shows nothing — not a guessed time — when there is no timestamp', () => {
    expect(tickedAt(null, now)).toBeNull();
    expect(tickedAt(undefined, now)).toBeNull();
    expect(tickedAt('', now)).toBeNull();
    expect(tickedAt('not a date', now)).toBeNull();
  });
});
