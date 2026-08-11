/**
 * Money — revenue, food cost and margin, per job and per range.
 *
 * This screen WRITES NOTHING. Not a record, not even a tick. Everything on it is
 * derived from jobs, recipes, ingredients and the rate card on every view, so
 * there is no stored figure anywhere that can disagree with them.
 *
 * The unusual thing about it is that the null cases are the point. A catering
 * owner's most expensive mistake is a job that looks profitable because an
 * unpriced ingredient counted as free, so this screen is designed to be unhelpful
 * in exactly the right way: it refuses the number and says what is blocking it.
 *
 * NO MARGIN PERCENTAGE. Whether that means percent of price or percent of cost is
 * an open question for the owner, and the two differ a lot at catering margins.
 * The absolute figure is shown until he says which he means.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { supabaseDb } from '../../data/client';
import {
  clientRateRepository,
  customerRepository,
  ingredientRepository,
  jobRepository,
  recipeRepository,
} from '../../data/repositories';
import { jobMargin, jobRevenue, rangeMoney } from '../../engine/costing';
import { buildMoneyView } from '../../ui/moneyView';
import { EmptyState } from '../../ui/EmptyState';
import { Field } from '../../ui/Field';
import { useAsync } from '../../ui/useAsync';

const addDays = (date: string, days: number): string => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
};

const today = (): string => new Date().toISOString().slice(0, 10);

export function Money(): ReactNode {
  const db = supabaseDb();

  // Looking back by default, unlike the operational screens. Money is mostly a
  // question about what has happened.
  const [from, setFrom] = useState(() => addDays(today(), -30));
  const [to, setTo] = useState(today);

  const jobs = useAsync(() => jobRepository(db).list(), []);
  const recipes = useAsync(() => recipeRepository(db).list(), []);
  const ingredients = useAsync(() => ingredientRepository(db).list(), []);
  const customers = useAsync(() => customerRepository(db).list(), []);
  const rates = useAsync(() => clientRateRepository(db).list(), []);

  const ready =
    jobs.state.status === 'ready' &&
    recipes.state.status === 'ready' &&
    ingredients.state.status === 'ready' &&
    customers.state.status === 'ready' &&
    rates.state.status === 'ready';

  const jobList = jobs.state.status === 'ready' ? jobs.state.data : [];

  const view = useMemo(() => {
    if (!ready) return null;

    const recipeList = recipes.state.status === 'ready' ? recipes.state.data : [];
    const ingredientList = ingredients.state.status === 'ready' ? ingredients.state.data : [];
    const customerList = customers.state.status === 'ready' ? customers.state.data : [];
    const rateList = rates.state.status === 'ready' ? rates.state.data : [];

    // Every job in the range, cancelled included — Rule 15 keeps them, and
    // `rangeMoney` values them apart rather than dropping them.
    const inRange = jobList
      .filter((j) => j.serviceDate !== null && j.serviceDate >= from && j.serviceDate <= to)
      .sort((a, b) => (b.serviceDate ?? '').localeCompare(a.serviceDate ?? ''));

    const customerById = new Map(customerList.map((c) => [c.id as string, c]));

    const inputs = inRange.map((job) => {
      const customer = job.customerId === null ? undefined : customerById.get(job.customerId);

      return {
        job,
        margin: jobMargin(job, customer, rateList, recipeList, ingredientList),
        revenue: jobRevenue(job, customer, rateList),
      };
    });

    const total = rangeMoney(inRange, customerList, rateList, recipeList, ingredientList);

    return buildMoneyView(inputs, total, customerList);
  }, [ready, jobList, recipes.state, ingredients.state, customers.state, rates.state, from, to]);

  if (!ready) {
    const failed = [jobs.state, recipes.state, ingredients.state, customers.state, rates.state].find(
      (s) => s.status === 'error',
    );

    if (failed !== undefined && failed.status === 'error') {
      return (
        <div>
          <h1>Money</h1>
          <p className="error" role="alert">
            Could not load: {failed.error.message}
          </p>
        </div>
      );
    }
    return <p className="muted">Working it out…</p>;
  }

  return (
    <div>
      <h1>Money</h1>

      <fieldset className="units">
        <legend>Which dates</legend>
        <Field label="From" value={from} onChange={setFrom} type="date" />
        <Field label="To" value={to} onChange={setTo} type="date" />
      </fieldset>

      {view !== null && view.rows.length === 0 ? (
        <EmptyState
          title="No jobs in these dates"
          description="Revenue, food cost and margin appear here once there are jobs with service dates in this range."
        />
      ) : null}

      {view !== null && view.rows.length > 0 && (
        <section className="money-summary">
          <h2>Across these dates</h2>

          <dl className="money-figures">
            <div>
              <dt>Revenue</dt>
              <dd className="num">{view.summary.revenue}</dd>
              {view.summary.revenueNote !== null && (
                <dd className="muted note">{view.summary.revenueNote}</dd>
              )}
            </div>

            <div>
              <dt>Food cost</dt>
              <dd className="num">{view.summary.foodCost}</dd>
              {view.summary.foodCostNote !== null && (
                <dd className="muted note">{view.summary.foodCostNote}</dd>
              )}
            </div>

            <div>
              <dt>Margin</dt>
              <dd className="num">{view.summary.margin}</dd>
              {view.summary.marginNote !== null && (
                <dd className="muted note">{view.summary.marginNote}</dd>
              )}
            </div>
          </dl>

          {/* Rule 15: cancelled jobs are kept and valued, never mixed into what
              was actually earned. */}
          {view.summary.cancelledNote !== null && (
            <p className="muted">{view.summary.cancelledNote}</p>
          )}

          {/* The open question, said out loud rather than resolved by picking one.
              A margin as a share of price and as a share of cost are different
              numbers, and only the owner can say which he runs his business on. */}
          <p className="muted">
            Shown as amounts, not shares. Whether a margin should read against the price or
            against the cost is your call — tell us which and it will appear here.
          </p>
        </section>
      )}

      {view?.rows.map((row) => (
        <section key={row.jobId} className={row.isLoss ? 'money-row loss' : 'money-row'}>
          <h3>
            {row.heading} <span className="muted">· {row.status}</span>
          </h3>

          <dl className="money-figures">
            <div>
              <dt>Revenue</dt>
              <dd className="num">{row.revenue}</dd>
              {/* Rule 11: he can see what he overrode, not just the new figure. */}
              {row.overriddenFrom !== null && (
                <dd className="muted note">rate card said {row.overriddenFrom}</dd>
              )}
            </div>
            <div>
              <dt>Food cost</dt>
              <dd className="num">{row.foodCost}</dd>
            </div>
            <div>
              <dt>Margin</dt>
              <dd className="num">{row.margin}</dd>
              {row.isLoss && <dd className="unresolved note">this job loses money</dd>}
            </div>
          </dl>

          {/* Rule 8 at the surface: a blank figure always says why it is blank. */}
          {row.blockers.length > 0 && (
            <ul className="blockers">
              {row.blockers.map((b) => (
                <li key={b.label}>
                  {b.label} <span className="muted">— fix in {b.where}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {view !== null && view.checkYourself.length > 0 && (
        <section className="unresolved-block">
          <h2>Check these yourself</h2>
          <p>These have no recorded quantity, so they cannot be costed. They need your eye.</p>
          <ul>
            {view.checkYourself.map((item) => (
              <li key={item.label}>{item.label}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
