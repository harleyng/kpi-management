import { describe, expect, it } from 'vitest';
import { DEMO, SYNTRA } from '@/data/fixtures';
import type { FormInstance, Id, PersonFormAction, RecipientFilter, WorkflowStep } from '@/data/types';
import type { DataGateway, DomainEvent } from '../types';
import { flush, newGateway, rejection } from './gateway.test-util';

/**
 * Đợt 2 (PEND-01, 02) through the mock gateway: a registration may start at the employee's own step
 * (bottom-up); the last step may record and lock by itself (AUTO_APPROVE, no actor); HR may send a
 * registration back to the manager. Open questions on ASSUMPTION Q44–Q46.
 */

const S = SYNTRA.tenantId;
const u = (code: string) => SYNTRA.user(code);
const emp = (code: string) => SYNTRA.employee(code);
const admin = u(SYNTRA.personas.admin);
const hr = u(SYNTRA.personas.hr);
const cycle2027 = SYNTRA.id('PerformanceCycle', '2027');
const formId = (key: string) => SYNTRA.id('FormInstance', key);
const planId = (owner: string) => SYNTRA.id('GoalPlan', cycle2027, owner);
const NOBODY: RecipientFilter = { orgUnitIds: [], includeChildUnits: false, positionIds: [], jobLevels: [], employmentStatuses: [], employeeIds: [] };
type Gw = DataGateway;

const workflowOf = async (gw: Gw, type: 'GOAL_SETTING' | 'KPI_EVAL') => (await gw.forms.listWorkflows(S, type))[0];
const stepsOf = async (gw: Gw, workflowId: Id) => gw.forms.listWorkflowSteps(S, workflowId);
const stepNo = async (gw: Gw, form: FormInstance) => (await stepsOf(gw, form.workflowId)).find((s) => s.id === form.currentStepId)?.stepNo ?? null;

async function act(gw: Gw, actor: Id, id: Id, action: PersonFormAction, comment: string | null = null) {
  const form = await gw.forms.getForm(S, id);
  return gw.forms.act(S, actor, { formId: id, expectedStepId: form.currentStepId as Id, action, comment, onBehalfOfUserId: null, delegationId: null });
}

/** Switches the last step of the type's workflow to record by itself (as HR would in the editor). */
async function turnOnAutoApprove(gw: Gw, type: 'GOAL_SETTING' | 'KPI_EVAL') {
  const workflow = await workflowOf(gw, type);
  const steps = await stepsOf(gw, workflow.id);
  const last = Math.max(...steps.map((s) => s.stepNo));
  const { tenantId: _t, ...input } = workflow;
  await gw.forms.saveWorkflow(S, admin, input, steps.map(({ tenantId: _tt, workflowId: _w, stepNo, ...s }) => ({ ...s, autoApprove: stepNo === last })));
}

