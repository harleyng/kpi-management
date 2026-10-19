import type { FileObject, Id, PayrollExport, RatingLevel } from '@/data/types';
import { KpiError, ruleIssue, toKpiError } from '@/lib/errorCatalog';
import { buildPayrollSheet, payrollFileName, type PayrollSheet } from '@/lib/payrollRules';
import { validatePayoutRule, validateRatingScale } from '@/lib/ratingRules';
import {
  applyAdjustment,
  buildPeriodResults,
  finalizePeriodResults,
  lockPeriodResults,
  type ResultChanges,
  type ResultData,
  type ResultIds,
  type ResultOutcome,
} from '@/lib/resultRules';
import type { ChildInput, PeriodResultFilter, ResultsGateway } from '../../types';
import { removeRow } from '../integrity';
import { eqOpt, inList, newId, saveChildren, upsert } from '../rows';
import { clockOf } from '../authorize';
import type { Runtime } from '../runtime';
import type { Tx } from '../store';
import { buildPayrollWorkbook, PAYROLL_MIME_TYPE } from '../payrollWorkbook';

/** Everything `resultRules` reads, straight from the transaction (the rules filter by period). */
function resultData(tx: Tx): ResultData {
  return {
    PerformanceCycle: tx.all('PerformanceCycle'),
    CyclePeriod: tx.all('CyclePeriod'),
    GoalPlan: tx.all('GoalPlan'),
    Goal: tx.all('Goal'),
    GoalAlignment: tx.all('GoalAlignment'),
    GoalPeriodTarget: tx.all('GoalPeriodTarget'),
    GoalTargetLevel: tx.all('GoalTargetLevel'),
    GoalActual: tx.all('GoalActual'),
    FormInstance: tx.all('FormInstance'),
    EvaluationItem: tx.all('EvaluationItem'),
    CalcMethod: tx.all('CalcMethod'),
    CalcTier: tx.all('CalcTier'),
    KpiDefinition: tx.all('KpiDefinition'),
    RatingLevel: tx.all('RatingLevel'),
    PayoutRule: tx.all('PayoutRule'),
    Employee: tx.all('Employee'),
    EmployeeAssignment: tx.all('EmployeeAssignment'),
    OrgUnit: tx.all('OrgUnit'),
    PeriodResult: tx.all('PeriodResult'),
    ResultDetail: tx.all('ResultDetail'),
  };
}

/** New rows get random ids here; the seed gives the same rows `seedId`s. */
const RANDOM_IDS: ResultIds = { result: () => newId(), detail: () => newId() };

/** The rule's answer, or its issues thrown (`toKpiError`: the first issue's code, every issue kept). */
function changesOf(outcome: ResultOutcome): ResultChanges {
  if (!outcome.ok) throw toKpiError(outcome.issues);
  return outcome.changes;
}

/** Writes the rule's changes; `action` overrides the audit action of the updates (LOCK). */
function apply(tx: Tx, changes: ResultChanges, action?: 'LOCK'): void {
  for (const id of changes.removedDetailIds) removeRow(tx, 'ResultDetail', id);
  for (const { row, created } of changes.results) {
    if (created) tx.insert('PeriodResult', row);
    else tx.update('PeriodResult', row, action ? { action } : {});
  }
  for (const detail of changes.addedDetails) tx.insert('ResultDetail', detail);
}

/** Everything `payrollRules` reads. */
function payrollData(tx: Tx) {
  return {
    PerformanceCycle: tx.all('PerformanceCycle'),
    CyclePeriod: tx.all('CyclePeriod'),
    GoalPlan: tx.all('GoalPlan'),
    Employee: tx.all('Employee'),
    EmployeeAssignment: tx.all('EmployeeAssignment'),
    OrgUnit: tx.all('OrgUnit'),
    JobPosition: tx.all('JobPosition'),
    RatingScale: tx.all('RatingScale'),
    RatingLevel: tx.all('RatingLevel'),
    PeriodResult: tx.all('PeriodResult'),
  };
}

