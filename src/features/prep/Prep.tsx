/**
 * Prep — the second derived screen.
 *
 * Same Rule 6 shape as Shopping: the plan is recomputed from jobs on every view
 * and only the tick persists. Nothing about the days, the tray counts or the
 * allocations is stored, so none of it can disagree with the jobs it came from.
 *
 * `tests/ui/derived.test.ts` covers this feature as well as Shopping, and fails if
 * it ever writes anything but its own tick.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { supabaseDb } from '../../data/client';
import {
  customerRepository,
  ingredientRepository,
  jobRepository,
  prepStateRepository,
  recipeRepository,
} from '../../data/repositories';
import { prepPlanByDay, productionBuckets } from '../../engine/production';
import { requirementsForRange } from '../../engine/shopping';
import { buildPrepView } from '../../ui/prepView';
import { EmptyState } from '../../ui/EmptyState';
import { Field } from '../../ui/Field';
import { useAsync } from '../../ui/useAsync';
import { useKitchen } from '../../auth/kitchenState';
import type { IsoDate, KitchenId, RecipeId } from '../../engine/types';

/**
 * Which jobs are prepped for. Same rule as Shopping.
 *
 * `productionBuckets` already skips cancelled jobs itself, so that part is the
 * engine's and is deliberately not repeated here — two filters for one rule is two
 * places for it to drift.
 */
const PREPPABLE = new Set(['confirmed', 'in_prep']);

const addDays = (date: string, days: number): string => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
};

const today = (): string => new Date().toISOString().slice(0, 10);

