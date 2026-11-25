/**
 * "Add all new lines" — the checklist screen over `src/scan/bulkIngredients.ts`.
 *
 * One row per receipt line that is not in his ingredients yet. He fills what the
 * receipt cannot say — how he counts it — checks the name and the printed pack,
 * and one tap adds every complete row. Rows that still need him are left, not
 * guessed, and the button says how many.
 *
 * Written one ingredient at a time. A failure part-way names what was added and
 * what was not; nothing claims to have saved what it did not.
 */

import { useState, type ReactNode } from 'react';
import { supabaseDb } from '../../data/client';
import { ingredientRepository } from '../../data/repositories';
import {
  NEEDS_COUNT,
  packIsPrinted,
  rowProblem,
  rowToIngredient,
  startRows,
  type BulkRow,
} from '../../scan/bulkIngredients';
import { packFromLine } from '../../scan/packFromLine';
import type { Ingredient, KitchenId, SupplierId } from '../../engine/types';
import { Field } from '../../ui/Field';

export interface BulkResult {
  /** Added, with whether its pack is the size printed on its line. */
  readonly added: readonly { readonly description: string; readonly name: string; readonly printed: boolean }[];
  readonly failed: readonly { readonly name: string; readonly why: string }[];
}

export function AddAllIngredients({
  descriptions,
  existing,
  kitchenId,
  supplierId,
  onDone,
  onCancel,
}: {
  readonly descriptions: readonly string[];
  readonly existing: readonly Ingredient[];
  readonly kitchenId: KitchenId;
  readonly supplierId: SupplierId | null;
  readonly onDone: (result: BulkResult) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const [rows, setRows] = useState<BulkRow[]>(() => startRows(descriptions));
  const [busy, setBusy] = useState(false);

  const patch = (at: number, change: Partial<BulkRow>): void =>
    setRows((all) => all.map((r, i) => (i === at ? { ...r, ...change } : r)));

  const problemOf = (at: number): string | null => {
    const row = rows[at];
    if (row === undefined || !row.include) return null;
    return rowProblem(row, existing, rows.filter((_, i) => i !== at));
  };

  const ready = rows.filter((r, i) => r.include && problemOf(i) === null);
  const waiting = rows.filter((r, i) => r.include && problemOf(i) !== null).length;

  const addAll = async (): Promise<void> => {
    setBusy(true);
    const repo = ingredientRepository(supabaseDb());
    const added: { description: string; name: string; printed: boolean }[] = [];
    const failed: { name: string; why: string }[] = [];
    for (const row of ready) {
      try {
        await repo.create(rowToIngredient(row, kitchenId, supplierId));
        added.push({ description: row.description, name: row.name.trim(), printed: packIsPrinted(row) });
      } catch (cause) {
        failed.push({ name: row.name.trim(), why: cause instanceof Error ? cause.message : 'could not be saved' });
      }
    }
    setBusy(false);
    onDone({ added, failed });
  };

  return (
    <section className="units bulk-add">
      <h2>Add the new lines as ingredients</h2>
      <p className="muted">
        One row per line that isn’t in your ingredients yet. Say how you count each one — the
        receipt can’t tell that. A pack size is filled in only where the line prints it. Untick any
        you don’t want.
      </p>

      <ul className="bulk-rows">
        {rows.map((row, at) => {
          const problem = problemOf(at);
          const printed = packFromLine(row.description);
          return (
            <li key={row.description} className={row.include ? 'bulk-row' : 'bulk-row is-off'}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={row.include}
                  onChange={(e) =>
                    patch(at, { include: (e.currentTarget as unknown as { checked: boolean }).checked })
                  }
                />
                <span>
                  Add <strong>{row.description}</strong>
                </span>
              </label>

              {row.include && (
                <>
                  <Field label="Name" value={row.name} onChange={(v) => patch(at, { name: v })} required />
                  <Field
                    label="How you count it"
                    value={row.stockUnit}
                    onChange={(v) => patch(at, { stockUnit: v })}
                    placeholder="kg, L, each, bag…"
                    required
                  />
                  <div className="bulk-pack">
                    <Field
                      label="Pack size"
                      value={row.packSize}
                      onChange={(v) => patch(at, { packSize: v })}
                      inputMode="decimal"
                      numeric
                    />
                    <Field label="Pack unit" value={row.packUnit} onChange={(v) => patch(at, { packUnit: v })} />
                  </div>
                  {printed !== null && packIsPrinted(row) && (
                    <p className="muted">Pack from the receipt: “{printed.said}”.</p>
                  )}
                  {/* An empty "How you count it" box already asks; repeating it
                      under every fresh row is noise. Anything else is said. */}
                  {problem !== null && problem !== NEEDS_COUNT && (
                    <p className="unresolved">{problem}</p>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>

      <div className="actions">
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || ready.length === 0}
          onClick={() => void addAll()}
        >
          {busy
            ? 'Adding…'
            : `Add ${ready.length} ingredient${ready.length === 1 ? '' : 's'}`}
        </button>
      </div>
      {waiting > 0 && (
        <p className="muted">
          {waiting} ticked row{waiting === 1 ? ' still needs' : 's still need'} you — {waiting === 1 ? 'it is' : 'they are'} left
          out until filled in.
        </p>
      )}
    </section>
  );
}
