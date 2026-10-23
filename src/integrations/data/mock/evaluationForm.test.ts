import { describe, expect, it } from 'vitest';
import { DEMO, SYNTRA } from '@/data/fixtures';
import { vn } from '@/data/fixtures/timeline';
import type { EvaluationItem, FormInstance, Id, PersonFormAction, RecipientFilter } from '@/data/types';
import type { DataGateway, EvaluationItemPatch } from '../types';
import { newGateway, rejection } from './gateway.test-util';

/**
 * Đợt 1 (PEND-06/07/08) through the mock gateway: the employee enters the actual on the form and the
 * system computes the %; the manager decides (a different % or a corrected actual needs a comment);
 * HR records the manager's result (a different one needs a reason); the completed form writes its
 * changed actuals as FORM actuals. Plus the quarter form's snapshots (PEND-04 leftover).
 */

const S = SYNTRA.tenantId;
const u = (code: string) => SYNTRA.user(code);
const emp = (code: string) => SYNTRA.employee(code);
const hr = u(SYNTRA.personas.hr);
const cycle2027 = SYNTRA.id('PerformanceCycle', '2027');
const T03 = SYNTRA.id('CyclePeriod', 2027, 'T03');
const formId = (key: string) => SYNTRA.id('FormInstance', key);
type Gw = DataGateway;

async function act(gw: Gw, actor: Id, id: Id, action: PersonFormAction, comment: string | null = null) {
  const form = await gw.forms.getForm(S, id);
  return gw.forms.act(S, actor, { formId: id, expectedStepId: form.currentStepId as Id, action, comment, onBehalfOfUserId: null, delegationId: null });
}
const items = (gw: Gw, id: Id) => gw.forms.listEvaluationItems(S, id);
const save = (gw: Gw, actor: Id, id: Id, patches: EvaluationItemPatch[]) => gw.forms.saveEvaluationItems(S, actor, id, patches);
const stepNo = async (gw: Gw, form: FormInstance) => (await gw.forms.listWorkflowSteps(S, form.workflowId)).find((s) => s.id === form.currentStepId)?.stepNo ?? null;
const explain = (list: EvaluationItem[]) => list.map((i) => ({ itemId: i.id, selfComment: 'Giải trình' }));
/** A numeric item whose method gives a % for a nearby actual (RATIO_UP with a target). */
const numericItem = (list: EvaluationItem[]) => list.find((i) => i.actualText === null && i.targetSnapshot !== null && i.targetSnapshot > 0 && i.selfAchievementPct !== null) as EvaluationItem;

// E033 — T03, at the employee's step, nothing saved yet; manager E011, delegate history irrelevant here.
const OPEN = formId('EVAL:T03:E033');

describe('the evaluation form on the seed (PEND-06/07)', () => {
  it('every item carries the form\'s actual, the period target and the system\'s % of them', async () => {
    const { gateway } = newGateway();
    for (const item of await items(gateway, OPEN)) {
      expect(item.actualValue).toBe(item.actualSnapshot);
      expect(item.actualText).toBe(item.actualTextSnapshot);
      if (item.actualSnapshot === null && item.actualTextSnapshot === null) expect(item.selfAchievementPct).toBeNull();
    }
    expect((await items(gateway, OPEN)).some((i) => i.selfAchievementPct !== null)).toBe(true);
  });

  it('the employee enters the actual: the system recomputes the %, nobody types it (04 SYSTEM_COLUMN)', async () => {
    const { gateway } = newGateway();
    const item = numericItem(await items(gateway, OPEN));
    const target = item.targetSnapshot as number;
    const [saved] = (await save(gateway, u('E033'), OPEN, [{ itemId: item.id, actualValue: target / 2 }])).filter((i) => i.id === item.id);
    expect(saved).toMatchObject({ actualValue: target / 2, actualEnteredBy: u('E033'), actualSnapshot: item.actualSnapshot });
    expect(saved.selfAchievementPct).not.toBe(item.selfAchievementPct);
    expect((await rejection(save(gateway, u('E033'), OPEN, [{ itemId: item.id, selfAchievementPct: 90 }]))).detail).toBe('SYSTEM_COLUMN');
    expect((await rejection(save(gateway, u('E033'), OPEN, [{ itemId: item.id, selfAchievementPct: null }]))).detail).toBe('SYSTEM_COLUMN');
    expect((await rejection(save(gateway, u('E033'), OPEN, [{ itemId: item.id, targetSnapshot: 1 } as EvaluationItemPatch]))).detail).toBe('SNAPSHOT_READ_ONLY');
  });

  it('the wrong kind of actual is 06; clearing it leaves no %, never 0', async () => {
    const { gateway } = newGateway();
    const item = numericItem(await items(gateway, OPEN));
    const wrong = await rejection(save(gateway, u('E033'), OPEN, [{ itemId: item.id, actualValue: null, actualText: 'Đạt' }]));
    expect([wrong.code, wrong.issues[0]?.detail, wrong.issues[0]?.ref]).toEqual(['ERR-KPI-06', 'ACTUAL_TYPE_MISMATCH', item.id]);
    const [cleared] = (await save(gateway, u('E033'), OPEN, [{ itemId: item.id, actualValue: null }])).filter((i) => i.id === item.id);
    expect(cleared).toMatchObject({ actualValue: null, selfAchievementPct: null });
  });
});

