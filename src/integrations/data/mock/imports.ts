import type { ImportBatch, ImportRowError, ImportType, Id } from '@/data/types';
import { validateActualRows, type ActualImportContext } from '@/lib/actualImportRules';
import { KpiDeferredError, KpiError, ruleIssue } from '@/lib/errorCatalog';
import { todayOf } from '@/lib/isoDate';
import type { StageImportInput } from '../types';
import { clockOf } from './authorize';
import { writeActualSnapshot, writeImportEvidence } from './actualWrites';
import type { Tx } from './store';

/**
 * The batch-import framework's per-type handlers (WBS 4.4.3, BR-KPI-54): how `actuals.stageImport`
 * validates the rows of each import type and how `actuals.commitImport` applies them. A lookup table
 * only — the decisions are the types' rules in `src/lib`. Track T4 wires `Actual`; T1 (OrgData,
 * 4.1.7), T2 (Library, 4.2.5) and T3 (GoalPlan, 4.3.7) add theirs here and delete their deferral.
 * A type without a handler answers `KpiDeferredError` from inside the wired method (it is not a
 * deferred METHOD, so `registry.deferred` does not list it).
 */
export interface ImportHandler<K extends ImportType> {
  /** Every row error of the staged rows, against the tenant's data as it is now. */
  validate(tx: Tx, input: Extract<StageImportInput, { importType: K }>): ImportRowError[];
  /** Applies a batch that validated clean; called inside the commit's transaction. */
  apply(tx: Tx, batch: Extract<ImportBatch, { importType: K }>): void;
}

/** What an actuals batch is checked against: the tenant's rows only (the Tx is the tenant). */
export function actualImportContext(tx: Tx, cycleId: Id): ActualImportContext {
  return {
    cycleId,
    goals: tx.all('Goal'),
    plans: tx.all('GoalPlan'),
    periods: tx.all('CyclePeriod'),
    users: tx.all('UserAccount'),
    kpiDefinitions: tx.all('KpiDefinition'),
    results: tx.all('PeriodResult'),
    asOf: todayOf(clockOf(tx)),
  };
}

const actualHandler: ImportHandler<'Actual'> = {
  validate: (tx, input) => validateActualRows(input.rows, actualImportContext(tx, input.cycleId as Id)).errors,
  apply: (tx, batch) => {
    // Re-validated against the data as it is NOW (a period may have been locked since staging); a
    // row that no longer passes refuses the whole commit and nothing is written (BR-KPI-54).
    const { errors, resolved } = validateActualRows(batch.rows, actualImportContext(tx, batch.cycleId as Id));
    if (errors.length > 0) {
      throw new KpiError(
        'ERR-KPI-04',
        `import batch ${batch.id}: ${new Set(errors.map((e) => e.rowNo)).size} row(s) no longer valid`,
        errors.map((e) => ruleIssue(e.code, `row:${e.rowNo}`, e.detail, { rowNo: e.rowNo, column: e.column ?? '' })),
      );
    }
    const goalsByPeriod = new Map<Id, Id[]>();
    for (const row of resolved) {
      const actual = writeActualSnapshot(tx, {
        goalId: row.goalId,
        periodId: row.periodId,
        actualValue: row.actualValue,
        actualText: row.actualText,
        note: row.note,
        sourceType: 'EXCEL',
        batchId: batch.id,
        syncRunId: null,
        enteredBy: tx.ctx.actorUserId,
      });
      if (row.evidenceUrl !== null) writeImportEvidence(tx, actual, row.evidenceUrl);
      goalsByPeriod.set(row.periodId, [...(goalsByPeriod.get(row.periodId) ?? []), row.goalId]);
    }
    for (const [periodId, goalIds] of goalsByPeriod) {
      tx.emit({ type: 'actuals.recorded', periodId, goalIds, sourceType: 'EXCEL', batchId: batch.id, syncRunId: null });
    }
  },
};

const deferredTo: Readonly<Record<Exclude<ImportType, 'Actual'>, string>> = {
  GoalPlan: 'T3 4.3.7 (Goal Plan import rules)',
  OrgData: 'T1 4.1.7 (organisation & staff import rules)',
  Library: 'T2 4.2.5 (library import rules)',
};

/** The handler of an import type, or `KpiDeferredError` while its track has not landed. */
export function importHandler<K extends ImportType>(importType: K): ImportHandler<K> {
  if (importType === 'Actual') return actualHandler as unknown as ImportHandler<K>;
  throw new KpiDeferredError('write', `actuals.stageImport:${importType}`, deferredTo[importType as Exclude<ImportType, 'Actual'>]);
}
