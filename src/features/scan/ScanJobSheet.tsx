/**
 * Scan a job sheet: photograph → ONE CARD PER BOOKING → fix in place → save.
 *
 * WHAT A JOB SHEET ACTUALLY IS. A notebook page, and a page usually carries
 * more than one booking — a Friday BBQ and a Sunday breakfast written under one
 * "Pandoras Cottage · Aoife" heading. This screen used to show exactly one job,
 * so the scanner silently kept whichever booking it landed on and the other
 * vanished. Now every booking on the page is its own card (`scan/page.ts`).
 *
 * THE LAYOUT, and why:
 *
 *   "N jobs found on this page", and either a check that every line on the
 *   page was placed in a job or the lines that were not. Nothing is dropped
 *   without him seeing it.
 *
 *   ONE "Needs you" list for the whole page, with the answer buttons inside
 *   each item — not a "still to settle" list at the foot of every card.
 *
 *   The heading once: customer and property apply to every booking written
 *   under it, because that is how he wrote them.
 *
 *   Each job as a short summary he can scan; "Show details" opens the full
 *   boxes. Each job saves on its own, so the breakfast that is ready does not
 *   wait for a BBQ whose menu he has not decided.
 *
 * NONE OF RULE 8 IS RELAXED BY THAT:
 *
 *   A date built from the page title is marked as such and must be confirmed
 *   before anything saves. Two times written together ("7/7.30pm") become two
 *   buttons, and neither is picked for him. A missing menu blocks the save until
 *   he SAYS it is not decided yet.
 *
 *   THE SHEET'S WORDS STAY VISIBLE. "Sheet said …" sits under a box after he
 *   corrects it, because the correction is the thing most worth checking twice.
 *
 *   A NAME MATCHING SEVERAL RECORDS IS STILL NOT CHOSEN FOR HIM.
 *
 *   NEW RECORDS ARE CREATED ON SAVE, NOT BEFORE, and he is told which by name.
 *   Once one job on the page creates "Aoife", every other job on the page points
 *   at that record instead of creating a second one.
 *
 * Colours come only from the theme tokens, so the UI refresh restyles this
 * screen with every other one.
 */

import { useState, type ReactNode } from 'react';
import { supabaseClient, supabaseDb } from '../../data/client';
import {
  clientRateRepository,
  customerRepository,
  propertyRepository,
  menuTemplateRepository,
  recipeRepository,
} from '../../data/repositories';
import { commitScannedDraft } from '../../scan/commit';
import {
  createdName,
  creationsFromDraft,
  originOf,
  type DietaryDraft,
  type JobSheetDraft,
  type NameChoice,
  type NameDraft,
} from '../../scan/jobDraft';
import {
  HEADER_DATE_FIELD,
  draftPage,
  jobGaps,
  markSaved,
  needsDateConfirm,
  phoneAction,
  saveable,
  setHeading,
  setNewCustomerPhone,
  settleAcrossPage,
  shortDate,
  timeQuestion,
  withJob,
  type PageDraft,
  type PageJob,
} from '../../scan/page';
import { parseJobSheet } from '../../scan/parseImage';
import { matchByName } from '../../engine/nameMatch';
import { menuFor, menuToSave, ownSpelling, savedMenus, serviceTypeFromMenus } from '../../engine/menus';
import { SaveAsMenu } from '../setup/SaveAsMenu';
import { distinctNames, useSuggestions } from '../../ui/suggestions';
import { toScaledDataUrl } from './scaleImage';
import { PhotoGate } from './PhotoGate';
import { ChoiceField, Field } from '../../ui/Field';
import { EmptyState } from '../../ui/EmptyState';
import { Screen } from '../../ui/Screen';
import { useAsync } from '../../ui/useAsync';
import { useKitchen } from '../../auth/kitchenState';
import type { DataSource } from '../../ui/sourceState';
import type {
  Customer,
  MenuTemplate,
  DietarySeverity,
  JobGroupId,
  KitchenId,
  Property,
  Recipe,
  RecipeId,
} from '../../engine/types';

/** The chip beside a box: where this value came from, in his words. */
const CHIP: Record<ReturnType<typeof originOf>, string> = {
  scanned: 'scanned',
  edited: 'you changed this',
  blank: 'not on the sheet',
};

/**
 * Severity has NO default option — Rule 9.
 *
 * The blank is first and selected until he picks, so an unanswered allergy
 * stays unanswered. Defaulting to "a note" would downgrade a nut allergy; the
 * sheet saying "severe" does not license the system to decide either.
 */
const SEVERITIES = [
  { value: '', label: 'Choose — not set' },
  { value: 'info', label: 'A note' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'severe', label: 'Severe' },
] as const;

/**
 * The options for a name box: his records, plus the scanned name as something
 * to create — only when the review said `new` (read cleanly, not found).
 */
function nameOptions<T extends { id: string; name: string }>(
  records: readonly T[],
  draft: NameDraft,
): readonly { value: string; label: string }[] {
  const creatable =
    draft.choice.kind === 'create'
      ? [{ value: `new:${draft.choice.name}`, label: `${draft.choice.name} — create this` }]
      : [];

  return [
    { value: '', label: 'Not set' },
    ...creatable,
    ...records.map((r) => ({ value: r.id, label: r.name })),
  ];
}

