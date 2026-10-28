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
import { SourceNotice } from './SourceNotice';
import { sourceState, type DataSource } from './sourceState';
import { useAsync } from './useAsync';
import type { ReferenceCount } from './form';

export interface RecordScreenProps<T> {
  readonly title: string;
  /**
   * The clause after the dash when this read fails: "could not load your
   * suppliers — THE SHOPPING LIST IS GROUPED BY THEM, so without them it
   * arrives as one long list."
   *
   * Required, and required on purpose. It is the one thing this component
   * cannot work out for itself — `what` comes from the title, but only the
   * caller knows what the owner loses — and the whole defect being fixed here
   * was a message that said something had failed without saying what it cost.
   * A screen that cannot name its own consequence does not compile.
   */
  readonly why: string;
  /** What the owner is invited to add when there is nothing yet. */
  readonly emptyDescription: string;
  readonly addLabel: string;
  readonly load: () => Promise<T[]>;
  readonly keyOf: (item: T) => string;
  readonly renderRow: (item: T) => ReactNode;
  /** The form for a new or existing record. `null` means "new". */
  readonly renderForm: (item: T | null, done: () => void) => ReactNode;
  /**
   * Anything the screen needs to say about a SECOND read of its own, placed
   * under the heading and above the list.
   *
   * Ingredients is why this exists: its on-hand column comes from a separate
   * stock read, and its notice had nowhere to go but above the heading this
   * component renders — so the owner met the explanation before the screen it
   * belonged to.
   */
  readonly notice?: ReactNode;
}

export function RecordScreen<T>({
  title,
  why,
  emptyDescription,
  addLabel,
  load,
  keyOf,
  renderRow,
  renderForm,
  notice,
}: RecordScreenProps<T>): ReactNode {
  const { state, reload } = useAsync(load, []);
  // `undefined` = not editing. `null` = adding. A value = editing that record.
  const [editing, setEditing] = useState<T | null | undefined>(undefined);

  const done = (): void => {
    setEditing(undefined);
    reload();
  };

  /*
   * EIGHT SCREENS went through the two branches this replaces: a bare
   * "Loading…", and "Could not load: Failed to fetch" with a Try again button —
   * naming neither which list failed nor what the owner loses by it, on a
   * screen that otherwise looked like an empty kitchen. That is one defect in
   * one shared place, so it is fixed once.
   *
   * `what` is the title in his words; `why` can only come from the caller.
   */
  const sources: readonly DataSource[] = [
    { what: `your ${title.toLowerCase()}`, why, state, reload },
  ];
  const loaded = sourceState(sources);

  /*
   * One read, so narrowing `state` and asking `loaded` are the same question —
   * `loaded.kind` is ready exactly when `state.status` is. The narrowing is
   * what gives us `state.data` below; `loaded` is what supplies the words.
   * The multi-read screens keep a `ready` boolean beside `loaded` because they
   * have several states to narrow; here there is nothing to fold together.
   */
  if (state.status !== 'ready') return <SourceNotice state={loaded} title={title} />;

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

      {/* Under the heading, above the list: a second read of the screen's own
          has somewhere to speak without arriving before its own screen. */}
      {notice}

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

      {/* Cancel first, Save last — so the primary is rightmost under the thumb
          AND the focus order matches what the eye sees. */}
      <div className="actions">
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
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
