/**
 * Setup → Client groups — the one place a group is named.
 *
 * A rate is found by client group + service type, and a customer carries a
 * group. Naming groups here first means Paul can set up "Holiday rentals" before
 * he has written a single rate, and the Rate card and Customers then PICK it
 * from a dropdown — so a group can never be misspelled on one side and silently
 * leave a job unpriced.
 *
 * Rename carries every customer and rate with it, in one database transaction
 * (`rename_client_group`). Delete is refused while anything still uses the group
 * — on the server (`delete_client_group`), and said here before he tries.
 */

import { useState, type ReactNode } from 'react';
import { supabaseDb } from '../../data/client';
import {
  clientGroupRepository,
  clientRateRepository,
  customerRepository,
} from '../../data/repositories';
import { describeUse, groupNameProblem, groupUse, type GroupUse } from '../../ui/clientGroups';
import { Field } from '../../ui/Field';
import { RecordForm, RecordScreen } from '../../ui/RecordScreen';
import { byName, parseText, textValue } from '../../ui/form';
import { useKitchen } from '../../auth/kitchenState';
import type { ClientGroup, ClientGroupId, KitchenId } from '../../engine/types';

interface GroupRecord {
  readonly group: ClientGroup;
  readonly use: GroupUse;
  /** Every group, so the form can refuse a name another one already has. */
  readonly all: readonly ClientGroup[];
}

export function ClientGroups(): ReactNode {
  const db = supabaseDb();

  return (
    <RecordScreen<GroupRecord>
      title="Client groups"
      icon="people"
      why="customers and rates pick their group from this list, so a job with no price is often traced to it"
      addLabel="Add a client group"
      emptyDescription="How you group your clients for pricing — holiday rentals, private clients, regulars. Customers and the Rate card pick from these."
      load={async () => {
        const [groups, customers, rates] = await Promise.all([
          clientGroupRepository(db).list(),
          customerRepository(db).list(),
          clientRateRepository(db).list(),
        ]);
        const sorted = [...groups].sort(byName((g) => g.name));
        return sorted.map((group) => ({ group, use: groupUse(group, customers, rates), all: sorted }));
      }}
      keyOf={(r) => r.group.id}
      sheetTitle={(r) => r.group.name}
      renderRow={(r) => (
        <>
          <strong>{r.group.name}</strong>
          <span className="muted">{describeUse(r.use)}</span>
        </>
      )}
      renderForm={(record, done) => <GroupForm record={record} done={done} />}
    />
  );
}

function GroupForm({
  record,
  done,
}: {
  record: GroupRecord | null;
  done: (said?: string) => void;
}): ReactNode {
  const { state } = useKitchen();
  const repo = clientGroupRepository(supabaseDb());
  const group = record?.group ?? null;

  const [name, setName] = useState(textValue(group?.name ?? null));
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const kitchenId =
    state.status === 'ready' ? (state.membership.kitchenId as KitchenId) : ('' as KitchenId);
  const inUse = record !== null && record.use.customers + record.use.rates > 0;

  const save = async (): Promise<void> => {
    const typed = parseText(name) ?? '';
    const problem = groupNameProblem(typed, record?.all ?? [], group?.id ?? null);
    setNameError(problem);
    if (problem !== null) return;

    setSaving(true);
    setError(null);
    try {
      if (group === null) {
        await repo.create({ id: '' as ClientGroupId, kitchenId, name: typed });
        done('Client group added');
      } else {
        if (typed !== group.name) await repo.rename(group.id, typed);
        done(inUse ? `Renamed — ${describeUse(record.use)} moved with it` : 'Saved');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
      setSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (group === null) return;
    setSaving(true);
    try {
      await repo.remove(group.id);
      done('Deleted');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete.');
      setSaving(false);
    }
  };

  return (
    <RecordForm
      saving={saving}
      error={error}
      onSave={() => void save()}
      onCancel={done}
      onDelete={group === null || inUse ? undefined : () => void remove()}
    >
      <Field
        label="Name"
        value={name}
        onChange={setName}
        required
        error={nameError}
        hint={
          group !== null && inUse
            ? `Used by ${describeUse(record.use).replace(' · ', ' and ')}. Renaming here renames it there too.`
            : 'As you want to see it on customers and the Rate card.'
        }
      />
      {group !== null && inUse && (
        <p className="muted">
          It can’t be deleted while it’s in use ({describeUse(record.use)}). Move them to another
          group first.
        </p>
      )}
    </RecordForm>
  );
}
