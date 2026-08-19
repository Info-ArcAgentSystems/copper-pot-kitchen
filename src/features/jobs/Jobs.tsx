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
import { Link } from 'react-router-dom';
import { supabaseDb } from '../../data/client';
import {
  clientRateRepository,
  customerRepository,
  ingredientRepository,
  jobRepository,
  propertyRepository,
  recipeRepository,
} from '../../data/repositories';
import { ChoiceField, Field } from '../../ui/Field';
import { RecordForm, RecordScreen } from '../../ui/RecordScreen';
import { useAsync, type AsyncState } from '../../ui/useAsync';
import { formatMoney, moneyValue, parseCount, parseMoney, parseText, textValue } from '../../ui/form';
import { jobRevenue } from '../../engine/costing';
import type { JobChanges } from '../../engine/impact';
import { ImpactPreview } from './ImpactPreview';
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

export function Jobs(): ReactNode {
  const repo = jobRepository(supabaseDb());

  return (
    <>
      {/* Scan lives here rather than in the tab bar: it produces jobs, and the
          bar is already at its width limit. */}
      <p className="muted">
        <Link to="/scan/job-sheet">Scan a job sheet from a photo</Link>
      </p>
      <RecordScreen<Job>
        title="Jobs"
        addLabel="Add a job"
        emptyDescription="A job is one service: who, where, when, how many, and what you are cooking."
        load={async () =>
          (await repo.list()).sort((a, b) =>
            (b.serviceDate ?? '').localeCompare(a.serviceDate ?? ''),
          )
        }
        keyOf={(j) => j.id}
        renderRow={(j) => (
          <>
            <strong>
              {j.serviceDate ?? 'no date'} · {j.serviceType ?? 'no service type'}
            </strong>
            <span className="muted num">
              {[
                j.guests === null ? 'no guest count' : `${j.guests} guests`,
                `${j.dishes.length} dish${j.dishes.length === 1 ? '' : 'es'}`,
                j.status,
              ].join(' · ')}
            </span>
            {j.dietaries.some((d) => d.kind === 'unresolved') && (
              <span className="unresolved">unresolved dietary</span>
            )}
          </>
        )}
          renderForm={(job, done) => <JobForm job={job} done={done} />}
      />
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

function JobForm({ job, done }: { job: Job | null; done: () => void }): ReactNode {
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

  const [customerId, setCustomerId] = useState(job?.customerId ?? '');
  const [propertyId, setPropertyId] = useState(job?.propertyId ?? '');
  const [serviceDate, setServiceDate] = useState(textValue(job?.serviceDate ?? null));
  const [serviceTime, setServiceTime] = useState(textValue(job?.serviceTime ?? null));
  const [serviceType, setServiceType] = useState(textValue(job?.serviceType ?? null));
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
      done();
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
      done();
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

  const ready =
    jobs.state.status === 'ready' &&
    recipes.state.status === 'ready' &&
    ingredients.state.status === 'ready';

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
        hint="Must match a rate-card service type exactly for a rate to apply."
      />

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
      {ready && job !== null && (
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
              hint="Leave blank to let the guest count decide. Type a number and yours wins."
            />
            <button type="button" onClick={() => setDishes((all) => all.filter((x) => x.key !== d.key))}>
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
            <button type="button" onClick={() => setExtras((all) => all.filter((x) => x.key !== e.key))}>
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
