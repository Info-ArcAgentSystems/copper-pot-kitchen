/**
 * Shopping — the first DERIVED screen.
 *
 * Every screen before this one was a record editor: what the owner typed is what
 * got stored. This one stores almost nothing. The list is recomputed from jobs on
 * every view, through the engine, and the only thing that persists is his tick.
 *
 * That is Rule 6, and it is what makes the cascade automatic. Change a guest count
 * on Tuesday and Wednesday's shopping is already different — not because anything
 * rebuilt it, but because there was never a stored list to go stale.
 *
 * The temptation this screen must resist is caching the computed list "for speed".
 * `tests/ui/derived.test.ts` fails if it ever does.
 */

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { supabaseDb } from '../../data/client';
import {
  ingredientRepository,
  jobRepository,
  purchaseStateRepository,
  recipeRepository,
  stockRepository,
  supplierRepository,
} from '../../data/repositories';
import { requirementsForRange, outstandingShopping } from '../../engine/shopping';
import { buildShoppingView, shoppingText } from '../../ui/shoppingView';
import { EmptyState } from '../../ui/EmptyState';
import { useAsync } from '../../ui/useAsync';
import { Screen } from '../../ui/Screen';
import { SourceNotice } from '../../ui/SourceNotice';
import { sourceState, type DataSource } from '../../ui/sourceState';
import { useDateRange, type DateRange } from '../../ui/dateRange';
import { useKitchen } from '../../auth/kitchenState';
import { useUndoToast } from '../../ui/UndoToast';
import { tickedAt } from '../../ui/tickedAt';
import { useTickMotion } from '../../ui/tickMotion';
import type { IngredientId, IsoDate, KitchenId, StockUnit } from '../../engine/types';

/**
 * Which jobs are shopped for.
 *
 * Cancelled and completed jobs stay in the system (Rule 15) but are not bought
 * for, and an enquiry may never happen — buying for one is buying for a job that
 * does not exist. The screen states how many it excluded rather than filtering
 * silently: a filter the owner cannot see is a filter he cannot trust.
 */
const SHOPPABLE = new Set(['confirmed', 'in_prep']);



