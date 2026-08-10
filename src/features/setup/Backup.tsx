/**
 * Backup, restore and clear-all — the safety net.
 *
 * This is the one screen whose failure modes matter more than its happy path,
 * because it is reached when something has already gone wrong. Three shapes that
 * decision:
 *
 *   - THE TEXT IS ALWAYS ON SCREEN. The download is attempted, the clipboard is
 *     attempted, but neither is trusted: iOS Safari blocks or silently swallows
 *     downloads often enough that a single delivery path is not a backup strategy.
 *     Whatever happened above, there is something he can select and paste.
 *
 *   - IMPORT AND CLEAR-ALL SHARE ONE SAFETY PATH. Both destroy everything, so both
 *     state the counts, both warn when the current data is not backed up, and both
 *     want the kitchen name typed.
 *
 *   - NOTHING CLAIMS SUCCESS IT DID NOT VERIFY. The RPCs return what they wrote or
 *     destroyed, and that is what gets reported.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { supabaseDb } from '../../data/client';
import { backupRepository } from '../../data/repositories';
import {
  backupFilename,
  backupStatus,
  backupToText,
  buildBackup,
  EXPORTED_TABLES,
  fingerprint,
  importable,
  parseBackup,
  type Backup,
} from '../../ui/backup';
import { Field } from '../../ui/Field';
import { useAsync } from '../../ui/useAsync';
import { useKitchen } from '../../auth/kitchenState';

/**
 * Where the "when did I last back up" note lives.
 *
 * localStorage rather than a column, so this needs no migration for what is a
 * reminder rather than data. The cost is stated on screen: it is per device, so
 * exporting on the phone leaves the laptop still reminding.
 */
const STORAGE_KEY = 'copper-pot.last-backup';

interface SavedBackup {
  readonly fingerprint: string;
  readonly at: string;
}

function readSaved(): SavedBackup | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<SavedBackup>;
    return typeof parsed.fingerprint === 'string' && typeof parsed.at === 'string'
      ? { fingerprint: parsed.fingerprint, at: parsed.at }
      : null;
  } catch {
    // A corrupt note is not worth failing over — it just means "never".
    return null;
  }
}

