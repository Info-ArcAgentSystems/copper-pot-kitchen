/**
 * Deleting several records at once — and saying exactly what happened.
 *
 * PURE apart from the `remove` it is handed. Each record is deleted on its own,
 * one after another, and a refusal does NOT stop the rest: these are independent
 * rows, and the database refusing one (a recipe still on a job's menu) says
 * nothing about the next. What comes back names every record kept and why, so
 * "deleted 5" can never hide that a sixth is still there.
 */

import type { ClosedJobStatus, Job } from '../engine/types';

export interface BulkOutcome {
  readonly deleted: readonly string[];
  readonly kept: readonly { readonly name: string; readonly reason: string }[];
}

export async function deleteEach<T>(
  items: readonly T[],
  remove: (item: T) => Promise<void>,
  nameOf: (item: T) => string,
  refusal: (cause: unknown) => string,
): Promise<BulkOutcome> {
  const deleted: string[] = [];
  const kept: { name: string; reason: string }[] = [];

  for (const item of items) {
    try {
      await remove(item);
      deleted.push(nameOf(item));
    } catch (cause) {
      kept.push({ name: nameOf(item), reason: refusal(cause) });
    }
  }

  return { deleted, kept };
}

/** A database refusal over a reference, in the owner's terms. */
export const referenceRefusal =
  (inUse: string) =>
  (cause: unknown): string =>
    cause instanceof Error && cause.message.includes('violates foreign key')
      ? inUse
      : cause instanceof Error
        ? cause.message
        : 'could not be deleted';

const CLOSED: ReadonlySet<ClosedJobStatus> = new Set(['delivered', 'invoiced', 'paid', 'cancelled']);

/**
 * RULE 15. Completed and cancelled jobs are never deleted — historical figures
 * depend on them — so in a bulk delete they cannot even be ticked. Returns why
 * a job is locked, or null when it may be selected.
 */
export function jobLockedReason(job: Job): string | null {
  return CLOSED.has(job.status as ClosedJobStatus)
    ? `${job.status} — completed and cancelled jobs stay in your history`
    : null;
}