export function Shopping({ range }: { range?: DateRange }): ReactNode {
  const db = supabaseDb();
  const { state: kitchenState } = useKitchen();

  // A view default, not business data: it encodes no price, quantity or recipe,
  // and he can move it. Rule 1 is about what the app SHIPS knowing, and it ships
  // knowing nothing about his food.
  // The hook is called unconditionally (rules of hooks); when Service passes a
  // range down, its value wins and the local one simply goes unused.
  const local = useDateRange();
  const { from, to } = range ?? local;

  const jobs = useAsync(() => jobRepository(db).list(), []);
  const recipes = useAsync(() => recipeRepository(db).list(), []);
  const ingredients = useAsync(() => ingredientRepository(db).list(), []);
  const stock = useAsync(() => stockRepository(db).list(), []);
  const suppliers = useAsync(() => supplierRepository(db).list(), []);

  // Re-read whenever the window moves: a tick belongs to a window, so a different
  // window is a different set of ticks, not a stale version of these.
  const ticks = useAsync(
    () => purchaseStateRepository(db).forWindow(from as IsoDate, to as IsoDate),
    [from, to],
  );

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sources: readonly DataSource[] = [
    {
      what: 'your jobs',
      why: 'the list is worked out from them every time you open it',
      state: jobs.state,
      reload: jobs.reload,
    },
    {
      what: 'your recipes',
      why: 'they turn each job into ingredients',
      state: recipes.state,
      reload: recipes.reload,
    },
    {
      what: 'your ingredients',
      why: 'pack sizes and prices come from them',
      state: ingredients.state,
      reload: ingredients.reload,
    },
    {
      what: 'what you have in stock',
      why: 'it comes off what you need to buy',
      state: stock.state,
      reload: stock.reload,
    },
    {
      what: 'your suppliers',
      why: 'the list is grouped by them',
      state: suppliers.state,
      reload: suppliers.reload,
    },
    {
      what: 'what you have already bought',
      why: 'it comes off what is still outstanding',
      state: ticks.state,
      reload: ticks.reload,
    },
  ];
  const loaded = sourceState(sources);
  const ready = loaded.kind === 'ready';

  const jobList = jobs.state.status === 'ready' ? jobs.state.data : [];

  const inWindow = useMemo(
    () =>
      jobList.filter(
        (j) => j.serviceDate !== null && j.serviceDate >= from && j.serviceDate <= to,
      ),
    [jobList, from, to],
  );

  const shoppable = useMemo(() => inWindow.filter((j) => SHOPPABLE.has(j.status)), [inWindow]);
  const excluded = inWindow.length - shoppable.length;

  /**
   * THE DERIVATION. Runs on every render, from jobs, every time.
   *
   * `useMemo` is a render optimisation over inputs that are already in memory —
   * not a cache of the result. Nothing here is written down, which is the whole
   * point: there is no stored list that can disagree with the jobs.
   */
  const view = useMemo(() => {
    if (!ready) return null;

    const recipeList = recipes.state.status === 'ready' ? recipes.state.data : [];
    const ingredientList = ingredients.state.status === 'ready' ? ingredients.state.data : [];
    const stockList = stock.state.status === 'ready' ? stock.state.data : [];
    const supplierList = suppliers.state.status === 'ready' ? suppliers.state.data : [];
    const tickList = ticks.state.status === 'ready' ? ticks.state.data : [];

    const requirements = requirementsForRange(shoppable, recipeList, ingredientList);

    // What he has already bought is subtracted by the ENGINE, not here. The ticks
    // are an input to the cascade, not an edit to its output.
    const purchased = tickList.map((t) => ({
      ingredientId: t.ingredientId,
      qty: t.qtyBought,
    }));

    const outstanding = outstandingShopping(
      requirements.lines,
      stockList,
      purchased,
      ingredientList,
    );

    return {
      ...buildShoppingView(outstanding, requirements.gaps, ingredientList, supplierList),
      ticks: tickList,
    };
  }, [ready, shoppable, recipes.state, ingredients.state, stock.state, suppliers.state, ticks.state]);

  const setBought = async (
    ingredientId: IngredientId,
    unit: StockUnit,
    qtyBought: number,
    done: boolean,
  ): Promise<boolean> => {
    if (kitchenState.status !== 'ready') return false;
    setBusy(ingredientId);
    setError(null);

    try {
      await purchaseStateRepository(db).setBought(
        kitchenState.membership.kitchenId as KitchenId,
        ingredientId,
        from as IsoDate,
        to as IsoDate,
        { qtyBought, unit, done },
      );
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save that.');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const { show, toast } = useUndoToast();
  const motion = useTickMotion();

  /*
   * A TICK, end to end. The row plays its short "done" move WHILE the write is
   * in flight — never instead of it: the line only moves to "In the trolley"
   * once the write has succeeded and the ticks are re-read. A failed write
   * leaves the row where it was, unticked, with the error above.
   *
   * Re-read rather than patch local state: the tick feeds back INTO the cascade,
   * so the whole list is recomputed with it.
   */
  const tick = async (
    line: { readonly ingredientId: IngredientId; readonly name: string },
    unit: StockUnit,
    qty: number,
    done: boolean,
  ): Promise<void> => {
    const id = line.ingredientId;
    const [ok] = await Promise.all([
      setBought(id, unit, qty, done),
      done ? motion.leave(id) : Promise.resolve(),
    ]);
    motion.settle(id, ok);
    if (!ok) return;
    ticks.reload();
    if (done) {
      show(`${line.name} ticked`, () => {
        void setBought(id, unit, qty, false).then((back) => {
          if (back) {
            motion.settle(id, true);
            ticks.reload();
          }
        });
      });
    } else {
      show(`${line.name} is back on the list`);
    }
  };

  const copy = async (): Promise<void> => {
    if (view === null) return;
    const text = shoppingText(view, from, to);

    try {
      await navigator.clipboard.writeText(text);
      setError(null);
    } catch {
      // Clipboard access is refused often enough on iOS Safari that failing
      // silently would look like a dead button.
      setError('Could not copy. Select the text below and copy it by hand.');
    }
  };

  if (!ready) return <SourceNotice state={loaded} />;

  const tickFor = (ingredientId: IngredientId) =>
    view?.ticks.find((t) => t.ingredientId === ingredientId);

  return (
    <Screen>
      {/* NO TITLE AND NO DESCRIPTION. `Service` above this renders both, and
          the segmented control names this view — three statements of the same
          word before any content. The dates caption says what the window means
          here, which is the only part this view has of its own. */}

      {/* Printed only: what the paper copy is, and when it was made, so an old
          printout on the fridge can be told from today's. */}
      <div className="print-only print-head">
        <p className="print-title">Shopping list</p>
        <p>
          {from} – {to} · printed{' '}
          {new Date().toLocaleString('en-IE', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      </div>

      {/* The filter, stated. Rule 15 keeps cancelled and completed jobs; it does
          not mean buying for them. */}
      <p className="muted">
        {shoppable.length === 0
          ? 'No confirmed jobs in this window.'
          : `From ${shoppable.length} confirmed job${shoppable.length === 1 ? '' : 's'}.`}
        {excluded > 0 &&
          ` ${excluded} other job${excluded === 1 ? '' : 's'} in these dates ${excluded === 1 ? 'is' : 'are'} an enquiry, cancelled or already done — not bought for.`}
      </p>

      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {shoppable.length === 0 ? (
        <EmptyState
          title="Nothing to shop for yet"
          description="Confirm a job in these dates and its ingredients will appear here, worked out from the recipes on its menu."
        />
      ) : view !== null && view.nothingToBuy && view.checkYourself.length === 0 && view.needsFixing.length === 0 ? (
        <EmptyState
          title="Nothing to buy"
          description="Everything these jobs need is already in stock or bought."
        />
      ) : null}

      {/* How far through the list he is — counted from his own ticks over the
          lines shown, nothing else. */}
      {view !== null && view.groups.length > 0 && (() => {
        const lines = view.groups.flatMap((g) => g.lines);
        const got = lines.filter((l) => tickFor(l.ingredientId)?.done === true).length;
        return (
          <div className="progress-block">
            <div
              className="progress"
              role="progressbar"
              aria-label="Bought so far"
              aria-valuemin={0}
              aria-valuemax={lines.length}
              aria-valuenow={got}
              style={
                {
                  '--done': `${lines.length === 0 ? 0 : Math.round((got * 100) / lines.length)}%`,
                } as CSSProperties
              }
            />
            <p className="muted num">
              {got} of {lines.length} bought
            </p>
          </div>
        );
      })()}

      {view !== null && view.groups.length > 0 && (
        <div className="no-print list-actions">
          <button type="button" onClick={() => window.print()}>
            Print list
          </button>
        </div>
      )}

      {/*
       * STILL TO BUY, by supplier. A ticked line leaves its group and goes to
       * "In the trolley" below, so what is left is what he looks at. A supplier
       * with nothing left drops its heading rather than showing an empty box.
       */}
      {view?.groups.map((group) => {
        const left = group.lines.filter((l) => tickFor(l.ingredientId)?.done !== true);
        if (left.length === 0) return null;
        return (
          <section key={group.supplierName} className="supplier-group">
            <h2>
              {group.supplierName}
              <span className="muted num group-count"> · {left.length} left</span>
            </h2>

            <ul className="records">
              {left.map((line) => {
                const t = tickFor(line.ingredientId);
                const unit = (t?.qtyBought.unit ?? '') as StockUnit;
                const qty = t?.qtyBought.value ?? 0;
                const leaving = motion.isLeaving(line.ingredientId);

                return (
                  <li
                    key={line.ingredientId}
                    className={`shop-line${motion.classFor(line.ingredientId)}`}
                  >
                    <label className="check" {...motion.pointerProps}>
                      <input
                        type="checkbox"
                        checked={leaving}
                        disabled={busy === line.ingredientId || leaving}
                        onChange={(e) => {
                          void tick(line, unit, qty, e.target.checked);
                        }}
                      />
                      <span className="num buy">{line.buy ?? line.outstanding}</span>
                      <span className="shop-name">{line.name}</span>
                    </label>

                    <span className="muted num workings">{line.workings}</span>

                    {line.note !== null && <span className="unresolved">{line.note}</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {/* IN THE TROLLEY — ticked lines, with when. Tap one to put it back. Not
          printed: the paper copy is for what is still to buy. */}
      {view !== null &&
        (() => {
          const ticked = view.groups
            .flatMap((g) => g.lines)
            .filter((l) => tickFor(l.ingredientId)?.done === true);
          if (ticked.length === 0) return null;
          const now = new Date();
          return (
            <section className="supplier-group trolley no-print">
              <h2>
                In the trolley
                <span className="muted num group-count"> · {ticked.length}</span>
              </h2>
              <ul className="records">
                {ticked.map((line) => {
                  const t = tickFor(line.ingredientId);
                  const when = tickedAt(t?.updatedAt, now);
                  return (
                    <li
                      key={line.ingredientId}
                      className={`shop-line done${motion.classFor(line.ingredientId)}`}
                    >
                      <label className="check">
                        <input
                          type="checkbox"
                          checked
                          disabled={busy === line.ingredientId}
                          onChange={() => {
                            void tick(
                              line,
                              (t?.qtyBought.unit ?? '') as StockUnit,
                              t?.qtyBought.value ?? 0,
                              false,
                            );
                          }}
                        />
                        <span className="num buy">{line.buy ?? line.outstanding}</span>
                        <span className="shop-name">{line.name}</span>
                      </label>
                      {when !== null && <span className="num ticked-at">✓ {when}</span>}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })()}

      {/* Rule 8 at the surface: things the engine could NOT put a number on are
          shown, not omitted. An item he never sees is the same defect as a
          guessed quantity. */}
      {view !== null && view.checkYourself.length > 0 && (
        <section className="unresolved-block">
          <h2>Check these yourself</h2>
          <p>These cannot be worked out from what is recorded. They are not mistakes — they need your eye.</p>
          <ul>
            {view.checkYourself.map((item) => (
              <li key={item.label}>
                <strong>{item.label}</strong>
                <br />
                {item.why}
              </li>
            ))}
          </ul>
        </section>
      )}

      {view !== null && view.needsFixing.length > 0 && (
        <section className="needs-fixing">
          <h2>Needs fixing</h2>
          <p className="muted">
            Something is missing from your records, so these were left out of the quantities
            above.
          </p>
          <ul>
            {view.needsFixing.map((flag) => (
              <li key={flag.label}>
                {flag.label} <span className="muted">— fix in {flag.where}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view !== null && view.surplus.length > 0 && (
        <section>
          <h2>More than you need</h2>
          <p className="muted">Reported separately, never subtracted from something else.</p>
          <ul className="muted">
            {view.surplus.map((s) => (
              <li key={s.label}>{s.label}</li>
            ))}
          </ul>
        </section>
      )}

      {view !== null && !view.nothingToBuy && (
        <button type="button" className="no-print" onClick={() => void copy()}>
          Copy for WhatsApp
        </button>
      )}

      {toast}
    </Screen>
  );
}
