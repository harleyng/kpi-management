import { describe, expect, it } from 'vitest';
import { SYNTRA } from '@/data/fixtures';
import type { ActualImportRow, Goal } from '@/data/types';
import { KpiDeferredError } from '@/lib/errorCatalog';
import type { DataGateway, DomainEvent } from '../types';
import { flush, newGateway, rejection } from './gateway.test-util';

/**
 * Track T4 on the mock — the batch import (WBS 4.4.3), manual entry (4.4.2), the simulated ERP Sale
 * sync (4.4.5) and evidence (4.4.6), against the seed (now = 2027-04-06; T01/T02 locked, T03 and T04
 * open, T05 not started; the 2027 staff plans Locked bar the four HR reopened on 04-05).
 */

const S = SYNTRA.tenantId;
const hr = SYNTRA.user(SYNTRA.personas.hr);
const cnb = SYNTRA.user(SYNTRA.personas.cnb);
const admin = SYNTRA.user(SYNTRA.personas.admin);
const employee = SYNTRA.user(SYNTRA.personas.employee);
const manager = SYNTRA.user(SYNTRA.personas.manager);
const cycle = SYNTRA.id('PerformanceCycle', '2027');
const period = (label: string) => SYNTRA.id('CyclePeriod', 2027, label);
const T03 = period('T03');
const erp = SYNTRA.id('IntegrationConnection', 'ERP_SALE');
const crmBatch = SYNTRA.id('ImportBatch', 'T03-crm');

async function goalsOf(gw: DataGateway, employeeCode: string): Promise<Goal[]> {
  const plans = await gw.goals.listGoalPlans(S, { cycleId: cycle, ownerEmployeeIds: [SYNTRA.employee(employeeCode)] });
  return (await gw.goals.listGoals(S, { goalPlanIds: plans.map((p) => p.id), status: 'Active' })).sort((a, b) => a.sortOrder - b.sortOrder);
}
const numericGoalsOf = async (gw: DataGateway, code: string) => (await goalsOf(gw, code)).filter((g) => g.targetType === 'NUMERIC');

const row = (goal: Goal, o: Partial<ActualImportRow> = {}): ActualImportRow => ({
  rowNo: 2, goalId: goal.id, login: null, kpiCode: null, periodLabel: 'T03', actualValue: 123, actualText: null, note: null, evidenceUrl: null, ...o,
});
const upload = async (gw: DataGateway, actor = hr) => (await gw.system.uploadFile(S, actor, { fileName: 'so-lieu-T03.xlsx', mimeType: 'application/octet-stream', data: new Blob(['x']) })).id;
const stage = async (gw: DataGateway, rows: ActualImportRow[], actor = hr) =>
  gw.actuals.stageImport(S, actor, { importType: 'Actual', fileId: await upload(gw), cycleId: cycle, rows });

function recordEvents(gw: DataGateway): DomainEvent[] {
  const events: DomainEvent[] = [];
  gw.events.subscribe(S, (e) => {
    events.push(e);
  });
  return events;
}

