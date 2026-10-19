import type { GoalActual, Id, ImportType } from '@/data/types';
import type { ActualFilter, ActualsGateway, EvidenceFilter, RecordActualInput } from '../../types';
import { actualIssues, canRejectImport, isResultFinalised } from '@/lib/actualRules';
import { KpiError, toKpiError } from '@/lib/errorCatalog';
import { todayOf } from '@/lib/isoDate';
import { removeRow } from '../integrity';
import { eqOpt, inList, newId, upsert } from '../rows';
import { clockOf, goalResource } from '../authorize';
import type { Runtime } from '../runtime';

export function actualsGroup(rt: Runtime): ActualsGateway {
  return {
    listDataSources: rt.read('actuals.listDataSources', (tx) => tx.all('DataSource')),
    saveDataSource: rt.write('actuals.saveDataSource', { permission: 'datasource.manage' }, (tx, input: Parameters<ActualsGateway['saveDataSource']>[2]) =>
      upsert(tx, 'DataSource', input, { create: () => ({}) }),
    ),

    listConnections: rt.read('actuals.listConnections', (tx) => tx.all('IntegrationConnection')),
    saveConnection: rt.write('actuals.saveConnection', { permission: 'datasource.manage' }, (tx, input: Parameters<ActualsGateway['saveConnection']>[2]) =>
      upsert(tx, 'IntegrationConnection', input, { create: () => ({}) }),
    ),
    listMappings: rt.read('actuals.listMappings', (tx, connectionId?: Id) =>
      tx.all('DataMapping').filter((m) => eqOpt(connectionId, m.connectionId)),
    ),
    saveMapping: rt.write('actuals.saveMapping', { permission: 'datasource.manage' }, (tx, input: Parameters<ActualsGateway['saveMapping']>[2]) =>
      upsert(tx, 'DataMapping', input, { create: () => ({}) }),
    ),
    deleteMapping: rt.write('actuals.deleteMapping', { permission: 'datasource.manage' }, (tx, mappingId: Id) => {
      removeRow(tx, 'DataMapping', mappingId);
    }),
    listSyncRuns: rt.read('actuals.listSyncRuns', (tx, connectionId?: Id) =>
      tx
        .all('SyncRun')
        .filter((r) => eqOpt(connectionId, r.connectionId))
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)),
    ),
    runSync: rt.deferred('actuals.runSync', 'write', 'T4 4.4.5 (the simulated ERP Sale connector)', {
      track: 'T4',
      auth: { permission: 'actual.import' },
    }),

    listActuals: rt.read('actuals.listActuals', (tx, filter: ActualFilter = {}) => {
      const currentOnly = filter.currentOnly ?? true;
      return tx
        .all('GoalActual')
        .filter(
          (a) =>
            inList(filter.goalIds, a.goalId) &&
            eqOpt(filter.periodId, a.periodId) &&
            eqOpt(filter.sourceType, a.sourceType) &&
            (!currentOnly || a.isCurrent),
        )
        .sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : 1));
    }),
    recordActual: rt.write('actuals.recordActual', { permission: 'actual.enter', resource: (tx, input) => goalResource(tx, input.goalId) }, (tx, input: RecordActualInput) => {
      const goal = tx.get('Goal', input.goalId);
      const period = tx.get('CyclePeriod', input.periodId);
      const plan = tx.get('GoalPlan', goal.goalPlanId);
      // The same rule checks every row of an Excel import (T4).
      const issues = actualIssues({
        actual: { actualValue: input.actualValue, actualText: input.actualText },
        goal,
        goalCycleId: plan.cycleId,
        period,
        resultsFinalised: isResultFinalised(tx.all('PeriodResult'), plan.id, period.id),
        asOf: todayOf(clockOf(tx)),
      });
      if (issues.length > 0) throw toKpiError(issues);
      // BR-KPI-52: a new snapshot; the previous current one is kept as history.
      for (const previous of tx.all('GoalActual')) {
        if (previous.goalId === input.goalId && previous.periodId === input.periodId && previous.isCurrent) {
          tx.update('GoalActual', { ...previous, isCurrent: false });
        }
      }
      const row: GoalActual = {
        id: newId(),
        tenantId: tx.tenantId,
        goalId: input.goalId,
        periodId: input.periodId,
        actualValue: input.actualValue,
        actualText: input.actualText,
        sourceType: 'MANUAL',
        batchId: null,
        syncRunId: null,
        enteredBy: tx.ctx.actorUserId,
        note: input.note,
        recordedAt: tx.now,
        isCurrent: true,
      };
      tx.emit({
        type: 'actuals.recorded',
        periodId: input.periodId,
        goalIds: [input.goalId],
        sourceType: 'MANUAL',
        batchId: null,
        syncRunId: null,
      });
      return tx.insert('GoalActual', row);
    }),

    listImportBatches: rt.read('actuals.listImportBatches', (tx, importType?: ImportType) =>
      tx
        .all('ImportBatch')
        .filter((b) => eqOpt(importType, b.importType))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    ),
    getImportBatch: rt.read('actuals.getImportBatch', (tx, batchId: Id) => tx.get('ImportBatch', batchId)),
    stageImport: rt.deferred('actuals.stageImport', 'write', 'T4 4.4.3 importRules (row validation)', {
      track: 'T4',
      auth: { permission: 'actual.import' },
    }),
    commitImport: rt.deferred('actuals.commitImport', 'write', 'T4 4.4.3 importRules (apply all rows or none)', {
      track: 'T4',
      auth: { permission: 'actual.import' },
    }),
    rejectImport: rt.write('actuals.rejectImport', { permission: 'actual.import' }, (tx, batchId: Id) => {
      const batch = tx.get('ImportBatch', batchId);
      const decision = canRejectImport(batch);
      if (!decision.ok) throw new KpiError(decision.code, `import batch ${batchId} is ${batch.status}`);
      return tx.update('ImportBatch', { ...batch, status: 'Rejected' });
    }),

    listEvidence: rt.read('actuals.listEvidence', (tx, filter: EvidenceFilter = {}) =>
      tx
        .all('Evidence')
        .filter(
          (e) =>
            eqOpt(filter.goalId, e.goalId) &&
            (filter.periodId === undefined || e.periodId === filter.periodId) &&
            (filter.actualId === undefined || e.actualId === filter.actualId),
        ),
    ),
    addEvidence: rt.write('actuals.addEvidence', { permission: 'evidence.upload', resource: (tx, input) => goalResource(tx, input.goalId) }, (tx, input: Parameters<ActualsGateway['addEvidence']>[2]) =>
      upsert(tx, 'Evidence', { ...input, id: undefined }, {
        create: () => ({ uploadedBy: tx.ctx.actorUserId as Id, uploadedAt: tx.now }),
      }),
    ),
    deleteEvidence: rt.write('actuals.deleteEvidence', { permission: 'evidence.upload', resource: (tx, evidenceId) => goalResource(tx, tx.find('Evidence', evidenceId)?.goalId) }, (tx, evidenceId: Id) => {
      removeRow(tx, 'Evidence', evidenceId);
    }),
  };
}
