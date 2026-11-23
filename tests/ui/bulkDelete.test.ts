/**
 * Deleting several records: every one kept is named, and Rule 15 holds.
 */

import { describe, expect, it } from 'vitest';
import { deleteEach, jobLockedReason, referenceRefusal } from '../../src/ui/bulkDelete';
import type { Job, JobStatus } from '../../src/engine/types';

const fk = new Error('update or delete on table "recipes" violates foreign key constraint');

describe('deleteEach — one refusal never stops the rest', () => {
  it('deletes what it can and names what it kept, with why', async () => {
    const removed: string[] = [];
    const outcome = await deleteEach(
      ['Pancakes', 'Barbeque', 'Full Irish'],
      async (name) => {
        if (name === 'Barbeque') throw fk;
        removed.push(name);
      },
      (name) => name,
      referenceRefusal('it’s on a job’s menu — remove it there first'),
    );

    expect(removed).toEqual(['Pancakes', 'Full Irish']);
    expect(outcome).toEqual({
      deleted: ['Pancakes', 'Full Irish'],
      kept: [{ name: 'Barbeque', reason: 'it’s on a job’s menu — remove it there first' }],
    });
  });

  it('passes any other failure through in its own words', async () => {
    const outcome = await deleteEach(
      ['x'],
      async () => {
        throw new Error('network down');
      },
      (n) => n,
      referenceRefusal('in use'),
    );
    expect(outcome.kept).toEqual([{ name: 'x', reason: 'network down' }]);
  });
});

describe('RULE 15 — completed and cancelled jobs cannot even be ticked', () => {
  const job = (status: JobStatus): Job => ({ status }) as Job;

  it.each(['delivered', 'invoiced', 'paid', 'cancelled'] as const)('locks a %s job', (status) => {
    expect(jobLockedReason(job(status))).toContain('stay in your history');
  });

  it.each(['enquiry', 'confirmed', 'in_prep'] as const)('allows a %s job', (status) => {
    expect(jobLockedReason(job(status))).toBeNull();
  });
});
