/**
 * Packing — the third and last derived screen.
 *
 * Rule 6 as before: the list is recomputed on every view and only the tick
 * persists. What differs is that packing is PER JOB. Shopping and Prep consolidate
 * across jobs because that is what makes them useful; packing must not, because
 * each job goes into its own boxes and its own van run.
 *
 * `tests/ui/derived.test.ts` covers this feature alongside the other two.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { supabaseDb } from '../../data/client';
import {
  customerRepository,
  ingredientRepository,
  jobRepository,
  packingStateRepository,
  recipeRepository,
  serviceTemplateRepository,
} from '../../data/repositories';
import { requirementsForRange } from '../../engine/shopping';
import { buildPackingView } from '../../ui/packingView';
import { EmptyState } from '../../ui/EmptyState';
import { Field } from '../../ui/Field';
import { useAsync } from '../../ui/useAsync';
import { useKitchen } from '../../auth/kitchenState';
import type { JobId, KitchenId } from '../../engine/types';

/** Same rule as Shopping and Prep. */
const PACKABLE = new Set(['confirmed', 'in_prep']);

const addDays = (date: string, days: number): string => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
};

const today = (): string => new Date().toISOString().slice(0, 10);

function Lines({
  title,
  lines,
  onToggle,
  busy,
}: {
  title: string;
  lines: readonly { itemKey: string; label: string; portions: number | null; note: string | null; done: boolean }[];
  onToggle: (itemKey: string, done: boolean) => void;
  busy: string | null;
}): ReactNode {
  if (lines.length === 0) return null;

  return (
    <>
      <h3 className="pack-section">{title}</h3>
      <ul className="records">
        {lines.map((line) => (
          <li key={line.itemKey} className={line.done ? 'pack-line done' : 'pack-line'}>
            <label className="check">
              <input
                type="checkbox"
                checked={line.done}
                disabled={busy === line.itemKey}
                onChange={(e) => onToggle(line.itemKey, e.target.checked)}
              />
              {/* Blank rather than a zero where there is no portions figure — a
                  "0" would read as "none of this dish". */}
              <span className="num pack-qty">{line.portions ?? ''}</span>
              <span className="pack-name">{line.label}</span>
            </label>
            {line.note !== null && <span className="unresolved">{line.note}</span>}
          </li>
        ))}
      </ul>
    </>
  );
}