describe('self → manager → HR, end to end (PEND-06/07/08)', () => {
  it('runs the three steps: defaults, overrides with their comments, FINAL = MANAGER, and one FORM actual', async () => {
    const { gateway } = newGateway();
    const list = await items(gateway, OPEN);
    const item = numericItem(list);
    const target = item.targetSnapshot as number;

    // 1 — the employee enters a number and explains every goal, then sends.
    await save(gateway, u('E033'), OPEN, [...explain(list), { itemId: item.id, actualValue: target * 0.8 }]);
    await act(gateway, u('E033'), OPEN, 'SUBMIT');
    let form = await gateway.forms.getForm(S, OPEN);
    expect(await stepNo(gateway, form)).toBe(2);
    for (const i of await items(gateway, OPEN)) {
      expect(i.managerAchievementPct).toBe(i.selfAchievementPct); // the manager starts at the system's %
      expect([i.submittedActualValue, i.submittedActualText]).toEqual([i.actualValue, i.actualText]);
    }
    const noSystem = (await items(gateway, OPEN)).filter((i) => i.selfAchievementPct === null);

    // 2 — the manager corrects the actual: the system % and the default follow; without a comment it is refused.
    const manager = u('E011');
    await save(gateway, manager, OPEN, [
      { itemId: item.id, actualValue: target * 0.9 },
      ...noSystem.map((i) => ({ itemId: i.id, managerAchievementPct: 80, managerComment: 'Không có số, chấm theo đánh giá.' })),
    ]);
    const corrected = (await items(gateway, OPEN)).find((i) => i.id === item.id) as EvaluationItem;
    expect(corrected.managerAchievementPct).toBe(corrected.selfAchievementPct);
    const refused = await rejection(act(gateway, manager, OPEN, 'SUBMIT'));
    expect([refused.code, refused.issues.map((i) => [i.ref, i.detail])]).toEqual(['ERR-KPI-06', [[item.id, 'ACTUAL_CHANGE_COMMENT_REQUIRED']]]);
    await save(gateway, manager, OPEN, [{ itemId: item.id, managerComment: 'Số theo đối soát kế toán.' }]);
    await act(gateway, manager, OPEN, 'SUBMIT');
    form = await gateway.forms.getForm(S, OPEN);
    expect(await stepNo(gateway, form)).toBe(3);

    // 3 — HR's column starts at the manager's; the actual is no longer editable; a different FINAL needs a reason.
    for (const i of await items(gateway, OPEN)) expect(i.finalAchievementPct).toBe(i.managerAchievementPct);
    expect((await rejection(save(gateway, hr, OPEN, [{ itemId: item.id, actualValue: 1 }]))).detail).toBe('ACTUAL_NOT_EDITABLE');
    // …a resent unchanged actual is not a change.
    await save(gateway, hr, OPEN, [{ itemId: item.id, actualValue: corrected.actualValue }]);
    const other = (await items(gateway, OPEN)).find((i) => i.id !== item.id && i.finalAchievementPct !== null) as EvaluationItem;
    await save(gateway, hr, OPEN, [{ itemId: other.id, finalAchievementPct: (other.finalAchievementPct as number) - 10 }]);
    expect((await rejection(act(gateway, hr, OPEN, 'APPROVE'))).issues.map((i) => i.detail)).toEqual(['OVERRIDE_REASON_REQUIRED']);
    await save(gateway, hr, OPEN, [{ itemId: other.id, finalComment: 'Trường hợp đặc biệt theo quyết định của C&B.' }]);
    const done = await act(gateway, hr, OPEN, 'APPROVE');
    expect(done.status).toBe('Completed');

    // The changed actual is now the current one, from the form, entered by the manager who last set it.
    const actuals = await gateway.actuals.listActuals(S, { goalIds: [item.goalId], periodId: T03 });
    expect(actuals).toHaveLength(1);
    expect(actuals[0]).toMatchObject({ actualValue: target * 0.9, sourceType: 'FORM', enteredBy: manager, isCurrent: true, tenantId: S });
    // Untouched items wrote nothing.
    const untouched = (await items(gateway, OPEN)).filter((i) => i.id !== item.id && i.actualSnapshot !== null);
    for (const i of untouched) {
      const [current] = await gateway.actuals.listActuals(S, { goalIds: [i.goalId], periodId: T03 });
      expect(current?.sourceType).not.toBe('FORM');
    }
    // HR's special edit is in the audit log with both values.
    const audit = (await gateway.system.listAuditLog(S, { entityName: 'EvaluationItem', entityId: other.id }, { limit: 50 })).items;
    expect(audit.some((a) => (a.afterData as Record<string, unknown>)?.finalComment === 'Trường hợp đặc biệt theo quyết định của C&B.')).toBe(true);
  });

  it('HR returns to the manager: the manager\'s % stays, FINAL is copied again on re-entry and HR\'s edit is dropped', async () => {
    const { gateway } = newGateway();
    const id = formId('EVAL:T03:E038'); // at HR's step
    const [first] = await items(gateway, id);
    await save(gateway, hr, id, [{ itemId: first.id, finalAchievementPct: 1, finalComment: 'thử' }]);
    await act(gateway, hr, id, 'RETURN', 'Chấm lại theo số đối soát.');
    const back = (await items(gateway, id)).find((i) => i.id === first.id) as EvaluationItem;
    expect(back.managerAchievementPct).toBe(first.managerAchievementPct);
    expect(await stepNo(gateway, await gateway.forms.getForm(S, id))).toBe(2);
    // The manager (E013) sends it on unchanged: HR's column starts again at the manager's, without the old reason.
    await act(gateway, u('E013'), id, 'SUBMIT');
    const again = (await items(gateway, id)).find((i) => i.id === first.id) as EvaluationItem;
    expect(again).toMatchObject({ finalAchievementPct: first.managerAchievementPct, finalComment: null });
  });

  it('a form completed after its period\'s result was locked still completes; the skipped write is on the audit row', async () => {
    const { gateway } = newGateway();
    const list = await items(gateway, OPEN);
    const item = numericItem(list);
    await save(gateway, u('E033'), OPEN, [...explain(list), { itemId: item.id, actualValue: (item.targetSnapshot as number) * 0.5 }]);
    await act(gateway, u('E033'), OPEN, 'SUBMIT');
    const manager = u('E011');
    const noSystem = (await items(gateway, OPEN)).filter((i) => i.managerAchievementPct === null);
    await save(gateway, manager, OPEN, noSystem.map((i) => ({ itemId: i.id, managerAchievementPct: 80, managerComment: 'Chấm theo đánh giá.' })));
    await act(gateway, manager, OPEN, 'SUBMIT');
    await gateway.goals.setPeriodLocked(S, SYNTRA.user(SYNTRA.personas.admin), T03, true);
    const done = await act(gateway, hr, OPEN, 'APPROVE');
    expect(done.status).toBe('Completed');
    const [current] = await gateway.actuals.listActuals(S, { goalIds: [item.goalId], periodId: T03 });
    expect(current?.sourceType).not.toBe('FORM');
    const audit = (await gateway.system.listAuditLog(S, { entityName: 'FormInstance', entityId: OPEN }, { limit: 50 })).items;
    expect(audit.some((a) => typeof a.reason === 'string' && a.reason.startsWith('FORM_ACTUAL_SKIPPED') && a.reason.includes(item.goalId))).toBe(true);
  });

  it('AUTO_FORWARD from the employee\'s step fills the manager\'s defaults (no actor, audited as AUTO_FORWARD)', async () => {
    const { gateway } = newGateway();
    gateway.dev?.setNow(vn('2027-04-08 09:00')); // step-1 deadline was 04-07
    await gateway.scheduler.runDue(S);
    const form = await gateway.forms.getForm(S, OPEN);
    expect(await stepNo(gateway, form)).toBe(2);
    const moved = await items(gateway, OPEN);
    expect(moved.every((i) => i.managerAchievementPct === i.selfAchievementPct)).toBe(true);
    const withDefault = moved.find((i) => i.managerAchievementPct !== null) as EvaluationItem;
    const audit = (await gateway.system.listAuditLog(S, { entityName: 'EvaluationItem', entityId: withDefault.id }, { limit: 50 })).items;
    expect(audit.some((a) => a.reason === 'AUTO_FORWARD' && a.userId === null)).toBe(true);
  });
});