describe('bottom-up registration (PEND-01)', () => {
  const launchFor = async (gw: Gw, employeeCode: string, startStepNo?: number | null) =>
    gw.forms.createLaunch(S, hr, {
      workflowId: (await workflowOf(gw, 'GOAL_SETTING')).id, name: 'Đăng ký KPI tự lập', cycleId: SYNTRA.id('PerformanceCycle', '2028'), periodId: null, dueDays: 14,
      recipientMode: 'FILTER', recipientFilter: { ...NOBODY, employeeIds: [emp(employeeCode)] }, timing: 'NOW', ...(startStepNo === undefined ? {} : { startStepNo }),
    } as never);

  it('a launch that starts at the employee\'s step: the form waits for the employee, the plan is Draft, no history', async () => {
    const { gateway } = newGateway();
    const cycles = await gateway.goals.listCycles(S);
    const planning = cycles.find((c) => c.status === 'Planning');
    expect(planning).toBeDefined();
    const launch = await gateway.forms.createLaunch(S, hr, {
      workflowId: (await workflowOf(gateway, 'GOAL_SETTING')).id, name: 'Đăng ký KPI tự lập', cycleId: planning?.id as Id, periodId: null, dueDays: 14,
      recipientMode: 'FILTER', recipientFilter: { ...NOBODY, employeeIds: [emp('E016')] }, timing: 'NOW', startStepNo: 2,
    } as never);
    expect(launch.startStepNo).toBe(2);
    const [form] = (await gateway.forms.listForms(S, { launchId: launch.id })).items;
    expect(await stepNo(gateway, form)).toBe(2);
    expect(await gateway.forms.listFormActions(S, form.id)).toEqual([]);
    expect((await gateway.goals.getGoalPlan(S, form.goalPlanId as Id)).status).toBe('Draft');
    expect(await gateway.forms.listInbox(S, u('E016'))).toContainEqual(expect.objectContaining({ id: form.id }));
  });

  it('a start after the employee\'s step is 06 and creates nothing; step 1 is stored as null', async () => {
    const { gateway } = newGateway();
    const before = (await gateway.forms.listLaunches(S)).length;
    expect((await rejection(launchFor(gateway, 'E016', 3))).issues.map((i) => i.detail)).toEqual(['START_STEP_INVALID']);
    expect((await gateway.forms.listLaunches(S)).length).toBe(before);
    const cycles = await gateway.goals.listCycles(S);
    const planning = cycles.find((c) => c.status === 'Planning') as { id: Id };
    const one = await gateway.forms.createLaunch(S, hr, {
      workflowId: (await workflowOf(gateway, 'GOAL_SETTING')).id, name: 'x', cycleId: planning.id, periodId: null, dueDays: 14,
      recipientMode: 'FILTER', recipientFilter: { ...NOBODY, employeeIds: [] }, timing: 'SCHEDULED', scheduledAt: '2027-12-01T02:00:00.000Z', startStepNo: 1,
    } as never);
    expect(one.startStepNo).toBeNull();
  });

  it('a unit plan started by hand at the head\'s step skips the division director', async () => {
    const { gateway } = newGateway();
    const workflow = await workflowOf(gateway, 'GOAL_SETTING');
    const unit = (await gateway.org.listOrgUnits(S)).find((x) => x.id === SYNTRA.unit('KDBH'));
    const unitPlan = await gateway.goals.createGoalPlan(S, hr, {
      cycleId: SYNTRA.id('PerformanceCycle', '2028'), planType: 'KPI', ownerType: 'OrgUnit', ownerOrgUnitId: SYNTRA.unit('KDBH'), ownerEmployeeId: null,
    });
    const form = await gateway.forms.startForm(S, hr, { workflowId: workflow.id, subjectEmployeeId: unit?.headEmployeeId as Id, goalPlanId: unitPlan.id, periodId: null, dueDate: '2027-12-31', startStepNo: 2 });
    expect(await stepNo(gateway, form)).toBe(2);
  });

  it('a started form refuses a bad start step before anything else (06)', async () => {
    const { gateway } = newGateway();
    const workflow = await workflowOf(gateway, 'GOAL_SETTING');
    const error = await rejection(gateway.forms.startForm(S, hr, { workflowId: workflow.id, subjectEmployeeId: emp('E016'), goalPlanId: planId('E016'), periodId: null, dueDate: '2027-12-31', startStepNo: 4 }));
    expect([error.code, error.issues[0]?.detail]).toEqual(['ERR-KPI-06', 'START_STEP_INVALID']);
  });
});

