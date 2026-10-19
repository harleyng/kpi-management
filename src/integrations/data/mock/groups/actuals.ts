import type { Goal, GoalActual, Id, ImportBatch, ImportType, SyncRun } from '@/data/types';
import type { ActualFilter, ActualsGateway, EvidenceFilter, RecordActualInput, StageImportInput } from '../../types';
import { actualIssues, currentActual, isEvidenceUrl, isResultFinalised, syncKeepsHumanActual, syncRunStatus } from '@/lib/actualRules';
import { DEFAULT_MAX_ROWS, batchCounts, canCommitImport, canRejectImport } from '@/lib/importRules';
import { issueText, KpiError, ruleIssue, toKpiError } from '@/lib/errorCatalog';
import { todayOf } from '@/lib/isoDate';
import { removeRow } from '../integrity';
import { eqOpt, inList, newId, upsert } from '../rows';
import { clockOf, goalResource } from '../authorize';
import { writeActualSnapshot } from '../actualWrites';
import { simulatedErpReading } from '../erpSaleSimulator';
import { importHandler } from '../imports';
import { refOrInvalid } from '../workflowContext';
import type { Runtime } from '../runtime';
import type { Tx } from '../store';

/** The rule input for one (goal, period) — what `recordActual`, an import row and a sync reading all check. */
function entryContext(tx: Tx, goal: Goal, periodId: Id) {
  const period = tx.get('CyclePeriod', periodId);
  const plan = tx.get('GoalPlan', goal.goalPlanId);
  return {
    goal,
    planStatus: plan.status,
    goalCycleId: plan.cycleId,
    period,
    resultsFinalised: isResultFinalised(tx.all('PeriodResult'), plan.id, period.id),
    asOf: todayOf(clockOf(tx)),
  };
}

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
    /**
     * The simulated ERP Sale connector for one month (WBS 4.4.5, BR-KPI-56). The connection and the
     * period name rows of the tenant (another tenant's answers ERR-KPI-02 like a missing one); an
     * Inactive connection refuses with 04 and records NO run (nothing ran); a Quarter / Half / Year is
     * 06 (actuals are monthly, `ASSUMPTION Q22`). Then, for each Active goal of the period's cycle
     * whose KPI the connection maps and whose source IS this connection's: a goal holding a person's
     * number is skipped (`ASSUMPTION Q23`); else the ERP's reading is checked by `actualIssues` and
     * recorded (API) or logged as an error. One run row, started = finished = now; its status from
     * `syncRunStatus`.
     */
    runSync: rt.write('actuals.runSync', { permission: 'actual.import' }, (tx, connectionId: Id, periodId: Id) => {
      const connection = tx.get('IntegrationConnection', connectionId);
      const period = tx.get('CyclePeriod', periodId);
      if (connection.status !== 'Active') throw toKpiError([ruleIssue('ERR-KPI-04', 'connectionId', 'CONNECTION_INACTIVE')]);
      if (period.periodType !== 'Month') throw toKpiError([ruleIssue('ERR-KPI-06', 'periodId', 'PERIOD_NOT_MONTH')]);

      const mappedKpis = new Set(tx.all('DataMapping').filter((m) => m.connectionId === connection.id).map((m) => m.kpiDefId));
      const cyclePlans = new Map(tx.all('GoalPlan').filter((p) => p.cycleId === period.cycleId).map((p) => [p.id, p]));
      const goals = tx
        .all('Goal')
        .filter((g) => g.status === 'Active' && g.kpiDefId !== null && mappedKpis.has(g.kpiDefId) && g.dataSourceId === connection.dataSourceId && cyclePlans.has(g.goalPlanId))
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      const employees = new Map(tx.all('Employee').map((e) => [e.id, e.employeeCode]));
      const units = new Map(tx.all('OrgUnit').map((u) => [u.id, u.code]));
      const kpis = new Map(tx.all('KpiDefinition').map((k) => [k.id, k]));
      const periodTargets = tx.all('GoalPeriodTarget').filter((t) => t.periodId === period.id);
      const actuals = tx.all('GoalActual').filter((a) => a.periodId === period.id && a.isCurrent);
      const runId = newId();

      const log: string[] = [];
      const loaded: Id[] = [];
      let errors = 0;
      let skipped = 0;
      const line = (goal: Goal, detail: string) => {
        const plan = cyclePlans.get(goal.goalPlanId);
        const owner = goal.ownerEmployeeId ? employees.get(goal.ownerEmployeeId) : plan?.ownerOrgUnitId ? units.get(plan.ownerOrgUnitId) : null;
        log.push(`${owner ?? 'Công ty'} · ${kpis.get(goal.kpiDefId as Id)?.code ?? goal.name}: ${issueText(detail)}`);
      };
      for (const goal of goals) {
        if (syncKeepsHumanActual(currentActual(actuals, goal.id, period.id))) {
          skipped++;
          line(goal, 'HUMAN_ACTUAL_KEPT');
          continue;
        }
        const reading = simulatedErpReading({
          goal,
          periodId: period.id,
          periodTargets,
          aggregation: kpis.get(goal.kpiDefId as Id)?.aggregation ?? null,
          methodType: tx.get('CalcMethod', goal.calcMethodId).methodType,
        });
        if (reading === null) {
          skipped++;
          line(goal, 'NO_PERIOD_TARGET');
          continue;
        }
        const issues = actualIssues({ actual: reading, ...entryContext(tx, goal, period.id) });
        if (issues.length > 0) {
          errors++;
          line(goal, issues[0].detail as string);
          continue;
        }
        writeActualSnapshot(tx, { goalId: goal.id, periodId: period.id, ...reading, note: null, sourceType: 'API', batchId: null, syncRunId: runId, enteredBy: null });
        loaded.push(goal.id);
      }
      if (goals.length === 0) log.push(issueText('NO_MAPPED_GOAL'));

      const run: SyncRun = {
        id: runId,
        tenantId: tx.tenantId,
        connectionId: connection.id,
        periodId: period.id,
        startedAt: tx.now,
        finishedAt: tx.now,
        recordsOk: loaded.length,
        recordsError: errors,
        status: syncRunStatus(loaded.length, errors, skipped),
        errorLog: log.length > 0 ? log.join('\n') : null,
      };
      tx.insert('SyncRun', run);
      if (loaded.length > 0) {
        tx.emit({ type: 'actuals.recorded', periodId: period.id, goalIds: loaded, sourceType: 'API', batchId: null, syncRunId: runId });
      }
      return run;
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
      // The same rule checks every row of an Excel import and every API reading.
      const issues = actualIssues({ actual: { actualValue: input.actualValue, actualText: input.actualText }, ...entryContext(tx, goal, input.periodId) });
      if (issues.length > 0) throw toKpiError(issues);
      const row: GoalActual = writeActualSnapshot(tx, {
        goalId: input.goalId,
        periodId: input.periodId,
        actualValue: input.actualValue,
        actualText: input.actualText === null || input.actualText.trim() === '' ? null : input.actualText.trim(),
        note: input.note === null || input.note.trim() === '' ? null : input.note.trim(),
        sourceType: 'MANUAL',
        batchId: null,
        syncRunId: null,
        enteredBy: tx.ctx.actorUserId,
      });
      tx.emit({ type: 'actuals.recorded', periodId: input.periodId, goalIds: [input.goalId], sourceType: 'MANUAL', batchId: null, syncRunId: null });
      return row;
    }),

    listImportBatches: rt.read('actuals.listImportBatches', (tx, importType?: ImportType) =>
      tx
        .all('ImportBatch')
        .filter((b) => eqOpt(importType, b.importType))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    ),
    getImportBatch: rt.read('actuals.getImportBatch', (tx, batchId: Id) => tx.get('ImportBatch', batchId)),
    /**
     * Stages parsed rows (BR-KPI-54): the file and the cycle must be the tenant's (06, worded like a
     * missing id), 1…5000 rows; the type's handler validates every row against the tenant's data and
     * the batch is stored Validating WITH its rows and row errors, so the preview and the commit read
     * exactly what was uploaded. Nothing is applied.
     */
    stageImport: rt.write('actuals.stageImport', { permission: 'actual.import' }, (tx, input: StageImportInput) => {
      const handler = importHandler(input.importType);
      refOrInvalid(tx, 'FileObject', input.fileId, 'stageImport.fileId');
      if (input.importType === 'Actual' || input.importType === 'GoalPlan') refOrInvalid(tx, 'PerformanceCycle', input.cycleId, 'stageImport.cycleId');
      if (input.rows.length === 0 || input.rows.length > DEFAULT_MAX_ROWS) {
        throw new KpiError('ERR-KPI-06', `stageImport: ${input.rows.length} rows (1…${DEFAULT_MAX_ROWS} accepted)`);
      }
      const errors = (handler.validate as (tx: Tx, input: StageImportInput) => ReturnType<typeof handler.validate>)(tx, input);
      const batch = {
        id: newId(),
        tenantId: tx.tenantId,
        importType: input.importType,
        cycleId: input.cycleId,
        fileId: input.fileId,
        uploadedBy: tx.ctx.actorUserId as Id,
        rows: [...input.rows],
        ...batchCounts(input.rows.length, errors),
        errors,
        status: 'Validating',
        createdAt: tx.now,
      } as ImportBatch;
      return tx.insert('ImportBatch', batch);
    }),
    /**
     * Applies a staged batch whole or not at all (BR-KPI-54): only a Validating batch without row
     * errors (`canCommitImport`, else 04); the rows are re-validated against the data as it is now
     * and any that no longer passes refuses the commit (04, the row issues attached) with NOTHING
     * written — the batch keeps its status, rows and errors.
     */
    commitImport: rt.write('actuals.commitImport', { permission: 'actual.import' }, (tx, batchId: Id) => {
      const batch = tx.get('ImportBatch', batchId);
      const decision = canCommitImport(batch);
      if (!decision.ok) throw new KpiError(decision.code, `import batch ${batchId} is ${batch.status} with ${batch.rowsError} row error(s)`);
      (importHandler(batch.importType).apply as (tx: Tx, batch: ImportBatch) => void)(tx, batch);
      return tx.update('ImportBatch', { ...batch, status: 'Committed' });
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
        )
        .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1)),
    ),
    /**
     * A file or an http(s) link backing a goal's result (BR-KPI-57): a link must be http(s) (06
     * EVIDENCE_URL_INVALID); a period must belong to the goal's cycle (06 PERIOD_NOT_IN_CYCLE). A
     * reference to another tenant's row is left to the integrity check (06, like a missing one).
     */
    addEvidence: rt.write('actuals.addEvidence', { permission: 'evidence.upload', resource: (tx, input) => goalResource(tx, input.goalId) }, (tx, input: Parameters<ActualsGateway['addEvidence']>[2]) => {
      const url = input.url === null || input.url.trim() === '' ? null : input.url.trim();
      if (url !== null && !isEvidenceUrl(url)) throw toKpiError([ruleIssue('ERR-KPI-06', 'url', 'EVIDENCE_URL_INVALID')]);
      const goal = tx.find('Goal', input.goalId);
      const period = input.periodId ? tx.find('CyclePeriod', input.periodId) : undefined;
      const plan = goal ? tx.find('GoalPlan', goal.goalPlanId) : undefined;
      if (period && plan && period.cycleId !== plan.cycleId) throw toKpiError([ruleIssue('ERR-KPI-06', 'periodId', 'PERIOD_NOT_IN_CYCLE')]);
      const note = input.note === null || input.note.trim() === '' ? null : input.note.trim();
      const payload = { ...input, url, note, id: undefined };
      return upsert(tx, 'Evidence', payload, {
        create: () => ({ uploadedBy: tx.ctx.actorUserId as Id, uploadedAt: tx.now }),
      });
    }),
    deleteEvidence: rt.write('actuals.deleteEvidence', { permission: 'evidence.upload', resource: (tx, evidenceId) => goalResource(tx, tx.find('Evidence', evidenceId)?.goalId) }, (tx, evidenceId: Id) => {
      removeRow(tx, 'Evidence', evidenceId);
    }),
  };
}
