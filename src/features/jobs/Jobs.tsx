/**
 * Jobs — the last screen, and the one the cascade was built for.
 *
 * Three rules are structural here rather than advisory:
 *
 *   Rule 16 — there is NO count input anywhere on this form. A dietary is either
 *   allocated to one named guest, or unresolved with the owner's wording kept
 *   verbatim. Two guests with the same requirement are two rows; one guest with
 *   two requirements shares a guest ref. Summing is not discouraged, it is
 *   unavailable.
 *
 *   Rule 15 — a completed or cancelled job stays editable. An invoice arrives
 *   late, a guest count is misremembered. Status is a state, not a lock, and the
 *   correction is logged by the trigger like any other.
 *
 *   Rule 11 — pricing is a union. The rate card applies, or the owner overrides
 *   it, and the computed figure is shown BESIDE the override so he can see what
 *   he is overriding.
 */

import { useState, type ReactNode } from 'react';
import { supabaseDb } from '../../data/client';
import {
  clientRateRepository,
  menuTemplateRepository,
  customerRepository,
  ingredientRepository,
  jobRepository,
  propertyRepository,
  recipeRepository,
} from '../../data/repositories';
import { ChoiceField, Field } from '../../ui/Field';
import { RecordForm, RecordScreen } from '../../ui/RecordScreen';
import { jobLockedReason } from '../../ui/bulkDelete';
import { SourceNotice } from '../../ui/SourceNotice';
import { sourceState, type DataSource } from '../../ui/sourceState';
import { useAsync, type AsyncState } from '../../ui/useAsync';
import { formatMoney, moneyValue, parseCount, parseMoney, parseText, textValue } from '../../ui/form';
import { menuFor, menuToSave, serviceTypeFromMenus } from '../../engine/menus';
import { SaveAsMenu } from '../setup/SaveAsMenu';
import { distinctNames } from '../../ui/suggestions';
import { jobRevenue } from '../../engine/costing';
import { portionsDerivable } from '../../engine/rules';
import type { JobChanges } from '../../engine/impact';
import { ImpactPreview } from './ImpactPreview';
import { Dashboard } from '../dashboard/Dashboard';
import { useKitchen } from '../../auth/kitchenState';
import type {
  AllocatedDietary,
  CustomerId,
  DietarySeverity,
  GuestRef,
  Job,
  JobDietary,
  JobDietaryId,
  JobDish,
  JobDishId,
  JobExtra,
  JobExtraId,
  JobId,
  JobStatus,
  KitchenId,
  PropertyId,
  Recipe,
  RecipeId,
  UnresolvedDietary,
} from '../../engine/types';

