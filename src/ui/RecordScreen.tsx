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
import { Screen } from './Screen';
import { SourceNotice } from './SourceNotice';
import { sourceState, type DataSource } from './sourceState';
import { useAsync } from './useAsync';
import type { ReferenceCount } from './form';
import { deleteEach, type BulkOutcome } from './bulkDelete';

/**
 * Opt-in: a Select mode that deletes several records with one confirmation.
 *
 * Each screen says how one record is removed and named, which records may not
 * be ticked at all (Rule 15's closed jobs), and how a refusal reads in his
 * terms. Everything else — ticking, the count, the confirm, the outcome — is
 * here once.
 */
export interface BulkDelete<T> {
  readonly remove: (item: T) => Promise<void>;
  readonly nameOf: (item: T) => string;
  /** Why a record cannot be selected, or null when it can. */
  readonly lockedReason?: (item: T) => string | null;
  readonly refusal: (cause: unknown) => string;
  /** "recipe" / "recipes", for the count and the confirmation. */
  readonly noun: readonly [one: string, many: string];
}

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
  /**
   * True when a SHELL above this one has already drawn the page title.
   *
   * Recipes and Ingredients are rendered inside `Library`, which renders
   * `<h1>Library</h1>` and a segmented control reading Recipes / Ingredients.
   * This component then rendered `<h1>Recipes</h1>` under both of them, so the
   * screen opened with two titles, the second one naming the tab the owner had
   * just tapped. Suppressing it here rather than at the shell because this is
   * the component that draws it, and `Screen` enforces one title per screen.
   *
   * The ADD label survives suppression as a section heading: "Add a recipe" is
   * new information — he is creating, not browsing — where "Recipes" over a
   * filled-in form is the tab name a third time.
   */
  readonly inShell?: boolean;
  readonly bulk?: BulkDelete<T>;
  /** Opt-in search: the text a record is matched on. */
  readonly searchText?: (item: T) => string;
  /**
   * Opt-in views as chips — Upcoming / Done for jobs. The first is the default.
   * Each may order its own rows: what is coming up reads soonest first, history
   * latest first.
   */
  readonly filters?: readonly ListFilter<T>[];
}

