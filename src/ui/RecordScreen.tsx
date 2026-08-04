/**
 * The shape every setup screen takes: a list, an empty state, and an inline form.
 *
 * One component rather than five near-identical screens. Each screen supplies
 * what is genuinely its own — the fields, how a row reads, what a blank record
 * is — and inherits everything else.
 *
 * Rule 1 is structural here: there is no path that renders seeded content. An
 * empty list renders `EmptyState` inviting the first record, and the only way a
 * row appears is if the owner saved one.
 */

import { useState, type ReactNode } from 'react';
import { EmptyState } from './EmptyState';
import { useAsync } from './useAsync';
import type { ReferenceCount } from './form';

export interface RecordScreenProps<T> {
  readonly title: string;
  /** What the owner is invited to add when there is nothing yet. */
  readonly emptyDescription: string;
  readonly addLabel: string;
  readonly load: () => Promise<T[]>;
  readonly keyOf: (item: T) => string;
  readonly renderRow: (item: T) => ReactNode;
  /** The form for a new or existing record. `null` means "new". */
  readonly renderForm: (item: T | null, done: () => void) => ReactNode;
}

export function RecordScreen<T>({
  title,
  emptyDescription,
  addLabel,
  load,
  keyOf,
  renderRow,
  renderForm,
}: RecordScreenProps<T>): ReactNode {
  const { state, reload } = useAsync(load, []);
  // `undefined` = not editing. `null` = adding. A value = editing that record.
  const [editing, setEditing] = useState<T | null | undefined>(undefined);

  const done = (): void => {
    setEditing(undefined);
    reload();
  };

  if (state.status === 'loading') return <p className="muted">Loading…</p>;

  if (state.status === 'error') {
    // Say what failed. A blank screen would look like an empty kitchen, which is
    // a different thing entirely.
    return (
      <div>
        <h1>{title}</h1>
        <p className="error" role="alert">
          Could not load: {state.error.message}
        </p>
        <button type="button" onClick={reload}>
          Try again
        </button>
      </div>
    );
  }

  if (editing !== undefined) {
    return (
      <div>
        <h1>{editing === null ? addLabel : title}</h1>
        {renderForm(editing, done)}
      </div>
    );
  }

  return (
    <div>
      <h1>{title}</h1>

      {state.data.length === 0 ? (
        <EmptyState
          title={`No ${title.toLowerCase()} yet`}
          description={emptyDescription}
          action={
            <button type="button" onClick={() => setEditing(null)}>
              {addLabel}
            </button>
          }
        />
      ) : (
        <>
          <ul className="records">
            {state.data.map((item) => (
              <li key={keyOf(item)}>
                <button type="button" className="record" onClick={() => setEditing(item)}>
                  {renderRow(item)}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setEditing(null)}>
            {addLabel}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Save, cancel, and delete behind a confirmation that names its consequence.
 *
 * The confirmation is not a generic "are you sure". Deleting a customer is
 * `on delete set null`, so jobs keep existing and quietly lose their client
 * group — which under Rule 11 makes them unpriceable. `deleteWarning` turns the
 * reference counts into that sentence.
 */
export function RecordForm({
  onSave,
  onCancel,
  onDelete,
  deleteWarningText,
  saving,
  error,
  children,
}: {
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  deleteWarningText?: string;
  saving: boolean;
  error: string | null;
  children: ReactNode;
}): ReactNode {
  const [confirming, setConfirming] = useState(false);

  return (
    <form
      className="record-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      {children}

      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="actions">
        <button type="submit" className="primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>

      {onDelete !== undefined && (
        <div className="danger-zone">
          {confirming ? (
            <>
              <p role="alert">{deleteWarningText ?? 'Delete this record?'}</p>
              <div className="actions">
                <button type="button" className="danger" onClick={onDelete} disabled={saving}>
                  Yes, delete
                </button>
                <button type="button" onClick={() => setConfirming(false)}>
                  Keep it
                </button>
              </div>
            </>
          ) : (
            <button type="button" onClick={() => setConfirming(true)}>
              Delete
            </button>
          )}
        </div>
      )}
    </form>
  );
}

export type { ReferenceCount };
