/**
 * Customers.
 *
 * `clientGroup` is the field that matters beyond this screen: Rule 11 keys a rate
 * on (client group, service type), so a customer with no group can never match a
 * rate and every job for them has null revenue. The hint says so, because that
 * consequence is invisible from here.
 */

import { useState, type ReactNode } from 'react';
import { supabaseDb } from '../../data/client';
import { customerRepository, referenceCounts } from '../../data/repositories';
import { Field } from '../../ui/Field';
import { RecordForm, RecordScreen } from '../../ui/RecordScreen';
import { byName, deleteWarning, parseText, requireText, textValue } from '../../ui/form';
import { useKitchen } from '../../auth/kitchenState';
import type { Customer, CustomerId, KitchenId } from '../../engine/types';

export function Customers(): ReactNode {
  const db = supabaseDb();
  const repo = customerRepository(db);

  return (
    <RecordScreen<Customer>
      title="Customers"
      addLabel="Add a customer"
      emptyDescription="Customers drive the rate card: a rate is looked up by client group and service type."
      load={async () => (await repo.list()).sort(byName((c) => c.name))}
      keyOf={(c) => c.id}
      renderRow={(c) => (
        <>
          <strong>{c.name}</strong>
          <span className="muted">
            {c.clientGroup ?? 'no client group — no rate can apply'}
          </span>
        </>
      )}
      renderForm={(customer, done) => (
        <CustomerForm customer={customer} done={done} />
      )}
    />
  );
}

function CustomerForm({
  customer,
  done,
}: {
  customer: Customer | null;
  done: () => void;
}): ReactNode {
  const { state } = useKitchen();
  const db = supabaseDb();
  const repo = customerRepository(db);

  const [name, setName] = useState(textValue(customer?.name ?? null));
  const [clientGroup, setClientGroup] = useState(textValue(customer?.clientGroup ?? null));
  const [phone, setPhone] = useState(textValue(customer?.phone ?? null));
  const [email, setEmail] = useState(textValue(customer?.email ?? null));
  const [notes, setNotes] = useState(textValue(customer?.notes ?? null));

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

    const value: Customer = {
      id: customer?.id ?? ('' as CustomerId),
      kitchenId,
      name: parseText(name) ?? '',
      clientGroup: parseText(clientGroup),
      phone: parseText(phone),
      email: parseText(email),
      notes: parseText(notes),
    };

    try {
      if (customer === null) await repo.create(value);
      else await repo.update(customer.id, value);
      done();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
      setSaving(false);
    }
  };

  /**
   * Count what points at this customer BEFORE offering to delete it.
   *
   * `jobs.customer_id` is `on delete set null`: the jobs survive and lose their
   * customer, so they lose their client group, so under Rule 11 they stop being
   * priceable. The owner should see that number before deciding.
   */
  const prepareDelete = async (): Promise<void> => {
    if (customer === null) return;
    const counts = await referenceCounts(db).forCustomer(customer.id);
    setWarning(deleteWarning('customer', counts));
  };

  const remove = async (): Promise<void> => {
    if (customer === null) return;
    setSaving(true);
    try {
      await repo.remove(customer.id);
      done();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete.');
      setSaving(false);
    }
  };

  if (customer !== null && warning === null) void prepareDelete();

  return (
    <RecordForm
      saving={saving}
      error={error}
      onSave={() => void save()}
      onCancel={done}
      onDelete={customer === null ? undefined : () => void remove()}
      deleteWarningText={warning ?? undefined}
    >
      <Field label="Name" value={name} onChange={setName} required error={nameError} />
      <Field
        label="Client group"
        value={clientGroup}
        onChange={setClientGroup}
        hint="Rates are looked up by client group and service type. Without one, no rate can apply and revenue stays blank."
      />
      <Field label="Phone" value={phone} onChange={setPhone} inputMode="tel" autoComplete="tel" />
      <Field label="Email" value={email} onChange={setEmail} inputMode="email" autoComplete="email" />
      <Field label="Notes" value={notes} onChange={setNotes} multiline />
    </RecordForm>
  );
}