export function Prep(): ReactNode {
  const db = supabaseDb();
  const { state: kitchenState } = useKitchen();

  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(() => addDays(today(), 7));

  const jobs = useAsync(() => jobRepository(db).list(), []);
  const recipes = useAsync(() => recipeRepository(db).list(), []);
  const ingredients = useAsync(() => ingredientRepository(db).list(), []);
  const customers = useAsync(() => customerRepository(db).list(), []);
  const ticks = useAsync(
    () => prepStateRepository(db).forRange(from as IsoDate, to as IsoDate),
    [from, to],
  );

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready =
    jobs.state.status === 'ready' &&
    recipes.state.status === 'ready' &&
    ingredients.state.status === 'ready' &&
    customers.state.status === 'ready' &&
    ticks.state.status === 'ready';

  const jobList = jobs.state.status === 'ready' ? jobs.state.data : [];

  /**
   * THE DERIVATION, and the one place Prep differs from Shopping.
   *
   * Shopping filters JOBS by service date. Prep must not, because prep happens
   * BEFORE service — `prepDateFor` is the service date minus `make_ahead_days`. A
   * job served on the 20th with three days of make-ahead is prepped on the 17th.
   * Filtering jobs to "served this week" would silently lose prep days that fall
   * inside the window for jobs served just outside it — which is exactly the work
   * he most needs warning about.
   *
   * So every preppable job goes into the engine, and the DAYS it returns are
   * filtered afterwards. The engine already keys buckets by prep date, so this is
   * a filter on its output, not a second derivation.
   */
  const view = useMemo(() => {
    if (!ready) return null;

    const recipeList = recipes.state.status === 'ready' ? recipes.state.data : [];
    const ingredientList = ingredients.state.status === 'ready' ? ingredients.state.data : [];
    const customerList = customers.state.status === 'ready' ? customers.state.data : [];
    const tickList = ticks.state.status === 'ready' ? ticks.state.data : [];

    const preppable = jobList.filter((j) => PREPPABLE.has(j.status));

    const allDays = prepPlanByDay(productionBuckets(preppable, recipeList));
    const days = allDays.filter((d) => d.prepDate >= from && d.prepDate <= to);

    // Gaps come from `requirementsForRange`, which already includes the production
    // gaps AND the scaling ones. An unquantified component is genuinely a prep
    // concern — he has to judge the seasoning at the stove — and taking the whole
    // set from one place keeps Prep and Shopping speaking the same vocabulary
    // rather than two that can drift.
    const gaps = requirementsForRange(preppable, recipeList, ingredientList).gaps;

    return buildPrepView(days, gaps, jobList, customerList, tickList);
  }, [ready, jobList, recipes.state, ingredients.state, customers.state, ticks.state, from, to]);

  const setDone = async (recipeId: RecipeId, prepDate: IsoDate, done: boolean): Promise<void> => {
    if (kitchenState.status !== 'ready') return;
    const key = `${recipeId} ${prepDate}`;
    setBusy(key);
    setError(null);

    try {
      await prepStateRepository(db).setDone(
        kitchenState.membership.kitchenId as KitchenId,
        recipeId,
        prepDate,
        done,
      );
      ticks.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save that.');
    } finally {
      setBusy(null);
    }
  };

  if (!ready) {
    const failed = [jobs.state, recipes.state, ingredients.state, customers.state, ticks.state].find(
      (s) => s.status === 'error',
    );

    if (failed !== undefined && failed.status === 'error') {
      return (
        <div>
          <h1>Prep</h1>
          <p className="error" role="alert">
            Could not load: {failed.error.message}
          </p>
        </div>
      );
    }
    return <p className="muted">Working it out…</p>;
  }

  const nothing = view === null || view.days.length === 0;

  return (
    <div>
      <h1>Prep</h1>

      <fieldset className="units">
        <legend>Which days</legend>
        <Field label="From" value={from} onChange={setFrom} numeric inputMode="numeric" />
        <Field label="To" value={to} onChange={setTo} numeric inputMode="numeric" />
        <p className="hint muted">
          These are prep days, not service days. Something served just after this range can
          still be made inside it.
        </p>
      </fieldset>

      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {nothing && view !== null && view.needsFixing.length === 0 && view.checkYourself.length === 0 && (
        <EmptyState
          title="Nothing to make in these days"
          description="Confirm a job and whatever its menu needs will appear here, on the day it should be made."
        />
      )}

      {view?.days.map((day) => (
        <section key={day.prepDate} className="prep-day">
          <h2>
            {day.prepDate}
            {day.isToday && <span className="today"> today</span>}
          </h2>

          <ul className="records">
            {day.lines.map((line) => (
              <li
                key={`${line.recipeId} ${day.prepDate}`}
                className={line.done ? 'prep-line done' : 'prep-line'}
              >
                <label className="check">
                  <input
                    type="checkbox"
                    checked={line.done}
                    disabled={busy === `${line.recipeId} ${day.prepDate}`}
                    onChange={(e) => {
                      void setDone(line.recipeId, day.prepDate, e.target.checked);
                    }}
                  />
                  <span className="num batch">{line.batchLabel ?? `${line.portions} portions`}</span>
                  <span className="prep-name">{line.recipeName}</span>
                </label>

                <span className="muted num prep-total">
                  {line.batchLabel === null ? '' : `${line.portions} portions`}
                  {/* Surplus is shown, never folded into the tray count — it is
                      real food he can plan around. */}
                  {line.surplus !== null && (
                    <>
                      {line.batchLabel === null ? '' : ' · '}
                      <span className="surplus">{line.surplus}</span>
                    </>
                  )}
                </span>

                {/* The per-job split. This is the reason a consolidated tray is
                    still usable: he has to know which portions go where. */}
                <ul className="allocations">
                  {line.allocations.map((a) => (
                    <li key={a.label}>
                      <span className="num">{a.portions}</span> {a.label}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {view !== null && view.days.length > 0 && (
        // ARCHITECTURE.md records this ordering as a documented default, not the
        // owner's routine — only the slack step makes an operational claim, and
        // Paul has never said how he sequences a day. Presenting a guess as his own
        // method is the quiet kind of wrong, so the screen says whose it is.
        <p className="muted">
          Ordered by what is tightest first — anything made on the day it is served cannot be
          moved. That is our default, not your routine. Tell us if you work differently.
        </p>
      )}

      {view !== null && view.checkYourself.length > 0 && (
        <section className="unresolved-block">
          <h2>Check these yourself</h2>
          <p>These cannot be worked out from what is recorded. They need your eye, at the stove.</p>
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
            Something is missing from your records, so these were left out of the plan above.
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
    </div>
  );
}
