import type { ActualSourceType, Evidence, GoalActual, Id } from '@/data/types';
import { newId } from './rows';
import type { Tx } from './store';

/**
 * The ONE way the mock writes an actual (manual entry, an Excel commit, an API sync): a new current
 * snapshot, the previous current one kept as history (BR-KPI-52). Callers have already checked it
 * with `actualRules`.
 */
export function writeActualSnapshot(
  tx: Tx,
  input: {
    goalId: Id;
    periodId: Id;
    actualValue: number | null;
    actualText: string | null;
    note: string | null;
    sourceType: ActualSourceType;
    batchId: Id | null;
    syncRunId: Id | null;
    /** `null` for an API sync. */
    enteredBy: Id | null;
  },
): GoalActual {
  for (const previous of tx.all('GoalActual')) {
    if (previous.goalId === input.goalId && previous.periodId === input.periodId && previous.isCurrent) {
      tx.update('GoalActual', { ...previous, isCurrent: false });
    }
  }
  return tx.insert('GoalActual', {
    id: newId(),
    tenantId: tx.tenantId,
    ...input,
    recordedAt: tx.now,
    isCurrent: true,
  });
}

/** The `Link bằng chứng` of an import row: a URL evidence tied to the actual it backs (BR-KPI-57). */
export function writeImportEvidence(tx: Tx, actual: GoalActual, url: string): Evidence {
  return tx.insert('Evidence', {
    id: newId(),
    tenantId: tx.tenantId,
    goalId: actual.goalId,
    periodId: actual.periodId,
    actualId: actual.id,
    fileId: null,
    url,
    note: null,
    uploadedBy: tx.ctx.actorUserId as Id,
    uploadedAt: tx.now,
  });
}
