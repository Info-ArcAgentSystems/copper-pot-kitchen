/**
 * Turning an `ImpactResult` into lines a person can read.
 *
 * PURE. No React, no engine maths — `changeImpact` already computed everything,
 * and `impact.ts` is source-inspected to prove it holds no arithmetic of its own.
 * A preview that did its own sums would be exactly the drift that function exists
 * to prevent, so this file only formats.
 */

import { formatMoney } from './form';
import type { ImpactResult, MoneyDelta } from '../engine/impact';

export interface SummaryLine {
  readonly label: string;
  readonly before: string;
  readonly after: string;
  /** 'up' | 'down' | 'same' — for emphasis only, never for a calculation. */
  readonly direction: 'up' | 'down' | 'same';
}

const direction = (before: number, after: number): SummaryLine['direction'] =>
  after > before ? 'up' : after < before ? 'down' : 'same';

const trimNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));

/** Batch and ingredient movements, skipping anything that did not change. */
export function quantityLines(impact: ImpactResult): SummaryLine[] {
  const lines: SummaryLine[] = [];

  for (const batch of impact.batches) {
    if (batch.batches !== null && batch.batches.delta !== 0) {
      lines.push({
        label: `${batch.recipeName} — batches`,
        before: trimNumber(batch.batches.before),
        after: trimNumber(batch.batches.after),
        direction: direction(batch.batches.before, batch.batches.after),
      });
    } else if (batch.portions.delta !== 0) {
      lines.push({
        label: `${batch.recipeName} — portions`,
        before: trimNumber(batch.portions.before),
        after: trimNumber(batch.portions.after),
        direction: direction(batch.portions.before, batch.portions.after),
      });
    }
  }

  for (const ingredient of impact.ingredients) {
    if (ingredient.required.delta === 0) continue;
    lines.push({
      label: ingredient.name,
      before: `${trimNumber(ingredient.required.before)} ${ingredient.unit}`,
      after: `${trimNumber(ingredient.required.after)} ${ingredient.unit}`,
      direction: direction(ingredient.required.before, ingredient.required.after),
    });
  }

  return lines;
}

/**
 * A money row.
 *
 * Null-safe by construction. A revenue that was unknown and becomes €360 must
 * read "was unknown, now €360" — never as a €360 increase, because there is no
 * increase from an unknown. `MoneyDelta` carries both sides for this reason.
 */
export function moneyLine(label: string, money: MoneyDelta): SummaryLine | null {
  if (money.before === null && money.after === null) return null;
  if (money.delta === 0) return null;

  return {
    label,
    before: formatMoney(money.before, 'unknown'),
    after: formatMoney(money.after, 'unknown'),
    direction:
      money.delta === null
        ? 'same'
        : direction(0, money.delta as unknown as number),
  };
}

/**
 * Why a guest-count change moved no food.
 *
 * Ingredients follow the guest count only when a dish has NO portions set, so
 * `applyBuffetSplit` derives them. With portions typed in, the owner's numbers
 * win and guests move revenue alone — which is correct, but silence would read
 * as a broken preview.
 */
export function explainNoFoodChange(
  guestsChanged: boolean,
  quantityLineCount: number,
  everyDishHasExplicitPortions: boolean,
): string | null {
  if (!guestsChanged || quantityLineCount > 0) return null;

  return everyDishHasExplicitPortions
    ? 'No change to food: every dish has its portions set by hand, so the guest count does not drive them. Clear a dish’s portions to let the guest count decide.'
    : 'No change to food: nothing on this menu scales with the guest count.';
}

/** True when the change is worth showing a preview for at all. */
export function hasImpact(impact: ImpactResult): boolean {
  return (
    quantityLines(impact).length > 0 ||
    moneyLine('Revenue', impact.revenue) !== null ||
    moneyLine('Food cost', impact.foodCost) !== null ||
    impact.gapsIntroduced.length > 0 ||
    impact.gapsResolved.length > 0
  );
}