describe('record and lock by itself; HR sends back to the manager (PEND-02)', () => {
  it('saveWorkflow refuses autoApprove anywhere but a last step that allows APPROVE', async () => {
    const { gateway } = newGateway();
    const workflow = await workflowOf(gateway, 'GOAL_SETTING');
    const steps = await stepsOf(gateway, workflow.id);
    const { tenantId: _t, ...input } = workflow;
    const strip = (s: WorkflowStep) => {
      const { tenantId: _tt, workflowId: _w, stepNo: _n, ...rest } = s;
      return rest;
    };
    const onStep3 = steps.map((s) => ({ ...strip(s), autoApprove: s.stepNo === 3 }));
    expect((await rejection(gateway.forms.saveWorkflow(S, admin, input, onStep3))).issues.map((i) => i.detail)).toContain('AUTO_APPROVE_NOT_LAST');
  });

  it('the manager\'s APPROVE completes the registration and locks the plan at once — AUTO_APPROVE, no actor, no stop at Approved', async () => {
    const { gateway } = newGateway();
    await turnOnAutoApprove(gateway, 'GOAL_SETTING');
    const id = formId('GS:E017'); // at the manager's step (E006) since the 04-05 unlock
    const heard: DomainEvent[] = [];
    gateway.events.subscribe(S, (e) => void heard.push(e));
    const done = await act(gateway, u('E006'), id, 'APPROVE');
    expect(done.status).toBe('Completed');
    expect((await gateway.goals.getGoalPlan(S, planId('E017'))).status).toBe('Locked');
    const history = await gateway.forms.listFormActions(S, id);
    expect(history.slice(-2).map((a) => [a.action, a.actorUserId])).toEqual([['APPROVE', u('E006')], ['AUTO_APPROVE', null]]);
    await flush();
    const changes = heard.filter((e) => e.type === 'goalPlan.statusChanged' && e.goalPlanId === planId('E017'));
    expect(changes.map((e) => (e as { to: string }).to)).toEqual(['Locked']);
    const audit = (await gateway.system.listAuditLog(S, { entityName: 'GoalPlan', entityId: planId('E017') }, { limit: 50 })).items;
    expect(audit.find((a) => a.action === 'LOCK' && a.reason === 'AUTO_APPROVE')).toBeDefined();
    // Nobody is told about a step nobody holds.
    expect(heard.filter((e) => e.type === 'form.stepActed' && e.formId === id).every((e) => (e as { nextStepId: Id | null }).nextStepId === null)).toBe(true);
  });

  it('HR returns a registration to the manager (comment required): the form is at step 3 and the plan Submitted', async () => {
    const { gateway } = newGateway();
    const id = formId('GS:E040'); // at HR's step since the 04-05 unlock
    expect((await rejection(act(gateway, hr, id, 'RETURN'))).code).toBe('ERR-KPI-06');
    const back = await act(gateway, hr, id, 'RETURN', 'Chỉ tiêu tồn kho chưa liên kết KPI phòng, đề nghị quản lý xem lại.');
    expect(await stepNo(gateway, back)).toBe(3);
    expect((await gateway.goals.getGoalPlan(S, planId('E040'))).status).toBe('Submitted');
  });

  it('an evaluation whose HR step records by itself completes on the manager\'s SUBMIT with FINAL = MANAGER', async () => {
    const { gateway } = newGateway();
    await turnOnAutoApprove(gateway, 'KPI_EVAL');
    const id = formId('EVAL:T03:E015'); // at the manager's step (E006)
    const done = await act(gateway, u('E006'), id, 'SUBMIT');
    expect(done.status).toBe('Completed');
    const items = await gateway.forms.listEvaluationItems(S, id);
    expect(items.every((i) => i.finalAchievementPct === i.managerAchievementPct)).toBe(true);
    expect((await gateway.forms.listFormActions(S, id)).at(-1)).toMatchObject({ action: 'AUTO_APPROVE', actorUserId: null });
  });
});

describe('tenant isolation of the new launch and workflow fields', () => {
  it('a Demo HR cannot launch with a Syntra workflow, nor switch a Syntra step to autoApprove', async () => {
    const { gateway } = newGateway();
    const workflow = await workflowOf(gateway, 'GOAL_SETTING');
    const demoHr = DEMO.user(DEMO.personas.hr);
    await expect(
      gateway.forms.createLaunch(DEMO.tenantId, demoHr, {
        workflowId: workflow.id, name: 'x', cycleId: null, periodId: null, dueDays: 7, recipientMode: 'ALL', recipientFilter: null, timing: 'NOW', startStepNo: 2,
      } as never),
    ).rejects.toBeDefined();
    const steps = await stepsOf(gateway, workflow.id);
    const { tenantId: _t, ...input } = workflow;
    await expect(
      gateway.forms.saveWorkflow(DEMO.tenantId, DEMO.user(DEMO.personas.admin), input, steps.map(({ tenantId: _tt, workflowId: _w, stepNo: _n, ...s }) => ({ ...s, autoApprove: true }))),
    ).rejects.toBeDefined();
    expect((await stepsOf(gateway, workflow.id)).every((s) => s.autoApprove === false)).toBe(true);
  });
});
