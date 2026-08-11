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

import { useMemo, useState, type ReactNode } from 'react';
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
import { Field } from '../../ui/Field';
import { useAsync } from '../../ui/useAsync';
import { useKitchen } from '../../auth/kitchenState';
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

const addDays = (date: string, days: number): string => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
};

const today = (): string => new Date().toISOString().slice(0, 10);

export function Shopping(): ReactNode {
  const db = supabaseDb();
  const { state: kitchenState } = useKitchen();

  // A view default, not business data: it encodes no price, quantity or recipe,
  // and he can move it. Rule 1 is about what the app SHIPS knowing, and it ships
  // knowing nothing about his food.
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(() => addDays(today(), 7));

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

  const ready =
    jobs.state.status === 'ready' &&
    recipes.state.status === 'ready' &&
    ingredients.state.status === 'ready' &&
    stock.state.status === 'ready' &&
    suppliers.state.status === 'ready' &&
    ticks.state.status === 'ready';

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
  ): Promise<void> => {
    if (kitchenState.status !== 'ready') return;
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
      // Re-read rather than patching local state: the tick feeds back INTO the
      // cascade, so the whole list is recomputed with it. That is the behaviour
      // being demonstrated, not a refresh for tidiness.
      ticks.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save that.');
    } finally {
      setBusy(null);
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

  if (!ready) {
    const failed = [jobs.state, recipes.state, ingredients.state, stock.state, suppliers.state, ticks.state]
      .find((s) => s.status === 'error');

    if (failed !== undefined && failed.status === 'error') {
      return (
        <div>
          <h1>Shopping</h1>
          <p className="error" role="alert">Could not load: {failed.error.message}</p>
        </div>
      );
    }
    return <p className="muted">Working it out…</p>;
  }

  const tickFor = (ingredientId: IngredientId) =>
    view?.ticks.find((t) => t.ingredientId === ingredientId);

  return (
    <div>
      <h1>Shopping</h1>

      <fieldset className="units">
        <legend>Which dates</legend>
        <Field label="From" value={from} onChange={setFrom} type="date" />
        <Field label="To" value={to} onChange={setTo} type="date" />
        <p className="hint muted">
          Ticks belong to these dates. Change the window and you are looking at a different
          shop, not losing the one you ticked.
        </p>
      </fieldset>

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

      {view?.groups.map((group) => (
        <section key={group.supplierName} className="supplier-group">
          <h2>{group.supplierName}</h2>

          <ul className="records">
            {group.lines.map((line) => {
              const tick = tickFor(line.ingredientId);
              const done = tick?.done ?? false;

              return (
                <li key={line.ingredientId} className={done ? 'shop-line done' : 'shop-line'}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={done}
                      disabled={busy === line.ingredientId}
                      onChange={(e) => {
                        void setBought(
                          line.ingredientId,
                          (tick?.qtyBought.unit ?? '') as StockUnit,
                          tick?.qtyBought.value ?? 0,
                          e.target.checked,
                        );
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
      ))}

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
        <button type="button" onClick={() => void copy()}>
          Copy for WhatsApp
        </button>
      )}
    </div>
  );
}
