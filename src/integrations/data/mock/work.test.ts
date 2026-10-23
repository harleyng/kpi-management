import { describe, expect, it } from 'vitest';
import { SYNTRA } from '@/data/fixtures';
import type { Id, RecipientFilter, WorkTask } from '@/data/types';
import { DEFAULT_WORK_SCORING } from '@/lib/workRules';
import type { DataGateway, WorkTaskInput } from '../types';
import { newGateway, rejection } from './gateway.test-util';

/**
 * Monthly work (PEND-14, Plan B step 8.1) through the mock gateway against the seed's Kinh doanh
 * pilot: T02 recorded, T03 under review, T04 planning (E015 / E018 Locked, E016 at the manager,
 * E017 returned to step 1). Every decision is `workRules` / `workflowRules`; these cases check the
 * gateway gathers their inputs right.
 */

const S = SYNTRA.tenantId;
const u = (code: string) => SYNTRA.user(code);
const hr = u(SYNTRA.personas.hr);
const MANAGER = u('E006');
const period = (label: string) => SYNTRA.id('CyclePeriod', 2027, label);
const workPlan = (code: string, month: string) => SYNTRA.id('WorkPlan', code, month);
const task = (code: string, month: string, n: number) => SYNTRA.id('WorkTask', code, month, n);
const formId = (key: string) => SYNTRA.id('FormInstance', key);
const KDBH: RecipientFilter = { orgUnitIds: [SYNTRA.unit('KDBH')], includeChildUnits: false, positionIds: [], jobLevels: [], employmentStatuses: [], employeeIds: [] };

const inputsOf = (tasks: readonly WorkTask[]): WorkTaskInput[] =>
  tasks.map(({ id, name, product, description, unitText, weight, startDate, dueDate, visibility, linkedGoalId }) => ({ id, name, product, description, unitText, weight, startDate, dueDate, visibility, linkedGoalId }));
const tasksOf = (gw: DataGateway, code: string, month: string) => gw.work.listWorkTasks(S, workPlan(code, month));
const codeOf = async (call: Promise<unknown>) => {
  const e = await rejection(call);
  return `${e.code}:${e.detail}`;
};

describe('work — reads', () => {
  it('lists plans by month with their statuses, and tasks in order', async () => {
    const { gateway } = newGateway();
    const t04 = await gateway.work.listWorkPlans(S, { periodId: period('T04') });
    expect(Object.fromEntries(t04.map((p) => [p.employeeId, p.status]))).toEqual({
      [SYNTRA.employee('E015')]: 'Locked',
      [SYNTRA.employee('E016')]: 'Submitted',
      [SYNTRA.employee('E017')]: 'Returned',
      [SYNTRA.employee('E018')]: 'Draft',
    });
    const tasks = await tasksOf(gateway, 'E015', 'T04');
    expect(tasks.map((t) => t.sortOrder)).toEqual([0, 1, 2]);
    expect(await gateway.work.listWorkPlans(S, { employeeIds: [] })).toEqual([]);
  });

  it('a review is read by its form; any other form has none (ERR-KPI-02)', async () => {
    const { gateway } = newGateway();
    const review = await gateway.work.getWorkReview(S, formId('WR:T03:E015'));
    expect(review).toMatchObject({ workPlanId: workPlan('E015', 'T03'), selfDisciplineScore: 90 });
    expect(await gateway.work.listWorkReviewItems(S, formId('WR:T03:E015'))).toHaveLength(3);
    expect((await rejection(gateway.work.getWorkReview(S, formId('WP:T04:E016')))).code).toBe('ERR-KPI-02');
  });

  it('the recorded month and the tenant\'s scoring settings', async () => {
    const { gateway } = newGateway();
    const results = await gateway.work.listWorkResults(S, { periodIds: [period('T02')] });
    expect(results).toHaveLength(3);
    const e017 = results.find((r) => r.employeeId === SYNTRA.employee('E017'));
    expect(e017?.hsht).toBeLessThan(80);
    expect(e017).toMatchObject({ hsnv: 70, finalScore: 70 });
    expect(await gateway.work.getWorkScoringConfig(S)).toMatchObject(DEFAULT_WORK_SCORING);
  });
});