describe('actuals.recordActual (WBS 4.4.2) — the matrix and the rules', () => {
  it('HR records a snapshot; the previous current one is kept as history (BR-KPI-52)', async () => {
    const { gateway } = newGateway();
    const t0 = gateway.clock.now();
    const [goal] = await numericGoalsOf(gateway, 'E016');
    const before = await gateway.actuals.listActuals(S, { goalIds: [goal.id], periodId: T03 });
    const saved = await gateway.actuals.recordActual(S, hr, { goalId: goal.id, periodId: T03, actualValue: 0, actualText: null, note: '  Đối soát  ' });
    expect(saved).toMatchObject({ sourceType: 'MANUAL', enteredBy: hr, actualValue: 0, note: 'Đối soát', isCurrent: true });
    expect(saved.recordedAt >= t0 && saved.recordedAt <= gateway.clock.now()).toBe(true);
    const history = await gateway.actuals.listActuals(S, { goalIds: [goal.id], periodId: T03, currentOnly: false });
    expect(history.filter((a) => a.isCurrent)).toEqual([saved]);
    expect(history).toHaveLength(before.length + 1);
  });

  it('an employee cannot enter actuals (ASSUMPTION Q19); a manager can, within their unit only', async () => {
    const { gateway } = newGateway();
    const [own] = await numericGoalsOf(gateway, 'E016');
    const input = { goalId: own.id, periodId: T03, actualValue: 1, actualText: null, note: null };
    expect((await rejection(gateway.actuals.recordActual(S, employee, input))).code).toBe('ERR-KPI-05');
    await expect(gateway.actuals.recordActual(S, manager, input)).resolves.toMatchObject({ enteredBy: manager });
    const [elsewhere] = await numericGoalsOf(gateway, 'E022'); // CSKH, outside the KD manager's unit
    expect((await rejection(gateway.actuals.recordActual(S, manager, { ...input, goalId: elsewhere.id }))).code).toBe('ERR-KPI-05');
  });

  it('refuses a goal of a plan HR reopened (PLAN_NOT_APPROVED, Q21) and a quarter (PERIOD_NOT_MONTH, Q22)', async () => {
    const { gateway } = newGateway();
    const [reopened] = await numericGoalsOf(gateway, 'E017'); // Submitted since HR's unlock on 04-05
    const refused = await rejection(gateway.actuals.recordActual(S, hr, { goalId: reopened.id, periodId: T03, actualValue: 1, actualText: null, note: null }));
    expect([refused.code, refused.issues.map((i) => i.detail)]).toEqual(['ERR-KPI-04', ['PLAN_NOT_APPROVED']]);
    const [goal] = await numericGoalsOf(gateway, 'E016');
    const quarter = await rejection(gateway.actuals.recordActual(S, hr, { goalId: goal.id, periodId: period('Q1'), actualValue: 1, actualText: null, note: null }));
    expect(quarter.issues.map((i) => i.detail)).toContain('PERIOD_NOT_MONTH');
  });
});

