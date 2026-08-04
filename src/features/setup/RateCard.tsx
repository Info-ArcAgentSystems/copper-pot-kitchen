/**
 * The client rate card — Rule 11.
 *
 * A rate is identified by the pair (client group, service type) and carries an
 * OPTIONAL per-head rate and an OPTIONAL flat fee. Either, both, or NEITHER may
 * be set.
 *
 * Neither is a legitimate state meaning "unpriced", so this form must not demand
 * one, and the list must not render a missing figure as EUR 0.00. Zero is a real
 * price meaning free; blank means the owner has not said, and a job under such a
 * rate has null revenue rather than a zero total (Rule 8).
 */

import { useState, type ReactNode } from 'react';
import { supabaseDb } from '../../data/client';
import { clientRateRepository } from '../../data/repositories';
import { Field } from '../../ui/Field';
import { RecordForm, RecordScreen } from '../../ui/RecordScreen';
import { formatMoney, moneyValue, parseMoney, parseText, requireText, textValue } from '../../ui/form';
import { useKitchen } from '../../auth/kitchenState';
import type { ClientRate, ClientRateId, KitchenId } from '../../engine/types';

export function RateCard(): ReactNode {
  const repo = clientRateRepository(supabaseDb());

  return (
    <RecordScreen<ClientRate>
      title="Rate card"
      addLabel="Add a rate"
      emptyDescription="A rate is a client group and a service type, with a per-head rate, a flat fee, or both. Without a matching rate a job has no price."
      load={async () =>
        (await repo.list()).sort(
          (a, b) =>
            a.clientGroup.localeCompare(b.clientGroup) ||
            a.serviceType.localeCompare(b.serviceType),
        )
      }
      keyOf={(r) => r.id}
      renderRow={(r) => (
        <>
          <strong>
            {r.clientGroup} · {r.serviceType}
          </strong>
          <span className="muted num">
            {r.ratePerHead === null && r.flatFee === null
              ? 'no rate set — jobs will have no price'
              : [
                  r.ratePerHead === null ? null : `${formatMoney(r.ratePerHead)} per head`,
                  r.flatFee === null ? null : `${formatMoney(r.flatFee)} flat`,
                ]
                  .filter((x) => x !== null)
                  .join(' + ')}
          </span>
        </>
      )}
      renderForm={(rate, done) => <RateForm rate={rate} done={done} />}
    />
  );
}

function RateForm({ rate, done }: { rate: ClientRate | null; done: () => void }): ReactNode {
  const { state } = useKitchen();
  const repo = clientRateRepository(supabaseDb());

  const [clientGroup, setClientGroup] = useState(textValue(rate?.clientGroup ?? null));
  const [serviceType, setServiceType] = useState(textValue(rate?.serviceType ?? null));
  const [perHead, setPerHead] = useState(moneyValue(rate?.ratePerHead ?? null));
  const [flatFee, setFlatFee] = useState(moneyValue(rate?.flatFee ?? null));

  const [groupError, setGroupError] = useState<string | null>(null);
  const [typeError, setTypeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const perHeadParse = parseMoney(perHead);
  const flatFeeParse = parseMoney(flatFee);

  const kitchenId =
    state.status === 'ready' ? (state.membership.kitchenId as KitchenId) : ('' as KitchenId);

  const save = async (): Promise<void> => {
    const g = requireText(clientGroup, 'Client group');
    const t = requireText(serviceType, 'Service type');
    setGroupError(g);
    setTypeError(t);
    if (g !== null || t !== null) return;
    if (perHeadParse.error !== null || flatFeeParse.error !== null) return;

    setSaving(true);
    setError(null);

    const value: ClientRate = {
      id: rate?.id ?? ('' as ClientRateId),
      kitchenId,
      clientGroup: parseText(clientGroup) ?? '',
      serviceType: parseText(serviceType) ?? '',
      // Both may be null. That is "unpriced", not "free" - Rule 11 says revenue
      // is then null rather than zero, and the engine already behaves that way.
      ratePerHead: perHeadParse.cents,
      flatFee: flatFeeParse.cents,
    };

    try {
      if (rate === null) await repo.create(value);
      else await repo.update(rate.id, value);
      done();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
      setSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (rate === null) return;
    setSaving(true);
    try {
      await repo.remove(rate.id);
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
      onDelete={rate === null ? undefined : () => void remove()}
      deleteWarningText="Delete this rate? Jobs matching it will have no price until another rate covers them."
      >
      <Field
        label="Client group"
        value={clientGroup}
        onChange={setClientGroup}
        required
        error={groupError}
        hint="Must match the client group on the customer exactly."
      />
      <Field
        label="Service type"
        value={serviceType}
        onChange={setServiceType}
        required
        error={typeError}
        hint="Must match the service type on the job exactly."
      />
      <Field
        label="Per head"
        value={perHead}
        onChange={setPerHead}
        inputMode="decimal"
        numeric
        error={perHeadParse.error}
        placeholder="e.g. 20"
        hint="Leave blank if this service is not charged per head."
      />
      <Field
        label="Flat fee"
        value={flatFee}
        onChange={setFlatFee}
        inputMode="decimal"
        numeric
        error={flatFeeParse.error}
        hint="Leave both blank if the price is agreed per booking. Blank is not zero."
      />
    </RecordForm>
  );
}
