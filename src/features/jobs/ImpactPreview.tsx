/**
 * The live impact preview.
 *
 * CLAUDE.md section 4: "Guest-count change shows a live impact preview before
 * saving." This is that, and it is the reason the whole cascade exists.
 *
 * It computes NOTHING. `changeImpact` runs the entire engine twice — before and
 * after — and diffs; `impact.ts` is source-inspected to prove it holds no
 * arithmetic of its own, and this component holds none either. A preview that did
 * its own sums would drift from the engine and lie on the screen the owner uses
 * to decide.
 *
 * It is synchronous. The jobs, recipes and ingredients are loaded once by the
 * screen; every keystroke re-runs a pure function. No network per change.
 */

import type { ReactNode } from 'react';
import { changeImpact, type JobChanges } from '../../engine/impact';
import {
  explainNoFoodChange,
  hasImpact,
  moneyLine,
  quantityLines,
  type SummaryLine,
} from '../../ui/impactSummary';
import type {
  ClientRate,
  Customer,
  Ingredient,
  Job,
  JobId,
  Recipe,
} from '../../engine/types';

function Row({ line }: { line: SummaryLine }): ReactNode {
  return (
    <tr>
      <th scope="row">{line.label}</th>
      <td className="num">{line.before}</td>
      <td className={`num delta-${line.direction}`}>{line.after}</td>
    </tr>
  );
}

export function ImpactPreview({
  jobs,
  recipes,
  ingredients,
  jobId,
  changes,
  customer,
  rates,
  guestsChanged,
}: {
  jobs: readonly Job[];
  recipes: readonly Recipe[];
  ingredients: readonly Ingredient[];
  jobId: JobId;
  changes: JobChanges;
  customer: Customer | undefined;
  rates: readonly ClientRate[];
  guestsChanged: boolean;
}): ReactNode {
  const impact = changeImpact(jobs, recipes, ingredients, jobId, changes, {
    customer,
    rates,
  });

  const quantities = quantityLines(impact);
  const money = [
    moneyLine('Revenue', impact.revenue),
    moneyLine('Food cost', impact.foodCost),
    moneyLine('Margin', impact.margin),
  ].filter((l): l is SummaryLine => l !== null);

  const saved = jobs.find((j) => j.id === jobId);
  const everyDishExplicit =
    saved !== undefined &&
    saved.dishes.length > 0 &&
    saved.dishes.every((d) => d.portions !== null);

  const noFoodReason = explainNoFoodChange(
    guestsChanged,
    quantities.length,
    everyDishExplicit,
  );

  if (!hasImpact(impact) && noFoodReason === null) return null;

  return (
    <section className="impact" aria-label="Impact of this change">
      <h2>If you save this</h2>

      {quantities.length + money.length > 0 && (
        <table className="impact-table">
          <thead>
            <tr>
              <th scope="col">What</th>
              <th scope="col">Now</th>
              <th scope="col">After</th>
            </tr>
          </thead>
          <tbody>
            {quantities.map((line) => (
              <Row key={line.label} line={line} />
            ))}
            {money.map((line) => (
              <Row key={line.label} line={line} />
            ))}
          </tbody>
        </table>
      )}

      {/* Silence would read as a broken preview. It is actually correct. */}
      {noFoodReason !== null && <p className="muted">{noFoodReason}</p>}

      {/* Rule 8 brought forward: a gap this change would OPEN is worth seeing
          before saving, not discovering on the shopping list afterwards. */}
      {impact.gapsIntroduced.length > 0 && (
        <div className="unresolved-block">
          <p className="unresolved">This change leaves something unresolved</p>
          <ul>
            {impact.gapsIntroduced.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      )}

      {impact.gapsResolved.length > 0 && (
        <div>
          <p className="muted">This change clears:</p>
          <ul className="muted">
            {impact.gapsResolved.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
