/**
 * Service templates — the equipment and tasks that travel with a service type.
 *
 * The packing list is food from the menu PLUS these. Owner-defined entirely:
 * there is no built-in list of what a BBQ needs, because that would be business
 * data in the app (Rule 1).
 */

import { useState, type ReactNode } from 'react';
import { supabaseDb } from '../../data/client';
import { serviceTemplateRepository } from '../../data/repositories';
import { ChoiceField, Field } from '../../ui/Field';
import { RecordForm, RecordScreen } from '../../ui/RecordScreen';
import { parseText, requireText, textValue } from '../../ui/form';
import { useKitchen } from '../../auth/kitchenState';
import type {
  KitchenId,
  ServiceTemplate,
  ServiceTemplateId,
  ServiceTemplateKind,
} from '../../engine/types';

const KINDS = [
  { value: 'equipment', label: 'Equipment' },
  { value: 'task', label: 'Task' },
] as const;

export function ServiceTemplates(): ReactNode {
  const repo = serviceTemplateRepository(supabaseDb());

  return (
    <RecordScreen<ServiceTemplate>
      title="Service templates"
      addLabel="Add an item"
      emptyDescription="What to pack for each service type. The packing list is the menu plus these."
      load={async () =>
        (await repo.list()).sort(
          (a, b) =>
            a.serviceType.localeCompare(b.serviceType) ||
            a.position - b.position ||
            a.item.localeCompare(b.item),
        )
      }
      keyOf={(t) => t.id}
      renderRow={(t) => (
        <>
          <strong>{t.item}</strong>
          <span className="muted">
            {t.serviceType} · {t.kind}
          </span>
        </>
      )}
      renderForm={(template, done) => <TemplateForm template={template} done={done} />}
    />
  );
}

function TemplateForm({
  template,
  done,
}: {
  template: ServiceTemplate | null;
  done: () => void;
}): ReactNode {
  const { state } = useKitchen();
  const repo = serviceTemplateRepository(supabaseDb());

  const [serviceType, setServiceType] = useState(textValue(template?.serviceType ?? null));
  const [item, setItem] = useState(textValue(template?.item ?? null));
  const [kind, setKind] = useState<string>(template?.kind ?? 'equipment');

  const [typeError, setTypeError] = useState<string | null>(null);
  const [itemError, setItemError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const kitchenId =
    state.status === 'ready' ? (state.membership.kitchenId as KitchenId) : ('' as KitchenId);

  const save = async (): Promise<void> => {
    const t = requireText(serviceType, 'Service type');
    const i = requireText(item, 'Item');
    setTypeError(t);
    setItemError(i);
    if (t !== null || i !== null) return;

    setSaving(true);
    setError(null);

    const value: ServiceTemplate = {
      id: template?.id ?? ('' as ServiceTemplateId),
      kitchenId,
      serviceType: parseText(serviceType) ?? '',
      item: parseText(item) ?? '',
      kind: kind as ServiceTemplateKind,
      position: template?.position ?? 0,
    };

    try {
      if (template === null) await repo.create(value);
      else await repo.update(template.id, value);
      done();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
      setSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (template === null) return;
    setSaving(true);
    try {
      await repo.remove(template.id);
      done();
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
      onDelete={template === null ? undefined : () => void remove()}
      deleteWarningText="Delete this item? It will stop appearing on packing lists for that service type."
    >
      <Field
        label="Service type"
        value={serviceType}
        onChange={setServiceType}
        required
        error={typeError}
        hint="Must match the service type on the job exactly."
      />
      <Field label="Item" value={item} onChange={setItem} required error={itemError} />
      <ChoiceField label="Kind" value={kind} options={KINDS} onChange={setKind} />
    </RecordForm>
  );
}
