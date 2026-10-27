/**
 * Scan a job sheet: photograph → FIX IN PLACE → save once.
 *
 * WHAT THIS SCREEN USED TO BE, and why it had to change. It showed the review
 * and nothing else. Every value was read-only, so the only things he could do
 * with a sheet that was not perfect were leave the screen or throw it away —
 * and `reviewJobSheet` raises a gap for ANY dietary wording on the sheet, which
 * meant a sheet mentioning an allergy could not be saved at all, because there
 * was nowhere to clear it. His actual route was: photograph the sheet, read the
 * result, then type the whole job again on the Jobs screen.
 *
 * So the values land in boxes. He corrects what is wrong, the outstanding list
 * recomputes from the boxes as he types, and one Save writes the records and
 * the job together.
 *
 * NONE OF RULE 8 IS RELAXED BY THAT. What changed is who may fill a gap:
 *
 *   NOTHING IS PREFILLED that the sheet did not say. An unread date is an empty
 *   box, not the coming Saturday. The chip beside each box says where its value
 *   came from — scanned, edited, or nothing on the sheet — and it is derived by
 *   comparing with the review rather than stored, so it cannot drift.
 *
 *   THE SHEET'S WORDS STAY VISIBLE. "Sheet said SAT 24TH" sits under the date
 *   box after he corrects it, because the correction is the thing most worth
 *   checking twice.
 *
 *   A NAME MATCHING SEVERAL RECORDS IS STILL NOT CHOSEN FOR HIM. The candidates
 *   are listed in the dropdown and nothing is selected.
 *
 *   NEW RECORDS ARE CREATED ON SAVE, NOT BEFORE, and he is shown the list by
 *   name first. Only a name the camera read cleanly and could not find is ever
 *   offered — never one that matched two records, never one it could not read.
 *
 * The engine is not involved. A scanned sheet is not a calculation; it becomes a
 * job, and every quantity follows from the job through the one cascade.
 */

import { useState, type ReactNode } from 'react';
import { supabaseClient, supabaseDb } from '../../data/client';
import {
  customerRepository,
  propertyRepository,
  recipeRepository,
} from '../../data/repositories';
import { commitScannedDraft } from '../../scan/commit';
import { reviewJobSheet } from '../../scan/jobSheet';
import {
  creationsFromDraft,
  draftFromReview,
  draftGaps,
  originOf,
  type DietaryDraft,
  type JobSheetDraft,
  type NameChoice,
  type NameDraft,
} from '../../scan/jobDraft';
import { parseJobSheet } from '../../scan/parseImage';
import { toScaledDataUrl } from './scaleImage';
import { PhotoGate } from './PhotoGate';
import { ChoiceField, Field } from '../../ui/Field';
import { EmptyState } from '../../ui/EmptyState';
import { useAsync } from '../../ui/useAsync';
import { useKitchen } from '../../auth/kitchenState';
import type { DataSource } from '../../ui/sourceState';
import type { Customer, DietarySeverity, KitchenId, Property, Recipe } from '../../engine/types';

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
 * to create.
 *
 * The scanned name only appears as an option when the review said `new` — read
 * cleanly and not found. An ambiguous read contributes nothing to create, only
 * its candidates to choose between, with NOTHING selected.
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

/** The dropdown's current value, from the choice. */
const choiceValue = (choice: NameChoice): string => {
  if (choice.kind === 'existing') return choice.id;
  if (choice.kind === 'create') return `new:${choice.name}`;
  return '';
};

/** And back again. `new:` is the only prefix, so a record id cannot collide. */
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

