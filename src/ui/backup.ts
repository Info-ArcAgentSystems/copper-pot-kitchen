/**
 * The backup file: what goes in it, and what comes back out.
 *
 * PURE — no React, no database, no clock except the one passed in. That matters
 * more here than anywhere else in the app, because this is the file Paul relies on
 * when something has already gone wrong.
 *
 * ROWS, NOT DOMAIN OBJECTS.
 *
 * The obvious implementation exports `recipeRepository.list()` and friends. It
 * would be wrong. The domain types are a deliberate narrowing of the schema —
 * `JobDish` drops nothing today, but `ingredient_price_history` has no domain type
 * at all, and every future column starts life unmapped. A backup built from domain
 * objects silently loses exactly the fields nobody has got round to modelling yet,
 * and it loses them invisibly, in the file, until a restore.
 *
 * So the backup is raw rows, and `tests/ui/backup.test.ts` reads `schema.sql` and
 * fails if any table is neither exported nor explicitly excluded with a reason.
 */

export const FORMAT_VERSION = 1;

/**
 * Every table the backup carries, in **insert order** — parents before children,
 * so a restore never has to defer a foreign key.
 */
export const EXPORTED_TABLES = [
  'suppliers',
  'properties',
  'customers',
  'client_rates',
  'service_templates',
  'ingredients',
  'ingredient_price_history',
  'stock',
  'recipes',
  'recipe_ingredients',
  'recipe_unquantified',
  'jobs',
  'job_dishes',
  'job_dietaries',
  'job_extras',
  'purchase_state',
  'prep_state',
  'packing_state',
  'job_changes',
] as const;

export type ExportedTable = (typeof EXPORTED_TABLES)[number];

/**
 * Tables deliberately left out, each with the reason.
 *
 * This list is not documentation — the coverage test reads it. A table that is
 * neither here nor in `EXPORTED_TABLES` fails the build, which is the only way to
 * stop a future table quietly falling out of every backup.
 */
export const NOT_EXPORTED: Readonly<Record<string, string>> = {
  kitchens:
    'the kitchen record itself, not its contents — a restore fills an existing kitchen rather than creating one',
  kitchen_members:
    'access control, not data. Exporting user ids would put auth identity in a file that gets emailed around, and Rule 17 wants membership granted per person rather than restored from a file',
  invoices: 'no feature yet, so always empty — listed so "empty" stays a decision, not an oversight',
  invoice_lines: 'no feature yet, so always empty',
};

/**
 * Tables that are exported but must NEVER be imported.
 *
 * `job_changes` is Paul's audit trail. It belongs in the file — it is his history,
 * and a backup without it loses the record of who changed what. But writing it
 * back would forge audit rows with a `changed_by` that no longer means anything.
 * Rule 10 says the trail is not optional; a trail that can be written from a file
 * is not a trail.
 */
export const NEVER_IMPORTED: readonly string[] = ['job_changes'];

export type Row = Record<string, unknown>;

export interface Backup {
  readonly formatVersion: number;
  readonly exportedAt: string;
  readonly kitchenName: string;
  readonly tables: Readonly<Record<string, readonly Row[]>>;
}

/** Assembles the file. `exportedAt` is passed in so the result is testable. */
export function buildBackup(
  kitchenName: string,
  tables: Readonly<Record<string, readonly Row[]>>,
  exportedAt: string,
): Backup {
  const out: Record<string, readonly Row[]> = {};
  // Fixed order, so two exports of identical data produce identical files and a
  // diff between them means something.
  for (const table of EXPORTED_TABLES) out[table] = tables[table] ?? [];

  return { formatVersion: FORMAT_VERSION, exportedAt, kitchenName, tables: out };
}

/** Pretty-printed, because it is meant to be readable when everything else fails. */
export const backupToText = (backup: Backup): string => JSON.stringify(backup, null, 2);

export const backupFilename = (exportedAt: string): string =>
  `copper-pot-backup-${exportedAt.slice(0, 10)}.json`;

// ---------------------------------------------------------------------------
// Reading one back
// ---------------------------------------------------------------------------

export type ParseResult =
  | { readonly ok: true; readonly backup: Backup; readonly counts: Readonly<Record<string, number>> }
  | { readonly ok: false; readonly error: string };

/**
 * Validate BEFORE anything is touched.
 *
 * Everything here is a refusal rather than a repair. A backup from a newer version
 * of the app, or one carrying a table this version does not know, must fail loudly
 * — restoring three quarters of a file and reporting success is the failure mode
 * that would cost Paul the most, because he would believe it worked.
 */
