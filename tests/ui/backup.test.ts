/**
 * The backup file.
 *
 * PURE, so it runs in Node with no DOM and no database. This is the feature whose
 * failure modes matter more than its happy path — it exists for the day something
 * has already gone wrong — so most of what follows asserts refusals.
 *
 * The load-bearing one is the coverage guard: a table added to the schema later
 * must FAIL this suite rather than quietly fall out of every backup from then on.
 * That is exactly how a backup betrays someone, and it is silent until a restore.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  backupFilename,
  backupStatus,
  buildBackup,
  backupToText,
  EXPORTED_TABLES,
  FORMAT_VERSION,
  fingerprint,
  importable,
  NEVER_IMPORTED,
  NOT_EXPORTED,
  parseBackup,
  type Row,
} from '../../src/ui/backup';

const AT = '2026-08-09T10:00:00.000Z';

const tables = (over: Record<string, Row[]> = {}) => ({
  recipes: [{ id: 'r1', kitchen_id: 'k1', name: 'Lasagne', portions_per_batch: 9 }],
  ingredients: [{ id: 'i1', kitchen_id: 'k1', name: 'mince', price_per_pack: null }],
  ...over,
});

describe('THE COVERAGE GUARD — every table is accounted for', () => {
  // Read from the schema itself rather than a list maintained by hand, because a
  // hand-maintained list is exactly what goes stale.
  const schema = readFileSync(
    fileURLToPath(new URL('../../schema.sql', import.meta.url)),
    'utf8',
  );
  const inSchema = [...schema.matchAll(/create table (\w+)/g)].map((m) => m[1] as string);

  it('finds the schema, so this guard is not vacuous', () => {
    expect(inSchema.length).toBeGreaterThan(15);
  });

  it.each(inSchema)('%s is either exported or explicitly excluded', (table) => {
    const exported = (EXPORTED_TABLES as readonly string[]).includes(table);
    const excluded = Object.hasOwn(NOT_EXPORTED, table);

    expect(
      exported || excluded,
      `"${table}" is in schema.sql but neither exported nor listed in NOT_EXPORTED. ` +
        'Add it to one or the other — a table that is in neither vanishes from every backup silently.',
    ).toBe(true);
  });

  it('gives a reason for every exclusion', () => {
    for (const [table, reason] of Object.entries(NOT_EXPORTED)) {
      expect(reason.length, `${table} is excluded without a reason`).toBeGreaterThan(20);
    }
  });

  it('excludes nothing that does not exist', () => {
    // A stale exclusion is a table someone thinks is handled and is not.
    for (const table of Object.keys(NOT_EXPORTED)) {
      expect(inSchema, `${table} is excluded but is not in the schema`).toContain(table);
    }
  });

  it('exports nothing that does not exist', () => {
    for (const table of EXPORTED_TABLES) {
      expect(inSchema, `${table} is exported but is not in the schema`).toContain(table);
    }
  });
});

describe('the file', () => {
  it('carries a format version, so a future change is detectable', () => {
    expect(buildBackup('Copper Pot', tables(), AT).formatVersion).toBe(FORMAT_VERSION);
  });

  it('includes every exported table, empty ones included', () => {
    // An absent key and an empty table must not look different on the way back in.
    const backup = buildBackup('Copper Pot', tables(), AT);

    for (const table of EXPORTED_TABLES) {
      expect(backup.tables[table], `${table} missing from the file`).toBeDefined();
    }
    expect(backup.tables['jobs']).toEqual([]);
  });

  it('names the file by date', () => {
    expect(backupFilename(AT)).toBe('copper-pot-backup-2026-08-09.json');
  });

  it('is pretty-printed, because it is read when everything else has failed', () => {
    expect(backupToText(buildBackup('Copper Pot', tables(), AT))).toContain('\n  ');
  });

  it('orders tables identically every time, so two exports can be diffed', () => {
    const a = buildBackup('Copper Pot', tables(), AT);
    const b = buildBackup('Copper Pot', { ingredients: tables()['ingredients'], recipes: tables()['recipes'] }, AT);

    expect(Object.keys(a.tables)).toEqual(Object.keys(b.tables));
  });
});

describe('RULE 8 — a backup preserves null as null', () => {
  it('round-trips a null without coercing it to 0 or an empty string', () => {
    // An unpriced ingredient that comes back as €0 would turn "I do not know" into
    // "it is free", in the file, permanently.
    const backup = buildBackup('Copper Pot', tables(), AT);
    const parsed = parseBackup(backupToText(backup));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const ingredient = parsed.backup.tables['ingredients']?.[0];
    expect(ingredient?.['price_per_pack']).toBeNull();
    expect(ingredient?.['price_per_pack']).not.toBe(0);
    expect(ingredient?.['price_per_pack']).not.toBe('');
  });

  it('round-trips the whole file unchanged', () => {
    const backup = buildBackup('Copper Pot', tables(), AT);
    const parsed = parseBackup(backupToText(backup));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.tables).toEqual(backup.tables);
  });

  it('counts what is in the file, so a confirm can say', () => {
    const parsed = parseBackup(backupToText(buildBackup('Copper Pot', tables(), AT)));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.counts['recipes']).toBe(1);
    expect(parsed.counts['jobs']).toBe(0);
  });
});

describe('reading a file back — every failure is a REFUSAL, never a repair', () => {
  it('rejects text that is not JSON', () => {
    const result = parseBackup('not json at all');
    expect(result.ok).toBe(false);
  });

  it('rejects JSON that is not an object', () => {
    expect(parseBackup('[1,2,3]').ok).toBe(false);
  });

  it('rejects a file with no formatVersion', () => {
    expect(parseBackup(JSON.stringify({ tables: {} })).ok).toBe(false);
  });

  it('REFUSES a newer format rather than importing part of it', () => {
    // The dangerous case. Restoring three quarters of a newer file and reporting
    // success is worse than failing, because he would believe it worked.
    const result = parseBackup(
      JSON.stringify({ formatVersion: FORMAT_VERSION + 1, tables: {} }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Update the app');
  });

  it('refuses an older format rather than guessing at a conversion', () => {
    expect(parseBackup(JSON.stringify({ formatVersion: 0, tables: {} })).ok).toBe(false);
  });

  it('REFUSES a file carrying a table it does not recognise', () => {
    // Importing it would leave that data behind without saying so.
    const result = parseBackup(
      JSON.stringify({ formatVersion: FORMAT_VERSION, tables: { invented_table: [] } }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('invented_table');
  });

  it('rejects a table section that is not a list', () => {
    const result = parseBackup(
      JSON.stringify({ formatVersion: FORMAT_VERSION, tables: { recipes: { id: 'r1' } } }),
    );

    expect(result.ok).toBe(false);
  });

  it('accepts a file missing an optional table, treating it as empty', () => {
    const result = parseBackup(
      JSON.stringify({ formatVersion: FORMAT_VERSION, tables: { recipes: [] } }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.counts['jobs']).toBe(0);
  });
});

describe('RULE 10 — the audit trail is exported but never written back', () => {
  it('includes job_changes in the file', () => {
    // It is his history. A backup without it loses the record of who changed what.
    expect(EXPORTED_TABLES).toContain('job_changes');
  });

  it('EXCLUDES job_changes from anything that gets imported', () => {
    // Writing it back would forge audit rows with a changed_by that means nothing.
    // A trail that can be written from a file is not a trail.
    const backup = buildBackup(
      'Copper Pot',
      tables({ job_changes: [{ id: 'c1', job_id: 'j1', field: 'guests', changed_by: 'someone' }] }),
      AT,
    );

    expect(Object.keys(importable(backup))).not.toContain('job_changes');
  });

  it('still imports everything else', () => {
    const backup = buildBackup('Copper Pot', tables(), AT);
    const payload = importable(backup);

    for (const table of EXPORTED_TABLES) {
      if (NEVER_IMPORTED.includes(table)) continue;
      expect(payload[table], `${table} missing from the import payload`).toBeDefined();
    }
  });
});

describe('the fingerprint — "has anything changed?"', () => {
  it('is stable for identical data', () => {
    expect(fingerprint(tables())).toBe(fingerprint(tables()));
  });

  it('IGNORES the export timestamp', () => {
    // It fingerprints the content, not the act of exporting. Otherwise every
    // export would differ from every other and the answer would always be
    // "changed".
    const a = buildBackup('Copper Pot', tables(), '2026-08-09T10:00:00.000Z');
    const b = buildBackup('Copper Pot', tables(), '2026-08-10T18:30:00.000Z');

    expect(fingerprint(a.tables)).toBe(fingerprint(b.tables));
  });

  it('changes when a value changes', () => {
    const before = fingerprint(tables());
    const after = fingerprint(tables({ ingredients: [{ id: 'i1', name: 'mince', price_per_pack: 900 }] }));

    expect(after).not.toBe(before);
  });

  it('changes when a row is added', () => {
    const after = fingerprint(
      tables({ jobs: [{ id: 'j1', kitchen_id: 'k1', guests: 12 }] }),
    );

    expect(after).not.toBe(fingerprint(tables()));
  });

  it('changes when a row is REMOVED, not just added', () => {
    // A deletion is a change he needs to back up too.
    expect(fingerprint({ recipes: [] })).not.toBe(fingerprint(tables()));
  });
});

describe('what the Setup screen says', () => {
  it('says so plainly when there has never been a backup', () => {
    const status = backupStatus('abc', null);

    expect(status.state).toBe('never');
    expect(status.message).toContain('never');
  });

  it('confirms when the backup matches what is there', () => {
    expect(backupStatus('abc', { fingerprint: 'abc', at: AT }).state).toBe('current');
  });

  it('warns when the data has moved on', () => {
    const status = backupStatus('xyz', { fingerprint: 'abc', at: AT });

    expect(status.state).toBe('stale');
    expect(status.message).toContain('changed');
  });

  it('answers "has it changed", not "how long ago"', () => {
    // A fortnight-old backup of unchanged data is fine. A backup from this morning
    // with every recipe rewritten since is not. Time alone gets both wrong.
    const old = backupStatus('abc', { fingerprint: 'abc', at: '2020-01-01T00:00:00.000Z' });
    expect(old.state).toBe('current');
  });
});
