import { describe, expect, it } from 'vitest';
import { DEMO, SYNTRA } from '@/data/fixtures';
import type { FormInstance, Goal, GoalPlan, Id } from '@/data/types';
import { allocationIssue, type CascadeChild } from '@/lib/alignmentRules';
import { todayOf } from '@/lib/isoDate';
import { buildAccessProfile } from '@/lib/permissionRules';
import { planEditabilityFrom, type PlanAccessRows } from '@/lib/planAccessRules';
import type { DataGateway } from '../types';
import { newGateway, rejection } from './gateway.test-util';

/**
 * Track T3 on the mock: the `saveGoal` allocation guard (BR-KPI-07) and the parity between the
 * screens' `planEditabilityFrom` (built from what the screens read) and the gateway's own plan-edit
 * guard (`assertPlanEditable` behind the authorize hook) — for every seeded plan and every person who
 * could be asked.
 */

const S = SYNTRA.tenantId;
const u = (code: string) => SYNTRA.user(code);
const admin = u(SYNTRA.personas.admin);
const hr = u(SYNTRA.personas.hr);
const cycle2027 = SYNTRA.id('PerformanceCycle', '2027');
const TZ = 'Asia/Ho_Chi_Minh';

async function cascadeParents(gw: DataGateway) {
  const cascades = (await gw.goals.listAlignments(S, { alignmentType: 'CASCADE' })).filter((a) => a.allocatedValue !== null);
  const goals = await gw.goals.listGoals(S);
  const byId = new Map(goals.map((g) => [g.id, g]));
  const parents = [...new Set(cascades.map((a) => a.parentGoalId))].map((id) => byId.get(id) as Goal);
  return { cascades, byId, parents };
}

describe('goals.saveGoal — a parent may not drop below what it handed down (T3, BR-KPI-07)', () => {
  it('no seeded parent is over-allocated today (so re-saving one unchanged never trips the guard)', async () => {
    const { gateway } = newGateway();
    const { cascades, byId, parents } = await cascadeParents(gateway);
    const employees = await gateway.org.listEmployees(S, { includeResigned: true });
    const asOf = todayOf({ now: gateway.clock.now(), tz: TZ });
    expect(parents.length).toBeGreaterThan(0);
    for (const parent of parents) {
      const children: CascadeChild[] = cascades
        .filter((a) => a.parentGoalId === parent.id)
        .map((a) => {
          const child = byId.get(a.childGoalId) as Goal;
          return { alignment: a, childGoal: child, childOwner: employees.find((e) => e.id === child.ownerEmployeeId) ?? null };
        });
      expect(allocationIssue(parent, children, asOf)).toBeNull();
    }
  });

  it('lowering a cascaded parent\'s target below its allocations → ERR-KPI-11, nothing written; a rename passes', async () => {
    const { gateway } = newGateway();
    const { cascades, parents } = await cascadeParents(gateway);
    const plans = await gateway.goals.listGoalPlans(S, { cycleId: cycle2027 });
    const parent = parents.find((p) => plans.find((pl) => pl.id === p.goalPlanId)?.ownerType === 'OrgUnit') as Goal;
    const plan = plans.find((p) => p.id === parent.goalPlanId) as GoalPlan;
    if (plan.status === 'Locked') await gateway.goals.unlockGoalPlan(S, hr, plan.id, 'Điều chỉnh mục tiêu', todayOf({ now: gateway.clock.now(), tz: TZ }));

    const allocated = cascades.filter((a) => a.parentGoalId === parent.id).reduce((sum, a) => sum + (a.allocatedValue ?? 0), 0);
    const refused = await rejection(gateway.goals.saveGoal(S, admin, { ...parent, targetValue: allocated / 2 }));
    expect(refused.code).toBe('ERR-KPI-11');
    expect((await gateway.goals.getGoal(S, parent.id)).targetValue).toBe(parent.targetValue);

    const tooMuchSelf = await rejection(gateway.goals.saveGoal(S, admin, { ...parent, selfAssignedValue: parent.targetValue }));
    expect(tooMuchSelf.code).toBe('ERR-KPI-11');
    const negative = await rejection(gateway.goals.saveGoal(S, admin, { ...parent, selfAssignedValue: -1 }));
    expect(negative).toMatchObject({ code: 'ERR-KPI-06' });
    const toText = await rejection(gateway.goals.saveGoal(S, admin, { ...parent, targetType: 'TEXT', targetValue: null, targetText: 'Đạt', selfAssignedValue: null }));
    expect(toText.code).toBe('ERR-KPI-06');

    await expect(gateway.goals.saveGoal(S, admin, { ...parent, name: `${parent.name} (đổi tên)` })).resolves.toMatchObject({ name: `${parent.name} (đổi tên)` });
  });

  it('the guard reads only the caller\'s tenant: another tenant\'s goal id answers 02 like a missing one', async () => {
    const { gateway } = newGateway();
    const { parents } = await cascadeParents(gateway);
    const foreign = await rejection(gateway.goals.saveGoal(DEMO.tenantId, DEMO.user(DEMO.personas.admin), { ...parents[0], targetValue: 1 }));
    expect(foreign.code).toBe('ERR-KPI-02');
  });
});

// ─── Parity: the screens' answer = the gateway's answer ───────────────────────────────────────