export function parseBackup(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That is not valid JSON. Paste the whole file, including the outer { }.' };
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'That JSON is not a backup file — the top level should be an object.' };
  }

  const candidate = raw as Partial<Backup>;

  if (typeof candidate.formatVersion !== 'number') {
    return { ok: false, error: 'No formatVersion, so this is not a Copper Pot backup.' };
  }

  if (candidate.formatVersion > FORMAT_VERSION) {
    return {
      ok: false,
      error: `This backup is version ${candidate.formatVersion}; this app understands up to ${FORMAT_VERSION}. Update the app rather than importing it here — restoring part of a newer file would lose whatever is new about it.`,
    };
  }

  if (candidate.formatVersion < FORMAT_VERSION) {
    return {
      ok: false,
      error: `This backup is version ${candidate.formatVersion} and this app expects ${FORMAT_VERSION}. Older formats are not converted automatically.`,
    };
  }

  const tables = candidate.tables;
  if (typeof tables !== 'object' || tables === null || Array.isArray(tables)) {
    return { ok: false, error: 'The backup has no `tables` object.' };
  }

  const known = new Set<string>(EXPORTED_TABLES);
  const unknown = Object.keys(tables).filter((t) => !known.has(t));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `This backup contains data this app does not recognise (${unknown.join(', ')}). Importing it would leave that data behind without saying so.`,
    };
  }

  const counts: Record<string, number> = {};
  for (const table of EXPORTED_TABLES) {
    const rows = (tables as Record<string, unknown>)[table];
    if (rows === undefined) {
      counts[table] = 0;
      continue;
    }
    if (!Array.isArray(rows)) {
      return { ok: false, error: `The "${table}" section of this backup is not a list.` };
    }
    counts[table] = rows.length;
  }

  return {
    ok: true,
    backup: {
      formatVersion: candidate.formatVersion,
      exportedAt: typeof candidate.exportedAt === 'string' ? candidate.exportedAt : '',
      kitchenName: typeof candidate.kitchenName === 'string' ? candidate.kitchenName : '',
      tables: tables as Readonly<Record<string, readonly Row[]>>,
    },
    counts,
  };
}

/**
 * What actually gets written back — everything except the audit trail.
 *
 * Dropping `job_changes` here rather than at the call site means there is one
 * place to check, and the repository test asserts it never appears in a payload.
 */
export function importable(backup: Backup): Record<string, readonly Row[]> {
  const out: Record<string, readonly Row[]> = {};

  for (const table of EXPORTED_TABLES) {
    if (NEVER_IMPORTED.includes(table)) continue;
    out[table] = backup.tables[table] ?? [];
  }

  return out;
}

// ---------------------------------------------------------------------------
// "Has anything changed since the last backup?"
// ---------------------------------------------------------------------------

/**
 * A fingerprint of the DATA, deliberately excluding `exportedAt`.
 *
 * The reminder has to answer "has anything changed since you last saved" rather
 * than "how long ago was that". A timestamp alone would nag someone who has
 * changed nothing in a fortnight, and — much worse — stay quiet for someone who
 * exported this morning and has rewritten every recipe since.
 *
 * Excluding `exportedAt` is what makes it a fingerprint of the content rather than
 * of the act of exporting. Otherwise every export would differ from every other and
 * the answer would always be "changed".
 *
 * FNV-1a: not cryptographic, and does not need to be. It detects accidental
 * difference, not tampering.
 */
export function fingerprint(tables: Readonly<Record<string, readonly Row[]>>): string {
  const canonical = JSON.stringify(
    EXPORTED_TABLES.map((table) => [table, tables[table] ?? []]),
  );

  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return `${hash.toString(16)}-${canonical.length}`;
}

export interface BackupStatus {
  readonly state: 'never' | 'current' | 'stale';
  readonly message: string;
}

/** What the Setup screen says about the state of his backups. */
export function backupStatus(
  currentFingerprint: string,
  saved: { fingerprint: string; at: string } | null,
): BackupStatus {
  if (saved === null) {
    return {
      state: 'never',
      message: 'You have never saved a backup from this device. Nothing here is stored anywhere else.',
    };
  }

  if (saved.fingerprint === currentFingerprint) {
    return {
      state: 'current',
      message: `Your last backup, on ${saved.at.slice(0, 10)}, matches what is here now.`,
    };
  }

  return {
    state: 'stale',
    message: `Your data has changed since your last backup on ${saved.at.slice(0, 10)}. Save a new one.`,
  };
}
