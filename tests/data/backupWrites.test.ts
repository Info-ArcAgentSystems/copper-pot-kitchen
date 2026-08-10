/**
 * Reading a kitchen out, and writing one back.
 *
 * The assertions that matter are the two refusals: no `kitchen_id` filter on the
 * read (RLS is the single definition of scope), and no `job_changes` in anything
 * written back (Rule 10 — a forgeable audit trail is not a trail).
 */

import { describe, expect, it } from 'vitest';
import { backupRepository } from '../../src/data/repositories';
import { buildBackup, EXPORTED_TABLES, importable } from '../../src/ui/backup';
import { fakeDb } from './fakeDb';

const AT = '2026-08-09T10:00:00.000Z';

describe('reading the kitchen out', () => {
  it('reads every table it is asked for', async () => {
    const db = fakeDb({
      recipes: [{ id: 'r1', kitchen_id: 'k1', name: 'Lasagne' }],
      ingredients: [{ id: 'i1', kitchen_id: 'k1', name: 'mince' }],
    });

    const rows = await backupRepository(db).readAll(['recipes', 'ingredients']);

    expect(rows['recipes']).toHaveLength(1);
    expect(rows['ingredients']).toHaveLength(1);
  });

  it('reads RAW ROWS, keeping columns the domain types do not model', async () => {
    // The reason this does not go through the repositories: a domain mapper drops
    // whatever it does not know about, silently, into the backup file.
    const db = fakeDb({
      stock: [{ id: 's1', kitchen_id: 'k1', ingredient_id: 'i1', qty: 2, unit: 'kg', use_by: '2026-09-01', counted_at: AT }],
    });

    const rows = await backupRepository(db).readAll(['stock']);

    expect(rows['stock']?.[0]).toHaveProperty('use_by', '2026-09-01');
    expect(rows['stock']?.[0]).toHaveProperty('counted_at');
  });

  it('does not filter by kitchen_id — RLS scopes the read', async () => {
    const db = fakeDb({ recipes: [] });
    await backupRepository(db).readAll(['recipes']);

    for (const call of db.calls) {
      expect(call.column).not.toBe('kitchen_id');
    }
  });

  it('returns an empty list for a table with no rows, not undefined', async () => {
    // An absent key and an empty table must not look different in the file.
    const db = fakeDb({});
    const rows = await backupRepository(db).readAll(['jobs']);

    expect(rows['jobs']).toEqual([]);
  });
});

describe('writing one back', () => {
  const backup = () =>
    buildBackup(
      'Copper Pot',
      {
        recipes: [{ id: 'r1', kitchen_id: 'k1', name: 'Lasagne' }],
        job_changes: [{ id: 'c1', job_id: 'j1', field: 'guests', changed_by: 'someone' }],
      },
      AT,
    );

  it('restores through ONE rpc, not a table at a time', async () => {
    // Twenty separate writes would leave the kitchen holding neither the backup
    // nor what was there before if one failed.
    const db = fakeDb({}, {});
    await backupRepository(db).importAll(importable(backup()));

    expect(db.calls.filter((c) => c.op === 'rpc')).toHaveLength(1);
    expect(db.calls[0]?.table).toBe('import_kitchen');
    expect(db.calls.some((c) => c.op === 'insert' || c.op === 'delete')).toBe(false);
  });

  it('RULE 10: never sends job_changes, even though the file carries it', async () => {
    const db = fakeDb({}, {});
    await backupRepository(db).importAll(importable(backup()));

    const payload = (db.calls[0]?.payload as { p_backup: Record<string, unknown> }).p_backup;

    expect(Object.keys(payload)).not.toContain('job_changes');
    expect(JSON.stringify(payload)).not.toContain('changed_by');
  });

  it('sends every other exported table', async () => {
    const db = fakeDb({}, {});
    await backupRepository(db).importAll(importable(backup()));

    const payload = (db.calls[0]?.payload as { p_backup: Record<string, unknown> }).p_backup;

    for (const table of EXPORTED_TABLES) {
      if (table === 'job_changes') continue;
      expect(Object.keys(payload), `${table} missing from the payload`).toContain(table);
    }
  });

  it('does not send a kitchen_id of its own — the function resolves it', async () => {
    // A backup taken from another kitchen, or an edited file, must not be able to
    // redirect the write.
    const db = fakeDb({}, {});
    await backupRepository(db).importAll(importable(backup()));

    const args = db.calls[0]?.payload as Record<string, unknown>;
    expect(args).not.toHaveProperty('kitchen_id');
    expect(args).not.toHaveProperty('p_kitchen_id');
  });
});

describe('clearing the kitchen', () => {
  it('goes through the rpc, not a delete per table', async () => {
    // Ordering across three `on delete restrict` edges is the whole difficulty,
    // and it belongs in one place that can be reasoned about.
    const db = fakeDb({}, {});
    await backupRepository(db).clearAll();

    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]?.op).toBe('rpc');
    expect(db.calls[0]?.table).toBe('clear_kitchen');
  });

  it('names no table directly, so no delete order lives in the client', async () => {
    const db = fakeDb({}, {});
    await backupRepository(db).clearAll();

    expect(db.calls.some((c) => c.op === 'delete')).toBe(false);
  });
});