const choiceValue = (choice: NameChoice): string => {
  if (choice.kind === 'existing') return choice.id;
  if (choice.kind === 'create') return `new:${choice.name}`;
  return '';
};

function choiceFrom<T extends { id: string; name: string }>(
  records: readonly T[],
  value: string,
): NameChoice {
  if (value === '') return { kind: 'none' };
  if (value.startsWith('new:')) return { kind: 'create', name: value.slice(4) };

  const record = records.find((r) => r.id === value);
  return record === undefined
    ? { kind: 'none' }
    : { kind: 'existing', id: record.id, name: record.name };
}

const nameHint = (name: NameDraft): string =>
  name.matches.length > 0
    ? `The sheet said “${name.read ?? ''}”, which matches ${name.matches.join(' and ')}. Nothing has been chosen — pick the right one.`
    : name.read === null
      ? 'Nothing was read for this.'
      : name.choice.kind === 'existing'
        ? `Matched your “${name.choice.name}”.`
        : `Read “${name.read}”.`;

/** "19:30" → "7:30pm" for a button label. The stored value stays HH:MM. */
const twelveHour = (hhmm: string): string => {
  const [h, m] = hhmm.split(':').map(Number);
  const hour = (h ?? 0) % 12 === 0 ? 12 : (h ?? 0) % 12;
  return `${hour}:${String(m ?? 0).padStart(2, '0')}${(h ?? 0) >= 12 ? 'pm' : 'am'}`;
};

/** What a job is, in one line he can scan. Only what the draft holds. */
function summaryOf(job: PageJob): string {
  const d = job.draft;
  const time =
    d.serviceTime.trim() !== ''
      ? d.serviceTime.trim()
      : job.meta.timeOptions.length > 0
        ? 'time to pick'
        : 'no time';
  const guests = d.guests.trim() !== '' ? `${d.guests.trim()} guests` : 'guests not set';
  const menu =
    d.dishes.length > 0 ? null : d.menuToBeDecided === true ? 'menu to be decided' : 'no menu yet';

  return [d.serviceType.trim() || null, time, guests, menu].filter((p) => p !== null).join(' · ');
}

