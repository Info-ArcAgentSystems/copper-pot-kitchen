/**
 * "Needs you" orders by what a mistake costs and never invents a figure: every
 * count it shows is one handed to it.
 */
import { describe, expect, it } from 'vitest';
import { needsYou } from '../../src/ui/needsYou';
import type { DashboardView } from '../../src/ui/dashboardView';

type Input = Parameters<typeof needsYou>[0];

const calm: Input = {
  dietary: [],
  anomalies: [],
  money: {
    jobs: 0,
    revenue: { total: null, priced: 0, unpriced: 0 },
    foodCost: { total: null, costed: 0, uncosted: 0 },
    margin: { total: null, withMargin: 0, withoutMargin: 0 },
    cancelled: { jobs: 0, revenue: { total: null, priced: 0, unpriced: 0 } },
    missing: [],
  } as unknown as DashboardView['money'],
  shopping: { outstanding: 0, blocked: 0 },
  enquiries: 0,
  backup: { state: 'known', at: '2026-11-27', daysAgo: 1, message: 'Last backup 1 day ago.' },
};

const anomaly = (severity: string, detail: string) =>
  ({ jobId: 'j1', reason: 'r', severity, detail }) as unknown as DashboardView['anomalies'][number];

describe('needsYou', () => {
  it('says nothing when nothing was found', () => {
    expect(needsYou(calm)).toEqual([]);
  });

  it('orders safety, then money, then decisions, then the rest', () => {
    const items = needsYou({
      ...calm,
      dietary: [{ detail: 'Coeliac guest — no dish assigned' }] as unknown as DashboardView['dietary'],
      anomalies: [anomaly('low', 'Buffet has no dessert'), anomaly('critical', 'BBQ has meat but no sides')],
      money: {
        ...calm.money,
        revenue: { total: null, priced: 1, unpriced: 2 },
        foodCost: { total: null, costed: 0, uncosted: 3 },
      },
      shopping: { outstanding: 4, blocked: 1 },
      enquiries: 2,
      backup: { state: 'never', at: null, daysAgo: null, message: 'No backup recorded on this device.' },
    });

    expect(items.map((i) => i.key)).toEqual([
      'dietary',
      'anomaly-j1-r',
      'unpriced',
      'uncosted',
      'blocked',
      'enquiries',
      'minor',
      'backup',
    ]);
    expect(items.map((i) => i.tone)).toEqual([
      'safety',
      'safety',
      'money',
      'money',
      'money',
      'plain',
      'plain',
      'plain',
    ]);
  });

  it('uses the counts it is given, worded for one and many', () => {
    const one = needsYou({ ...calm, money: { ...calm.money, revenue: { total: null, priced: 0, unpriced: 1 } } });
    expect(one[0]?.title).toBe('1 job has no price');

    const two = needsYou({ ...calm, enquiries: 2 });
    expect(two[0]?.title).toBe('2 enquiries not confirmed');
  });

  it('sends each item to the screen that fixes it', () => {
    const items = needsYou({
      ...calm,
      money: { ...calm.money, revenue: { total: null, priced: 0, unpriced: 1 } },
      shopping: { outstanding: 0, blocked: 2 },
    });
    expect(items.map((i) => i.action.to)).toEqual(['/setup/rates', '/service/shopping']);
  });

  it('counts dietary ISSUES, never guests (Rule 16), in review language (Rule 9)', () => {
    const items = needsYou({
      ...calm,
      dietary: [{ detail: 'a' }, { detail: 'b' }] as unknown as DashboardView['dietary'],
    });
    expect(items[0]?.title).toBe('Dietary — 2 possible conflicts to review');
    expect(items[0]?.title).not.toMatch(/safe/i);
  });
});
