/**
 * Revenue by week: every figure is the engine's `rangeMoney`, every bar says how
 * sure it is, and the headline only compares weeks that are whole and fully priced.
 */
import { describe, expect, it } from 'vitest';
import { latestComparison, mondayOf, moneyWeeks } from '../../src/ui/moneyWeeks';
import type {
  Cents,
  ClientRate,
  ClientRateId,
  Customer,
  CustomerId,
  IsoDate,
  Job,
  JobId,
  KitchenId,
} from '../../src/engine/types';

const K = 'k1' as KitchenId;

const job = (id: string, date: string, over: Partial<Job> = {}): Job => ({
  id: id as JobId,
  kitchenId: K,
  customerId: 'c1' as CustomerId,
  propertyId: null,
  jobGroup: null,
  serviceDate: date as IsoDate,
  serviceTime: null,
  serviceType: 'Breakfast',
  guests: 10,
  guestsConfirmed: true,
  meatEatingGuests: null,
  pricing: { kind: 'rate_card' },
  status: 'confirmed',
  notes: null,
  dishes: [],
  dietaries: [],
  extras: [],
  ...over,
});

const customers: Customer[] = [
  { id: 'c1' as CustomerId, kitchenId: K, name: 'Aoife', phone: null, email: null, clientGroup: 'Birthday Rentals', notes: null },
];
// €20 flat for a Breakfast; no rate for BBQ — the real live state.
const rates: ClientRate[] = [
  { id: 'r1' as ClientRateId, kitchenId: K, clientGroup: 'Birthday Rentals', serviceType: 'Breakfast', ratePerHead: null, flatFee: 2000 as Cents },
];

describe('mondayOf', () => {
  it('finds the Monday on or before a date', () => {
    expect(mondayOf('2026-11-22')).toBe('2026-11-16'); // Sunday
    expect(mondayOf('2026-11-16')).toBe('2026-11-16'); // Monday
    expect(mondayOf('2026-11-28')).toBe('2026-11-23'); // Saturday
  });
});

describe('moneyWeeks', () => {
  it('reproduces the live state: one partly priced week, and gaps that are not zeros', () => {
    const jobs = [
      job('bbq', '2026-11-20', { serviceType: 'B.B.Q' }),
      job('breakfast', '2026-11-22'),
    ];
    const weeks = moneyWeeks(jobs, '2026-11-09', '2026-11-29', customers, rates, [], []);

    expect(weeks.map((w) => [w.start, w.state])).toEqual([
      ['2026-11-09', 'none'],
      ['2026-11-16', 'partial'],
      ['2026-11-23', 'none'],
    ]);
    const mid = weeks[1];
    expect(mid?.revenue).toEqual({ total: 2000, priced: 1, unpriced: 1 });
    expect(mid?.label).toBe('16 Nov');
  });

  it('marks a week with jobs but no price as unpriced, not as zero', () => {
    const weeks = moneyWeeks([job('bbq', '2026-11-20', { serviceType: 'BBQ' })], '2026-11-16', '2026-11-22', customers, rates, [], []);
    expect(weeks[0]?.state).toBe('unpriced');
    expect(weeks[0]?.revenue.total).toBeNull();
  });

  it('marks weeks the window cuts as clipped', () => {
    const weeks = moneyWeeks([], '2026-11-18', '2026-11-25', customers, rates, [], []);
    expect(weeks.map((w) => w.clipped)).toEqual([true, true]);
  });

  it('leaves out jobs outside the window even inside a drawn week', () => {
    const weeks = moneyWeeks([job('early', '2026-11-16')], '2026-11-18', '2026-11-22', customers, rates, [], []);
    expect(weeks[0]?.state).toBe('none');
  });
});

describe('latestComparison', () => {
  it('compares only whole, fully priced weeks', () => {
    const jobs = [
      job('a', '2026-11-03'),
      job('b', '2026-11-10'),
      job('c', '2026-11-17'),
      job('d', '2026-11-18', { serviceType: 'BBQ' }), // makes the 16 Nov week partial
    ];
    const weeks = moneyWeeks(jobs, '2026-11-02', '2026-11-22', customers, rates, [], []);
    const cmp = latestComparison(weeks);

    expect(cmp?.latest.start).toBe('2026-11-09');
    expect(cmp?.previous.start).toBe('2026-11-02');
    expect(cmp?.adjacent).toBe(true);
  });

  it('says nothing when fewer than two weeks can be compared', () => {
    const weeks = moneyWeeks([job('a', '2026-11-03')], '2026-11-02', '2026-11-15', customers, rates, [], []);
    expect(latestComparison(weeks)).toBeNull();
  });
});