describe('the batch import (WBS 4.4.3, BR-KPI-54)', () => {
  it('stages rows as Validating, by the actor, at the clock — nothing applied yet', async () => {
    const { gateway } = newGateway();
    const [g1, g2] = await numericGoalsOf(gateway, 'E016');
    const actualsBefore = await gateway.actuals.listActuals(S, { currentOnly: false });
    const batch = await stage(gateway, [row(g1), row(g2, { rowNo: 3 })]);
    expect(batch).toMatchObject({ importType: 'Actual', status: 'Validating', uploadedBy: hr, rowsTotal: 2, rowsError: 0, errors: [] });
    expect(await gateway.actuals.listActuals(S, { currentOnly: false })).toEqual(actualsBefore);
    expect(batch.createdAt <= gateway.clock.now()).toBe(true);
    expect(await gateway.actuals.getImportBatch(S, batch.id)).toEqual(batch);
  });

  it('commits all rows: EXCEL snapshots by the actor with the batch id, history kept, evidence only for a link, one event per period', async () => {
    const { gateway } = newGateway();
    const events = recordEvents(gateway);
    const [g1, g2] = await numericGoalsOf(gateway, 'E016');
    const batch = await stage(gateway, [
      row(g1, { note: 'Theo báo cáo' }),
      row(g2, { rowNo: 3, actualValue: -5, evidenceUrl: 'https://drive.example/bao-cao' }),
      row(g1, { rowNo: 4, periodLabel: 'T04', actualValue: 7 }),
    ]);
    const evidenceBefore = await gateway.actuals.listEvidence(S);
    const committed = await gateway.actuals.commitImport(S, hr, batch.id);
    expect(committed.status).toBe('Committed');
    const current = await gateway.actuals.listActuals(S, { goalIds: [g1.id, g2.id] });
    const of = (goalId: string, periodId: string) => current.find((a) => a.goalId === goalId && a.periodId === periodId);
    expect(of(g1.id, T03)).toMatchObject({ actualValue: 123, sourceType: 'EXCEL', batchId: batch.id, enteredBy: hr, note: 'Theo báo cáo' });
    expect(of(g2.id, T03)).toMatchObject({ actualValue: -5, sourceType: 'EXCEL' });
    expect(of(g1.id, period('T04'))).toMatchObject({ actualValue: 7 });
    const history = await gateway.actuals.listActuals(S, { goalIds: [g1.id], periodId: T03, currentOnly: false });
    expect(history.filter((a) => a.isCurrent)).toHaveLength(1);
    const evidence = await gateway.actuals.listEvidence(S);
    expect(evidence).toHaveLength(evidenceBefore.length + 1);
    expect(evidence.find((e) => e.url === 'https://drive.example/bao-cao')).toMatchObject({ goalId: g2.id, periodId: T03, actualId: of(g2.id, T03)?.id, uploadedBy: hr });
    await flush();
    const recorded = events.filter((e) => e.type === 'actuals.recorded');
    expect(recorded.map((e) => (e.type === 'actuals.recorded' ? [e.periodId, e.sourceType, e.batchId, [...e.goalIds].sort()] : null))).toEqual([
      [T03, 'EXCEL', batch.id, [g1.id, g2.id].sort()],
      [period('T04'), 'EXCEL', batch.id, [g1.id]],
    ]);
  });

  it('a batch with row errors is stored with them and cannot be committed (04); it stays as it was', async () => {
    const { gateway } = newGateway();
    const [g1] = await numericGoalsOf(gateway, 'E016');
    const batch = await stage(gateway, [row(g1), row(g1, { rowNo: 3, periodLabel: 'T01' }), row(g1, { rowNo: 4, goalId: null })]);
    expect(batch.errors.map((e) => `${e.rowNo} ${e.detail}`)).toEqual(['3 PERIOD_LOCKED', '3 RESULT_FINAL', '4 GOAL_KEY_REQUIRED']);
    expect(batch.rowsError).toBe(2);
    expect((await rejection(gateway.actuals.commitImport(S, hr, batch.id))).code).toBe('ERR-KPI-04');
    expect(await gateway.actuals.getImportBatch(S, batch.id)).toEqual(batch);
  });

  it('re-validates at commit: a period locked since staging refuses the whole batch and writes nothing', async () => {
    const { gateway } = newGateway();
    const [g1, g2] = await numericGoalsOf(gateway, 'E016');
    const batch = await stage(gateway, [row(g2, { periodLabel: 'T04' }), row(g1, { rowNo: 3 })]);
    expect(batch.rowsError).toBe(0);
    await gateway.goals.setPeriodLocked(S, hr, T03, true);
    const actualsBefore = await gateway.actuals.listActuals(S, { currentOnly: false });
    const evidenceBefore = await gateway.actuals.listEvidence(S);
    const refused = await rejection(gateway.actuals.commitImport(S, hr, batch.id));
    expect(refused.code).toBe('ERR-KPI-04');
    expect(refused.issues.map((i) => [i.ref, i.detail])).toEqual([['row:3', 'PERIOD_LOCKED']]);
    expect(await gateway.actuals.getImportBatch(S, batch.id)).toEqual(batch);
    expect(await gateway.actuals.listActuals(S, { currentOnly: false })).toEqual(actualsBefore); // not even the valid T04 row
    expect(await gateway.actuals.listEvidence(S)).toEqual(evidenceBefore);
  });

  it('the seeded CRM batch: commit refused, reject once, then neither again; a committed batch is final', async () => {
    const { gateway } = newGateway();
    expect((await rejection(gateway.actuals.commitImport(S, hr, crmBatch))).code).toBe('ERR-KPI-04');
    expect((await gateway.actuals.rejectImport(S, hr, crmBatch)).status).toBe('Rejected');
    expect((await rejection(gateway.actuals.rejectImport(S, hr, crmBatch))).code).toBe('ERR-KPI-04');
    expect((await rejection(gateway.actuals.commitImport(S, hr, crmBatch))).code).toBe('ERR-KPI-04');
    const [g1] = await numericGoalsOf(gateway, 'E016');
    const batch = await stage(gateway, [row(g1)]);
    await gateway.actuals.commitImport(S, hr, batch.id);
    expect((await rejection(gateway.actuals.commitImport(S, hr, batch.id))).code).toBe('ERR-KPI-04');
    expect((await rejection(gateway.actuals.rejectImport(S, hr, batch.id))).code).toBe('ERR-KPI-04');
  });

  it('refuses 0 rows, a missing cycle and a missing file (06); the other tracks\' types are deferred', async () => {
    const { gateway } = newGateway();
    const fileId = await upload(gateway);
    const [g1] = await numericGoalsOf(gateway, 'E016');
    expect((await rejection(gateway.actuals.stageImport(S, hr, { importType: 'Actual', fileId, cycleId: cycle, rows: [] }))).code).toBe('ERR-KPI-06');
    expect((await rejection(gateway.actuals.stageImport(S, hr, { importType: 'Actual', fileId, cycleId: null, rows: [row(g1)] }))).code).toBe('ERR-KPI-06');
    expect((await rejection(gateway.actuals.stageImport(S, hr, { importType: 'Actual', fileId: 'nope', cycleId: cycle, rows: [row(g1)] }))).code).toBe('ERR-KPI-06');
    for (const importType of ['GoalPlan', 'OrgData', 'Library'] as const) {
      const error = await rejection(gateway.actuals.stageImport(S, hr, { importType, fileId, cycleId: cycle, rows: [{}] } as never));
      expect(error, importType).toBeInstanceOf(KpiDeferredError);
      expect((error as KpiDeferredError).method).toBe(`actuals.stageImport:${importType}`);
    }
  });

  it('who may import: HR, C&B and Admin; C&B uploads the file through their EMPLOYEE role (BR-KPI-62); an employee cannot import', async () => {
    const { gateway } = newGateway();
    const [g1] = await numericGoalsOf(gateway, 'E016');
    await expect(upload(gateway, cnb)).resolves.toBeTypeOf('string');
    await expect(stage(gateway, [row(g1)], cnb)).resolves.toMatchObject({ uploadedBy: cnb });
    await expect(stage(gateway, [row(g1)], admin)).resolves.toMatchObject({ status: 'Validating' });
    const fileId = await upload(gateway);
    expect((await rejection(gateway.actuals.stageImport(S, employee, { importType: 'Actual', fileId, cycleId: cycle, rows: [row(g1)] }))).code).toBe('ERR-KPI-05');
    expect((await rejection(gateway.actuals.commitImport(S, employee, crmBatch))).code).toBe('ERR-KPI-05');
    expect((await rejection(gateway.actuals.rejectImport(S, employee, crmBatch))).code).toBe('ERR-KPI-05');
    expect((await rejection(gateway.actuals.runSync(S, employee, erp, T03))).code).toBe('ERR-KPI-05');
    // a manager enters by hand but does not import or sync (actual.import is HR / C&B / Admin)
    expect((await rejection(gateway.actuals.stageImport(S, manager, { importType: 'Actual', fileId, cycleId: cycle, rows: [row(g1)] }))).code).toBe('ERR-KPI-05');
    expect((await rejection(gateway.actuals.runSync(S, manager, erp, T03))).code).toBe('ERR-KPI-05');
  });
});

