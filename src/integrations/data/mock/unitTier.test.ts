import { describe, expect, it } from 'vitest';
import { SYNTRA } from '@/data/fixtures';
import type { Goal, GoalPlan, Id } from '@/data/types';
import { allocationBuckets, cascadedGoalDraft, type CascadeChild } from '@/lib/alignmentRules';
import { cascadeTargetPlans } from '@/lib/planAccessRules';
import type { DataGateway } from '../types';
import { newGateway, rejection } from './gateway.test-util';

/**
 * The company → department tier on the mock, as the screens drive it (BR-KPI-07, 12, 19): HR builds
 * the company plan and the department plans of a new cycle, cascades a company goal into a department
 * plan (`useCascadeGoal` = saveGoal + saveAlignment CASCADE), then starts the department plan's
 * registration by hand. Who may write into the department plan at each moment follows `canEditPlan`:
 * no form → its head or HR; a form open → the step's actor, or HR acting for them (`form.proxy`).
 */

const S = SYNTRA.tenantId;
const u = (code: string) => SYNTRA.user(code);
const emp = (code: string) => SYNTRA.employee(code);
const hr = u(SYNTRA.personas.hr);
const cycle2027 = SYNTRA.id('PerformanceCycle', '2027');
const cycle2028 = SYNTRA.id('PerformanceCycle', '2028');
const REVENUE = 160_800_000_000;
const CYCLE = { startDate: '2028-01-01', endDate: '2028-12-31' };

async function workflowOf(gw: DataGateway) {
  return (await gw.forms.listWorkflows(S, 'GOAL_SETTING')).find((w) => w.isDefault)?.id as Id;
}

/** KPI 2028: the company plan with a copy of the 2027 company revenue goal, and Phòng Kinh doanh's Draft plan. */
async function setUp(gw: DataGateway) {
  const company2027 = (await gw.goals.listGoalPlans(S, { cycleId: cycle2027 })).find((p) => p.ownerType === 'Company') as GoalPlan;
  const seeded = (await gw.goals.listGoals(S, { goalPlanIds: [company2027.id] })).find((g) => g.targetValue === REVENUE) as Goal;
  const company = await gw.goals.createGoalPlan(S, hr, { cycleId: cycle2028, planType: 'KPI', ownerType: 'Company', ownerOrgUnitId: SYNTRA.unit('SYN'), ownerEmployeeId: null });
  const dept = await gw.goals.createGoalPlan(S, hr, { cycleId: cycle2028, planType: 'KPI', ownerType: 'OrgUnit', ownerOrgUnitId: SYNTRA.unit('KDBH'), ownerEmployeeId: null });
  const { id: _id, tenantId: _t, status: _s, replacesGoalId: _r, ...copy } = seeded;
  const revenue = await gw.goals.saveGoal(S, hr, { ...copy, goalPlanId: company.id, kgiId: null, startDate: CYCLE.startDate, dueDate: CYCLE.endDate });
  const methods = await gw.library.listCalcMethods(S);
  const head = (await gw.org.listEmployees(S)).find((e) => e.id === emp('E006')) ?? null;
  /** Exactly what `CascadeDialog` + `useCascadeGoal` send. */
  const cascade = async (actor: Id, allocatedValue: number) => {
    const draft = cascadedGoalDraft(revenue, methods.find((m) => m.id === revenue.calcMethodId) ?? null, {
      goalPlanId: dept.id,
      ownerEmployeeId: emp('E006'),
      allocatedValue,
      weight: 40,
      sortOrder: 1,
      calcMethodId: null,
      cycle: CYCLE,
      owner: head,
    });
    if (!draft.ok) throw new Error(JSON.stringify(draft.issues));
    const child = await gw.goals.saveGoal(S, actor, draft.goal);
    try {
      return await gw.goals.saveAlignment(S, actor, { childGoalId: child.id, parentGoalId: revenue.id, alignmentType: 'CASCADE', allocatedValue, contributionPct: null });
    } catch (error) {
      await gw.goals.deleteGoal(S, hr, child.id);
      throw error;
    }
  };
  return { company, dept, revenue, cascade };
}

