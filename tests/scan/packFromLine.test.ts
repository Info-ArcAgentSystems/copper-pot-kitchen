/**
 * Pack sizes printed on a receipt line — found by code, offered, never guessed.
 *
 * THE CASE THIS EXISTS FOR. A Tesco receipt said "RASPBERRIES 125G" and the
 * scanner answered "no pack size recorded — set one in Ingredients", as though
 * the size were nowhere to be found. It was on the line.
 */

import { describe, expect, it } from 'vitest';
import { packFromLine } from '../../src/scan/packFromLine';

describe('packFromLine — one plain size, or nothing', () => {
  it.each([
    ['RASPBERRIES 125G', 125, 'g'],
    ['JUICE ORANGE FC 2L', 2, 'l'],
    ['MILK 1.5LTR', 1.5, 'l'],
    ['FLOUR 1,5KG', 1.5, 'kg'],
    ['Cream 500 ml', 500, 'ml'],
    ['RED WINE 75CL', 75, 'cl'],
    ['BUTTER 250GR', 250, 'g'],
  ])('%s → %s %s', (line, size, unit) => {
    expect(packFromLine(line)).toMatchObject({ size, unit });
  });

  it('quotes the receipt back exactly as printed', () => {
    expect(packFromLine('RASPBERRIES 125G')?.said).toBe('125G');
  });

  it.each([
    ['STRAWBERRY', 'no size printed'],
    ['NAAN BREAD GC', 'no size printed'],
    ['BS BABY POTATO', 'no size printed'],
    ['EGGS 12', 'a count, not a size'],
    ['7UP REGULAR', 'a number inside a name'],
    ['VITAMIN B12', 'a number inside a word'],
    ['COKE 6X330ML', 'a multipack'],
    ['PEPSI 2 X 2L', 'a multipack, spaced'],
    ['WATER 6×500ML', 'a multipack, with ×'],
    ['TOMATOES 400G 4PK', 'a pack count after the size'],
    ['CHICKEN 1KG 500G', 'two sizes'],
    ['RICE 0KG', 'a zero size'],
  ])('%s → nothing (%s)', (line) => {
    expect(packFromLine(line)).toBeNull();
  });
});
