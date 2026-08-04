/**
 * Suppliers.
 *
 * The shopping list groups by supplier, so this is what turns one long list into
 * several shop-sized ones.
 */

import { useState, type ReactNode } from 'react';
import { supabaseDb } from '../../data/client';
import { referenceCounts, supplierRepository } from '../../data/repositories';
import { Field } from '../../ui/Field';
import { RecordForm, RecordScreen } from '../../ui/RecordScreen';
import { byName, deleteWarning, parseText, requireText, textValue } from '../../ui/form';
import { useKitchen } from '../../auth/kitchenState';
import type { KitchenId, Supplier, SupplierId } from '../../engine/types';

export function Suppliers(): ReactNode {
  const repo = supplierRepository(supabaseDb());

  return (
    <RecordScreen<Supplier>
      title="Suppliers"
      addLabel="Add a supplier"
      emptyDescription="The shopping list groups by supplier, so each shop gets its own section."
      load={async () => (await repo.list()).sort(byName((s) => s.name))}
      keyOf={(s) => s.id}
      renderRow={(s) => (
        <>
          <strong>{s.name}</strong>
          {s.notes !== null && <span className="muted">{s.notes}</span>}
        </>
      )}
      renderForm={(supplier, done) => <SupplierForm supplier={supplier} done={done} />}
    />
  );
}

function SupplierForm({
  supplier,
  done,
}: {
  supplier: Supplier | null;
  done: () => void;
}): ReactNode {
  const { state } = useKitchen();
  const db = supabaseDb();
  const repo = supplierRepository(db);

  const [name, setName] = useState(textValue(supplier?.name ?? null));
  const [notes, setNotes] = useState(textValue(supplier?.notes ?? null));
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

    const value: Supplier = {
      id: supplier?.id ?? ('' as SupplierId),
      kitchenId,
      name: parseText(name) ?? '',
      notes: parseText(notes),
    };

    try {
      if (supplier === null) await repo.create(value);
      else await repo.update(supplier.id, value);
      done();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
      setSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (supplier === null) return;
    setSaving(true);
    try {
      await repo.remove(supplier.id);
      done();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete.');
      setSaving(false);
    }
  };

  if (supplier !== null && warning === null) {
    void referenceCounts(db)
      .forSupplier(supplier.id)
      .then((counts) => setWarning(deleteWarning('supplier', counts)));
  }

  return (
    <RecordForm
      saving={saving}
      error={error}
      onSave={() => void save()}
      onCancel={done}
      onDelete={supplier === null ? undefined : () => void remove()}
      deleteWarningText={warning ?? undefined}
    >
      <Field label="Name" value={name} onChange={setName} required error={nameError} />
      <Field label="Notes" value={notes} onChange={setNotes} multiline />
    </RecordForm>
  );
}
