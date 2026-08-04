/**
 * Properties — the venues jobs are delivered to.
 *
 * The eircode is the field with a history: CHANGE-VISIT-CARLINGFORD-EIRCODE in
 * the golden pack is an eircode corrected after entry, with the prior value
 * still traceable. That trail comes from the audit trigger on jobs, not from
 * here, but it is why the field is worth getting right.
 */

import { useState, type ReactNode } from 'react';
import { supabaseDb } from '../../data/client';
import { propertyRepository, referenceCounts } from '../../data/repositories';
import { Field } from '../../ui/Field';
import { RecordForm, RecordScreen } from '../../ui/RecordScreen';
import { byName, deleteWarning, parseText, requireText, textValue } from '../../ui/form';
import { useKitchen } from '../../auth/kitchenState';
import type { KitchenId, Property, PropertyId } from '../../engine/types';

export function Properties(): ReactNode {
  const repo = propertyRepository(supabaseDb());

  return (
    <RecordScreen<Property>
      title="Properties"
      addLabel="Add a property"
      emptyDescription="The houses and venues you deliver to, with access notes and facilities."
      load={async () => (await repo.list()).sort(byName((p) => p.name))}
      keyOf={(p) => p.id}
      renderRow={(p) => (
        <>
          <strong>{p.name}</strong>
          <span className="muted num">{p.eircode ?? 'no eircode'}</span>
        </>
      )}
      renderForm={(property, done) => <PropertyForm property={property} done={done} />}
    />
  );
}

function PropertyForm({
  property,
  done,
}: {
  property: Property | null;
  done: () => void;
}): ReactNode {
  const { state } = useKitchen();
  const db = supabaseDb();
  const repo = propertyRepository(db);

  const [name, setName] = useState(textValue(property?.name ?? null));
  const [eircode, setEircode] = useState(textValue(property?.eircode ?? null));
  const [address, setAddress] = useState(textValue(property?.address ?? null));
  const [accessNotes, setAccessNotes] = useState(textValue(property?.accessNotes ?? null));
  const [facilities, setFacilities] = useState(textValue(property?.facilities ?? null));

  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const kitchenId =
    state.status === 'ready' ? (state.membership.kitchenId as KitchenId) : ('' as KitchenId);

  const save = async (): Promise<void> => {
    const problem = requireText(name, 'Name');
    setNameError(problem);
    if (problem !== null) return;

    setSaving(true);
    setError(null);

    const value: Property = {
      id: property?.id ?? ('' as PropertyId),
      kitchenId,
      name: parseText(name) ?? '',
      eircode: parseText(eircode),
      address: parseText(address),
      accessNotes: parseText(accessNotes),
      facilities: parseText(facilities),
    };

    try {
      if (property === null) await repo.create(value);
      else await repo.update(property.id, value);
      done();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
      setSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (property === null) return;
    setSaving(true);
    try {
      await repo.remove(property.id);
      done();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete.');
      setSaving(false);
    }
  };

  if (property !== null && warning === null) {
    void referenceCounts(db)
      .forProperty(property.id)
      .then((counts) => setWarning(deleteWarning('property', counts)));
  }

  return (
    <RecordForm
      saving={saving}
      error={error}
      onSave={() => void save()}
      onCancel={done}
      onDelete={property === null ? undefined : () => void remove()}
      deleteWarningText={warning ?? undefined}
    >
      <Field label="Name" value={name} onChange={setName} required error={nameError} />
      <Field label="Eircode" value={eircode} onChange={setEircode} numeric />
      <Field label="Address" value={address} onChange={setAddress} multiline />
      <Field
        label="Access notes"
        value={accessNotes}
        onChange={setAccessNotes}
        multiline
        hint="Keys, gate codes, where to park."
      />
      <Field
        label="Facilities"
        value={facilities}
        onChange={setFacilities}
        multiline
        hint="Oven, hob, fridge space — what you can rely on being there."
      />
    </RecordForm>
  );
}