describe('work.saveWorkTasks — before approval, at the step that allows EDIT', () => {
  it('the employee edits her returned plan at step 1: add, change, remove', async () => {
    const { gateway } = newGateway();
    const [first, second] = await tasksOf(gateway, 'E017', 'T04');
    const saved = await gateway.work.saveWorkTasks(S, u('E017'), workPlan('E017', 'T04'), [
      { ...inputsOf([first])[0], weight: 50 },
      { name: 'Gọi 40 khách hàng tồn, ghi kết quả vào CRM', product: null, description: null, unitText: 'cuộc gọi', weight: 50, startDate: '2027-04-01', dueDate: '2027-04-30', visibility: 'PUBLIC', linkedGoalId: null },
    ]);
    expect(saved.map((t) => [t.weight, t.sortOrder, t.progressStatus])).toEqual([[50, 0, 'NotStarted'], [50, 1, 'NotStarted']]);
    expect(saved[1].createdBy).toBe(u('E017'));
    expect((await tasksOf(gateway, 'E017', 'T04')).map((t) => t.id)).not.toContain(second.id);
  });

  it('the manager may not edit at the employee\'s step; the employee may not at the manager\'s', async () => {
    const { gateway } = newGateway();
    const e017 = await tasksOf(gateway, 'E017', 'T04');
    expect((await rejection(gateway.work.saveWorkTasks(S, MANAGER, workPlan('E017', 'T04'), inputsOf(e017).slice(1)))).code).toBe('ERR-KPI-05');
    const e016 = await tasksOf(gateway, 'E016', 'T04');
    expect((await rejection(gateway.work.saveWorkTasks(S, u('E016'), workPlan('E016', 'T04'), inputsOf(e016).slice(1)))).code).toBe('ERR-KPI-05');
    // At step 2 the manager edits (EDIT allowed there).
    const changed = await gateway.work.saveWorkTasks(S, MANAGER, workPlan('E016', 'T04'), inputsOf(e016).map((t, i) => (i === 0 ? { ...t, weight: 40 } : i === 1 ? { ...t, weight: 40 } : t)));
    expect(changed.map((t) => t.weight)).toEqual([40, 40, 20]);
  });

  it('saving the list unchanged is a no-op for anyone', async () => {
    const { gateway } = newGateway();
    const tasks = await tasksOf(gateway, 'E015', 'T04');
    expect(await gateway.work.saveWorkTasks(S, u('E016'), workPlan('E015', 'T04'), inputsOf(tasks))).toEqual(tasks);
  });

  it('refuses another plan\'s task id and a link to someone else\'s KPI (ERR-KPI-06)', async () => {
    const { gateway } = newGateway();
    const tasks = inputsOf(await tasksOf(gateway, 'E017', 'T04'));
    const foreign = { ...tasks[0], id: task('E015', 'T04', 1) };
    expect(await codeOf(gateway.work.saveWorkTasks(S, u('E017'), workPlan('E017', 'T04'), [...tasks, foreign]))).toMatch(/^ERR-KPI-06:WorkTask .* is not a task of plan/);
    const othersKpi = (await gateway.goals.listGoals(S, { ownerEmployeeId: SYNTRA.employee('E015') }))[0].id;
    expect(await codeOf(gateway.work.saveWorkTasks(S, u('E017'), workPlan('E017', 'T04'), [{ ...tasks[0], linkedGoalId: othersKpi }, tasks[1]]))).toBe('ERR-KPI-06:LINKED_GOAL_INVALID');
  });
});