export interface ListFilter<T> {
  readonly key: string;
  readonly label: string;
  readonly test: (item: T) => boolean;
  readonly sort?: (a: T, b: T) => number;
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
  inShell = false,
  bulk,
  searchText,
  filters,
}: RecordScreenProps<T>): ReactNode {
  const { state, reload } = useAsync(load, []);
  // `undefined` = not editing. `null` = adding. A value = editing that record.
  const [editing, setEditing] = useState<T | null | undefined>(undefined);

  // Select mode. Keys, so a reload cannot leave a stale record object ticked.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null);
  const [query, setQuery] = useState('');
  const [filterKey, setFilterKey] = useState(filters?.[0]?.key ?? '');

  const stopSelecting = (): void => {
    setSelecting(false);
    setSelected(new Set());
    setConfirming(false);
  };

  const toggle = (key: string): void => {
    setConfirming(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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
  if (state.status !== 'ready')
    return <SourceNotice state={loaded} title={inShell ? undefined : title} />;

  /* What the list shows: the chosen view, then the search, in the view's order. */
  const filter = filters?.find((f) => f.key === filterKey) ?? filters?.[0];
  const words = query.trim().toLowerCase().split(/\s+/).filter((w) => w !== '');
  const visible = state.data
    .filter((item) => filter === undefined || filter.test(item))
    .filter((item) => {
      if (searchText === undefined || words.length === 0) return true;
      const text = searchText(item).toLowerCase();
      return words.every((w) => text.includes(w));
    });
  if (filter?.sort !== undefined) visible.sort(filter.sort);

  if (editing !== undefined) {
    const heading = editing === null ? addLabel : title;

    return (
      <Screen title={inShell ? undefined : heading}>
        {inShell && editing === null && <h2>{heading}</h2>}
        {renderForm(editing, done)}
      </Screen>
    );
  }

  return (
    <Screen title={inShell ? undefined : title}>

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
          {outcome !== null && <BulkResult outcome={outcome} onDismiss={() => setOutcome(null)} />}

          {(searchText !== undefined || filters !== undefined) && (
            <div className="list-tools">
              {searchText !== undefined && (
                <input
                  type="search"
                  className="list-search"
                  placeholder={`Search ${title.toLowerCase()}`}
                  aria-label={`Search ${title.toLowerCase()}`}
                  value={query}
                  // Read without DOM types: this file is also compiled by the
                  // test build, which has none.
                  onChange={(e) => setQuery((e.currentTarget as unknown as { value: string }).value)}
                />
              )}
              {filters !== undefined && (
                <div className="chips" role="group" aria-label={`Show ${title.toLowerCase()}`}>
                  {filters.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      className="chip"
                      aria-pressed={f.key === filterKey}
                      onClick={() => {
                        setFilterKey(f.key);
                        setSelected(new Set());
                      }}
                    >
                      {f.label}
                      <span className="chip-count num">{state.data.filter(f.test).length}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {visible.length === 0 && (
            <p className="muted">
              {query.trim() !== ''
                ? `No ${title.toLowerCase()} match “${query.trim()}”.`
                : `No ${title.toLowerCase()} here.`}
            </p>
          )}

          <ul className="records">
            {visible.map((item) => {
              const key = keyOf(item);
              if (!selecting || bulk === undefined) {
                return (
                  <li key={key}>
                    <button type="button" className="record" onClick={() => setEditing(item)}>
                      {renderRow(item)}
                    </button>
                  </li>
                );
              }

              const locked = bulk.lockedReason?.(item) ?? null;
              return (
                <li key={key}>
                  <label className={`record record-select check${locked === null ? '' : ' is-locked'}`}>
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      disabled={locked !== null || deleting}
                      onChange={() => toggle(key)}
                    />
                    <span className="record-select-body">
                      {renderRow(item)}
                      {locked !== null && <span className="muted">Can’t be deleted: {locked}</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          {bulk === undefined ? (
            <button type="button" onClick={() => setEditing(null)}>
              {addLabel}
            </button>
          ) : !selecting ? (
            <div className="actions">
              <button
                type="button"
                onClick={() => {
                  setOutcome(null);
                  setSelecting(true);
                }}
              >
                Select to delete
              </button>
              <button type="button" onClick={() => setEditing(null)}>
                {addLabel}
              </button>
            </div>
          ) : (
            (() => {
              const deletable = visible.filter((i) => (bulk.lockedReason?.(i) ?? null) === null);
              const chosen = visible.filter((i) => selected.has(keyOf(i)));
              const n = chosen.length;
              const noun = n === 1 ? bulk.noun[0] : bulk.noun[1];
              const allTicked = deletable.length > 0 && deletable.every((i) => selected.has(keyOf(i)));

              const run = async (): Promise<void> => {
                setDeleting(true);
                const result = await deleteEach(chosen, bulk.remove, bulk.nameOf, bulk.refusal);
                setDeleting(false);
                setOutcome(result);
                stopSelecting();
                reload();
              };

              return (
                <div className="bulk-bar" role="region" aria-label="Delete selected">
                  {confirming ? (
                    <>
                      <p>
                        Delete {n} {noun}? This can’t be undone. Anything still in use is kept, and
                        you’ll be told which.
                      </p>
                      <div className="actions">
                        <button type="button" disabled={deleting} onClick={() => setConfirming(false)}>
                          Keep them
                        </button>
                        <button type="button" className="danger" disabled={deleting} onClick={() => void run()}>
                          {deleting ? 'Deleting…' : `Delete ${n} ${noun}`}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="num">
                        {n === 0 ? `Tick the ${bulk.noun[1]} to delete.` : `${n} ${noun} selected`}
                      </p>
                      <div className="actions">
                        <button
                          type="button"
                          onClick={() =>
                            setSelected(allTicked ? new Set() : new Set(deletable.map(keyOf)))
                          }
                          disabled={deletable.length === 0}
                        >
                          {allTicked ? 'Clear all' : 'Select all'}
                        </button>
                        <button type="button" onClick={stopSelecting}>
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="danger"
                          disabled={n === 0}
                          onClick={() => setConfirming(true)}
                        >
                          Delete {n === 0 ? '' : `${n} `}
                          {noun}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })()
          )}
        </>
      )}
    </Screen>
  );
}

/** What a bulk delete did — every record kept is named, with why. */
function BulkResult({
  outcome,
  onDismiss,
}: {
  outcome: BulkOutcome;
  onDismiss: () => void;
}): ReactNode {
  return (
    <section className={outcome.kept.length > 0 ? 'unresolved-block' : 'card'} aria-live="polite">
      <p>
        Deleted {outcome.deleted.length}
        {outcome.deleted.length > 0 && `: ${outcome.deleted.join(', ')}`}.
      </p>
      {outcome.kept.length > 0 && (
        <>
          <p>Kept {outcome.kept.length}:</p>
          <ul>
            {outcome.kept.map((k, i) => (
              <li key={`${i}-${k.name}`}>
                {k.name} — {k.reason}
              </li>
            ))}
          </ul>
        </>
      )}
      <button type="button" className="sm" onClick={onDismiss}>
        Done
      </button>
    </section>
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