/** Who the file says exported it: the person behind the account, else the account's display name. */
function actorName(tx: Tx): string {
  const account = tx.get('UserAccount', tx.ctx.actorUserId as Id);
  const employee = account.employeeId ? tx.find('Employee', account.employeeId) : undefined;
  return employee?.fullName ?? account.displayName;
}

const withoutTime = ({ exportedAt: _exportedAt, ...rest }: PayrollSheet) => rest;

const periodResults = (tx: Tx, periodId: Id) => tx.all('PeriodResult').filter((r) => r.periodId === periodId);

export function resultsGroup(rt: Runtime): ResultsGateway {
  return {
    listRatingScales: rt.read('results.listRatingScales', (tx) => tx.all('RatingScale')),
    listRatingLevels: rt.read('results.listRatingLevels', (tx, ratingScaleId?: Id) =>
      tx
        .all('RatingLevel')
        .filter((l) => eqOpt(ratingScaleId, l.ratingScaleId))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    ),
    saveRatingScale: rt.write(
      'results.saveRatingScale', { permission: 'rating.config' },
      (tx, input: Parameters<ResultsGateway['saveRatingScale']>[2], levels: readonly ChildInput<RatingLevel, 'ratingScaleId'>[]) => {
        const parent = upsert(tx, 'RatingScale', input, { create: () => ({}) });
        const children = saveChildren(tx, 'RatingLevel', 'ratingScaleId', parent.id, levels);
        // BR-KPI-41: from 0, contiguous, every level non-empty (ERR-KPI-13).
        const issues = validateRatingScale(children);
        if (issues.length > 0) throw toKpiError(issues);
        return { parent, children };
      },
    ),

    listPayoutRules: rt.read('results.listPayoutRules', (tx, ratingScaleId?: Id) =>
      tx.all('PayoutRule').filter((r) => eqOpt(ratingScaleId, r.ratingScaleId)),
    ),
    savePayoutRule: rt.write('results.savePayoutRule', { permission: 'rating.config' }, (tx, input: Parameters<ResultsGateway['savePayoutRule']>[2]) => {
      const saved = upsert(tx, 'PayoutRule', input, { create: () => ({}) });
      // A reference that does not resolve in this tenant is the integrity check's answer (ERR-KPI-06,
      // worded like a missing id); the rules speak only about rows that exist.
      const level = tx.find('RatingLevel', saved.ratingLevelId);
      const resolves =
        level !== undefined &&
        tx.find('RatingScale', saved.ratingScaleId) !== undefined &&
        (saved.orgUnitId === null || tx.find('OrgUnit', saved.orgUnitId) !== undefined) &&
        (saved.positionId === null || tx.find('JobPosition', saved.positionId) !== undefined);
      if (resolves) {
        const issues = validatePayoutRule(saved);
        if (issues.length > 0) throw toKpiError(issues);
        if (level.ratingScaleId !== saved.ratingScaleId) throw toKpiError([ruleIssue('ERR-KPI-06', saved.id, 'LEVEL_NOT_IN_SCALE')]);
      }
      return saved;
    }),
    deletePayoutRule: rt.write('results.deletePayoutRule', { permission: 'rating.config' }, (tx, payoutRuleId: Id) => {
      removeRow(tx, 'PayoutRule', payoutRuleId);
    }),

    listPeriodResults: rt.read('results.listPeriodResults', (tx, filter: PeriodResultFilter = {}) =>
      tx
        .all('PeriodResult')
        .filter(
          (r) =>
            eqOpt(filter.periodId, r.periodId) &&
            inList(filter.goalPlanIds, r.goalPlanId) &&
            eqOpt(filter.ownerType, r.ownerType) &&
            eqOpt(filter.status, r.status),
        ),
    ),
    listResultDetails: rt.read('results.listResultDetails', (tx, resultId: Id) => {
      tx.get('PeriodResult', resultId);
      return tx.all('ResultDetail').filter((d) => d.resultId === resultId);
    }),

    // BR-KPI-40…43 — every number comes from `resultRules` (the seed runs the same functions).
    calculateResults: rt.write('results.calculateResults', { permission: 'result.finalize' }, (tx, periodId: Id) => {
      tx.get('CyclePeriod', periodId);
      apply(tx, changesOf(buildPeriodResults(resultData(tx), periodId, RANDOM_IDS)));
      return periodResults(tx, periodId);
    }),
    setAdjustment: rt.write('results.setAdjustment', { permission: 'result.finalize' }, (tx, resultId: Id, adjustmentPct: number) => {
      tx.get('PeriodResult', resultId);
      apply(tx, changesOf(applyAdjustment(resultData(tx), resultId, adjustmentPct)));
      return tx.get('PeriodResult', resultId);
    }),
    finalizeResults: rt.write('results.finalizeResults', { permission: 'result.finalize' }, (tx, periodId: Id, resultIds?: readonly Id[]) => {
      tx.get('CyclePeriod', periodId);
      if (resultIds !== undefined && !Array.isArray(resultIds)) throw new KpiError('ERR-KPI-06', 'resultIds must be a list');
      for (const id of resultIds ?? []) tx.get('PeriodResult', id);
      // All or none: one result with an issue refuses the whole call, listing every issue.
      const changes = changesOf(finalizePeriodResults(resultData(tx), periodId, resultIds, tx.now, RANDOM_IDS));
      apply(tx, changes);
      const ids = changes.results.map((r) => r.row.id);
      tx.emit({ type: 'results.finalized', periodId, resultIds: ids });
      return ids.map((id) => tx.get('PeriodResult', id));
    }),
    lockResults: rt.write('results.lockResults', { permission: 'result.finalize' }, (tx, periodId: Id) => {
      tx.get('CyclePeriod', periodId);
      const changes = changesOf(lockPeriodResults(resultData(tx), periodId));
      apply(tx, changes, 'LOCK');
      return changes.results.map((r) => tx.get('PeriodResult', r.row.id));
    }),

    listPayrollExports: rt.read('results.listPayrollExports', (tx, periodId?: Id) =>
      tx
        .all('PayrollExport')
        .filter((e) => eqOpt(periodId, e.periodId))
        .sort((a, b) => (a.exportedAt !== b.exportedAt ? (a.exportedAt < b.exportedAt ? 1 : -1) : a.id < b.id ? 1 : -1)),
    ),
    // BR-KPI-81 — the file is rendered from `payrollRules.buildPayrollSheet` (stored numbers, never
    // recomputed); exporting writes the file and its record and changes no result.
    exportPayroll: rt.preparedWrite('results.exportPayroll', { permission: 'result.export' }, {
      prepare: (tx, periodId: Id) => {
        tx.get('CyclePeriod', periodId);
        const outcome = buildPayrollSheet(payrollData(tx), periodId, {
          tenantName: tx.globals.tenants.get(tx.tenantId)?.name ?? '',
          timeZone: clockOf(tx).tz,
          exportedAt: tx.now,
          exportedByName: actorName(tx),
        });
        if (!outcome.ok) throw toKpiError(outcome.issues);
        return outcome.sheet;
      },
      produce: buildPayrollWorkbook,
      // The fresh read differs only by its clock reading — anything else means the data moved.
      same: (before, now) => JSON.stringify(withoutTime(before)) === JSON.stringify(withoutTime(now)),
      apply: (tx, sheet, blob, periodId: Id) => {
        const fileId = newId();
        const file: FileObject = {
          id: fileId,
          tenantId: tx.tenantId,
          storageKey: `mock/${fileId}`,
          fileName: payrollFileName(sheet),
          mimeType: PAYROLL_MIME_TYPE,
          sizeBytes: blob.size,
          uploadedBy: tx.ctx.actorUserId as Id,
          uploadedAt: sheet.exportedAt,
        };
        tx.insert('FileObject', file);
        const record: PayrollExport = { id: newId(), tenantId: tx.tenantId, periodId, fileId, exportedBy: tx.ctx.actorUserId as Id, exportedAt: sheet.exportedAt };
        tx.insert('PayrollExport', record);
        tx.emit({ type: 'payroll.exported', periodId, exportId: record.id });
        return record;
      },
      // Memory only, like every mock file (persistence.ts): a reload keeps the record, not the bytes.
      afterCommit: (record, blob) => rt.blobs.set(`${record.tenantId}/${record.fileId}`, blob),
    }),
  };
}