export function BackupScreen(): ReactNode {
  const db = supabaseDb();
  const repo = backupRepository(db);
  const { state: kitchenState } = useKitchen();

  const kitchenName =
    kitchenState.status === 'ready' ? kitchenState.membership.kitchenName : '';

  const data = useAsync(() => repo.readAll([...EXPORTED_TABLES]), []);

  const [saved, setSaved] = useState<SavedBackup | null>(readSaved);
  const [text, setText] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  // Import
  const [pasted, setPasted] = useState('');
  const [confirmImport, setConfirmImport] = useState(false);
  const [typedForImport, setTypedForImport] = useState('');

  // Clear-all
  const [confirmClear, setConfirmClear] = useState(false);
  const [typedForClear, setTypedForClear] = useState('');

  const tables = data.state.status === 'ready' ? data.state.data : null;

  const current = useMemo(() => (tables === null ? null : fingerprint(tables)), [tables]);
  const status = current === null ? null : backupStatus(current, saved);

  const liveCounts = useMemo(() => {
    if (tables === null) return null;
    return EXPORTED_TABLES.map((t) => ({ table: t, count: tables[t]?.length ?? 0 })).filter(
      (c) => c.count > 0,
    );
  }, [tables]);

  const parsed = useMemo(() => (pasted.trim() === '' ? null : parseBackup(pasted)), [pasted]);

  const exportNow = useCallback(async (): Promise<void> => {
    if (tables === null) return;
    setError(null);
    setOutcome(null);

    const at = new Date().toISOString();
    const backup: Backup = buildBackup(kitchenName, tables, at);
    const json = backupToText(backup);

    // Shown FIRST, before either delivery attempt, so it is on screen even if what
    // follows throws.
    setText(json);

    const notes: string[] = [];

    try {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = backupFilename(at);
      link.click();
      URL.revokeObjectURL(url);
      notes.push('downloaded');
    } catch {
      notes.push('the download did not start');
    }

    try {
      await navigator.clipboard.writeText(json);
      notes.push('copied to the clipboard');
    } catch {
      notes.push('the clipboard was refused');
    }

    setDelivery(`${notes.join(', ')}. The full text is below either way.`);

    // Recorded only after the text exists. A note saying "backed up" for a backup
    // he never received would be worse than no note.
    const note: SavedBackup = { fingerprint: fingerprint(tables), at };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(note));
    } catch {
      // Private browsing refuses writes. The backup itself still happened.
    }
    setSaved(note);
  }, [tables, kitchenName]);

  const runImport = useCallback(async (): Promise<void> => {
    if (parsed === null || !parsed.ok) return;
    setBusy(true);
    setError(null);
    setOutcome(null);

    try {
      const written = await repo.importAll(importable(parsed.backup));
      setOutcome(`Restored. ${JSON.stringify(written)}`);
      setConfirmImport(false);
      setTypedForImport('');
      setPasted('');
      data.reload();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Nothing was changed. ${cause.message}`
          : 'Nothing was changed. The restore failed.',
      );
    } finally {
      setBusy(false);
    }
  }, [parsed, repo, data]);

  const runClear = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setOutcome(null);

    try {
      const destroyed = await repo.clearAll();
      setOutcome(`Cleared. ${JSON.stringify(destroyed)}`);
      setConfirmClear(false);
      setTypedForClear('');
      data.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not clear the kitchen.');
    } finally {
      setBusy(false);
    }
  }, [repo, data]);

  if (data.state.status === 'loading') return <p className="muted">Reading everything…</p>;

  if (data.state.status === 'error') {
    return (
      <div>
        <h1>Backup</h1>
        <p className="error" role="alert">
          Could not read your data, so a backup would be incomplete: {data.state.error.message}
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>Backup</h1>

      {status !== null && (
        <p className={status.state === 'current' ? 'muted' : 'unresolved'}>{status.message}</p>
      )}

      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {outcome !== null && <p className="muted">{outcome}</p>}

      {/* --- export ---------------------------------------------------- */}
      <section className="units">
        <h2>Save a backup</h2>
        <p className="muted">
          Everything in the kitchen, as one file. Your audit trail is included in the file but
          is never written back on a restore.
        </p>

        {liveCounts !== null && liveCounts.length > 0 && (
          <p className="muted num">
            {liveCounts.map((c) => `${c.count} ${c.table.replace(/_/g, ' ')}`).join(' · ')}
          </p>
        )}

        <button type="button" className="primary" onClick={() => void exportNow()} disabled={busy}>
          Save a backup now
        </button>

        {delivery !== null && <p className="muted">{delivery}</p>}

        {/* The guarantee. If the download was blocked and the clipboard refused,
            this is still here to select and paste. */}
        {text !== null && (
          <>
            <p className="muted">
              If the download did not appear, select all of this and paste it somewhere safe.
            </p>
            <textarea className="backup-text num" readOnly rows={12} value={text} />
          </>
        )}

        <p className="hint muted">
          The reminder above is kept on this device only, so a backup saved on your phone will
          not stop this page reminding you on a laptop.
        </p>
      </section>

      {/* --- import ---------------------------------------------------- */}
      <section className="units">
        <h2>Restore from a backup</h2>
        <p className="unresolved">
          Restoring REPLACES everything currently in the kitchen. Save a backup first if there
          is anything here you want to keep.
        </p>

        <Field
          label="Paste the backup file"
          value={pasted}
          onChange={(v) => {
            setPasted(v);
            setConfirmImport(false);
          }}
          multiline
          hint="Open the .json file in any text editor, select all, and paste it here."
        />

        {parsed !== null && !parsed.ok && (
          <p className="error" role="alert">
            {parsed.error}
          </p>
        )}

        {parsed !== null && parsed.ok && !confirmImport && (
          <>
            {/* Both sides, side by side. "Restore 40 recipes over your 3" and
                "restore 3 over your 40" must not look the same. */}
            <p className="muted">
              This file holds {parsed.counts['recipes'] ?? 0} recipes,{' '}
              {parsed.counts['ingredients'] ?? 0} ingredients and {parsed.counts['jobs'] ?? 0}{' '}
              jobs. It would replace {tables?.['recipes']?.length ?? 0} recipes,{' '}
              {tables?.['ingredients']?.length ?? 0} ingredients and{' '}
              {tables?.['jobs']?.length ?? 0} jobs that are here now.
            </p>
            <button type="button" onClick={() => setConfirmImport(true)}>
              Restore this backup
            </button>
          </>
        )}

        {confirmImport && parsed !== null && parsed.ok && (
          <>
            {status?.state !== 'current' && (
              <p className="unresolved">
                What is in the kitchen now has not been backed up. Restoring will destroy it.
              </p>
            )}
            <Field
              label={`Type ${kitchenName} to confirm`}
              value={typedForImport}
              onChange={setTypedForImport}
            />
            <div className="actions">
              <button
                type="button"
                className="danger"
                disabled={busy || typedForImport.trim() !== kitchenName}
                onClick={() => void runImport()}
              >
                {busy ? 'Restoring…' : 'Replace everything with this backup'}
              </button>
              <button type="button" onClick={() => setConfirmImport(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          </>
        )}
      </section>

      {/* --- clear all ------------------------------------------------- */}
      <section className="units danger-zone">
        <h2>Clear everything</h2>
        <p className="muted">
          Deletes every recipe, ingredient, job, customer and price in this kitchen. Your
          account and access are not touched. This cannot be undone.
        </p>

        {!confirmClear ? (
          <button type="button" onClick={() => setConfirmClear(true)}>
            Clear everything
          </button>
        ) : (
          <>
            {liveCounts !== null && (
              <p className="unresolved num">
                About to delete:{' '}
                {liveCounts.map((c) => `${c.count} ${c.table.replace(/_/g, ' ')}`).join(' · ')}
              </p>
            )}

            {/* Warns, but does not block. Blocking would trap him if the export
                itself were failing, and then the only way out is the SQL editor. */}
            {status?.state !== 'current' && (
              <p className="unresolved">
                This has not been backed up. Once it is gone there is no copy of it anywhere.
              </p>
            )}

            <Field
              label={`Type ${kitchenName} to confirm`}
              value={typedForClear}
              onChange={setTypedForClear}
              hint="Typed rather than tapped, because this cannot be undone."
            />

            <div className="actions">
              <button
                type="button"
                className="danger"
                disabled={busy || typedForClear.trim() !== kitchenName}
                onClick={() => void runClear()}
              >
                {busy ? 'Clearing…' : 'Delete everything permanently'}
              </button>
              <button type="button" onClick={() => setConfirmClear(false)} disabled={busy}>
                Keep it
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