const STATUSES: { value: JobStatus; label: string }[] = [
  { value: 'enquiry', label: 'Enquiry' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'in_prep', label: 'In prep' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'invoiced', label: 'Invoiced' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
];

const SEVERITIES: { value: DietarySeverity; label: string }[] = [
  { value: 'info', label: 'Info' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'severe', label: 'Severe' },
];

const STATUS_LABEL: Record<JobStatus, string> = {
  enquiry: 'Enquiry',
  confirmed: 'Confirmed',
  in_prep: 'In prep',
  delivered: 'Delivered',
  invoiced: 'Invoiced',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

const DONE: ReadonlySet<JobStatus> = new Set(['delivered', 'invoiced', 'paid']);

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-11-27" → Fri / 27, read as a local calendar date. Null for no date. */
function dateChip(iso: string | null): { dow: string; day: number; label: string } | null {
  if (iso === null || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
  const dow = DOW[date.getDay()] ?? '';
  return { dow, day: date.getDate(), label: `${dow} ${date.getDate()}` };
}

/** A job with its customer's name, for the list. The name is read, never guessed. */
interface JobRow {
  readonly job: Job;
  readonly customer: string | null;
}

const rowTitle = (r: JobRow): string =>
  [r.job.serviceType ?? 'No service type', r.customer].filter((x) => x !== null).join(' · ');

const CLOSED: ReadonlySet<JobStatus> = new Set(['delivered', 'invoiced', 'paid', 'cancelled']);

/** Soonest first, undated last — what is coming up reads top down. */
const soonest = (a: JobRow, b: JobRow): number =>
  (a.job.serviceDate ?? '9999').localeCompare(b.job.serviceDate ?? '9999');

/** Most recent first, for history. */
const latest = (a: JobRow, b: JobRow): number =>
  (b.job.serviceDate ?? '').localeCompare(a.job.serviceDate ?? '');

const JOB_FILTERS = [
  { key: 'upcoming', label: 'Upcoming', test: (r: JobRow) => !CLOSED.has(r.job.status), sort: soonest },
  { key: 'enquiries', label: 'Enquiries', test: (r: JobRow) => r.job.status === 'enquiry', sort: soonest },
  { key: 'done', label: 'Done & cancelled', test: (r: JobRow) => CLOSED.has(r.job.status), sort: latest },
  { key: 'all', label: 'All', test: () => true, sort: latest },
] as const;

/**
 * One job as a row: date chip, what and who, its status, and what still needs
 * him — each said in words at the point he looks, never left for a detail
 * screen (Rule 12).
 */
function JobRowView({ row }: { readonly row: JobRow }): ReactNode {
  const j = row.job;
  const chip = dateChip(j.serviceDate);
  const severe = j.dietaries.filter((d) => d.severity === 'severe');
  const unresolved = j.dietaries.filter(
    (d): d is Extract<typeof d, { kind: 'unresolved' }> => d.kind === 'unresolved',
  );

  return (
    <span className="record-row">
      {chip === null ? (
        <span className="date-chip is-none">
          <span>No</span>
          <span>date</span>
        </span>
      ) : (
        <span className="date-chip" aria-label={chip.label}>
          <span className="date-chip-dow">{chip.dow}</span>
          <span className="date-chip-day">{chip.day}</span>
        </span>
      )}
      <span className="record-body">
        <span className="record-head">
          <strong>{rowTitle(row)}</strong>
          <span className={`status-pill${DONE.has(j.status) ? ' is-done' : ''}`}>
            {STATUS_LABEL[j.status]}
          </span>
        </span>
        <span className="muted num">
          {[
            j.serviceTime === null ? null : j.serviceTime.slice(0, 5),
            j.guests === null ? 'no guest count' : `${j.guests} guests`,
            `${j.dishes.length} dish${j.dishes.length === 1 ? '' : 'es'}`,
          ]
            .filter((x) => x !== null)
            .join(' · ')}
        </span>
        {(j.dishes.length === 0 || severe.length > 0 || unresolved.length > 0) && (
          <span className="row-tags">
            {j.dishes.length === 0 && <span className="row-tag">No menu yet</span>}
            {unresolved.map((d) => (
              <span key={d.id} className="row-tag">
                “{d.originalWording}” — count not confirmed
              </span>
            ))}
            {/* RULE 9. A severe requirement asks for review; it never claims a
                conflict or its absence. Amber, the one colour that means look. */}
            {severe.map((d) => (
              <span key={d.id} className="row-tag is-warn">
                Severe: {d.dietType} — review the menu
              </span>
            ))}
          </span>
        )}
      </span>
    </span>
  );
}

export function Jobs(): ReactNode {
  const db = supabaseDb();
  const repo = jobRepository(db);

  return (
    <>
      {/* The former "Today" screen. Folded in rather than kept as its own tab:
          what is coming up and the jobs it comes from are one question, and the
          dashboard was the only tab that answered half of it.

          Still its own component in `features/dashboard/` — `derived.test.ts`
          guards that directory by name, and it writes nothing. */}
      <Dashboard />

      {/* The target of the dashboard's "All jobs". A fragment on the same
          screen rather than a route, because the list IS on the same screen —
          the comment at that link records what the route did instead. */}
      <div id="jobs-list">
        <RecordScreen<JobRow>
          title="Jobs"
          icon="jobs"
          why="everything the kitchen does is one of them, and shopping, prep and packing are all derived from this list"
          addLabel="Add a job"
          emptyDescription="A job is one service: who, where, when, how many, and what you are cooking."
          load={async () => {
            /*
             * The customer's NAME for each row, read alongside the jobs. A failed
             * customer read does not fail the list: the rows show without names
             * rather than not at all, and a name is never invented in its place.
             */
            const [jobs, customers] = await Promise.all([
              repo.list(),
              customerRepository(db)
                .list()
                .catch(() => null),
            ]);
            const nameOf = new Map((customers ?? []).map((c) => [c.id as string, c.name]));
            return jobs.map((job) => ({
              job,
              customer: job.customerId === null ? null : (nameOf.get(job.customerId) ?? null),
            }));
          }}
          keyOf={(r) => r.job.id}
          searchText={(r) =>
            [r.job.serviceType, r.customer, r.job.serviceDate, r.job.notes]
              .filter((x): x is string => x !== null)
              .join(' ')
          }
          filters={JOB_FILTERS}
          bulk={{
            remove: (r) => repo.remove(r.job.id),
            nameOf: (r) => rowTitle(r),
            lockedReason: (r) => jobLockedReason(r.job),
            refusal: (cause) => (cause instanceof Error ? cause.message : 'could not be deleted'),
            noun: ['job', 'jobs'],
          }}
          sheetTitle={rowTitle}
          renderRow={(r) => <JobRowView row={r} />}
          renderForm={(r, done) => <JobForm job={r?.job ?? null} done={done} />}
        />
      </div>
    </>
  );
}

interface DishDraft {
  key: string;
  recipeId: string;
  portions: string;
}

interface DietaryDraft {
  key: string;
  kind: 'allocated' | 'unresolved';
  dietType: string;
  severity: DietarySeverity;
  /** Allocated only. Two rows sharing this are ONE person (Rule 16). */
  guest: string;
  /** Unresolved only. Verbatim, never parsed (Rule 12). */
  wording: string;
  excludesMeat: boolean;
  assignedRecipeId: string;
}

interface ExtraDraft {
  key: string;
  label: string;
  amountEach: string;
  quantity: string;
}

let seq = 0;
const newKey = (): string => `j${(seq += 1)}`;

/**
 * What "Portions" promises, told truthfully for THIS recipe.
 *
 * The field used to say "leave blank to let the guest count decide" for every
 * dish. `applyBuffetSplit` only does that for a main, a side or a dessert — for a
 * breakfast or an uncoursed recipe it leaves the dish null, `productionBuckets`
 * drops it, and it contributes no prep, no shopping and no food cost while still
 * sitting on the menu.
 *
 * So the owner followed the instruction on screen and silently lost the dish.
 * Rule 12: the need for a figure has to be obvious AT THE POINT OF USE, not
 * buried in a screen he has no reason to open.
 */
function portionsHint(recipe: Recipe | undefined): string {
  // Nothing chosen yet — do not warn about a recipe he has not picked.
  if (recipe === undefined) {
    return 'Leave blank to let the guest count decide. Type a number and yours wins.';
  }

  if (portionsDerivable(recipe)) {
    return 'Leave blank to let the guest count decide. Type a number and yours wins.';
  }

  return recipe.course === null
    ? `Type a number — ${recipe.name} has no course, so the guest count cannot decide for it. Left blank, this dish is left out of prep, shopping and cost.`
    : `Type a number — a ${recipe.course} is a choice, not an even split, so the guest count cannot decide for it. Left blank, this dish is left out of prep, shopping and cost.`;
}

function JobForm({ job, done }: { job: Job | null; done: (said?: string) => void }): ReactNode {
  const { state } = useKitchen();
  const db = supabaseDb();
  const repo = jobRepository(db);

  // Loaded once. The preview then recomputes purely on every keystroke, with no
  // further network — that is what makes it live.
  const jobs = useAsync(() => repo.list(), []);
  const recipes = useAsync(() => recipeRepository(db).list(), []);
  const ingredients = useAsync(() => ingredientRepository(db).list(), []);
  const customers = useAsync(() => customerRepository(db).list(), []);
  const properties = useAsync(() => propertyRepository(db).list(), []);
  const rates = useAsync(() => clientRateRepository(db).list(), []);
  const menus = useAsync(() => menuTemplateRepository(db).list(), []);

  /*
   * What the preview is made of. Gated separately because these three are the
   * ones whose absence removes a feature rather than a dropdown — and the `why`
   * clause on each has to say so, since the preview's absence is otherwise the
   * silence this whole change was about.
   */
  const previewSources: readonly DataSource[] = [
    {
      what: 'your other jobs',
      why: 'the preview needs them to show what this change does to a shared prep day',
      state: jobs.state,
      reload: jobs.reload,
    },
    {
      what: 'your recipes',
      why: 'the menu is chosen from them, and the preview scales them to the guest count',
      state: recipes.state,
      reload: recipes.reload,
    },
    {
      what: 'your ingredients',
      why: 'the preview works out what this change adds to the shopping list',
      state: ingredients.state,
      reload: ingredients.reload,
    },
  ];

  /*
   * And what the form itself is made of. These three failed WORSE than
   * silently: `nameOptions` falls back to the blank option, so a broken read
   * renders as "No customer" and nothing else — indistinguishable from a
   * kitchen with no customers in it.
   */
  const formSources: readonly DataSource[] = [
    {
      what: 'your customers',
      why: 'the customer is what decides which rate from the card applies',
      state: customers.state,
      reload: customers.reload,
    },
    {
      what: 'your properties',
      why: 'the property is where the service happens, and it carries the address',
      state: properties.state,
      reload: properties.reload,
    },
    {
      what: 'your rate card',
      why: 'without it no rate can apply, and the price stays blank',
      state: rates.state,
      reload: rates.reload,
    },
    {
      what: 'your saved menus',
      why: 'a job with no dishes is offered your usual menu for its service type',
      state: menus.state,
      reload: menus.reload,
    },
  ];

  const sources: readonly DataSource[] = [...previewSources, ...formSources];

  const [customerId, setCustomerId] = useState(job?.customerId ?? '');
  const [propertyId, setPropertyId] = useState(job?.propertyId ?? '');
  const [serviceDate, setServiceDate] = useState(textValue(job?.serviceDate ?? null));
  // The database hands the time back with seconds ("19:00:00"); he wrote and
  // reads hours and minutes.
  const [serviceTime, setServiceTime] = useState(
    textValue(job?.serviceTime === undefined || job.serviceTime === null ? null : job.serviceTime.slice(0, 5)),
  );
  const [serviceType, setServiceType] = useState(textValue(job?.serviceType ?? null));
  /** What "Save as your menu" said, kept after the offer itself goes. */
  const [menuNote, setMenuNote] = useState<string | null>(null);
  const [guests, setGuests] = useState(job?.guests === null || job === null ? '' : String(job.guests));
  const [guestsConfirmed, setGuestsConfirmed] = useState(job?.guestsConfirmed ?? false);
  const [meatEating, setMeatEating] = useState(
    job?.meatEatingGuests === null || job === null ? '' : String(job.meatEatingGuests),
  );
  const [status, setStatus] = useState<string>(job?.status ?? 'enquiry');
  const [override, setOverride] = useState(
    job?.pricing.kind === 'override' ? moneyValue(job.pricing.amount) : '',
  );
  const [notes, setNotes] = useState(textValue(job?.notes ?? null));

  const [dishes, setDishes] = useState<DishDraft[]>(
    (job?.dishes ?? []).map((d) => ({
      key: newKey(),
      recipeId: d.recipeId,
      portions: d.portions === null ? '' : String(d.portions),
    })),
  );
  const [dietaries, setDietaries] = useState<DietaryDraft[]>(
    (job?.dietaries ?? []).map((d) => ({
      key: newKey(),
      kind: d.kind,
      dietType: d.dietType,
      severity: d.severity,
      guest: d.kind === 'allocated' ? d.guest : '',
      wording: d.kind === 'unresolved' ? d.originalWording : '',
      excludesMeat: d.excludesMeat,
      assignedRecipeId: d.assignedRecipeId ?? '',
    })),
  );
  const [extras, setExtras] = useState<ExtraDraft[]>(
    (job?.extras ?? []).map((e) => ({
      key: newKey(),
      label: e.label,
      amountEach: moneyValue(e.amountEach),
      quantity: String(e.quantity),
    })),
  );

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const kitchenId =
    state.status === 'ready' ? (state.membership.kitchenId as KitchenId) : ('' as KitchenId);

  const overrideParse = parseMoney(override);
  const guestsParse = parseCount(guests);

  const buildDishes = (): JobDish[] =>
    dishes
      .filter((d) => d.recipeId !== '')
      .map((d, position) => ({
        id: '' as JobDishId,
        jobId: job?.id ?? ('' as JobId),
        recipeId: d.recipeId as RecipeId,
        // Blank means "let the guest count decide" — applyBuffetSplit derives it.
        portions: d.portions.trim() === '' ? null : Number(d.portions),
        note: null,
        position,
      }));

  const buildDietaries = (): JobDietary[] =>
    dietaries
      .filter((d) => d.dietType.trim() !== '')
      .map((d) => {
        const base = {
          id: '' as JobDietaryId,
          jobId: job?.id ?? ('' as JobId),
          dietType: d.dietType.trim(),
          severity: d.severity,
          excludesMeat: d.excludesMeat,
          details: null,
          assignedRecipeId:
            d.assignedRecipeId === '' ? null : (d.assignedRecipeId as RecipeId),
        };
        return d.kind === 'unresolved'
          ? ({ ...base, kind: 'unresolved', originalWording: d.wording } as UnresolvedDietary)
          : ({ ...base, kind: 'allocated', guest: d.guest as GuestRef } as AllocatedDietary);
      });

  const buildExtras = (): JobExtra[] =>
    extras
      .filter((e) => e.label.trim() !== '')
      .map((e) => ({
        id: '' as JobExtraId,
        jobId: job?.id ?? ('' as JobId),
        label: e.label.trim(),
        // Blank is null, not zero: a named but unpriced extra makes revenue null
        // rather than silently free (Rules 8 and 11).
        amountEach: parseMoney(e.amountEach).cents,
        quantity: parseCount(e.quantity).value ?? 1,
      }));

  const nameOptions = <T extends { id: string; name: string }>(
    state: AsyncState<T[]>,
    blank: string,
  ): { value: string; label: string }[] => [
    { value: '', label: blank },
    ...(state.status === 'ready' ? state.data.map((x) => ({ value: x.id, label: x.name })) : []),
  ];

  const draft = (): Job => ({
    id: job?.id ?? ('' as JobId),
    kitchenId,
    customerId: customerId === '' ? null : (customerId as CustomerId),
    propertyId: propertyId === '' ? null : (propertyId as PropertyId),
    jobGroup: job?.jobGroup ?? null,
    serviceDate: parseText(serviceDate) as Job['serviceDate'],
    serviceTime: parseText(serviceTime) as Job['serviceTime'],
    serviceType: parseText(serviceType),
    guests: guestsParse.value,
    guestsConfirmed,
    meatEatingGuests: parseCount(meatEating).value,
    pricing:
      overrideParse.cents === null
        ? { kind: 'rate_card' }
        : { kind: 'override', amount: overrideParse.cents },
    status: status as JobStatus,
    notes: parseText(notes),
    dishes: buildDishes(),
    dietaries: buildDietaries(),
    extras: buildExtras(),
  });

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await repo.save(draft());
      done('Saved');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
      setSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (job === null) return;
    setSaving(true);
    try {
      await repo.remove(job.id);
      done('Deleted');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete.');
      setSaving(false);
    }
  };

  const recipeOptions = [
    { value: '', label: 'Choose a recipe' },
    ...(recipes.state.status === 'ready'
      ? recipes.state.data.map((r) => ({ value: r.id as string, label: r.name }))
      : []),
  ];

  const recipeById = new Map(
    recipes.state.status === 'ready' ? recipes.state.data.map((r) => [r.id as string, r]) : [],
  );

  const customer =
    customers.state.status === 'ready'
      ? customers.state.data.find((c) => c.id === customerId)
      : undefined;
  const rateList = rates.state.status === 'ready' ? rates.state.data : [];

  // Rule 11: the computed figure stays visible beside an override, so he can see
  // what he is overriding rather than replacing a number he cannot check.
  const computed = jobRevenue({ ...draft(), pricing: { kind: 'rate_card' } }, customer, rateList);

  // What differs from what is saved. `changeImpact` diffs two full engine runs
  // over this.
  const changes: JobChanges = {
    guests: guestsParse.value,
    serviceDate: parseText(serviceDate) as Job['serviceDate'],
    serviceType: parseText(serviceType),
    status: status as JobStatus,
    dishes: buildDishes(),
  };
  const guestsChanged = job !== null && guestsParse.value !== job.guests;

  // Not a boolean of its own: the same decision the notice above is rendering,
  // asked of the three reads the preview actually needs.
  const previewReady = sourceState(previewSources).kind === 'ready';

  const patchDish = (key: string, patch: Partial<DishDraft>): void =>
    setDishes((all) => all.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const patchDietary = (key: string, patch: Partial<DietaryDraft>): void =>
    setDietaries((all) => all.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const patchExtra = (key: string, patch: Partial<ExtraDraft>): void =>
    setExtras((all) => all.map((e) => (e.key === key ? { ...e, ...patch } : e)));

  return (
    <RecordForm
      saving={saving}
      error={error}
      onSave={() => void save()}
      onCancel={done}
      onDelete={job === null ? undefined : () => void remove()}
      deleteWarningText="Delete this job? Completed and cancelled jobs are normally kept, because historical figures depend on them."
    >
      {/* Above the two dropdowns it explains, and above the preview it
          explains. Inline, with no title: `RecordScreen` has already put the
          heading on. */}
      <SourceNotice state={sourceState(sources)} />

      <ChoiceField
        label="Customer"
        value={customerId}
        options={nameOptions(customers.state, 'No customer')}
        onChange={setCustomerId}
      />
      <ChoiceField
        label="Property"
        value={propertyId}
        options={nameOptions(properties.state, 'No property')}
        onChange={setPropertyId}
      />

      <Field label="Service date" value={serviceDate} onChange={setServiceDate} type="date" />
      <Field label="Service time" value={serviceTime} onChange={setServiceTime} placeholder="18:00" numeric />
      <Field
        label="Service type"
        value={serviceType}
        onChange={setServiceType}
        suggestions={distinctNames(
          rates.state.status === 'ready' ? rates.state.data.map((r) => r.serviceType) : [],
          menus.state.status === 'ready' ? menus.state.data.map((m) => m.serviceType) : [],
          jobs.state.status === 'ready' ? jobs.state.data.map((j) => j.serviceType) : [],
        )}
        hint="Must match a rate-card service type exactly for a rate to apply — pick one you already use."
      />

      {/* Dishes chosen, no service type: offered from his saved menus only,
          when the dishes fit exactly one. Never filled in — it sets the price. */}
      {serviceType.trim() === '' &&
        (() => {
          const chosen = dishes.map((d) => d.recipeId).filter((id) => id !== '');
          if (chosen.length === 0 || chosen.length !== dishes.length) return null;
          const type = serviceTypeFromMenus(
            chosen as RecipeId[],
            menus.state.status === 'ready' ? menus.state.data : [],
          );
          if (type === null) return null;
          return (
            <p className="muted">
              These dishes are all on your {type} menu.{' '}
              <button type="button" className="sm" onClick={() => setServiceType(type)}>
                Set service type to “{type}”
              </button>
            </p>
          );
        })()}

      <Field
        label="Guests"
        value={guests}
        onChange={setGuests}
        inputMode="numeric"
        numeric
        error={guestsParse.error}
        hint="Leave blank if you do not know yet. Blank is not zero, and quantities that depend on it stay unresolved."
      />
      <label className="check">
        <input
          type="checkbox"
          checked={guestsConfirmed}
          onChange={(e) => setGuestsConfirmed(e.target.checked)}
        />
        Guest count confirmed
      </label>
      <Field
        label="Meat-eating guests"
        value={meatEating}
        onChange={setMeatEating}
        inputMode="numeric"
        numeric
        hint="Your own figure. Leave blank and it is worked out from the dietaries below — never by adding them up."
      />

      {/* THE PREVIEW — the §4 feature. Purely computed, no network. */}
      {previewReady && job !== null && (
        <ImpactPreview
          jobs={jobs.state.status === 'ready' ? jobs.state.data : []}
          recipes={recipes.state.status === 'ready' ? recipes.state.data : []}
          ingredients={ingredients.state.status === 'ready' ? ingredients.state.data : []}
          jobId={job.id}
          changes={changes}
          customer={customer}
          rates={rateList}
          guestsChanged={guestsChanged}
        />
      )}

      {/* --- menu ------------------------------------------------------- */}
      <fieldset className="units">
        <legend>Menu</legend>
        {dishes.length === 0 && <p className="muted">No dishes yet.</p>}

        {/* His usual menu for this service type, OFFERED — never added by
            itself (Rule 7). Only on a job with no dishes, so it never mixes
            into a menu he has already started. */}
        {dishes.every((d) => d.recipeId === '') &&
          (() => {
            const saved = menuFor(
              parseText(serviceType),
              menus.state.status === 'ready' ? menus.state.data : [],
            );
            if (saved === null) return null;
            return (
              <button
                type="button"
                className="primary"
                onClick={() =>
                  setDishes(
                    saved.recipeIds.map((recipeId) => ({ key: newKey(), recipeId, portions: '' })),
                  )
                }
              >
                Use your {saved.serviceType} menu ({saved.recipeIds.length} dish
                {saved.recipeIds.length === 1 ? '' : 'es'})
              </button>
            );
          })()}

        {dishes.map((d) => (
          <div key={d.key} className="line">
            <ChoiceField
              label="Recipe"
              value={d.recipeId}
              options={recipeOptions}
              onChange={(v) => patchDish(d.key, { recipeId: v })}
            />
            <Field
              label="Portions"
              value={d.portions}
              onChange={(v) => patchDish(d.key, { portions: v })}
              inputMode="numeric"
              numeric
              hint={portionsHint(recipeById.get(d.recipeId))}
            />
            <button
              className="sm"
              type="button"
              onClick={() => setDishes((all) => all.filter((x) => x.key !== d.key))}
            >
              Remove dish
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() => setDishes((all) => [...all, { key: newKey(), recipeId: '', portions: '' }])}
        >
          Add a dish
        </button>

        {/* No saved menu for this service type yet: one tap makes these dishes
            the standard. Never replaces a menu he already has. */}
        {menuNote !== null ? (
          <p role="status">{menuNote}</p>
        ) : (
          (() => {
            const chosen = dishes.map((d) => d.recipeId).filter((id) => id !== '');
            if (chosen.length !== dishes.length || menus.state.status !== 'ready') return null;
            const offer = menuToSave(parseText(serviceType), chosen as RecipeId[], menus.state.data);
            if (offer === null) return null;
            return (
              <SaveAsMenu
                menu={offer}
                kitchenId={kitchenId}
                onSaved={(said) => {
                  setMenuNote(said);
                  menus.reload();
                }}
              />
            );
          })()
        )}
      </fieldset>

      {/* --- dietaries -------------------------------------------------- */}
      <fieldset className="units">
        <legend>Dietary requirements</legend>
        <p className="muted">
          One row per requirement, per guest. <strong>There is no count box</strong> — two guests
          with the same requirement are two rows, and one guest with two requirements shares a
          guest reference. Counting them up would double anyone who has both.
        </p>

        {dietaries.map((d) => (
          <div key={d.key} className="line">
            <ChoiceField
              label="Kind"
              value={d.kind}
              options={[
                { value: 'allocated', label: 'A named guest' },
                { value: 'unresolved', label: 'Not yet pinned down' },
              ]}
              onChange={(v) => patchDietary(d.key, { kind: v as DietaryDraft['kind'] })}
            />
            <Field
              label="Requirement"
              value={d.dietType}
              onChange={(v) => patchDietary(d.key, { dietType: v })}
              hint="Your own words: vegan, coeliac, severe mushroom allergy."
            />
            <ChoiceField
              label="Severity"
              value={d.severity}
              options={SEVERITIES}
              onChange={(v) => patchDietary(d.key, { severity: v as DietarySeverity })}
            />

            {d.kind === 'allocated' ? (
              <Field
                label="Guest"
                value={d.guest}
                onChange={(v) => patchDietary(d.key, { guest: v })}
                hint="Anything that identifies them for this job. Use the SAME value on two rows if it is one person with two requirements."
              />
            ) : (
              <Field
                label="What you were told"
                value={d.wording}
                onChange={(v) => patchDietary(d.key, { wording: v })}
                hint="Kept word for word — “a few vegetarians” stays that. It is never turned into a number, and it blocks exact purchase quantities until you pin it down."
              />
            )}

            <label className="check">
              <input
                type="checkbox"
                checked={d.excludesMeat}
                onChange={(e) => patchDietary(d.key, { excludesMeat: e.target.checked })}
              />
              This guest does not eat meat
            </label>

            <ChoiceField
              label="Dish for them"
              value={d.assignedRecipeId}
              options={[{ value: '', label: 'Not decided' }, ...recipeOptions.slice(1)]}
              onChange={(v) => patchDietary(d.key, { assignedRecipeId: v })}
            />

            <button
              className="sm"
              type="button"
              onClick={() => setDietaries((all) => all.filter((x) => x.key !== d.key))}
            >
              Remove
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() =>
            setDietaries((all) => [
              ...all,
              {
                key: newKey(),
                kind: 'allocated',
                dietType: '',
                severity: 'moderate',
                guest: '',
                wording: '',
                excludesMeat: false,
                assignedRecipeId: '',
              },
            ])
          }
        >
          Add a dietary requirement
        </button>
      </fieldset>

      {/* --- extras ----------------------------------------------------- */}
      <fieldset className="units">
        <legend>Extras and surcharges</legend>
        {extras.map((e) => (
          <div key={e.key} className="line">
            <Field
              label="What"
              value={e.label}
              onChange={(v) => patchExtra(e.key, { label: v })}
              placeholder="Bistro steak surcharge"
            />
            <Field
              label="Each"
              value={e.amountEach}
              onChange={(v) => patchExtra(e.key, { amountEach: v })}
              inputMode="decimal"
              numeric
              hint="Blank means you have not priced it — the whole job price then stays blank rather than being wrong."
            />
            <Field
              label="How many"
              value={e.quantity}
              onChange={(v) => patchExtra(e.key, { quantity: v })}
              inputMode="numeric"
              numeric
            />
            <button
              className="sm"
              type="button"
              onClick={() => setExtras((all) => all.filter((x) => x.key !== e.key))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setExtras((all) => [...all, { key: newKey(), label: '', amountEach: '', quantity: '1' }])
          }
        >
          Add an extra
        </button>
      </fieldset>

      {/* --- price and status ------------------------------------------- */}
      <fieldset className="units">
        <legend>Price</legend>
        <p className="muted num">
          From the rate card: <strong>{formatMoney(computed.computed, 'no rate applies')}</strong>
        </p>
        <Field
          label="Override"
          value={override}
          onChange={setOverride}
          inputMode="decimal"
          numeric
          error={overrideParse.error}
          hint="Leave blank to use the rate card. A figure here replaces it, is recorded as an override, and the rate-card figure stays visible above."
        />
      </fieldset>

      <ChoiceField label="Status" value={status} options={STATUSES} onChange={setStatus} />
      {(status === 'delivered' || status === 'invoiced' || status === 'paid' || status === 'cancelled') && (
        <p className="muted">
          Completed and cancelled jobs stay editable — an invoice arrives late, a guest count is
          remembered wrong. Any correction is logged with who changed it and when.
        </p>
      )}

      <Field label="Notes" value={notes} onChange={setNotes} multiline />
    </RecordForm>
  );
}