async function buckets(gw: DataGateway, parent: Goal) {
  const alignments = (await gw.goals.listAlignments(S, { alignmentType: 'CASCADE' })).filter((a) => a.parentGoalId === parent.id);
  const goals = await gw.goals.listGoals(S);
  const children: CascadeChild[] = alignments.map((a) => ({ alignment: a, childGoal: goals.find((g) => g.id === a.childGoalId) as Goal, childOwner: null }));
  return allocationBuckets(parent, children, '2027-04-06');
}

describe('company → department on the mock (BR-KPI-07, 19)', () => {
  it('the company plan offers the department plans as cascade targets (no Khối plan in between)', async () => {
    const { gateway } = newGateway();
    const { company, dept } = await setUp(gateway);
    const plans = await gateway.goals.listGoalPlans(S, { cycleId: cycle2028 });
    const units = await gateway.org.listOrgUnits(S);
    expect(cascadeTargetPlans(company, plans, units, '2027-04-06').map((p) => p.id)).toEqual([dept.id]);
  });

  it('a Draft department plan with no form: HR and the head may take a cascade; the director and the CEO may not', async () => {
    const { gateway } = newGateway();
    const { revenue, cascade } = await setUp(gateway);
    expect(['ERR-KPI-04', 'ERR-KPI-05']).toContain((await rejection(cascade(u('E003'), 10))).code);
    expect(['ERR-KPI-04', 'ERR-KPI-05']).toContain((await rejection(cascade(u('E001'), 10))).code);
    await cascade(hr, 96_000_000_000);
    await cascade(u('E006'), 48_000_000_000);
    expect(await buckets(gateway, revenue)).toMatchObject({ target: REVENUE, assigned: 144_000_000_000, unassigned: 16_800_000_000, overAllocated: false });
    expect((await rejection(cascade(hr, 20_000_000_000))).code).toBe('ERR-KPI-11');
  });

  it('once HR starts the registration: the director (B1) and HR acting for him may cascade; the head and the CEO may not', async () => {
    const { gateway } = newGateway();
    const { dept, revenue, cascade } = await setUp(gateway);
    const form = await gateway.forms.startForm(S, hr, { workflowId: await workflowOf(gateway), subjectEmployeeId: emp('E006'), goalPlanId: dept.id, periodId: null, dueDate: '2027-04-17' });
    expect(form).toMatchObject({ formType: 'GOAL_SETTING', subjectEmployeeId: emp('E006'), status: 'Open' });
    expect((await gateway.forms.listInbox(S, u('E003'))).map((f) => f.id)).toContain(form.id);
    expect((await gateway.goals.getGoalPlan(S, dept.id)).status).toBe('Draft');

    expect((await rejection(cascade(u('E006'), 10))).code).toBe('ERR-KPI-05');
    expect((await rejection(cascade(u('E001'), 10))).code).toBe('ERR-KPI-05');
    await cascade(u('E003'), 50_000_000_000);
    await cascade(hr, 10_000_000_000);
    expect(await buckets(gateway, revenue)).toMatchObject({ assigned: 60_000_000_000, unassigned: 100_800_000_000 });
  });

  it('starting is refused when the cycle no longer accepts registration (CYCLE_NOT_OPEN)', async () => {
    const { gateway } = newGateway();
    const cskh = (await gateway.goals.listGoalPlans(S, { cycleId: cycle2027 })).find((p) => p.ownerType === 'OrgUnit' && p.ownerOrgUnitId === SYNTRA.unit('CSKH')) as GoalPlan;
    const input = { workflowId: await workflowOf(gateway), subjectEmployeeId: emp('E008'), goalPlanId: cskh.id, periodId: null, dueDate: '2027-04-17' };
    expect((await rejection(gateway.forms.startForm(S, hr, input))).detail).toBe('PLAN_LOCKED');
    await gateway.goals.unlockGoalPlan(S, hr, cskh.id, 'Bổ sung chỉ tiêu', '2027-04-17');
    await gateway.goals.setCycleStatus(S, hr, cycle2027, 'Evaluating');
    expect((await rejection(gateway.forms.startForm(S, hr, input))).detail).toBe('CYCLE_NOT_OPEN');
  });
});