describe('work — after approval: cancel (manager, reason) and progress', () => {
  it('a Locked plan\'s list is fixed', async () => {
    const { gateway } = newGateway();
    const tasks = inputsOf(await tasksOf(gateway, 'E015', 'T04'));
    expect(await codeOf(gateway.work.saveWorkTasks(S, MANAGER, workPlan('E015', 'T04'), [{ ...tasks[0], weight: 30 }, ...tasks.slice(1)]))).toBe('ERR-KPI-04:PLAN_LOCKED');
  });

  it('the manager cancels with a reason; the task drops out, the reason is audited', async () => {
    const { gateway } = newGateway();
    const id = task('E015', 'T04', 2);
    expect(await codeOf(gateway.work.cancelWorkTask(S, u('E015'), id, 'Lý do'))).toBe('ERR-KPI-05:MANAGER_ONLY');
    expect(await codeOf(gateway.work.cancelWorkTask(S, MANAGER, id, ' '))).toBe('ERR-KPI-06:CANCEL_REASON_REQUIRED');
    const cancelled = await gateway.work.cancelWorkTask(S, MANAGER, id, 'Trưởng phòng tự làm báo cáo tháng này');
    expect(cancelled).toMatchObject({ progressStatus: 'Cancelled', cancelledBy: MANAGER, cancelReason: 'Trưởng phòng tự làm báo cáo tháng này' });
    const audit = await gateway.system.listAuditLog(S, { entityName: 'WorkTask', entityId: id });
    expect(audit.items.at(-1)?.reason).toBe('Trưởng phòng tự làm báo cáo tháng này');
    expect(await codeOf(gateway.work.cancelWorkTask(S, MANAGER, id, 'Lại'))).toBe('ERR-KPI-04:TASK_CANCELLED');
  });

  it('the employee updates progress; out of range or "Cancelled" is refused', async () => {
    const { gateway } = newGateway();
    const id = task('E015', 'T04', 1);
    expect(await gateway.work.updateTaskProgress(S, u('E015'), id, { progressPct: 75, progressStatus: 'InProgress', note: 'Đã gặp 22 khách' })).toMatchObject({ progressPct: 75, note: 'Đã gặp 22 khách' });
    expect(await codeOf(gateway.work.updateTaskProgress(S, u('E015'), id, { progressPct: 120, progressStatus: 'InProgress', note: null }))).toBe('ERR-KPI-06:PROGRESS_OUT_OF_RANGE');
    expect(await codeOf(gateway.work.updateTaskProgress(S, u('E015'), id, { progressPct: 10, progressStatus: 'Cancelled', note: null }))).toBe('ERR-KPI-06:CANCEL_BY_PROGRESS');
    expect(await codeOf(gateway.work.updateTaskProgress(S, u('E016'), id, { progressPct: 10, progressStatus: 'InProgress', note: null }))).toBe('ERR-KPI-05:NOT_SUBJECT_OR_MANAGER');
    expect(await codeOf(gateway.work.updateTaskProgress(S, u('E016'), task('E016', 'T04', 1), { progressPct: 10, progressStatus: 'InProgress', note: null }))).toBe('ERR-KPI-04:NOT_APPROVED');
  });

  it('HR as proxy cancels FOR the manager; the log names both (BR-KPI-21)', async () => {
    const { gateway } = newGateway();
    const id = task('E015', 'T04', 2);
    expect(await codeOf(gateway.work.cancelWorkTask(S, u('E016'), id, 'Lý do'))).toBe('ERR-KPI-05:MANAGER_ONLY');
    await gateway.work.cancelWorkTask(S, hr, id, 'HR hủy thay trưởng phòng');
    const audit = await gateway.system.listAuditLog(S, { entityName: 'WorkTask', entityId: id });
    expect(audit.items.at(-1)).toMatchObject({ userId: hr, onBehalfOfUserId: MANAGER });
    // The employee tracking her own task acts as herself.
    await gateway.work.updateTaskProgress(S, u('E015'), task('E015', 'T04', 1), { progressPct: 40, progressStatus: 'InProgress', note: null });
    const own = await gateway.system.listAuditLog(S, { entityName: 'WorkTask', entityId: task('E015', 'T04', 1) });
    expect(own.items.at(-1)).toMatchObject({ userId: u('E015'), onBehalfOfUserId: null });
  });

  it('a delegate (not the employee) tracks a colleague\'s task as the manager\'s delegate', async () => {
    const { gateway } = newGateway();
    await gateway.forms.saveDelegation(S, MANAGER, { toUserId: u('E016'), formType: 'WORK_PLAN', validFrom: '2027-04-06', validTo: '2027-04-12' });
    const id = task('E015', 'T04', 1);
    await gateway.work.updateTaskProgress(S, u('E016'), id, { progressPct: 20, progressStatus: 'InProgress', note: null });
    const audit = await gateway.system.listAuditLog(S, { entityName: 'WorkTask', entityId: id });
    expect(audit.items.at(-1)).toMatchObject({ userId: u('E016'), onBehalfOfUserId: MANAGER });
    // A KPI_EVAL delegation does not reach monthly work.
    expect(await codeOf(gateway.work.cancelWorkTask(S, u('E017'), task('E015', 'T04', 3), 'Lý do'))).toBe('ERR-KPI-05:MANAGER_ONLY');
  });

  it('progress status agrees with the %, and a cancelled task cannot be dropped from the list', async () => {
    const { gateway } = newGateway();
    expect(await codeOf(gateway.work.updateTaskProgress(S, u('E015'), task('E015', 'T04', 1), { progressPct: 30, progressStatus: 'Done', note: null }))).toBe('ERR-KPI-06:STATUS_MISMATCH');
    const tasks = inputsOf(await tasksOf(gateway, 'E016', 'T03'));
    // T03 E016: task 3 was cancelled mid-month; sending the list without it is refused.
    expect((await rejection(gateway.work.saveWorkTasks(S, MANAGER, workPlan('E016', 'T03'), tasks.slice(0, 2)))).code).toBe('ERR-KPI-04');
  });

  it('once the month is under review the list is frozen; once recorded, everything', async () => {
    const { gateway } = newGateway();
    expect(await codeOf(gateway.work.cancelWorkTask(S, MANAGER, task('E015', 'T03', 1), 'Lý do'))).toBe('ERR-KPI-04:REVIEW_LAUNCHED');
    expect((await gateway.work.updateTaskProgress(S, u('E015'), task('E015', 'T03', 1), { progressPct: 100, progressStatus: 'Done', note: null })).progressStatus).toBe('Done');
    expect(await codeOf(gateway.work.updateTaskProgress(S, u('E015'), task('E015', 'T02', 1), { progressPct: 90, progressStatus: 'Done', note: null }))).toBe('ERR-KPI-04:RESULT_RECORDED');
  });
});

