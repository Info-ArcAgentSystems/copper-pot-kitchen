/**
 * The dashboard — what the owner sees when he opens the app.
 *
 * DERIVED ON EVERY VIEW (Rule 6), and the strictest case of it in the app:
 * shopping, prep and packing each persist the owner's tick, and this persists
 * nothing at all. There is no repository write anywhere on this screen, and
 * `tests/ui/derived.test.ts` holds it to that.
 *
 * The arithmetic is all in `dashboardView.ts`, which itself does none — it calls
 * the engine and arranges the answers. This file renders them.
 *
 * ORDERED BY WHAT HE ASKS FIRST, not by what is easiest to compute: what is
 * coming, what is wrong with it, what he has to buy, what it is worth, and — last,
 * because it is a housekeeping matter rather than an operational one — whether his
 * data is backed up.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { supabaseDb } from '../../data/client';
import {
  clientRateRepository,
  customerRepository,
  ingredientRepository,
  jobRepository,
  recipeRepository,
  stockRepository,
} from '../../data/repositories';
import { buildDashboardView } from '../../ui/dashboardView';
import { needsYou } from '../../ui/needsYou';
import { BACKUP_STORAGE_KEY } from '../../ui/backup';
import { AHEAD, DateRangeBar } from '../../ui/DateRangeBar';
import { SectionHeading } from '../../ui/icons';
import { Stat } from '../../ui/Stat';
import { formatMoney } from '../../ui/form';
import { useAsync } from '../../ui/useAsync';
import { Screen } from '../../ui/Screen';
import { SourceNotice } from '../../ui/SourceNotice';
import { sourceState, type DataSource } from '../../ui/sourceState';
import type { Cents } from '../../engine/types';

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * What this device remembers about its last backup.
 *
 * Read here rather than in `ui/backup.ts`: that module is compiled without DOM
 * types so it can be tested under plain Node, and `localStorage` is a browser
 * global. The KEY is shared from there, so the two screens that read it cannot
 * drift apart.
 */
function readSavedBackup(): { fingerprint: string; at: string } | null {
  try {
    const raw = localStorage.getItem(BACKUP_STORAGE_KEY);
    if (raw === null) return null;

    const parsed = JSON.parse(raw) as { fingerprint?: unknown; at?: unknown };
    return typeof parsed.fingerprint === 'string' && typeof parsed.at === 'string'
      ? { fingerprint: parsed.fingerprint, at: parsed.at }
      : null;
  } catch {
    // A corrupt or unavailable store is "no backup recorded", never a crash on
    // the screen the app opens to.
    return null;
  }
}

const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Readiness as a ring and a percentage, from the engine's met / total — the
 * same two numbers written beside it in words. Green only when complete.
 */
function ReadinessRing({ met, total }: { met: number; total: number }): ReactNode {
  const share = total === 0 ? 0 : met / total;
  const r = 18;
  const around = 2 * Math.PI * r;
  return (
    <span className={`ring${met === total && total > 0 ? ' is-done' : ''}`} aria-hidden="true">
      <svg width="48" height="48" viewBox="0 0 48 48">
        <circle className="ring-track" cx="24" cy="24" r={r} />
        <circle
          className="ring-fill"
          cx="24"
          cy="24"
          r={r}
          strokeDasharray={`${share * around} ${around}`}
        />
      </svg>
      <span className="ring-label num">{Math.round(share * 100)}%</span>
    </span>
  );
}

/** A figure, or a stated absence in the same size — never a zero standing in. */
function Figure({ label, value }: { label: string; value: string | null }): ReactNode {
  return (
    <div>
      <dt>{label}</dt>
      {value === null ? <dd className="unresolved">not known</dd> : <dd className="num">{value}</dd>}
    </div>
  );
}