export function Packing(): ReactNode {
  const db = supabaseDb();
  const { state: kitchenState } = useKitchen();

  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(() => addDays(today(), 7));

  const jobs = useAsync(() => jobRepository(db).list(), []);
  const recipes = useAsync(() => recipeRepository(db).list(), []);
  const ingredients = useAsync(() => ingredientRepository(db).list(), []);
  const customers = useAsync(() => customerRepository(db).list(), []);
  const templates = useAsync(() => serviceTemplateRepository(db).list(), []);

  const jobList = jobs.state.status === 'ready' ? jobs.state.data : [];

  // Packing is driven by SERVICE date — you pack for service, not for prep.
  const inWindow = useMemo(
    () =>
      jobList.filter((j) => j.serviceDate !== null && j.serviceDate >= from && j.serviceDate <= to),
    [jobList, from, to],
  );
  const packable = useMemo(() => inWindow.filter((j) => PACKABLE.has(j.status)), [inWindow]);
  const excluded = inWindow.length - packable.length;

  const jobIds = useMemo(() => packable.map((j) => j.id), [packable]);
  const ticks = useAsync(() => packingStateRepository(db).forJobs(jobIds), [jobIds.join(',')]);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready =
    jobs.state.status === 'ready' &&
    recipes.state.status === 'ready' &&
    ingredients.state.status === 'ready' &&
    customers.state.status === 'ready' &&
    templates.state.status === 'ready' &&
    ticks.state.status === 'ready';

  const view = useMemo(() => {
    if (!ready) return null;

    const recipeList = recipes.state.status === 'ready' ? recipes.state.data : [];
    const ingredientList = ingredients.state.status === 'ready' ? ingredients.state.data : [];
    const customerList = customers.state.status === 'ready' ? customers.state.data : [];
    const templateList = templates.state.status === 'ready' ? templates.state.data : [];
    const tickList = ticks.state.status === 'ready' ? ticks.state.data : [];

    // Same gap vocabulary as Shopping and Prep, scoped to these jobs.
    const gaps = requirementsForRange(packable, recipeList, ingredientList).gaps;

    return buildPackingView(packable, recipeList, templateList, customerList, tickList, gaps);
  }, [ready, packable, recipes.state, ingredients.state, customers.state, templates.state, ticks.state]);

  const toggle = async (jobId: JobId, itemKey: string, done: boolean): Promise<void> => {
    if (kitchenState.status !== 'ready') return;
    setBusy(itemKey);
    setError(null);

    try {
      await packingStateRepository(db).setDone(
        kitchenState.membership.kitchenId as KitchenId,
        jobId,
        itemKey,
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
    const failed = [
      jobs.state,
      recipes.state,
      ingredients.state,
      customers.state,
      templates.state,
      ticks.state,
    ].find((s) => s.status === 'error');

    if (failed !== undefined && failed.status === 'error') {
      return (
        <div>
          <h1>Packing</h1>
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
      <h1>Packing</h1>

      <fieldset className="units">
        <legend>Which dates</legend>
        <Field label="From" value={from} onChange={setFrom} type="date" />
        <Field label="To" value={to} onChange={setTo} type="date" />
        <p className="hint muted">
          One list per job. Each is packed and delivered on its own, so nothing here is added
          up across jobs.
        </p>
      </fieldset>

      <p className="muted">
        {packable.length === 0
          ? 'No confirmed jobs in this window.'
          : `${packable.length} job${packable.length === 1 ? '' : 's'} to pack.`}
        {excluded > 0 &&
          ` ${excluded} other job${excluded === 1 ? '' : 's'} in these dates ${excluded === 1 ? 'is' : 'are'} an enquiry, cancelled or already done.`}
      </p>

      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {view?.nothingToPack === true && (
        <EmptyState
          title="Nothing to pack in these days"
          description="Confirm a job with a service date in this range and its food and equipment will appear here."
        />
      )}

      {view?.jobs.map((packJob) => (
        <section key={packJob.jobId} className="pack-job">
          <h2>{packJob.heading}</h2>

          <Lines
            title="Food"
            lines={packJob.food}
            busy={busy}
            onToggle={(key, done) => void toggle(packJob.jobId, key, done)}
          />

          {packJob.emptyMenu && (
            <p className="unresolved">
              No dishes on this job yet — nothing to pack until its menu is set.
            </p>
          )}

          <Lines
            title="Equipment"
            lines={packJob.equipment}
            busy={busy}
            onToggle={(key, done) => void toggle(packJob.jobId, key, done)}
          />

          <Lines
            title="To do"
            lines={packJob.tasks}
            busy={busy}
            onToggle={(key, done) => void toggle(packJob.jobId, key, done)}
          />

          {/* Rule 1: the app ships with no templates, so this is the normal state
              early on. An empty section would read as "no equipment needed", which
              is a different and wrong statement. */}
          {packJob.noTemplate && (
            <p className="unresolved">
              No equipment list for this service type yet. Set one up in Setup → Service
              templates and it will appear on every job like this one.
            </p>
          )}

          {packJob.noServiceType && (
            <p className="unresolved">
              This job has no service type, so no equipment list can be matched to it. Set one
              on the job.
            </p>
          )}
        </section>
      ))}

      {view !== null && view.checkYourself.length > 0 && (
        <section className="unresolved-block">
          <h2>Check these yourself</h2>
          <p>These cannot be worked out from what is recorded. They need your eye.</p>
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
          <p className="muted">Something is missing from your records.</p>
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
