import type { GoalActual, Id, ImportType } from '@/data/types';
import type { ActualFilter, ActualsGateway, EvidenceFilter, RecordActualInput } from '../../types';
import { removeRow } from '../integrity';
import { eqOpt, inList, newId, upsert } from '../rows';
import type { Runtime } from '../runtime';

export function actualsGroup(rt: Runtime): ActualsGateway {
  rt.pendingGuard(
    'actuals.recordActual',
    'T4 / Phase 1.5 actual rules: period not locked, goal Active and in the period\'s cycle, value vs text per the goal\'s target type',
  );
  rt.pendingGuard('actuals.rejectImport', 'T4 4.4.3 importRules: only a Validating batch can be rejected');

  return {
    listDataSources: rt.read('actuals.listDataSources', (tx) => tx.all('DataSource')),
    saveDataSource: rt.write('actuals.saveDataSource', (tx, input: Parameters<ActualsGateway['saveDataSource']>[2]) =>
      upsert(tx, 'DataSource', input, { create: () => ({}) }),
    ),

    listConnections: rt.read('actuals.listConnections', (tx) => tx.all('IntegrationConnection')),
    saveConnection: rt.write('actuals.saveConnection', (tx, input: Parameters<ActualsGateway['saveConnection']>[2]) =>
      upsert(tx, 'IntegrationConnection', input, { create: () => ({}) }),
    ),
    listMappings: rt.read('actuals.listMappings', (tx, connectionId?: Id) =>
      tx.all('DataMapping').filter((m) => eqOpt(connectionId, m.connectionId)),
    ),
    saveMapping: rt.write('actuals.saveMapping', (tx, input: Parameters<ActualsGateway['saveMapping']>[2]) =>
      upsert(tx, 'DataMapping', input, { create: () => ({}) }),
    ),
    deleteMapping: rt.write('actuals.deleteMapping', (tx, mappingId: Id) => {
      removeRow(tx, 'DataMapping', mappingId);
    }),
    listSyncRuns: rt.read('actuals.listSyncRuns', (tx, connectionId?: Id) =>
      tx
        .all('SyncRun')
        .filter((r) => eqOpt(connectionId, r.connectionId))
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)),
    ),
    runSync: rt.deferred('actuals.runSync', 'write', 'T4 4.4.5 (the simulated ERP Sale connector)'),

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
    recordActual: rt.write('actuals.recordActual', (tx, input: RecordActualInput) => {
      tx.get('Goal', input.goalId);
      tx.get('CyclePeriod', input.periodId);
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
    stageImport: rt.deferred('actuals.stageImport', 'write', 'T4 4.4.3 importRules (row validation)'),
    commitImport: rt.deferred('actuals.commitImport', 'write', 'T4 4.4.3 importRules (apply all rows or none)'),
    rejectImport: rt.write('actuals.rejectImport', (tx, batchId: Id) =>
      tx.update('ImportBatch', { ...tx.get('ImportBatch', batchId), status: 'Rejected' }),
    ),

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
    addEvidence: rt.write('actuals.addEvidence', (tx, input: Parameters<ActualsGateway['addEvidence']>[2]) =>
      upsert(tx, 'Evidence', { ...input, id: undefined }, {
        create: () => ({ uploadedBy: tx.ctx.actorUserId as Id, uploadedAt: tx.now }),
      }),
    ),
    deleteEvidence: rt.write('actuals.deleteEvidence', (tx, evidenceId: Id) => {
      removeRow(tx, 'Evidence', evidenceId);
    }),
  };
}