describe('a quarter form snapshots the quarter (PEND-04 leftover)', () => {
  const STAFF: RecipientFilter = { orgUnitIds: [], includeChildUnits: false, positionIds: [], jobLevels: [], employmentStatuses: [], employeeIds: [] };

  it('the actual adds up the months by the KPI\'s aggregation; a SUM target never borrows the annual one', async () => {
    const { gateway } = newGateway();
    const periods = await gateway.goals.listPeriods(S, cycle2027);
    const q1 = periods.find((p) => p.periodType === 'Quarter' && p.label === 'Q1');
    expect(q1).toBeDefined();
    const months = periods.filter((p) => p.periodType === 'Month' && ['T01', 'T02', 'T03'].includes(p.label)).map((p) => p.id);
    const workflowId = (await gateway.forms.listWorkflows(S, 'KPI_EVAL'))[0].id;
    const launch = await gateway.forms.createLaunch(S, hr, {
      workflowId, name: 'Đánh giá KPI quý 1/2027', cycleId: cycle2027, periodId: q1?.id as Id, dueDays: 12,
      recipientMode: 'FILTER', recipientFilter: { ...STAFF, employeeIds: [emp('E016')] }, timing: 'NOW',
    } as never);
    const [form] = (await gateway.forms.listForms(S, { launchId: launch.id })).items;
    const goals = await gateway.goals.listGoals(S, { goalPlanIds: [form.goalPlanId as Id] });
    const defs = await gateway.library.listKpiDefinitions(S);
    const targets = await gateway.goals.listPeriodTargets(S, { goalPlanId: form.goalPlanId as Id });
    let checkedSum = 0;
    for (const item of await items(gateway, form.id)) {
      const goal = goals.find((g) => g.id === item.goalId);
      const aggregation = defs.find((d) => d.id === goal?.kpiDefId)?.aggregation;
      if (aggregation !== 'SUM' || goal?.targetType !== 'NUMERIC') continue;
      const monthly = await Promise.all(months.map(async (m) => (await gateway.actuals.listActuals(S, { goalIds: [item.goalId], periodId: m }))[0]?.actualValue ?? null));
      if (monthly.every((v) => v !== null)) expect(item.actualSnapshot).toBeCloseTo((monthly as number[]).reduce((s, v) => s + v, 0), 6);
      const split = months.map((m) => targets.find((t) => t.goalId === item.goalId && t.periodId === m)?.targetValue ?? null);
      if (split.every((v) => v !== null)) expect(item.targetSnapshot).toBeCloseTo((split as number[]).reduce((s, v) => s + v, 0), 6);
      else expect(item.targetSnapshot).not.toBe(goal.targetValue);
      checkedSum++;
    }
    expect(checkedSum).toBeGreaterThan(0);
  });
});

describe('tenant isolation of the form\'s actual (PEND-06)', () => {
  it('a Demo actor cannot touch a Syntra item, nor a Syntra item ride on a Demo form', async () => {
    const { gateway } = newGateway();
    const [item] = await items(gateway, OPEN);
    const demoUser = DEMO.user('D003');
    const demoForm = DEMO.id('FormInstance', 'EVAL-T01');
    await expect(gateway.forms.saveEvaluationItems(DEMO.tenantId, demoUser, OPEN, [{ itemId: item.id, actualValue: 1 }])).rejects.toBeDefined();
    await expect(gateway.forms.saveEvaluationItems(DEMO.tenantId, demoUser, demoForm, [{ itemId: item.id, actualValue: 1 }])).rejects.toBeDefined();
    expect((await items(gateway, OPEN)).find((i) => i.id === item.id)?.actualValue).toBe(item.actualValue);
  });
});
