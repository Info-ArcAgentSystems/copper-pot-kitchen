/**
 * Saved menus and service types — matched by their letters, never guessed.
 *
 * THE CASE THIS EXISTS FOR. Paul's notebook says "B.B.Q"; his own menu, rate and
 * packing list say "BBQ". Compared as text they never met, so a scanned BBQ got
 * no menu, no rate and no packing list, with nothing on screen saying why.
 */

import { describe, expect, it } from 'vitest';
import {
  menuFor,
  menuToSave,
  ownSpelling,
  savedMenus,
  serviceTypeFromMenus,
  serviceTypeKey,
} from '../../src/engine/menus';
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

const ids = (...xs: string[]): RecipeId[] => xs.map((x) => x as RecipeId);

describe('menuToSave — a job\'s dishes become his menu, never overwrite one', () => {
  it('offers a first Breakfast menu from a breakfast job, in his order', () => {
    expect(menuToSave('Brunch', ids('eggs', 'toast'), TEMPLATES)).toEqual({
      serviceType: 'Brunch',
      recipeIds: ids('eggs', 'toast'),
    });
  });

  it('keeps his spelling, trimmed, and saves a repeated dish once', () => {
    expect(menuToSave('  Brunch ', ids('eggs', 'toast', 'eggs'), TEMPLATES)).toEqual({
      serviceType: 'Brunch',
      recipeIds: ids('eggs', 'toast'),
    });
  });

  it('never replaces a menu he already has — "B.B.Q" is his BBQ', () => {
    expect(menuToSave('BBQ', ids('burgers'), TEMPLATES)).toBeNull();
    expect(menuToSave('B.B.Q', ids('burgers', 'corn'), TEMPLATES)).toBeNull();
  });

  it('offers nothing without a service type or without dishes', () => {
    expect(menuToSave(null, ids('eggs'), TEMPLATES)).toBeNull();
    expect(menuToSave('  ', ids('eggs'), TEMPLATES)).toBeNull();
    expect(menuToSave('...', ids('eggs'), TEMPLATES)).toBeNull();
    expect(menuToSave('Brunch', [], TEMPLATES)).toBeNull();
  });
});

describe('serviceTypeFromMenus — dishes on the page, no service named', () => {
  it('offers Breakfast when every dish is on the Breakfast menu', () => {
    expect(serviceTypeFromMenus(ids('full-irish'), TEMPLATES)).toBe('Breakfast');
  });

  it('a page listing part of a menu still fits it', () => {
    expect(serviceTypeFromMenus(ids('burgers', 'slaw'), TEMPLATES)).toBe('BBQ');
  });

  it('a dish on no menu means no offer — it is not on his BBQ', () => {
    expect(serviceTypeFromMenus(ids('burgers', 'lasagne'), TEMPLATES)).toBeNull();
  });

  it('dishes from two different menus fit neither', () => {
    expect(serviceTypeFromMenus(ids('burgers', 'full-irish'), TEMPLATES)).toBeNull();
  });

  it('dishes on two menus at once are a guess, so nothing is offered', () => {
    const both = [...TEMPLATES, row('Party', 'slaw', 0), row('Party', 'burgers', 1)];
    expect(serviceTypeFromMenus(ids('burgers', 'slaw'), both)).toBeNull();
    expect(serviceTypeFromMenus(ids('sausages'), both)).toBe('BBQ');
  });

  it('no dishes, no offer', () => {
    expect(serviceTypeFromMenus([], TEMPLATES)).toBeNull();
  });
});
