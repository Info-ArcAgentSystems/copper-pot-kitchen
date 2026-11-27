import { describe, expect, it } from 'vitest';
import { describeUse, groupChoice, groupNameProblem, groupUse } from '../../src/ui/clientGroups';
import type { ClientGroup, ClientGroupId, ClientRate, Customer, KitchenId } from '../../src/engine/types';

const g = (id: string, name: string): ClientGroup => ({ id: id as ClientGroupId, kitchenId: 'k' as KitchenId, name });
const groups = [g('g1', 'Priority'), g('g2', 'Holiday rentals')];

describe('groupNameProblem — one name per group, on letters and digits', () => {
  it('refuses a name another group already has, however it is spelled', () => {
    expect(groupNameProblem('priority.', groups, null)).toBe('“Priority” already exists.');
    expect(groupNameProblem('HOLIDAY RENTALS', groups, null)).toBe('“Holiday rentals” already exists.');
  });

  it('lets a group keep — or re-spell — its own name', () => {
    expect(groupNameProblem('PRIORITY', groups, 'g1' as ClientGroupId)).toBeNull();
  });

  it('needs letters or numbers', () => {
    expect(groupNameProblem(' ... ', groups, null)).toMatch(/letters or numbers/);
  });

  it('a genuinely new name is fine', () => {
    expect(groupNameProblem('Private clients', groups, null)).toBeNull();
  });
});

describe('groupUse — what still names a group', () => {
  const customers = [{ clientGroup: 'priority' }, { clientGroup: null }, { clientGroup: 'Priority.' }] as Customer[];
  const rates = [{ clientGroup: 'Priority' }, { clientGroup: 'Holiday rentals' }] as ClientRate[];

  it('counts customers and rates by key', () => {
    expect(groupUse(groups[0]!, customers, rates)).toEqual({ customers: 2, rates: 1 });
    expect(describeUse(groupUse(groups[0]!, customers, rates))).toBe('2 customers · 1 rate');
  });

  it('an unused group says so', () => {
    expect(describeUse(groupUse(g('g3', 'Weddings'), customers, rates))).toBe('Not used yet');
  });
});

describe('groupChoice — the dropdown never changes a record by itself', () => {
  it('lists the groups, with an empty choice where a group is optional', () => {
    const c = groupChoice(groups, null, 'No group');
    expect(c.options.map((o) => o.value)).toEqual(['', 'Priority', 'Holiday rentals']);
    expect(c.selected).toBe('');
  });

  it('shows the group’s spelling for a stored variant', () => {
    expect(groupChoice(groups, 'priority', 'No group').selected).toBe('Priority');
  });

  it('keeps a stored group that is not in the list, labelled', () => {
    const c = groupChoice(groups, 'Weddings', null);
    expect(c.options[0]).toEqual({ value: 'Weddings', label: 'Weddings (not in Client groups)' });
    expect(c.selected).toBe('Weddings');
  });
});