describe('work.saveWorkReview — "Lưu nháp" of the current step\'s column', () => {
  it('the employee saves her column: 0 is a score, null clears, an omitted key is untouched', async () => {
    const { gateway } = newGateway();
    const f = formId('WR:T03:E015');
    const [a, b] = await gateway.work.listWorkReviewItems(S, f);
    const { review, items } = await gateway.work.saveWorkReview(S, u('E015'), f, { disciplineScore: 0, items: [{ itemId: a.id, score: 0 }, { itemId: b.id, score: null }] });
    expect(review.selfDisciplineScore).toBe(0);
    expect(review.selfComment).not.toBeNull(); // omitted → kept
    expect(items.find((i) => i.id === a.id)?.selfScore).toBe(0);
    expect(items.find((i) => i.id === b.id)?.selfScore).toBeNull();
  });

  it('refuses Hsnv in the SELF column, a score off the scale, another form\'s item, and someone else\'s step', async () => {
    const { gateway } = newGateway();
    const f = formId('WR:T03:E015');
    expect(await codeOf(gateway.work.saveWorkReview(S, u('E015'), f, { hsnv: 80 }))).toBe('ERR-KPI-04:COLUMN_NOT_EDITABLE');
    expect(await codeOf(gateway.work.saveWorkReview(S, u('E015'), f, { disciplineScore: 101 }))).toBe('ERR-KPI-06:SCORE_OUT_OF_RANGE');
    const other = (await gateway.work.listWorkReviewItems(S, formId('WR:T03:E017')))[0];
    expect((await rejection(gateway.work.saveWorkReview(S, u('E015'), f, { items: [{ itemId: other.id, score: 50 }] }))).code).toBe('ERR-KPI-06');
    expect((await rejection(gateway.work.saveWorkReview(S, MANAGER, f, { disciplineScore: 80 }))).code).toBe('ERR-KPI-05');
    expect((await rejection(gateway.work.saveWorkReview(S, u('E015'), formId('EVAL:T03:E015'), {}))).code).toBe('ERR-KPI-06');
  });

  it('refuses two patches of the same item in one call', async () => {
    const { gateway } = newGateway();
    const f = formId('WR:T03:E015');
    const [a] = await gateway.work.listWorkReviewItems(S, f);
    expect((await rejection(gateway.work.saveWorkReview(S, u('E015'), f, { items: [{ itemId: a.id, score: 50 }, { itemId: a.id, score: 60 }] }))).code).toBe('ERR-KPI-06');
  });

  it('the manager saves his column, Hsnv and reason included', async () => {
    const { gateway } = newGateway();
    const f = formId('WR:T03:E017');
    const items = await gateway.work.listWorkReviewItems(S, f);
    const { review } = await gateway.work.saveWorkReview(S, MANAGER, f, {
      disciplineScore: 70,
      hsnv: 72,
      hsnvReason: 'Khối lượng việc tồn lớn',
      items: items.map((i) => ({ itemId: i.id, score: 60 })),
    });
    expect(review).toMatchObject({ managerDisciplineScore: 70, managerHsnv: 72, managerHsnvReason: 'Khối lượng việc tồn lớn', selfDisciplineScore: 80 });
  });
});