export function Dashboard(): ReactNode {
  const db = supabaseDb();
  const jobs = useAsync(() => jobRepository(db).list(), []);
  const recipes = useAsync(() => recipeRepository(db).list(), []);
  const ingredients = useAsync(() => ingredientRepository(db).list(), []);
  const customers = useAsync(() => customerRepository(db).list(), []);
  const rates = useAsync(() => clientRateRepository(db).list(), []);
  const stock = useAsync(() => stockRepository(db).list(), []);

  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(() => addDays(today(), 7));

  const sources: readonly DataSource[] = [
    {
      what: 'your jobs',
      why: 'every figure on this screen is counted from them',
      state: jobs.state,
      reload: jobs.reload,
    },
    {
      what: 'your recipes',
      why: 'they turn a job into portions, batches and shopping',
      state: recipes.state,
      reload: recipes.reload,
    },
    {
      what: 'your ingredients',
      why: 'the outstanding shopping figure is counted in them',
      state: ingredients.state,
      reload: ingredients.reload,
    },
    {
      what: 'your customers',
      why: 'a job is listed under the customer it belongs to',
      state: customers.state,
      reload: customers.reload,
    },
    {
      what: 'your rate card',
      why: 'revenue is priced from it',
      state: rates.state,
      reload: rates.reload,
    },
    {
      what: 'what you have in stock',
      why: 'it comes off what still needs buying',
      state: stock.state,
      reload: stock.reload,
    },
  ];
  const loaded = sourceState(sources);
  const ready = loaded.kind === 'ready';

  /**
   * THE DERIVATION. Runs on every render, from the jobs, every time.
   *
   * `useMemo` is a render optimisation over inputs already in memory, not a cache
   * of the result. Nothing here is written down — there is no stored summary that
   * can disagree with the jobs it came from.
   */
  const view = useMemo(() => {
    if (!ready) return null;

    return buildDashboardView({
      jobs: jobs.state.status === 'ready' ? jobs.state.data : [],
      recipes: recipes.state.status === 'ready' ? recipes.state.data : [],
      ingredients: ingredients.state.status === 'ready' ? ingredients.state.data : [],
      customers: customers.state.status === 'ready' ? customers.state.data : [],
      rates: rates.state.status === 'ready' ? rates.state.data : [],
      stock: stock.state.status === 'ready' ? stock.state.data : [],
      from,
      to,
      today: today(),
      savedBackup: readSavedBackup(),
    });
  }, [ready, jobs.state, recipes.state, ingredients.state, customers.state, rates.state, stock.state, from, to]);

  /*
   * THIS LINE USED TO SAY "Loading…" FOREVER.
   *
   * It was `if (!ready || view === null)` over a boolean that is false while
   * loading AND false after a failed read, on the screen the app opens to. Six
   * reads, any one of which could leave the owner looking at a word that was
   * not true, with the reason sitting unused in `useAsync`.
   */
  if (!ready) return <SourceNotice state={loaded} title="Today" />;

  /*
   * Ready, so the derivation ran and `view` is an object. Separated from the
   * line above rather than folded into it — `!ready || view === null` is how a
   * failed read borrowed the word "loading" in the first place, and a bare
   * `<SourceNotice>` here would render NOTHING, since a ready state has nothing
   * to say. Unreachable, and said out loud anyway.
   */
  if (view === null) {
    return (
      <Screen title="Today">
        <p className="error" role="alert">
          Today’s figures could not be worked out. Your data is fine — this is a fault in the
          app.
        </p>
      </Screen>
    );
  }

  const money = view.money;
  const needs = needsYou(view);

  /* Guests booked: RECORDED guest counts added up, and the jobs without one
     counted separately — a missing count is never added in as zero. */
  const covers = view.nextJobs.reduce(
    (acc, n) =>
      n.job.guests === null
        ? { ...acc, missing: acc.missing + 1 }
        : { ...acc, total: acc.total + n.job.guests, counted: acc.counted + 1 },
    { total: 0, counted: 0, missing: 0 },
  );

  return (
    <Screen
      title="Today"
      icon="home"
      description="How the coming days look, and what needs you now."
    >
      {/* The SAME date control as Service and Money. It was two loose `.field`
          divs, which read as two unrelated blocks once the container owns the
          rhythm — and it was the only one of the three date-ranged screens that
          did not box its pair. */}
      <DateRangeBar from={from} to={to} setFrom={setFrom} setTo={setTo} presets={AHEAD} />

      {/* ------------------------------------------------------------------
          FOUR FIGURES, read first. Each is a number the engine already worked
          out for this window — nothing new is calculated here except adding up
          guest counts that were RECORDED. An unknown is a dash with a caption
          saying why, never a zero standing in for it.
          ------------------------------------------------------------------ */}
      <div className="stats">
        <Stat
          icon="jobs"
          label="Confirmed jobs"
          value={String(view.nextJobs.length)}
          caption={`${view.window.jobCount} in these dates, enquiries included`}
        />
        <Stat
          icon="guests"
          label="Guests booked"
          value={covers.counted === 0 && covers.missing > 0 ? null : String(covers.total)}
          caption={
            covers.missing > 0
              ? `${covers.missing} job${covers.missing === 1 ? ' has' : 's have'} no guest count yet`
              : 'across the confirmed jobs'
          }
        />
        <Stat
          icon="cart"
          label="To buy"
          value={String(view.shopping.outstanding)}
          caption={
            view.shopping.blocked > 0
              ? `lines outstanding · ${view.shopping.blocked} could not be worked out`
              : 'lines outstanding'
          }
        />
        <Stat
          icon="money"
          label="Revenue"
          value={money.revenue.total === null ? null : formatMoney(money.revenue.total as Cents)}
          caption={
            money.revenue.unpriced > 0
              ? `${money.revenue.unpriced} job${money.revenue.unpriced === 1 ? '' : 's'} not priced yet`
              : 'in these dates'
          }
        />
      </div>

      {/* ------------------------------------------------------------------
          NEEDS YOU — what stops a job being ready, worst first, each with ONE
          place to fix it. Ordered and worded by `needsYou`, which only arranges
          what the view above already holds. An empty list says what it means:
          nothing was found, not "everything is fine".
          ------------------------------------------------------------------ */}
      <SectionHeading icon="chart">Needs you</SectionHeading>
      {needs.length === 0 ? (
        <p className="muted">
          Nothing found to fix in these dates — every confirmed job is priced, costed and
          shoppable.
        </p>
      ) : (
        <ol className="needs">
          {needs.map((n, i) => (
            <li key={n.key} className={`need need-${n.tone}`}>
              <span className="need-rank num" aria-hidden="true">
                {i + 1}
              </span>
              <span className="need-body">
                <strong>{n.title}</strong>
                {n.why !== '' && <span className="need-why">{n.why}</span>}
              </span>
              <Link className="need-go" to={n.action.to}>
                {n.action.label}
              </Link>
            </li>
          ))}
        </ol>
      )}

      {/* ------------------------------------------------------------------ */}
      <SectionHeading icon="jobs">Next jobs</SectionHeading>
      {view.nextJobs.length === 0 ? (
        <p className="muted">Nothing confirmed in these dates.</p>
      ) : (
        <ul className="records">
          {view.nextJobs.map((n) => (
            <li key={n.job.id}>
              {/* To the Jobs list, where the job can be tapped. No route opens
                  one job directly — `RecordScreen` holds its editing state
                  internally — so this is the honest destination. */}
              <Link className="record" to="/jobs">
                <span className="record-row">
                  {/* How ready, as a ring: the engine's own count of checks met
                      (guests confirmed, time, menu, priced, shopping…). */}
                  <ReadinessRing met={n.readiness.metCount} total={n.readiness.total} />
                  <span className="record-body">
                    <strong>
                      {n.job.serviceType ?? 'Job'} · {n.job.serviceDate ?? 'no date'}
                    </strong>
                    <span className="muted">
                      {n.job.guests === null ? 'guest count not recorded' : `${n.job.guests} guests`} ·{' '}
                      {n.readiness.metCount} of {n.readiness.total} ready
                    </span>
                    {n.blocked > 0 && (
                      <span className="unresolved">
                        {n.blocked} {n.blocked === 1 ? 'quantity' : 'quantities'} could not be worked out
                      </span>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="hint muted">
        <Link className="qlink" to="/jobs">
          See all jobs
        </Link>
      </p>

      {/* ------------------------------------------------------------------
          AT A GLANCE — two summaries, each a single tile the owner taps.
          Every null still renders as `.unresolved` "not known", and the blocked
          count is still carried separately: quieter, never silent.
          ------------------------------------------------------------------ */}
      <SectionHeading icon="chart">At a glance</SectionHeading>
      <div className="tiles">
        {/* `/service/shopping`, not `/shopping`: the short one is a bookmark
            redirect, and arriving through it mounts Service twice. */}
        <Link className="tile" to="/service/shopping">
          <h3>To buy</h3>
          <dl className="money-figures">
            <Figure label="Lines outstanding" value={String(view.shopping.outstanding)} />
            {view.shopping.blocked > 0 && (
              <div>
                <dt>Could not be worked out</dt>
                <dd className="unresolved">{view.shopping.blocked}</dd>
              </div>
            )}
          </dl>
          <p className="tile-go">Shopping list</p>
        </Link>

        <Link className="tile" to="/money">
          <h3>Money in these dates</h3>
          <dl className="money-figures">
            <Figure
              label="Revenue"
              value={
                money.revenue.total === null ? null : formatMoney(money.revenue.total as Cents)
              }
            />
            <Figure
              label="Food cost"
              value={
                money.foodCost.total === null ? null : formatMoney(money.foodCost.total as Cents)
              }
            />
            <Figure
              label="Margin"
              value={money.margin.total === null ? null : formatMoney(money.margin.total as Cents)}
            />
          </dl>
          <p className="tile-go">Open Money</p>
        </Link>
      </div>

      {/* Every anomaly and dietary issue in full. "Needs you" leads with the
          serious ones; nothing is dropped for being smaller. */}
      {view.anomalies.length > 0 && (
        <section className="needs-fixing">
          <h2>Worth a look</h2>
          <ul>
            {view.anomalies.map((a) => (
              <li key={`${a.jobId}-${a.reason}`}>{a.detail}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Rule 9: possible conflicts for review. Never a verdict, never a count
          summed across guests (Rule 16) — each issue names its own guests. */}
      {view.dietary.length > 0 && (
        <section className="unresolved-block">
          <h2>Dietary — review required</h2>
          <ul>
            {view.dietary.map((d) => (
              <li key={d.dietaryId}>{d.detail}</li>
            ))}
          </ul>
        </section>
      )}

      <SectionHeading icon="guests">Covers served</SectionHeading>
      <section className="money-row">
        {view.history.completed === 0 ? (
          <p className="muted">Nothing in these dates has been delivered yet.</p>
        ) : (
          <dl className="money-figures">
            <Figure
              label="Covers served"
              value={
                view.history.covers.totalCovers === null
                  ? null
                  : String(view.history.covers.totalCovers)
              }
            />
            <Figure label="Jobs completed" value={String(view.history.completed)} />
            {view.history.covers.withoutGuestCount > 0 && (
              <dd className="note muted">
                {view.history.covers.withoutGuestCount} left out — no guest count recorded.
              </dd>
            )}
          </dl>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Last, because it is housekeeping rather than service. It states when,
          and never that the backup is current — see `backupReminder`. */}
      {/* Only once a backup is known: "never" is already item one of Needs
          you, and saying it twice made the warning look like two problems. */}
      {view.backup.state !== 'never' && (
        <section className="money-row">
          <h2>Backup</h2>
          <p className="muted">
            {view.backup.message}
          </p>
          <p className="hint muted">
            <Link className="qlink" to="/setup/backup">Open backup</Link>
          </p>
        </section>
      )}
    </Screen>
  );
}