describe('actuals.runSync — the simulated ERP Sale connector (WBS 4.4.5, BR-KPI-56)', () => {
  const erpGoals = async (gw: DataGateway) => {
    const erpSource = (await gw.actuals.listDataSources(S)).find((d) => d.code === 'ERP_SALE');
    return (await gw.goals.listGoals(S, { status: 'Active' })).filter((g) => g.dataSourceId === erpSource?.id);
  };

  it('T03: replaces the 06:00 API readings, writes no author, records one run and announces it', async () => {
    const { gateway } = newGateway();
    const events = recordEvents(gateway);
    const run = await gateway.actuals.runSync(S, hr, erp, T03);
    expect(run).toMatchObject({ connectionId: erp, periodId: T03 });
    expect(run.finishedAt).toBe(run.startedAt);
    expect(run.recordsOk).toBeGreaterThan(0);
    expect(['Succeeded', 'PartiallyFailed']).toContain(run.status);
    const loaded = await gateway.actuals.listActuals(S, { periodId: T03, sourceType: 'API' });
    const fresh = loaded.filter((a) => a.syncRunId === run.id);
    expect(fresh).toHaveLength(run.recordsOk);
    expect(fresh.every((a) => a.enteredBy === null && a.isCurrent)).toBe(true);
    expect((await gateway.actuals.listSyncRuns(S, erp))[0]).toEqual(run);
    await flush();
    expect(events.filter((e) => e.type === 'actuals.recorded' && e.syncRunId === run.id)).toHaveLength(1);
  });

  it('the plans HR reopened refuse their readings: logged as errors (the run is PartiallyFailed)', async () => {
    const { gateway } = newGateway();
    const run = await gateway.actuals.runSync(S, hr, erp, T03);
    expect(run.recordsError).toBeGreaterThan(0); // E017, E021, E030 — reopened on 04-05
    expect(run.status).toBe('PartiallyFailed');
    expect(run.errorLog).toContain('Kế hoạch mục tiêu chưa được duyệt hoặc khóa');
  });

  it('never overwrites a person\'s number: a goal with a manual T03 actual is skipped and logged (Q23)', async () => {
    const { gateway } = newGateway();
    const goals = await erpGoals(gateway);
    const plans = await gateway.goals.listGoalPlans(S, { cycleId: cycle, status: 'Locked' });
    const target = goals.find((g) => g.targetType === 'NUMERIC' && plans.some((p) => p.id === g.goalPlanId)) as Goal;
    const manual = await gateway.actuals.recordActual(S, hr, { goalId: target.id, periodId: T03, actualValue: 42, actualText: null, note: null });
    const run = await gateway.actuals.runSync(S, hr, erp, T03);
    const [current] = await gateway.actuals.listActuals(S, { goalIds: [target.id], periodId: T03 });
    expect(current).toEqual(manual);
    expect(run.errorLog).toContain('Đã có số nhập tay hoặc Excel');
  });

  it('is deterministic: the same month synced twice reads the same numbers', async () => {
    const { gateway } = newGateway();
    const first = await gateway.actuals.runSync(S, hr, erp, T03);
    const values = async (runId: string) =>
      (await gateway.actuals.listActuals(S, { periodId: T03, currentOnly: false })).filter((a) => a.syncRunId === runId).map((a) => [a.goalId, a.actualValue, a.actualText]).sort();
    const a = await values(first.id);
    const second = await gateway.actuals.runSync(S, hr, erp, T03);
    expect(await values(second.id)).toEqual(a);
  });

  it('a locked month (T01) and a month not started (T05) fail with nothing loaded', async () => {
    const { gateway } = newGateway();
    const before = await gateway.actuals.listActuals(S, { currentOnly: false });
    for (const label of ['T01', 'T05']) {
      const run = await gateway.actuals.runSync(S, hr, erp, period(label));
      expect([label, run.status, run.recordsOk]).toEqual([label, 'Failed', 0]);
      expect(run.recordsError).toBeGreaterThan(0);
      expect(run.errorLog).toContain(label === 'T01' ? 'Kỳ đã khóa số liệu.' : 'Kỳ chưa bắt đầu.');
    }
    expect(await gateway.actuals.listActuals(S, { currentOnly: false })).toEqual(before);
  });

  it('a quarter is refused (06); an Inactive connection is refused (04) and records no run', async () => {
    const { gateway } = newGateway();
    expect((await rejection(gateway.actuals.runSync(S, hr, erp, period('Q1')))).issues.map((i) => i.detail)).toEqual(['PERIOD_NOT_MONTH']);
    const connection = (await gateway.actuals.listConnections(S)).find((c) => c.id === erp);
    await gateway.actuals.saveConnection(S, admin, { ...connection!, status: 'Inactive' });
    const runsBefore = await gateway.actuals.listSyncRuns(S, erp);
    const refused = await rejection(gateway.actuals.runSync(S, hr, erp, T03));
    expect([refused.code, refused.issues.map((i) => i.detail)]).toEqual(['ERR-KPI-04', ['CONNECTION_INACTIVE']]);
    expect(await gateway.actuals.listSyncRuns(S, erp)).toEqual(runsBefore);
  });

  it('a connection with no mapping finds nothing to load: a Failed run saying so', async () => {
    const { gateway } = newGateway();
    for (const m of await gateway.actuals.listMappings(S, erp)) await gateway.actuals.deleteMapping(S, admin, m.id);
    const run = await gateway.actuals.runSync(S, hr, erp, T03);
    expect([run.status, run.recordsOk, run.recordsError, run.errorLog]).toEqual(['Failed', 0, 0, 'Không có chỉ tiêu nào khớp ánh xạ của kết nối trong kỳ này.']);
  });

  it('only reads goals whose source IS the connection\'s source', async () => {
    const { gateway } = newGateway();
    const run = await gateway.actuals.runSync(S, hr, erp, T03);
    const ids = new Set((await erpGoals(gateway)).map((g) => g.id));
    const loaded = (await gateway.actuals.listActuals(S, { periodId: T03 })).filter((a) => a.syncRunId === run.id);
    expect(loaded.every((a) => ids.has(a.goalId))).toBe(true);
  });
});