describe('work — forms and launches (the monthly-work part wired in 8.1)', () => {
  it('a monthly-work form does not move yet (8.2 / 8.3); HR may still cancel it', async () => {
    const { gateway } = newGateway();
    const form = await gateway.forms.getForm(S, formId('WP:T04:E016'));
    const base = { formId: form.id, expectedStepId: form.currentStepId as Id, comment: 'Duyệt', onBehalfOfUserId: null, delegationId: null };
    expect(await codeOf(gateway.forms.act(S, MANAGER, { ...base, action: 'APPROVE' }))).toBe('ERR-KPI-04:WORK_FORM_NOT_BUILT');
    expect((await gateway.forms.act(S, hr, { ...base, action: 'CANCEL', comment: 'Kiểm thử' })).status).toBe('Cancelled');
  });

  it('a WORK_PLAN launch creates each recipient\'s Draft plan for the month; a second skips them', async () => {
    const { gateway } = newGateway();
    const input = { workflowId: (await gateway.forms.listWorkflows(S, 'WORK_PLAN'))[0].id, name: 'Kế hoạch T05', cycleId: SYNTRA.id('PerformanceCycle', '2027'), periodId: period('T05'), dueDays: 7, recipientMode: 'FILTER', recipientFilter: KDBH, timing: 'NOW' } as const;
    const launch = await gateway.forms.createLaunch(S, hr, input);
    const forms = (await gateway.forms.listForms(S, { launchId: launch.id })).items;
    const plans = await gateway.work.listWorkPlans(S, { periodId: period('T05') });
    // The department's five people, its head included (his plan goes to his own manager).
    expect(forms.length).toBe(5);
    expect(new Set(plans.map((p) => p.status))).toEqual(new Set(['Draft']));
    expect(plans).toHaveLength(5);
    for (const f of forms) expect(plans.map((p) => p.id)).toContain(f.workPlanId);
    const again = await gateway.forms.createLaunch(S, hr, input);
    expect((await gateway.forms.listForms(S, { launchId: again.id })).items).toEqual([]);
  });

  it('a WORK_REVIEW launch takes one item per live task; a quarter is refused (MONTH_REQUIRED)', async () => {
    const { gateway } = newGateway();
    const workflowId = (await gateway.forms.listWorkflows(S, 'WORK_REVIEW'))[0].id;
    await gateway.work.cancelWorkTask(S, MANAGER, task('E015', 'T04', 2), 'Không còn cần');
    const base = { workflowId, name: 'Đánh giá T04', cycleId: SYNTRA.id('PerformanceCycle', '2027'), dueDays: 12, recipientMode: 'FILTER' as const, timing: 'NOW' as const, recipientFilter: { ...KDBH, employeeIds: [SYNTRA.employee('E015')] } };
    const launch = await gateway.forms.createLaunch(S, hr, { ...base, periodId: period('T04') });
    const [form] = (await gateway.forms.listForms(S, { launchId: launch.id })).items;
    expect(form.workPlanId).toBe(workPlan('E015', 'T04'));
    expect((await gateway.work.listWorkReviewItems(S, form.id)).map((i) => i.taskId)).toEqual([task('E015', 'T04', 1), task('E015', 'T04', 3)]);
    expect(await codeOf(gateway.forms.createLaunch(S, hr, { ...base, periodId: SYNTRA.id('CyclePeriod', 2027, 'Q2') }))).toBe('ERR-KPI-06:MONTH_REQUIRED');
  });

  it('a WORK_REVIEW launch skips a month whose plan is not Locked, and one with no live task (ASSUMPTION Q69)', async () => {
    const { gateway } = newGateway();
    const workflowId = (await gateway.forms.listWorkflows(S, 'WORK_REVIEW'))[0].id;
    const launch = await gateway.forms.createLaunch(S, hr, {
      workflowId, name: 'Đánh giá T04', cycleId: SYNTRA.id('PerformanceCycle', '2027'), periodId: period('T04'), dueDays: 12, recipientMode: 'FILTER', recipientFilter: KDBH, timing: 'NOW',
    });
    const forms = (await gateway.forms.listForms(S, { launchId: launch.id })).items;
    // Only E015's April plan is Locked; E016 (Submitted), E017 (Returned), E018 (Draft) and the head (no plan) are skipped.
    expect(forms.map((f) => f.subjectEmployeeId)).toEqual([SYNTRA.employee('E015')]);
    expect(await gateway.work.listWorkPlans(S, { periodId: period('T04') })).toHaveLength(4); // no plan created for the head
  });

  it('a monthly-work form is never started by hand', async () => {
    const { gateway } = newGateway();
    const workflowId = (await gateway.forms.listWorkflows(S, 'WORK_PLAN'))[0].id;
    const e = await rejection(gateway.forms.startForm(S, hr, { workflowId, subjectEmployeeId: SYNTRA.employee('E015'), goalPlanId: null, periodId: period('T05'), dueDate: '2027-05-08' }));
    expect([e.code, e.detail]).toEqual(['ERR-KPI-06', 'NOT_STARTABLE']);
  });
});

describe('work.saveWorkScoringConfig', () => {
  it('HR saves the one row; an off-balance or employee save is refused', async () => {
    const { gateway } = newGateway();
    const before = await gateway.work.getWorkScoringConfig(S);
    const saved = await gateway.work.saveWorkScoringConfig(S, hr, { resultWeight: 60, disciplineWeight: 40, hsnvThreshold: 75, scoreMin: 0, scoreMax: 100 });
    expect(saved.id).toBe(before?.id);
    expect(await codeOf(gateway.work.saveWorkScoringConfig(S, hr, { resultWeight: 60, disciplineWeight: 30, hsnvThreshold: 80, scoreMin: 0, scoreMax: 100 }))).toBe('ERR-KPI-07:undefined');
    expect((await rejection(gateway.work.saveWorkScoringConfig(S, u('E016'), DEFAULT_WORK_SCORING))).code).toBe('ERR-KPI-05');
  });
});