export function ScanJobSheet(): ReactNode {
  const db = supabaseDb();
  const { state: kitchen } = useKitchen();

  const customers = useAsync(() => customerRepository(db).list(), []);
  const properties = useAsync(() => propertyRepository(db).list(), []);
  const recipes = useAsync(() => recipeRepository(db).list(), []);
  const menus = useAsync(() => menuTemplateRepository(db).list(), []);

  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  /*
   * Which job's save failed, and why — shown ON that job. The page-level message
   * sits under the photo box, out of sight when he is scrolled down at the job
   * he just tapped: the button went back to "Save" and nothing said it failed.
   */
  const [failed, setFailed] = useState<{ readonly at: number; readonly error: string } | null>(null);
  const [page, setPage] = useState<PageDraft | null>(null);
  /** What "Save as your menu" said, per job, kept after the offer itself goes. */
  const [menuNotes, setMenuNotes] = useState<ReadonlyMap<number, string>>(new Map());
  /** Which job cards have their full boxes open. */
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  /** What a failed save managed to create, so he is not told nothing happened. */
  const [partial, setPartial] = useState<readonly string[]>([]);
  /** The outcome of adding a sheet's phone number to an existing customer. */
  const [phoneNote, setPhoneNote] = useState<string | null>(null);

  /**
   * The three reads a photograph is no use without, each named as he would name
   * it. THE MOST EXPOSED SCREEN IN THE APP: three repositories, any one of which
   * can fail, and before `PhotoGate` a failure in any of them greyed the buttons
   * silently and permanently.
   */
  const sources: readonly DataSource[] = [
    {
      what: 'your customers',
      why: 'the scanner matches the name on the sheet against them',
      state: customers.state,
      reload: customers.reload,
    },
    {
      what: 'your properties',
      why: 'the scanner matches the address on the sheet against them',
      state: properties.state,
      reload: properties.reload,
    },
    {
      what: 'your recipes',
      why: 'the scanner matches the dishes on the sheet against them',
      state: recipes.state,
      reload: recipes.reload,
    },
    {
      what: 'your saved menus',
      why: 'a booking with no dishes, like a sheet that just says “BBQ”, is offered your usual menu',
      state: menus.state,
      reload: menus.reload,
    },
  ];

  const menuList: readonly MenuTemplate[] = menus.state.status === 'ready' ? menus.state.data : [];

  /** A typed service type, or null when the box is blank. */
  const parseTextOrNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());

  const customerList: readonly Customer[] =
    customers.state.status === 'ready' ? customers.state.data : [];
  const propertyList: readonly Property[] =
    properties.state.status === 'ready' ? properties.state.data : [];
  const recipeList: readonly Recipe[] = recipes.state.status === 'ready' ? recipes.state.data : [];

  const kitchenId =
    kitchen.status === 'ready' ? (kitchen.membership.kitchenId as KitchenId) : ('' as KitchenId);

  const scan = async (file: File): Promise<void> => {
    setBusy(true);
    setRefusal(null);
    setPage(null);
    setOpen(new Set());
    setPartial([]);

    try {
      const base = import.meta.env.VITE_SUPABASE_URL ?? '';
      const session = await supabaseClient().auth.getSession();
      const token = session.data.session?.access_token ?? '';

      const image = await toScaledDataUrl(file);
      const reply = await parseJobSheet(image, {
        url: `${base}/functions/v1/parse-image`,
        token,
      });

      if (reply.kind === 'unresolved') {
        setRefusal(reply.reason);
        return;
      }

      // The model resolved nothing. Names are matched HERE, against his own
      // records, by the same matcher Ask Sous uses — once per booking.
      setPage(
        draftPage(
          reply.page,
          { customers: customerList, properties: propertyList, recipes: recipeList },
          () => crypto.randomUUID(),
        ),
      );
    } catch (cause) {
      setRefusal(cause instanceof Error ? cause.message : 'Could not read that photo.');
    } finally {
      setBusy(false);
    }
  };

  const patchJob = (at: number, change: Partial<JobSheetDraft>): void =>
    setPage((p) => (p === null ? null : withJob(p, at, (d) => ({ ...d, ...change }))));

  const patchDietary = (at: number, index: number, change: Partial<DietaryDraft>): void =>
    setPage((p) =>
      p === null
        ? null
        : withJob(p, at, (d) => ({
            ...d,
            dietaries: d.dietaries.map((x, i) => (i === index ? { ...x, ...change } : x)),
          })),
    );

  const openJob = (at: number): void => setOpen((s) => new Set([...s, at]));
  const toggleJob = (at: number): void =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(at)) next.delete(at);
      else next.add(at);
      return next;
    });

  /**
   * Write ONE job. The only thing on this screen that writes — Rule 7's
   * separate call, fired by his tap.
   *
   * Whatever the save created (even on a partial failure) is settled across the
   * whole page, so the next job points at it instead of creating it again.
   */
  const commitOne = async (
    current: PageDraft,
    at: number,
  ): Promise<{ page: PageDraft; ok: boolean }> => {
    const job = current.jobs[at];
    if (job === undefined || !saveable(current, at, recipeList)) return { page: current, ok: false };

    const result = await commitScannedDraft(
      db,
      job.draft,
      kitchenId,
      job.group as JobGroupId | null,
    );
    const settled = settleAcrossPage(current, job.draft, result.ids);

    if (result.ok) return { page: markSaved(settled, at, result.jobId), ok: true };

    setRefusal(result.error);
    setFailed({ at, error: result.error });
    /*
     * What DID get written. supabase-js has no transaction, so a partial write
     * is real: telling him nothing was saved when two recipes exist is a lie he
     * would discover as duplicates on his next attempt.
     */
    setPartial(result.created.filter((c) => c.ok).map((c) => `${c.kind}: ${c.what}`));
    return { page: settled, ok: false };
  };

  /*
   * After any save, his lists are re-read, so a recipe this save created shows
   * in the next job's "Add a dish" — not only after he leaves and comes back.
   * Re-read even on a failed save: a partial write still created records.
   */
  const reloadLists = (): void => {
    customers.reload();
    properties.reload();
    recipes.reload();
  };

  const saveJob = async (at: number): Promise<void> => {
    if (page === null) return;
    setBusy(true);
    setRefusal(null);
    setFailed(null);
    const { page: next } = await commitOne(page, at);
    setPage(next);
    reloadLists();
    setBusy(false);
  };

  /** Every job that is ready, one after another, stopping at the first failure. */
  const saveAllReady = async (): Promise<void> => {
    if (page === null) return;
    setBusy(true);
    setRefusal(null);
    setFailed(null);

    let current = page;
    for (let at = 0; at < current.jobs.length; at += 1) {
      if (!saveable(current, at, recipeList)) continue;
      const step = await commitOne(current, at);
      current = step.page;
      if (!step.ok) break;
    }

    setPage(current);
    reloadLists();
    setBusy(false);
  };

  /** A box, with the chip and the sheet's own words under it. */
  const scannedField = (
    label: string,
    read: string | null,
    value: string,
    onChange: (v: string) => void,
    extra: { type?: 'date'; inputMode?: 'numeric'; hint?: string; suggestions?: readonly string[] } = {},
  ): ReactNode => (
    <div className="scan-field">
      <Field
        label={`${label} — ${CHIP[originOf(read, value)]}`}
        value={value}
        onChange={onChange}
        type={extra.type}
        inputMode={extra.inputMode}
        numeric={extra.inputMode === 'numeric'}
        hint={extra.hint}
        suggestions={extra.suggestions}
      />
      {read !== null && read !== value && <p className="muted">Sheet said “{read}”.</p>}
    </div>
  );

  // -------------------------------------------------------------------------
  // Derived, never stored
  // -------------------------------------------------------------------------

  const jobs = page?.jobs ?? [];
  const unsaved = jobs.filter((j) => j.savedJobId === null);
  const readyCount = page === null ? 0 : jobs.filter((_, at) => saveable(page, at, recipeList)).length;
  const savedCount = jobs.length - unsaved.length;
  const headerDated = page === null ? [] : jobs.filter((j) => needsDateConfirm(page, j));
  const blocks = [...new Set(jobs.map((j) => j.meta.block))];

  /** Warns, never switches: a typed name he already has is his call to pick. */
  const typedDishHint = (choice: NameChoice): string => {
    if (choice.kind !== 'create') return 'Saved as a new recipe with just its name — add the rest later.';
    const same = matchByName(recipeList, createdName(choice.name));
    return same.length > 0
      ? `You already have ${same.map((r) => `“${r.name}”`).join(' and ')} — pick it from the list instead.`
      : 'Saved as a new recipe with just its name — add the rest later.';
  };

  /** The heading line: "Both under Pandoras Cottage · Aoife". */
  const underLine = (): string | null => {
    if (blocks.length !== 1 || jobs.length < 2) return null;
    const first = jobs[0]?.draft;
    const shown = (n: NameDraft | undefined): string | null | undefined =>
      n === undefined ? undefined : n.choice.kind === 'none' ? n.read : n.choice.name;
    const names = [shown(first?.property), shown(first?.customer)].filter(
      (n): n is string => typeof n === 'string' && n !== '',
    );
    return names.length === 0 ? null : `${jobs.length === 2 ? 'Both' : 'All'} under ${names.join(' · ')}`;
  };

  // -------------------------------------------------------------------------
  // The pieces
  // -------------------------------------------------------------------------

  const needsYou = (): ReactNode => {
    if (page === null) return null;

    const items: ReactNode[] = [];

    if (headerDated.length > 0) {
      items.push(
        <li key="dates" className="scan-need">
          <p className="scan-need-who">All jobs on this page · dates</p>
          <p className="scan-need-what">These dates were built from the page title — check them</p>
          <ul className="scan-need-detail">
            {headerDated.map((job) => {
              const hd = job.meta.headerDate;
              const at = jobs.indexOf(job);
              return (
                <li key={at}>
                  Job {at + 1}: {shortDate(job.draft.serviceDate) ?? job.draft.serviceDate}
                  {job.meta.dayWritten !== null && <> — the line says “{job.meta.dayWritten}”</>}
                  {hd?.weekdayMatches === true && <> · {hd.weekdayWritten} matches ✓</>}
                  {hd?.weekdayMatches === false && (
                    <strong> · {hd.weekdayWritten} does NOT match this date — check it</strong>
                  )}
                  {hd?.disagreesWithHeader === true && (
                    <> · the title lists {hd.headerDays.join('/')}, not this day</>
                  )}
                </li>
              );
            })}
          </ul>
          {page.header !== null && <p className="muted">Page title: “{page.header}”</p>}
          <div className="scan-need-actions">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => setPage((p) => (p === null ? null : { ...p, headerDatesConfirmed: true }))}
            >
              The dates are right
            </button>
          </div>
        </li>,
      );
    }

    jobs.forEach((job, at) => {
      if (job.savedJobId !== null) return;
      const who = `Job ${at + 1} · ${shortDate(job.draft.serviceDate) ?? 'no date yet'}`;

      const times = timeQuestion(job);
      if (times.length > 0) {
        items.push(
          <li key={`time-${at}`} className="scan-need">
            <p className="scan-need-who">{who} · time</p>
            <p className="scan-need-what">Which time? The sheet says “{job.meta.timeWording}”</p>
            <p className="muted">Doesn’t stop the save — but the prep day reads better with it.</p>
            <div className="scan-need-actions">
              {times.map((t) => (
                <button key={t} type="button" onClick={() => patchJob(at, { serviceTime: t })}>
                  {twelveHour(t)}
                </button>
              ))}
              <button type="button" onClick={() => openJob(at)}>
                Other
              </button>
            </div>
          </li>,
        );
      }

      for (const gap of jobGaps(page, at, recipeList)) {
        if (gap.field === HEADER_DATE_FIELD) continue;

        if (gap.field === 'dishes') {
          items.push(
            <li key={`menu-${at}`} className="scan-need">
              <p className="scan-need-who">{who} · menu</p>
              <p className="scan-need-what">
                No dishes are written under {job.draft.serviceType.trim() !== '' ? `“${job.draft.serviceType.trim()}”` : 'this booking'}
              </p>
              <p className="muted">
                Add them now, or save it as “menu to be decided” — it stays out of shopping and
                prep until you add dishes.
              </p>
              <div className="scan-need-actions">
                <button
                  type="button"
                  onClick={() => {
                    patchJob(at, {
                      dishes: [
                        ...job.draft.dishes,
                        { read: null, matches: [], choice: { kind: 'none' }, portions: null },
                      ],
                    });
                    openJob(at);
                  }}
                >
                  Add a dish
                </button>
                {menuButton(at, job)}
                <button type="button" onClick={() => patchJob(at, { menuToBeDecided: true })}>
                  Menu to be decided
                </button>
              </div>
            </li>,
          );
          continue;
        }

        items.push(
          <li key={`${at}-${gap.field}`} className="scan-need">
            <p className="scan-need-who">{who}</p>
            <p className="scan-need-what">
              {gap.label}
              {gap.saw !== null && <span className="muted"> — saw “{gap.saw}”</span>}
            </p>
            <div className="scan-need-actions">
              <button type="button" onClick={() => openJob(at)}>
                Fix in Job {at + 1}
              </button>
            </div>
          </li>,
        );
      }
    });

    if (items.length === 0) return null;

    return (
      <section className="needs-fixing">
        <h2>Needs you</h2>
        <p className="muted">Nothing here was guessed. These are what the sheet did not say clearly.</p>
        <ul className="scan-needs">{items}</ul>
      </section>
    );
  };

  /*
   * The phone number written beside the name. It is placed, never dropped: a new
   * customer is created with it, and an existing one gets it only by his tap.
   * A record that already holds a DIFFERENT number is never overwritten.
   */
  const addPhone = async (customer: Customer, phone: string): Promise<void> => {
    setPhoneNote(null);
    const saved = await customerRepository(db).update(customer.id, { ...customer, phone });
    setPhoneNote(
      saved === null ? `Couldn’t add the number to ${customer.name} — nothing was changed.` : null,
    );
    customers.reload();
  };

  const phoneLine = (block: number, lead: PageJob): ReactNode => {
    const action = phoneAction(lead, customerList);
    if (action.kind === 'none') return null;

    const said = `The sheet has the number “${action.phone}”`;
    switch (action.kind) {
      case 'with-new':
        return (
          <div className="scan-phone">
            <p className="muted">
              {said}.{' '}
              {action.saving ? 'It is saved with the new customer.' : 'It won’t be saved.'}
            </p>
            <button
              className="sm"
              type="button"
              onClick={() =>
                setPage((p) => (p === null ? null : setNewCustomerPhone(p, block, !action.saving)))
              }
            >
              {action.saving ? 'Don’t save this number' : 'Save it with the customer'}
            </button>
          </div>
        );
      case 'offer':
        return (
          <div className="scan-phone">
            <p className="muted">
              {said}. {action.customer.name} has no phone saved.
            </p>
            <button
              className="sm"
              type="button"
              disabled={busy}
              onClick={() => void addPhone(action.customer, action.phone)}
            >
              Add it to {action.customer.name}
            </button>
            {phoneNote !== null && <p className="unresolved">{phoneNote}</p>}
          </div>
        );
      case 'same':
        return <p className="muted scan-phone">{said} — it matches the customer’s record.</p>;
      case 'differs':
        return (
          <p className="muted scan-phone">
            {said}. {action.customer.name}’s record has “{action.customer.phone}” — nothing has been
            changed. Update it in Setup if the sheet is right.
          </p>
        );
      case 'unassigned':
        return (
          <p className="muted scan-phone">{said}. Pick or create the customer to keep it.</p>
        );
    }
  };

  /*
   * Service types he already uses — the rate card's spelling first — offered
   * under the box. A read "B.B.Q" gets no price from a "BBQ" rate.
   */
  const rateTypes = useSuggestions(async () =>
    (await clientRateRepository(supabaseDb()).list()).map((r) => r.serviceType),
  );
  const typeNames = distinctNames(rateTypes, savedMenus(menuList).map((m) => m.serviceType));

  /** The job's dishes as recipe ids — or null while any is new or unchosen. */
  const dishIds = (job: PageJob): RecipeId[] | null => {
    const out: RecipeId[] = [];
    for (const dish of job.draft.dishes) {
      if (dish.choice.kind !== 'existing') return null;
      out.push(dish.choice.id as RecipeId);
    }
    return out;
  };

  /*
   * The page lists dishes but never names the service ("10 x Full Irish, 3 x
   * Pancakes"). When they are all on exactly one of his saved menus, that menu's
   * service type is offered — never filled in, it sets the price.
   */
  const serviceOffer = (at: number, job: PageJob): ReactNode => {
    if (job.savedJobId !== null || job.draft.serviceType.trim() !== '') return null;
    const ids = dishIds(job);
    const type = ids === null ? null : serviceTypeFromMenus(ids, menuList);
    if (type === null) return null;
    return (
      <p className="muted scan-phone">
        No service type is written, but these dishes are all on your {type} menu.{' '}
        <button type="button" className="sm" onClick={() => patchJob(at, { serviceType: type })}>
          Set it to “{type}”
        </button>
      </p>
    );
  };

  /*
   * After a save: "Save these dishes as your BBQ menu", when he has none yet.
   * The saved job's dishes are all real recipes by now — the save settled any
   * new ones to the records it created.
   */
  const menuSaveOffer = (at: number, job: PageJob): ReactNode => {
    const note = menuNotes.get(at);
    if (note !== undefined) return <p role="status">{note}</p>;
    if (job.savedJobId === null) return null;
    const ids = dishIds(job);
    const offer = ids === null ? null : menuToSave(parseTextOrNull(job.draft.serviceType), ids, menuList);
    if (offer === null) return null;
    return (
      <SaveAsMenu
        menu={offer}
        kitchenId={kitchenId}
        onSaved={(said) => {
          setMenuNotes((m) => new Map(m).set(at, said));
          menus.reload();
        }}
      />
    );
  };

  /*
   * "Use your BBQ menu": his own saved dishes for this service type, in his
   * order, each an existing recipe. Offered only — and only when every dish on
   * the menu is still one of his recipes, so it never adds a dish that the
   * save would then fail to find.
   */
  const menuButton = (at: number, job: PageJob): ReactNode => {
    const saved = menuFor(parseTextOrNull(job.draft.serviceType), menuList);
    if (saved === null) return null;
    const byId = new Map(recipeList.map((r) => [r.id as string, r]));
    const picked = saved.recipeIds.map((id) => byId.get(id));
    if (picked.some((r) => r === undefined)) return null;

    return (
      <button
        type="button"
        className="primary"
        onClick={() =>
          patchJob(at, {
            menuToBeDecided: false,
            dishes: picked.flatMap((r) =>
              r === undefined
                ? []
                : [{ read: null, matches: [], choice: { kind: 'existing', id: r.id, name: r.name }, portions: null }],
            ),
          })
        }
      >
        Use your {saved.serviceType} menu ({picked.length} dish{picked.length === 1 ? '' : 'es'})
      </button>
    );
  };

  const heading = (block: number): ReactNode => {
    if (page === null) return null;
    const inBlock = jobs.filter((j) => j.meta.block === block);
    const lead = inBlock.find((j) => j.savedJobId === null) ?? inBlock[0];
    if (lead === undefined) return null;

    const title =
      inBlock.length > 1 ? `From the heading — applies to all ${inBlock.length} jobs` : 'Who and where';

    return (
      <section key={`heading-${block}`} className="units">
        <h2>{title}</h2>
        <ChoiceField
          label="Customer"
          value={choiceValue(lead.draft.customer.choice)}
          options={nameOptions(customerList, lead.draft.customer)}
          onChange={(v) =>
            setPage((p) => (p === null ? null : setHeading(p, block, 'customer', choiceFrom(customerList, v))))
          }
          hint={nameHint(lead.draft.customer)}
        />
        {phoneLine(block, lead)}
        <ChoiceField
          label="Property"
          value={choiceValue(lead.draft.property.choice)}
          options={nameOptions(propertyList, lead.draft.property)}
          onChange={(v) =>
            setPage((p) => (p === null ? null : setHeading(p, block, 'property', choiceFrom(propertyList, v))))
          }
          hint={nameHint(lead.draft.property)}
        />
      </section>
    );
  };

  const details = (at: number, job: PageJob): ReactNode => {
    const d = job.draft;
    return (
      <div className="scan-job-details">
        {scannedField('Date', d.from.serviceDate, d.serviceDate, (v) => patchJob(at, { serviceDate: v }), {
          type: 'date',
          hint: job.meta.dateFrom === 'header' ? 'Built from the line’s day and the page title.' : undefined,
        })}
        {scannedField('Time', d.from.serviceTime, d.serviceTime, (v) => patchJob(at, { serviceTime: v }), {
          hint: job.meta.timeWording !== null ? `The sheet says “${job.meta.timeWording}”.` : undefined,
        })}
        {scannedField('Service type', d.from.serviceType, d.serviceType, (v) => patchJob(at, { serviceType: v }), {
          hint: 'Must match a rate-card service type exactly for a rate to apply — pick one you already use.',
          suggestions: typeNames,
        })}
        {/* "B.B.Q" read, "BBQ" is how he writes it: offered, never swapped. */}
        {(() => {
          const own = ownSpelling(
            parseTextOrNull(d.serviceType),
            savedMenus(menuList).map((m) => m.serviceType),
          );
          return own === null ? null : (
            <p className="muted scan-phone">
              You write this as “{own}”.{' '}
              <button type="button" className="sm" onClick={() => patchJob(at, { serviceType: own })}>
                Use “{own}”
              </button>
            </p>
          );
        })()}
        {scannedField(
          'Guests',
          d.from.guests === null ? null : String(d.from.guests),
          d.guests,
          (v) => patchJob(at, { guests: v }),
          {
            inputMode: 'numeric',
            hint: job.meta.guestsWording !== null ? `Read “${job.meta.guestsWording}”.` : undefined,
          },
        )}

        {/* RULE 12. His words for a vague count, kept beside the box. */}
        {d.guestsWording !== null && (
          <p className="unresolved">
            The sheet said “{d.guestsWording}”, which is not a number and has not been turned into
            one. Put the figure in the box when you know it.
          </p>
        )}

        <div className="scan-job-dishes">
          {/* Still offered after "Add a dish" — while every dish is a blank row
              he has not filled in, the menu replaces them rather than mixing in. */}
          {d.dishes.length > 0 &&
            d.dishes.every((x) => x.read === null && x.choice.kind === 'none') &&
            menuButton(at, job)}
          {d.dishes.map((dish, i) => (
            <div key={i} className="line">
              <ChoiceField
                label={`Dish ${i + 1}`}
                value={choiceValue(dish.choice)}
                options={nameOptions(recipeList, dish)}
                onChange={(v) =>
                  patchJob(at, {
                    dishes: d.dishes.map((x, j) => (j === i ? { ...x, choice: choiceFrom(recipeList, v) } : x)),
                  })
                }
                hint={
                  dish.matches.length > 0
                    ? `“${dish.read ?? ''}” matches ${dish.matches.join(' and ')} — pick one.`
                    : dish.read === null
                      ? 'Pick one of your recipes, or type a new dish below.'
                      : `Read “${dish.read}”${dish.portions !== null ? ` · ${dish.portions} portions` : ''}.`
                }
              />
              {/*
               * A name to CREATE — only where nothing was matched. A dish that
               * matched two recipes never gets this box: making a third is the
               * worst of the wrong answers, so he picks one of the two.
               */}
              {dish.matches.length === 0 &&
                (dish.choice.kind === 'create' || dish.choice.kind === 'none') && (
                  <Field
                    label={dish.read === null ? 'Or type a new dish' : 'Name it will be created as'}
                    value={dish.choice.kind === 'create' ? dish.choice.name : ''}
                    onChange={(v) =>
                      patchJob(at, {
                        dishes: d.dishes.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                choice:
                                  v.trim() === ''
                                    ? { kind: 'none' }
                                    : { kind: 'create', name: v.replace(/^\s+/, '') },
                              }
                            : x,
                        ),
                      })
                    }
                    hint={typedDishHint(dish.choice)}
                  />
                )}
              <button
                className="sm"
                type="button"
                onClick={() => patchJob(at, { dishes: d.dishes.filter((_, j) => j !== i) })}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            className="sm"
            type="button"
            onClick={() =>
              patchJob(at, {
                dishes: [...d.dishes, { read: null, matches: [], choice: { kind: 'none' }, portions: null }],
              })
            }
          >
            Add a dish
          </button>
        </div>

        {/* RULES 9, 12 AND 16. The wording is the sheet's; the three fields
            beside it cannot come off a photograph, so he sets them. */}
        {d.dietaries.length > 0 && (
          <section className="needs-fixing">
            <h2>Dietary requirements — these need you</h2>
            <p>
              Kept exactly as the sheet had it. What kind of requirement it is and how serious it is
              are not on the photograph and have not been guessed — a possible conflict is for you
              to review, and nothing here will call anything safe.
            </p>

            {d.dietaries.map((dietary, i) => (
              <div key={i} className="line">
                <p className="unresolved">“{dietary.wording}”</p>
                <Field
                  label="What is it"
                  value={dietary.dietType}
                  onChange={(v) => patchDietary(at, i, { dietType: v })}
                  placeholder="nut allergy"
                  hint="Your own wording. There is no built-in list of diets."
                />
                <ChoiceField
                  label="How serious"
                  value={dietary.severity ?? ''}
                  options={SEVERITIES}
                  onChange={(v) =>
                    patchDietary(at, i, { severity: v === '' ? null : (v as DietarySeverity) })
                  }
                  hint="Not set until you choose. Nothing is assumed from the wording."
                />
                <label className="check">
                  <input
                    type="checkbox"
                    checked={dietary.excludesMeat}
                    onChange={(e) => patchDietary(at, i, { excludesMeat: e.target.checked })}
                  />
                  This person eats no meat
                </label>
                <p className="hint muted">
                  Tick only if you mean it — on a BBQ this changes how much meat is bought.
                </p>
              </div>
            ))}
          </section>
        )}

        <Field label="Notes" value={d.notes} onChange={(v) => patchJob(at, { notes: v })} multiline />
      </div>
    );
  };

  const jobCard = (job: PageJob, at: number): ReactNode => {
    if (page === null) return null;
    const d = job.draft;
    const gaps = jobGaps(page, at, recipeList);
    const isOpen = open.has(at);
    const newRecipes = creationsFromDraft(d).recipes;

    const status =
      job.savedJobId !== null
        ? { text: 'Saved', cls: 'scan-pill done' }
        : gaps.length === 0
          ? { text: 'Ready', cls: 'scan-pill done' }
          : { text: `${gaps.length} to fix`, cls: 'scan-pill' };

    return (
      <article key={at} className="scan-job">
        <header className="scan-job-head">
          <div>
            <p className="scan-job-title">
              Job {at + 1} · {shortDate(d.serviceDate) ?? 'No date yet'}
            </p>
            <p className="muted">{summaryOf(job)}</p>
          </div>
          <span className={status.cls}>{status.text}</span>
        </header>

        {d.dishes.length > 0 ? (
          <ul className="scan-dishes">
            {d.dishes.map((dish, i) => (
              <li key={i}>
                <span>
                  {dish.choice.kind === 'none' ? (dish.read ?? 'A dish to choose') : dish.choice.name}
                </span>
                {dish.portions !== null && <span className="scan-num">× {dish.portions}</span>}
              </li>
            ))}
          </ul>
        ) : d.menuToBeDecided === true ? (
          <p className="muted">
            Menu to be decided — kept out of shopping and prep until you add dishes.{' '}
            {job.savedJobId === null && (
              <button type="button" className="sm" onClick={() => patchJob(at, { menuToBeDecided: false })}>
                Undo
              </button>
            )}
          </p>
        ) : (
          <p className="muted">No dishes are written under this booking.</p>
        )}

        {newRecipes.length > 0 && job.savedJobId === null && (
          <p className="muted">
            Creates {newRecipes.length === 1 ? 'a new recipe' : `${newRecipes.length} new recipes`} (
            {newRecipes.join(', ')}) — names only. They won’t be bought or costed until you add their
            ingredients.
          </p>
        )}

        {serviceOffer(at, job)}

        {job.savedJobId !== null ? (
          <>
            <p role="status">Saved as a new enquiry — open it on the Jobs screen.</p>
            {menuSaveOffer(at, job)}
          </>
        ) : (
          <div className="actions">
            <button type="button" onClick={() => toggleJob(at)}>
              {isOpen ? 'Hide details' : 'Show details'}
            </button>
            <button
              type="button"
              className="primary scan-job-save"
              disabled={busy || !saveable(page, at, recipeList)}
              onClick={() => void saveJob(at)}
            >
              {busy ? 'Saving…' : 'Save this job'}
            </button>
          </div>
        )}

        {failed !== null && failed.at === at && job.savedJobId === null && (
          <p className="error" role="alert">
            This job was not saved — {failed.error}
          </p>
        )}

        {isOpen && job.savedJobId === null && details(at, job)}
      </article>
    );
  };

  // -------------------------------------------------------------------------

  return (
    <Screen
      title="Scan a job sheet"
      description="Photograph the sheet, fix anything wrong here, then save. Nothing is written until you tap save."
    >

      <PhotoGate sources={sources} busy={busy} onFile={(file) => void scan(file)} />

      {busy && page === null && <p className="muted">Reading it…</p>}

      {refusal !== null && (
        <p className="error" role="alert">
          {refusal}
        </p>
      )}

      {partial.length > 0 && (
        <section className="unresolved-block">
          <h2>These were created before it failed</h2>
          <p>They already exist, so saving again will use them rather than making them twice.</p>
          <ul>
            {partial.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      )}

      {page === null && !busy && refusal === null && (
        <EmptyState
          title="Nothing scanned yet"
          description="Photograph a whole page — every booking on it becomes a job you can check here and save."
        />
      )}

      {page !== null && (
        <>
          <section className="units">
            <h2>On this page</h2>
            <p className="scan-count">
              {jobs.length === 0
                ? 'No bookings found on this page'
                : `${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'} found on this page`}
            </p>
            {underLine() !== null && <p className="muted">{underLine()}</p>}
            {page.unplaced.length === 0 ? (
              jobs.length > 0 && <p className="scan-placed">✓ Every line on the page was placed in a job</p>
            ) : (
              <div className="unresolved">
                <p>These lines were read but not placed in any job — check whether they belong to one:</p>
                <ul>
                  {page.unplaced.map((line) => (
                    <li key={line}>“{line}”</li>
                  ))}
                </ul>
              </div>
            )}
            {page.uncertain.length > 0 && (
              <p className="muted">
                The scanner was unsure about:{' '}
                {page.uncertain.map((u) => (u.saw === null ? u.field : `${u.field} (“${u.saw}”)`)).join('; ')}
              </p>
            )}
          </section>

          {needsYou()}

          {blocks.map((block) => heading(block))}

          {jobs.length > 0 && (
            <section className="units">
              <h2>Jobs on this page</h2>
              {jobs.map((job, at) => jobCard(job, at))}
            </section>
          )}

          {/* Discard first, save last. Discard is secondary, not danger: it
              throws away a draft, not a record. */}
          {unsaved.length > 0 ? (
            <div className="actions">
              <button type="button" onClick={() => setPage(null)} disabled={busy}>
                {savedCount > 0 ? 'Discard the rest' : 'Discard scan'}
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || readyCount === 0}
                onClick={() => void saveAllReady()}
              >
                {busy
                  ? 'Saving…'
                  : readyCount === 0
                    ? 'Nothing ready to save yet'
                    : `Save ${readyCount} ready ${readyCount === 1 ? 'job' : 'jobs'}`}
              </button>
            </div>
          ) : (
            jobs.length > 0 && (
              <p role="status">
                All {jobs.length} {jobs.length === 1 ? 'job is' : 'jobs are'} saved. Open them on the
                Jobs screen to allocate portions and name the guests behind any dietary.
              </p>
            )
          )}

          {unsaved.length > 0 && readyCount < unsaved.length && (
            <p className="muted">
              A job saves once everything under “Needs you” for it is settled. Saving one never loses
              the others.
            </p>
          )}
        </>
      )}
    </Screen>
  );
}