async function rowsFor(gw: DataGateway, plan: GoalPlan, userId: Id): Promise<PlanAccessRows> {
  const [accounts, employees, roles, permissions, rolePermissions, userRoles, units, assignments, delegations, steps, cycle] = await Promise.all([
    gw.org.listUserAccounts(S),
    gw.org.listEmployees(S, { includeResigned: true }),
    gw.org.listRoles(S),
    gw.org.listPermissions(S),
    gw.org.listRolePermissions(S),
    gw.org.listUserRoles(S),
    gw.org.listOrgUnits(S),
    gw.org.listAssignments(S),
    gw.forms.listDelegations(S),
    gw.forms.listWorkflowSteps(S),
    gw.goals.getCycle(S, plan.cycleId),
  ]);
  const forms: FormInstance[] = [];
  let cursor: string | undefined;
  do {
    const page = await gw.forms.listForms(S, { goalPlanId: plan.id }, { limit: 500, cursor });
    forms.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  const clock = { now: gw.clock.now(), tz: TZ };
  const account = accounts.find((a) => a.id === userId)!;
  const access = buildAccessProfile({ tenantId: S, account, roles, userRoles, permissions, rolePermissions, orgUnits: units, assignments, employees, asOf: todayOf(clock) });
  return {
    plan,
    cycleStatus: cycle.status,
    forms,
    steps,
    delegations,
    dir: { employees, assignments, users: accounts, userRoles, roles, units },
    access,
    actor: { userId, employeeId: account.employeeId },
    clock,
  };
}

/** A real plan edit that changes nothing: re-save a KGI, or a goal, unchanged. */
async function probe(gw: DataGateway, plan: GoalPlan, userId: Id): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    const [kgi] = await gw.goals.listKgis(S, plan.id);
    if (kgi) await gw.goals.saveKgi(S, userId, kgi);
    else {
      const [goal] = await gw.goals.listGoals(S, { goalPlanIds: [plan.id] });
      if (!goal) return { ok: true }; // nothing to re-save; skipped by the caller
      await gw.goals.saveGoal(S, userId, goal);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, code: (error as { code: string }).code };
  }
}

/** Every plan × every relevant person: the screens' decision = the gateway's. Returns how many were compared. */
async function compareAll(gateway: DataGateway, plansFilter: (p: GoalPlan) => boolean = () => true): Promise<number> {
  const plans = (await gateway.goals.listGoalPlans(S)).filter(plansFilter);
  const accounts = await gateway.org.listUserAccounts(S);
  const units = await gateway.org.listOrgUnits(S);
  const assignments = await gateway.org.listAssignments(S);
  const delegations = await gateway.forms.listDelegations(S);
  let compared = 0;
  for (const plan of plans) {
    if ((await gateway.goals.listKgis(S, plan.id)).length === 0 && (await gateway.goals.listGoals(S, { goalPlanIds: [plan.id] })).length === 0) continue;
    const ownerEmp = plan.ownerEmployeeId ?? units.find((x) => x.id === plan.ownerOrgUnitId)?.headEmployeeId ?? null;
    const managers = assignments.filter((a) => a.employeeId === ownerEmp && a.managerEmployeeId).map((a) => a.managerEmployeeId as Id);
    const people = new Set<Id>([admin, hr, u(SYNTRA.personas.bod), u(SYNTRA.personas.employee), ...delegations.map((d) => d.toUserId)]);
    for (const emp of [ownerEmp, ...managers]) {
      const account = accounts.find((a) => a.employeeId === emp && a.status === 'Active');
      if (account) people.add(account.id);
    }
    for (const userId of people) {
      if (!accounts.find((a) => a.id === userId && a.status === 'Active')) continue;
      const screen = planEditabilityFrom(await rowsFor(gateway, plan, userId)).decision;
      const actual = await probe(gateway, plan, userId);
      expect({ plan: plan.id, userId, ...actual }).toEqual({ plan: plan.id, userId, ...(screen.ok ? { ok: true } : { ok: false, code: screen.code }) });
      compared++;
    }
  }
  return compared;
}

describe('planEditabilityFrom agrees with the gateway guard — every seeded plan, every relevant person', () => {
  it('on the seed: same decision and same code', async () => {
    const { gateway } = newGateway();
    expect(await compareAll(gateway)).toBeGreaterThan(100);
  }, 60_000);

  it('after the state moves: a returned form, a plan locked with its form open, delegations expired, the cycle closed', async () => {
    const { gateway } = newGateway();
    const plans = await gateway.goals.listGoalPlans(S, { cycleId: cycle2027 });
    const forms = (await gateway.forms.listForms(S, { formType: 'GOAL_SETTING' }, { limit: 500 })).items.filter((f) => f.status === 'Open' || f.status === 'InProgress');
    const in2027 = (p: GoalPlan) => p.cycleId === cycle2027;

    // E017's form waits for the manager (step 3): return it to the employee.
    const e017 = forms.find((f) => f.subjectEmployeeId === SYNTRA.employee('E017')) as FormInstance;
    await gateway.forms.act(S, u('E006'), { formId: e017.id, expectedStepId: e017.currentStepId as Id, action: 'RETURN', comment: 'Bổ sung chỉ tiêu', onBehalfOfUserId: null, delegationId: null });
    // E030's plan: HR locks it while its registration form is open (the form freezes).
    await gateway.goals.lockGoalPlan(S, hr, plans.find((p) => p.ownerEmployeeId === SYNTRA.employee('E030'))!.id);
    expect(await compareAll(gateway, in2027)).toBeGreaterThan(20);

    // Every delegation's end passes.
    const latest = (await gateway.forms.listDelegations(S)).reduce((max, d) => (d.validTo > max ? d.validTo : max), '2027-01-01');
    gateway.dev!.setNow(`${latest}T20:00:00.000Z`);
    expect(await compareAll(gateway, in2027)).toBeGreaterThan(20);

    // The cycle closes: nothing of it is editable for anyone.
    await gateway.goals.setCycleStatus(S, admin, cycle2027, 'Evaluating');
    await gateway.goals.setCycleStatus(S, admin, cycle2027, 'Closed');
    expect(await compareAll(gateway, in2027)).toBeGreaterThan(20);
  }, 120_000);
});