describe('evidence (WBS 4.4.6, BR-KPI-57)', () => {
  it('the owner attaches a link to their goal for a period, and can delete it', async () => {
    const { gateway } = newGateway();
    const [goal] = await goalsOf(gateway, 'E016');
    const added = await gateway.actuals.addEvidence(S, employee, { goalId: goal.id, periodId: T03, actualId: null, fileId: null, url: ' https://drive.example/x ', note: '  ' });
    expect(added).toMatchObject({ url: 'https://drive.example/x', note: null, uploadedBy: employee });
    await gateway.actuals.deleteEvidence(S, employee, added.id);
    expect((await gateway.actuals.listEvidence(S, { goalId: goal.id })).some((e) => e.id === added.id)).toBe(false);
  });

  it('refuses a link that is not http(s), no file and no link, and a period of another cycle (06)', async () => {
    const { gateway } = newGateway();
    const [goal] = await goalsOf(gateway, 'E016');
    const base = { goalId: goal.id, periodId: T03, actualId: null, fileId: null, note: null };
    const bad = await rejection(gateway.actuals.addEvidence(S, hr, { ...base, url: 'ftp://files.example/a' }));
    expect([bad.code, bad.issues.map((i) => i.detail)]).toEqual(['ERR-KPI-06', ['EVIDENCE_URL_INVALID']]);
    expect((await rejection(gateway.actuals.addEvidence(S, hr, { ...base, url: null }))).code).toBe('ERR-KPI-06');
    const other = await rejection(gateway.actuals.addEvidence(S, hr, { ...base, periodId: SYNTRA.id('CyclePeriod', 2026, 'T03'), url: 'https://a.example' }));
    expect(other.issues.map((i) => i.detail)).toEqual(['PERIOD_NOT_IN_CYCLE']);
  });

  it('an employee cannot attach evidence to someone else\'s goal (05); an actual of another goal is refused (06)', async () => {
    const { gateway } = newGateway();
    const [mine] = await goalsOf(gateway, 'E016');
    const [theirs] = await goalsOf(gateway, 'E022');
    const base = { periodId: T03, actualId: null, fileId: null, url: 'https://a.example', note: null };
    expect((await rejection(gateway.actuals.addEvidence(S, employee, { ...base, goalId: theirs.id }))).code).toBe('ERR-KPI-05');
    const [otherActual] = await gateway.actuals.listActuals(S, { goalIds: [theirs.id] });
    expect((await rejection(gateway.actuals.addEvidence(S, hr, { ...base, goalId: mine.id, actualId: otherActual.id }))).code).toBe('ERR-KPI-06');
  });

  it('C&B cannot attach evidence (no evidence.upload)', async () => {
    const { gateway } = newGateway();
    const [goal] = await goalsOf(gateway, 'E016');
    expect((await rejection(gateway.actuals.addEvidence(S, cnb, { goalId: goal.id, periodId: T03, actualId: null, fileId: null, url: 'https://a.example', note: null }))).code).toBe('ERR-KPI-05');
  });
});
