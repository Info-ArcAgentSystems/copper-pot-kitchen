/**
 * Saved menus and service types — matched by their letters, never guessed.
 *
 * THE CASE THIS EXISTS FOR. Paul's notebook says "B.B.Q"; his own menu, rate and
 * packing list say "BBQ". Compared as text they never met, so a scanned BBQ got
 * no menu, no rate and no packing list, with nothing on screen saying why.
 */

import { describe, expect, it } from 'vitest';
import { menuFor, ownSpelling, savedMenus, serviceTypeKey } from '../../src/engine/menus';
import type { KitchenId, MenuTemplate, MenuTemplateId, RecipeId } from '../../src/engine/types';

const row = (serviceType: string, recipeId: string, position: number): MenuTemplate => ({
  id: `${serviceType}-${recipeId}` as MenuTemplateId,
  kitchenId: 'k1' as KitchenId,
  serviceType,
  recipeId: recipeId as RecipeId,
  position,
});

const TEMPLATES = [
  row('BBQ', 'slaw', 2),
  row('BBQ', 'burgers', 0),
  row('BBQ', 'sausages', 1),
  row('Breakfast', 'full-irish', 0),
];

describe('serviceTypeKey — formatting only', () => {
  it.each([
    ['B.B.Q', 'bbq'],
    ['bbq', 'bbq'],
    ['B B Q', 'bbq'],
    ['Breakfast!', 'breakfast'],
  ])('%s → %s', (input, key) => {
    expect(serviceTypeKey(input)).toBe(key);
  });

  it('never makes different words the same — Barbecue is not BBQ', () => {
    expect(serviceTypeKey('Barbecue')).not.toBe(serviceTypeKey('BBQ'));
  });
});

describe('menuFor — his menu, in his order', () => {
  it('finds the BBQ menu for a sheet that wrote "B.B.Q"', () => {
    expect(menuFor('B.B.Q', TEMPLATES)).toEqual({
      serviceType: 'BBQ',
      recipeIds: ['burgers', 'sausages', 'slaw'],
    });
  });

  it('has nothing for a service type with no saved menu', () => {
    expect(menuFor('Buffet', TEMPLATES)).toBeNull();
  });

  it('has nothing for a job with no service type', () => {
    expect(menuFor(null, TEMPLATES)).toBeNull();
    expect(menuFor('  ', TEMPLATES)).toBeNull();
  });

  it('lists every menu once, by name', () => {
    expect(savedMenus(TEMPLATES).map((m) => m.serviceType)).toEqual(['BBQ', 'Breakfast']);
  });
});

describe('ownSpelling — offered, never swapped', () => {
  it('offers "BBQ" for a read "B.B.Q"', () => {
    expect(ownSpelling('B.B.Q', ['BBQ', 'Breakfast'])).toBe('BBQ');
  });

  it('says nothing when it already matches, or matches nothing he uses', () => {
    expect(ownSpelling('BBQ', ['BBQ'])).toBeNull();
    expect(ownSpelling('Buffet', ['BBQ'])).toBeNull();
    expect(ownSpelling(null, ['BBQ'])).toBeNull();
  });
});