export function ScanJobSheet(): ReactNode {
  const db = supabaseDb();
  const { state: kitchen } = useKitchen();

  const customers = useAsync(() => customerRepository(db).list(), []);
  const properties = useAsync(() => propertyRepository(db).list(), []);
  const recipes = useAsync(() => recipeRepository(db).list(), []);

  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [draft, setDraft] = useState<JobSheetDraft | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  /** What a failed save managed to create, so he is not told nothing happened. */
  const [partial, setPartial] = useState<readonly string[]>([]);

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
  ];

  const customerList: readonly Customer[] =
    customers.state.status === 'ready' ? customers.state.data : [];
  const propertyList: readonly Property[] =
    properties.state.status === 'ready' ? properties.state.data : [];
  const recipeList: readonly Recipe[] = recipes.state.status === 'ready' ? recipes.state.data : [];

  const scan = async (file: File): Promise<void> => {
    setBusy(true);
    setRefusal(null);
    setDraft(null);
    setSaved(null);
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
      // records, by the same matcher Ask Sous uses.
      setDraft(
        draftFromReview(
          reviewJobSheet(reply.read, {
            customers: customerList,
            properties: propertyList,
            recipes: recipeList,
          }),
        ),
      );
    } catch (cause) {
      setRefusal(cause instanceof Error ? cause.message : 'Could not read that photo.');
    } finally {
      setBusy(false);
    }
  };

  const patch = (change: Partial<JobSheetDraft>): void =>
    setDraft((current) => (current === null ? null : { ...current, ...change }));

  const patchDietary = (at: number, change: Partial<DietaryDraft>): void =>
    setDraft((current) =>
      current === null
        ? null
        : {
            ...current,
            dietaries: current.dietaries.map((d, i) => (i === at ? { ...d, ...change } : d)),
          },
    );

  /** The ONLY thing on this screen that writes. Rule 7's separate call. */
  const confirm = async (): Promise<void> => {
    if (draft === null) return;

    const kitchenId =
      kitchen.status === 'ready' ? (kitchen.membership.kitchenId as KitchenId) : ('' as KitchenId);

    setBusy(true);
    setRefusal(null);
    const result = await commitScannedDraft(db, draft, kitchenId);
    setBusy(false);

    if (result.ok) {
      setSaved(result.jobId);
      setDraft(null);
      return;
    }

    setRefusal(result.error);
    /*
     * What DID get written. supabase-js has no transaction, so a partial write
     * is real: telling him nothing was saved when two recipes exist is a lie he
     * would discover as duplicates on his next attempt.
     *
     * The created records are also turned into `existing` choices, so a retry
     * points at them instead of making them twice.
     */
    setPartial(result.created.filter((c) => c.ok).map((c) => `${c.kind}: ${c.what}`));
    setDraft((current) => {
      if (current === null) return null;

      const { customerId, propertyId, recipeIds } = result.ids;

      const settle = (name: NameDraft, id: string | null): NameDraft =>
        name.choice.kind === 'create' && id !== null
          ? { ...name, choice: { kind: 'existing', id, name: name.choice.name } }
          : name;

      return {
        ...current,
        customer: settle(current.customer, customerId),
        property: settle(current.property, propertyId),
        dishes: current.dishes.map((dish) =>
          settle(dish, dish.choice.kind === 'create' ? (recipeIds.get(dish.choice.name) ?? null) : null),
        ),
      };
    });
  };

  const gaps = draft === null ? [] : draftGaps(draft);
  const creations = draft === null ? null : creationsFromDraft(draft);
  const willCreate =
    creations === null
      ? []
      : [
          ...creations.customers.map((n) => `a customer, ${n}`),
          ...creations.properties.map((n) => `a property, ${n}`),
          ...creations.recipes.map((n) => `a recipe, ${n}`),
        ];

  /** A box, with the chip and the sheet's own words under it. */
  const scannedField = (
    label: string,
    read: string | null,
    value: string,
    onChange: (v: string) => void,
    extra: { type?: 'date'; inputMode?: 'numeric'; hint?: string } = {},
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
      />
      {/* Kept under the box AFTER he edits it. A correction is the thing most
          worth checking twice, and the sheet is the only way to check it. */}
      {read !== null && read !== value && (
        <p className="muted">Sheet said “{read}”.</p>
      )}
    </div>
  );

  return (
    <section>
      <h1>Scan a job sheet</h1>
      <p className="muted">
        Photograph the sheet, fix anything wrong here, then save. Nothing is written until you
        tap save.
      </p>

      <PhotoGate sources={sources} busy={busy} onFile={(file) => void scan(file)} />

      {busy && <p className="muted">Reading it…</p>}

      {refusal !== null && (
        <p className="error" role="alert">
          {refusal}
        </p>
      )}

      {partial.length > 0 && (
        <section className="unresolved-block">
          <h2>These were created before it failed</h2>
          <p>
            They already exist, so saving again will use them rather than making them twice.
          </p>
          <ul>
            {partial.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      )}

      {saved !== null && (
        <p role="status">
          Saved as a new enquiry. Open it on the Jobs screen to allocate portions and name the
          guests behind any dietary.
        </p>
      )}

      {draft === null && !busy && refusal === null && saved === null && (
        <EmptyState
          title="Nothing scanned yet"
          description="A photo of a job sheet becomes a job you can correct here and save in one go."
        />
      )}

      {draft !== null && (
        <>
          <section className="units">
            <h2>Who and where</h2>

            <ChoiceField
              label="Customer"
              value={choiceValue(draft.customer.choice)}
              options={nameOptions(customerList, draft.customer)}
              onChange={(v) =>
                patch({ customer: { ...draft.customer, choice: choiceFrom(customerList, v) } })
              }
              hint={
                draft.customer.matches.length > 0
                  ? `The sheet said “${draft.customer.read ?? ''}”, which matches ${draft.customer.matches.join(' and ')}. Nothing has been chosen — pick the right one.`
                  : draft.customer.read === null
                    ? 'Nothing was read for this.'
                    : `Read “${draft.customer.read}”.`
              }
            />

            <ChoiceField
              label="Property"
              value={choiceValue(draft.property.choice)}
              options={nameOptions(propertyList, draft.property)}
              onChange={(v) =>
                patch({ property: { ...draft.property, choice: choiceFrom(propertyList, v) } })
              }
              hint={
                draft.property.matches.length > 0
                  ? `The sheet said “${draft.property.read ?? ''}”, which matches ${draft.property.matches.join(' and ')}. Nothing has been chosen — pick the right one.`
                  : draft.property.read === null
                    ? 'Nothing was read for this.'
                    : `Read “${draft.property.read}”.`
              }
            />
          </section>

          <section className="units">
            <h2>When</h2>

            {scannedField('Date', draft.from.serviceDate, draft.serviceDate, (v) =>
              patch({ serviceDate: v }),
              { type: 'date' },
            )}
            {scannedField('Time', draft.from.serviceTime, draft.serviceTime, (v) =>
              patch({ serviceTime: v }),
            )}
            {scannedField('Service type', draft.from.serviceType, draft.serviceType, (v) =>
              patch({ serviceType: v }),
              { hint: 'Must match a rate-card service type exactly for a rate to apply.' },
            )}
            {scannedField(
              'Guests',
              draft.from.guests === null ? null : String(draft.from.guests),
              draft.guests,
              (v) => patch({ guests: v }),
              { inputMode: 'numeric' },
            )}

            {/* RULE 12. His words for a vague count, kept beside the box and
                kept after he fills it: 18 is his answer, "a few" is what he is
                answering. */}
            {draft.guestsWording !== null && (
              <p className="unresolved">
                The sheet said “{draft.guestsWording}”, which is not a number and has not been
                turned into one. Put the figure in the box when you know it.
              </p>
            )}
          </section>

          <section className="units">
            <h2>Dishes</h2>
            {draft.dishes.length === 0 && <p className="muted">No dishes were read.</p>}

            {draft.dishes.map((dish, at) => (
              <div key={at} className="line">
                <ChoiceField
                  label={`Dish ${at + 1}`}
                  value={choiceValue(dish.choice)}
                  options={nameOptions(recipeList, dish)}
                  onChange={(v) =>
                    patch({
                      dishes: draft.dishes.map((d, i) =>
                        i === at ? { ...d, choice: choiceFrom(recipeList, v) } : d,
                      ),
                    })
                  }
                  hint={
                    dish.matches.length > 0
                      ? `“${dish.read ?? ''}” matches ${dish.matches.join(' and ')} — pick one.`
                      : `Read “${dish.read ?? ''}”.`
                  }
                />
                <button
                  type="button"
                  onClick={() => patch({ dishes: draft.dishes.filter((_, i) => i !== at) })}
                >
                  Remove
                </button>
              </div>
            ))}
          </section>

          {/* RULES 9, 12 AND 16. The wording is the sheet's; the three fields
              beside it cannot come off a photograph, so he sets them. The
              requirement is saved UNRESOLVED, which under Rule 12 blocks exact
              purchase quantities until he names the guests on the job screen. */}
          {draft.dietaries.length > 0 && (
            <section className="needs-fixing">
              <h2>Dietary requirements — these need you</h2>
              <p>
                Kept exactly as the sheet had it. What kind of requirement it is and how serious
                it is are not on the photograph and have not been guessed — a possible conflict is
                for you to review, and nothing here will call anything safe.
              </p>

              {draft.dietaries.map((dietary, at) => (
                <div key={at} className="line">
                  <p className="unresolved">“{dietary.wording}”</p>

                  <Field
                    label="What is it"
                    value={dietary.dietType}
                    onChange={(v) => patchDietary(at, { dietType: v })}
                    placeholder="nut allergy"
                    hint="Your own wording. There is no built-in list of diets."
                  />

                  <ChoiceField
                    label="How serious"
                    value={dietary.severity ?? ''}
                    options={SEVERITIES}
                    onChange={(v) =>
                      patchDietary(at, { severity: v === '' ? null : (v as DietarySeverity) })
                    }
                    hint="Not set until you choose. Nothing is assumed from the wording."
                  />

                  <label className="check">
                    <input
                      type="checkbox"
                      checked={dietary.excludesMeat}
                      onChange={(e) => patchDietary(at, { excludesMeat: e.target.checked })}
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

          <Field label="Notes" value={draft.notes} onChange={(v) => patch({ notes: v })} multiline />

          {willCreate.length > 0 && (
            <section className="unresolved-block">
              <h2>Saving will also create</h2>
              <ul>
                {willCreate.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              <p>
                Only names read clearly off the sheet that you do not already have. A recipe
                created this way is a NAME ONLY — it will not be bought or costed until you add
                its ingredients, and the prep sheet says so on the line.
              </p>
            </section>
          )}

          {gaps.length > 0 && (
            <section className="needs-fixing">
              <h2>Still to settle</h2>
              <p className="muted">
                Nothing here was guessed. These are the things the sheet did not say clearly.
              </p>
              <ul>
                {gaps.map((g) => (
                  <li key={g.field}>
                    {g.label}
                    {g.saw !== null && <span className="muted"> — saw “{g.saw}”</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={busy || gaps.length > 0}
              onClick={() => void confirm()}
            >
              {busy ? 'Saving…' : 'Confirm and save as a new job'}
            </button>
            <button type="button" onClick={() => setDraft(null)} disabled={busy}>
              Discard
            </button>
          </div>

          {gaps.length > 0 && (
            <p className="muted">
              Settle everything under “Still to settle” first — on a photograph, an unanswered
              field is the one most likely to be wrong.
            </p>
          )}
        </>
      )}
    </section>
  );
}
