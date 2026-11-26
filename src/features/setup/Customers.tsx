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
import { clientRateRepository, customerRepository, referenceCounts } from '../../data/repositories';
import { serviceTypeKey } from '../../engine/menus';
import { distinctNames, useLoadedNames } from '../../ui/suggestions';
import { ChoiceField, Field } from '../../ui/Field';
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
      icon="people"
      why="a rate is looked up by their client group, so this is where a job with no price is traced to"
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
  done: (said?: string) => void;
}): ReactNode {
  const { state } = useKitchen();
  const db = supabaseDb();
  const repo = customerRepository(db);

  const [name, setName] = useState(textValue(customer?.name ?? null));
  const [clientGroup, setClientGroup] = useState(textValue(customer?.clientGroup ?? null));
  /*
   * A customer's group is PICKED from the groups the Rate card names — never
   * typed — so it always matches a rate. A group already on the record but not
   * on the card is kept and labelled, so nothing changes unless he changes it.
   */
  const rateGroups = useLoadedNames(async () =>
    distinctNames((await clientRateRepository(supabaseDb()).list()).map((r) => r.clientGroup)),
  );
  const current = clientGroup.trim();
  const onCard = current === '' || rateGroups.some((g) => serviceTypeKey(g) === serviceTypeKey(current));
  const groupOptions = [
    { value: '', label: 'No group — no rate can apply' },
    ...(onCard ? [] : [{ value: current, label: `${current} (not on the rate card — no price)` }]),
    ...rateGroups.map((g) => ({ value: g, label: g })),
  ];
  // Show the card's spelling when his stored one differs only in case or dots.
  const selected = onCard
    ? (rateGroups.find((g) => serviceTypeKey(g) === serviceTypeKey(current)) ?? '')
    : current;
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
      done('Saved');
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
      done('Deleted');
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
      <ChoiceField
        label="Client group"
        value={selected}
        options={groupOptions}
        onChange={setClientGroup}
        hint={
          rateGroups.length === 0
            ? 'Groups come from Setup → Rate card. Add a rate there first and its group appears here.'
            : 'Groups come from Setup → Rate card. Without one, no rate can apply and revenue stays blank.'
        }
      />
      <Field label="Phone" value={phone} onChange={setPhone} inputMode="tel" autoComplete="tel" />
      <Field label="Email" value={email} onChange={setEmail} inputMode="email" autoComplete="email" />
      <Field label="Notes" value={notes} onChange={setNotes} multiline />
    </RecordForm>
  );
}
