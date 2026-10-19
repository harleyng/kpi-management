import { describe, expect, it } from 'vitest';
import type { CycleStatus, FormInstance, GoalPlan, GoalPlanStatus } from '@/data/types';
import { TZ, calcMethod, delegation, form, goal, goals, kgi, level, months2027, periodTarget, plan, registrationSteps } from '@/test/builders';
import type { Clock } from './isoDate';
import { buildTenant } from './permissionFixtures.test-util';
import { can, resourceOfOwner } from './permissionRules';
import { canSeeGoal, linkCandidatePlans, planEditability, planReadiness, planRouteAllows, submitAvailability, visibleGoals, type OpenRegistration, type PlanEditInput, type ReadinessContext } from './planAccessRules';
import type { EntitlementContext } from './workflowRules';

const CLOCK: Clock = { now: '2027-04-06T02:00:00.000Z', tz: TZ };
const steps = registrationSteps();
const stepId = (no: number) => steps[no - 1].id;
// Registration of e1's plan: manager u-m1, employee u-e1, HR u-hr.
const regForm = (o: Partial<FormInstance> = {}) => form({ formType: 'GOAL_SETTING', periodId: null, currentStepId: stepId(2), status: 'InProgress', ...o });
const ctxAt = (no: number, o: Partial<EntitlementContext> = {}): EntitlementContext => ({
  stepActors: no === 1 || no === 3 ? ['u-m1'] : no === 2 ? ['u-e1'] : ['u-hr'],
  delegations: [],
  actorMayProxy: false,
  actorMayCancel: false,
  subjectUserId: 'u-e1',
  clock: CLOCK,
  ...o,
});
const open = (no: number, ctx: Partial<EntitlementContext> = {}, f: Partial<FormInstance> = {}): OpenRegistration => ({
  form: regForm({ currentStepId: stepId(no), ...f }),
  steps,
  ctx: ctxAt(no, ctx),
});
const input = (o: Partial<PlanEditInput> = {}): PlanEditInput => ({
  plan: { status: 'Draft' },
  cycleStatus: 'Active',
  openRegistration: null,
  actor: { userId: 'u-e1', employeeId: 'e1' },
  planOwnerEmployeeId: 'e1',
  actorIsPlanAdmin: false,
  ...o,
});

describe('planEditability — the one "may I change this plan now" (gateway + screens)', () => {
  it('owner on a Draft plan with no form → editable', () => {
    expect(planEditability(input())).toEqual({ decision: { ok: true }, reason: 'EDITABLE', standing: null, formFrozen: false });
  });

  it.each([
    ['Draft', false, 'NOT_OWNER', 'ERR-KPI-05'],
    ['Returned', false, 'NOT_OWNER', 'ERR-KPI-05'],
    ['Submitted', false, 'ADMIN_ONLY', 'ERR-KPI-04'],
    ['Approved', false, 'ADMIN_ONLY', 'ERR-KPI-04'],
  ] as const)('a non-owner without a form on %s → %s', (status, admin, reason, code) => {
    const r = planEditability(input({ plan: { status }, actor: { userId: 'u-x', employeeId: 'x' }, actorIsPlanAdmin: admin }));
    expect(r).toMatchObject({ reason, decision: { ok: false, code } });
  });

  it('a plan admin edits a Submitted / Approved plan with no open form', () => {
    expect(planEditability(input({ plan: { status: 'Approved' }, actor: { userId: 'u-hr', employeeId: 'hr' }, actorIsPlanAdmin: true })).reason).toBe('EDITABLE');
  });

  it.each(['Draft', 'Submitted', 'Approved'] as GoalPlanStatus[])('Locked beats everything; a Closed cycle too (%s)', (status) => {
    expect(planEditability(input({ plan: { status: 'Locked' }, actorIsPlanAdmin: true })).reason).toBe('LOCKED');
    expect(planEditability(input({ plan: { status }, cycleStatus: 'Closed' as CycleStatus, actorIsPlanAdmin: true })).reason).toBe('CYCLE_CLOSED');
  });

  it('a Locked plan with an open registration is flagged as a frozen form', () => {
    const r = planEditability(input({ plan: { status: 'Locked' }, openRegistration: open(2) }));
    expect(r).toMatchObject({ reason: 'LOCKED', formFrozen: true });
  });

  it('open form at step 2 (SELF, EDIT): the employee edits; the manager may not (NOT_STEP_ACTOR, 05)', () => {
    expect(planEditability(input({ openRegistration: open(2) })).reason).toBe('EDITABLE');
    const manager = planEditability(input({ openRegistration: open(2), actor: { userId: 'u-m1', employeeId: 'm1' } }));
    expect(manager).toMatchObject({ reason: 'NOT_STEP_ACTOR', decision: { ok: false, code: 'ERR-KPI-05' } });
  });

  it('open form at step 1 (manager cascades): the manager edits the report\'s plan; the employee waits', () => {
    expect(planEditability(input({ openRegistration: open(1), actor: { userId: 'u-m1', employeeId: 'm1' } })).reason).toBe('EDITABLE');
    expect(planEditability(input({ openRegistration: open(1) })).reason).toBe('NOT_STEP_ACTOR');
  });

  it('step 4 (HR, no EDIT) → STEP_NO_EDIT even for HR (the gateway answers 05, as before T3)', () => {
    const hr = planEditability(input({ plan: { status: 'Approved' }, openRegistration: open(4), actor: { userId: 'u-hr', employeeId: 'hr' }, actorIsPlanAdmin: true }));
    expect(hr).toMatchObject({ reason: 'STEP_NO_EDIT', decision: { ok: false, code: 'ERR-KPI-05' } });
  });

  it('a valid delegate of the step actor edits, and the standing names the delegator (both recorded)', () => {
    const d = delegation({ id: 'd1', fromUserId: 'u-m1', toUserId: 'u-m2', formType: 'GOAL_SETTING', validFrom: '2027-04-01', validTo: '2027-04-30' });
    const r = planEditability(input({ openRegistration: open(1, { delegations: [d] }), actor: { userId: 'u-m2', employeeId: 'm2' } }));
    expect(r).toMatchObject({ reason: 'EDITABLE', standing: { actorUserId: 'u-m2', onBehalfOfUserId: 'u-m1', delegationId: 'd1' } });
  });

  it('a delegation that expired mid-form → DELEGATION_EXPIRED', () => {
    const d = delegation({ fromUserId: 'u-m1', toUserId: 'u-m2', formType: 'GOAL_SETTING', validFrom: '2027-03-01', validTo: '2027-04-05' });
    const r = planEditability(input({ openRegistration: open(1, { delegations: [d] }), actor: { userId: 'u-m2', employeeId: 'm2' } }));
    expect(r).toMatchObject({ reason: 'DELEGATION_EXPIRED', decision: { ok: false, code: 'ERR-KPI-05' } });
  });

  it('HR as proxy at step 1 edits on behalf of the manager', () => {
    const r = planEditability(input({ openRegistration: open(1, { actorMayProxy: true }), actor: { userId: 'u-hr', employeeId: 'hr' }, actorIsPlanAdmin: true }));
    expect(r).toMatchObject({ reason: 'EDITABLE', standing: { actorUserId: 'u-hr', onBehalfOfUserId: 'u-m1', delegationId: null } });
  });

  it('a manager who left: nobody is the step actor — only a proxy may edit', () => {
    expect(planEditability(input({ openRegistration: open(1, { stepActors: [] }), actor: { userId: 'u-m1', employeeId: 'm1' } })).reason).toBe('NOT_STEP_ACTOR');
    const proxy = planEditability(input({ openRegistration: open(1, { stepActors: [], actorMayProxy: true }), actor: { userId: 'u-hr', employeeId: 'hr' } }));
    expect(proxy.reason).toBe('EDITABLE');
  });

  it('the subject acting at a manager step of their own form → SELF_APPROVAL', () => {
    const r = planEditability(input({ openRegistration: open(3, { stepActors: ['u-m1', 'u-e1'] }) }));
    expect(r.reason).toBe('SELF_APPROVAL');
  });

  it('after HR unlocks an auto-locked plan, the form at the same step is editable again', () => {
    const frozen = open(2, {}, { overdueHandledAt: '2027-01-09T02:00:00.000Z' });
    expect(planEditability(input({ plan: { status: 'Locked' }, openRegistration: frozen })).reason).toBe('LOCKED');
    const reentered = open(2, {}, { overdueHandledAt: null, currentStepEnteredAt: '2027-04-05T02:00:00.000Z' });
    expect(planEditability(input({ plan: { status: 'Draft' }, openRegistration: reentered })).reason).toBe('EDITABLE');
  });
});

describe('submitAvailability — "Gửi" is a dry run of forms.act (checkAction)', () => {
  const ready = goals(5);
  const kgis = [kgi({ id: 'k1' }), kgi({ id: 'k2' }), kgi({ id: 'k3' })];
  const avail = (no: number, userId: string, o: { ctx?: Partial<EntitlementContext>; goals?: typeof ready; form?: Partial<FormInstance>; plan?: GoalPlanStatus } = {}) =>
    submitAvailability({
      form: regForm({ currentStepId: stepId(no), ...o.form }),
      steps,
      plan: { status: o.plan ?? 'Draft' },
      goals: o.goals ?? ready,
      kgis,
      userId,
      ctx: ctxAt(no, o.ctx),
      clock: CLOCK,
    });

  it('the employee at step 2 with a complete plan → allowed, "Gửi"', () => {
    expect(avail(2, 'u-e1')).toMatchObject({ allowed: true, kind: 'SUBMIT', visible: true, actor: { actorUserId: 'u-e1', onBehalfOfUserId: null } });
  });

  it('the employee at step 2 with 90% → refused with the weight issue (07)', () => {
    const r = avail(2, 'u-e1', { goals: goals(5, [20, 20, 20, 20, 10]) });
    expect(r).toMatchObject({ allowed: false, visible: true, refusal: { code: 'ERR-KPI-07', detail: 'CONTENT_INCOMPLETE' } });
    expect(r.issues[0]).toMatchObject({ code: 'ERR-KPI-07', data: { totalWeight: 90 } });
  });

  it('the manager at step 1 with an INCOMPLETE plan → allowed, "Chuyển cho nhân viên"', () => {
    expect(avail(1, 'u-m1', { goals: [goal({ weight: 30 })] })).toMatchObject({ allowed: true, kind: 'HAND_TO_OWNER' });
  });

  it('the manager at step 3 — passes entitlement and content, but the step has no SUBMIT → refused, hidden', () => {
    const r = avail(3, 'u-m1', { plan: 'Submitted' });
    expect(r).toMatchObject({ allowed: false, visible: false });
    expect(r.refusal?.code).toBe('ERR-KPI-04');
  });

  it('the employee at step 3 → not entitled (05), hidden', () => {
    expect(avail(3, 'u-e1', { plan: 'Submitted' })).toMatchObject({ allowed: false, visible: false, refusal: { code: 'ERR-KPI-05' } });
  });

  it('a frozen form (auto-locked) → 04 FROZEN', () => {
    const r = avail(2, 'u-e1', { plan: 'Locked', form: { overdueHandledAt: '2027-01-09T02:00:00.000Z' } });
    expect(r).toMatchObject({ allowed: false, refusal: { code: 'ERR-KPI-04', detail: 'FROZEN' } });
  });

  it('a closed form → 04 FORM_CLOSED', () => {
    expect(avail(2, 'u-e1', { form: { status: 'Completed' } }).refusal).toEqual({ code: 'ERR-KPI-04', detail: 'FORM_CLOSED' });
  });

  it('HR as proxy at step 2 → allowed on behalf of the employee (both recorded)', () => {
    const r = avail(2, 'u-hr', { ctx: { actorMayProxy: true } });
    expect(r).toMatchObject({ allowed: true, visible: true, actor: { actorUserId: 'u-hr', onBehalfOfUserId: 'u-e1', delegationId: null } });
  });

  it('a valid delegate of the manager at step 1 → allowed with the delegation', () => {
    const d = delegation({ id: 'd9', fromUserId: 'u-m1', toUserId: 'u-m2', formType: 'GOAL_SETTING', validFrom: '2027-04-01', validTo: '2027-04-30' });
    expect(avail(1, 'u-m2', { ctx: { delegations: [d] } })).toMatchObject({ allowed: true, actor: { onBehalfOfUserId: 'u-m1', delegationId: 'd9' } });
  });
});

describe('canSeeGoal — PRIVATE goals (D2, product owner: owner + manager chain + Tenant scope)', () => {
  const t = buildTenant('t1');
  const ctx = { assignments: t.assignments, units: t.orgUnits, today: '2027-02-15' };
  const viewer = (key: Parameters<typeof t.profileOf>[0]) => ({ employeeId: key === 'system' ? null : t.employee(key as never), access: t.profileOf(key), tenantId: 't1' });
  const empPlan = { ownerEmployeeId: t.employee('emp'), ownerOrgUnitId: null } as Pick<GoalPlan, 'ownerEmployeeId' | 'ownerOrgUnitId'>;
  const secret = goal({ visibility: 'PRIVATE', ownerEmployeeId: t.employee('emp') });

  it('a PUBLIC goal → everyone', () => {
    expect(canSeeGoal(goal({ visibility: 'PUBLIC' }), empPlan, viewer('emp2'), ctx)).toBe(true);
  });

  it.each([
    ['emp', true], // the owner
    ['lead', true], // direct manager
    ['head', true], // manager of the manager
    ['ceo', true], // the top of the chain (also BOD, Tenant scope)
    ['hr', true], // Tenant scope
    ['emp2', false], // a peer
    ['opsEmp', false], // another unit
  ] as const)('PRIVATE goal of emp seen by %s → %s', (who, expected) => {
    expect(canSeeGoal(secret, empPlan, viewer(who), ctx)).toBe(expected);
  });

  it('a unit plan\'s private goal: the unit head is the owner', () => {
    const unitPlan = { ownerEmployeeId: null, ownerOrgUnitId: t.unit('sales') };
    const unitGoal = goal({ visibility: 'PRIVATE', ownerEmployeeId: null });
    expect(canSeeGoal(unitGoal, unitPlan, viewer('head'), ctx)).toBe(true);
    expect(canSeeGoal(unitGoal, unitPlan, viewer('lead'), ctx)).toBe(false);
  });

  it('a manager cycle in the data does not loop', () => {
    const loop = [
      ...t.assignments.filter((a) => a.employeeId !== t.employee('lead') && a.employeeId !== t.employee('head')),
      { ...t.assignments.find((a) => a.employeeId === t.employee('lead'))!, managerEmployeeId: t.employee('head') },
      { ...t.assignments.find((a) => a.employeeId === t.employee('head'))!, managerEmployeeId: t.employee('lead') },
    ];
    expect(canSeeGoal(secret, empPlan, viewer('emp2'), { ...ctx, assignments: loop })).toBe(false);
  });

  it('a system account with no employee and no Tenant scope sees no PRIVATE goal', () => {
    const system = { employeeId: null, access: { ...t.profileOf('emp'), coverage: new Map() }, tenantId: 't1' };
    expect(canSeeGoal(secret, empPlan, system, ctx)).toBe(false);
    expect(canSeeGoal(goal({ visibility: 'PUBLIC' }), empPlan, system, ctx)).toBe(true);
  });

  it('a goal whose plan is unknown shows only when PUBLIC (or to a Tenant scope)', () => {
    const list = [goal({ id: 'a', goalPlanId: 'gone' }), goal({ id: 'b', goalPlanId: 'gone', visibility: 'PRIVATE', ownerEmployeeId: null })];
    expect(visibleGoals(list, [], viewer('lead'), ctx).hiddenCount).toBe(1);
    expect(visibleGoals(list, [], viewer('hr'), ctx).hiddenCount).toBe(0);
  });

  it('visibleGoals filters and counts what was hidden', () => {
    const list = [goal({ id: 'a', goalPlanId: 'p' }), goal({ id: 'b', goalPlanId: 'p', visibility: 'PRIVATE', ownerEmployeeId: t.employee('emp') })];
    const plans = [plan({ id: 'p', ownerEmployeeId: t.employee('emp') })];
    expect(visibleGoals(list, plans, viewer('emp2'), ctx)).toEqual({ goals: [list[0]], hiddenCount: 1 });
    expect(visibleGoals(list, plans, viewer('lead'), ctx).hiddenCount).toBe(0);
  });
});

describe('planReadiness — the strip above "Gửi"', () => {
  const kgis = [kgi({ id: 'k1' }), kgi({ id: 'k2' }), kgi({ id: 'k3' })];
  const base = (o: Partial<ReadinessContext> = {}): ReadinessContext => ({
    levels: [], periodTargets: [], periods: months2027(), methods: [calcMethod({ id: 'cm1', methodType: 'RATIO_UP' })], kpiDefinitions: [], beforeOwnerStep: false, ...o,
  });

  it('a complete plan → nothing to fix', () => {
    expect(planReadiness(goals(5), kgis, base())).toEqual({ blocking: [], warnings: [], info: [] });
  });

  it('blocking = submitIssues (weights first); warnings never block', () => {
    const r = planReadiness(goals(4, [20, 20, 20, 20]), [kgi()], base());
    expect(r.blocking.map((i) => i.code)).toEqual(['ERR-KPI-07', 'ERR-KPI-08']);
    expect(r.warnings.map((i) => i.detail)).toEqual(['KGI_COUNT']);
  });

  it('before the owner\'s step the same checks are information, not blockers', () => {
    const r = planReadiness(goals(2, [30, 20]), kgis, base({ beforeOwnerStep: true }));
    expect(r.blocking).toEqual([]);
    expect(r.info.map((i) => i.code)).toEqual(['ERR-KPI-07', 'ERR-KPI-08']);
  });

  it('per goal: split, LEVELS without levels, TEXT under a numeric-only method', () => {
    const list = [
      goal({ id: 'split', kpiDefId: 'k', weight: 25, targetValue: 120 }),
      goal({ id: 'lv', calcMethodId: 'cm-lv', weight: 25 }),
      goal({ id: 'txt', targetType: 'TEXT', targetValue: null, targetText: 'Đạt', weight: 25 }),
      goal({ id: 'ok', calcMethodId: 'cm-lv', weight: 15 }),
      goal({ id: 'ok2', weight: 10 }),
    ];
    const r = planReadiness(list, kgis, base({
      kpiDefinitions: [{ id: 'k', aggregation: 'SUM' }],
      periodTargets: [periodTarget({ goalId: 'split', periodId: 'T01', targetValue: 10 })],
      methods: [calcMethod({ id: 'cm1', methodType: 'RATIO_UP' }), calcMethod({ id: 'cm-lv', methodType: 'LEVELS' })],
      levels: [level({ goalId: 'ok', levelCode: 'L1' }), level({ goalId: 'ok', levelCode: 'L2' }), level({ goalId: 'lv', levelCode: 'L1' })],
    }));
    expect(r.blocking).toEqual([]);
    expect(r.warnings.map((i) => `${i.ref}:${i.detail}`)).toEqual(['split:SPLIT_INCOMPLETE', 'lv:LEVELS_MISSING', 'txt:TARGET_TYPE_MISMATCH']);
  });

  it('cancelled goals are not checked', () => {
    const r = planReadiness([...goals(5), goal({ id: 'gone', status: 'Cancelled', calcMethodId: 'cm-lv', weight: 10 })], kgis, base({ methods: [calcMethod({ id: 'cm-lv', methodType: 'LEVELS' })] }));
    expect(r.warnings).toEqual([]);
  });
});

describe('linkCandidatePlans — where a goal may link up to', () => {
  const t = buildTenant('t1');
  const ctx = { assignments: t.assignments, units: t.orgUnits, today: '2027-02-15' };
  const p = (id: string, o: Partial<GoalPlan>) => plan({ id, cycleId: 'c', ownerType: 'Employee', ownerEmployeeId: null, ownerOrgUnitId: null, ...o });
  const company = p('company', { ownerType: 'Company', ownerOrgUnitId: t.unit('root') });
  const sales = p('sales', { ownerType: 'OrgUnit', ownerOrgUnitId: t.unit('sales') });
  const salesA = p('salesA', { ownerType: 'OrgUnit', ownerOrgUnitId: t.unit('salesA') });
  const lead = p('lead', { ownerEmployeeId: t.employee('lead') });
  const emp = p('emp', { ownerEmployeeId: t.employee('emp') });
  const other = p('other-cycle', { cycleId: 'old', ownerType: 'Company', ownerOrgUnitId: t.unit('root') });
  const all = [company, sales, salesA, lead, emp, other];

  it('an employee: the manager\'s plan, then the units up the chain, then the company — same cycle only', () => {
    expect(linkCandidatePlans(emp, all, ctx).map((x) => x.id)).toEqual(['lead', 'salesA', 'sales', 'company']);
  });

  it('a unit plan: the units above its unit, then the company; never itself', () => {
    expect(linkCandidatePlans(salesA, all, ctx).map((x) => x.id)).toEqual(['sales', 'company']);
    expect(linkCandidatePlans(company, all, ctx)).toEqual([]);
  });

  it('missing plans are skipped', () => {
    expect(linkCandidatePlans(emp, [emp, company], ctx).map((x) => x.id)).toEqual(['company']);
  });
});

describe('planRouteAllows — a typed plan id never opens someone else\'s plan', () => {
  const ctx = (o: Partial<Parameters<typeof planRouteAllows>[2]> = {}) => ({ mayView: true, viewerEmployeeId: 'e1', routeCycleId: null, ...o });
  const mine = plan({ ownerEmployeeId: 'e1' });
  const colleague = plan({ id: 'p2', ownerEmployeeId: 'e2' });
  const unitPlan = plan({ id: 'pu', ownerType: 'OrgUnit', ownerEmployeeId: null, ownerOrgUnitId: 'u1' });
  const companyPlan = plan({ id: 'pc', ownerType: 'Company', ownerEmployeeId: null, ownerOrgUnitId: 'root' });

  it.each([
    ['my: my own plan', mine, 'my', ctx(), true],
    ['my: a colleague\'s plan, even with scope over it', colleague, 'my', ctx(), false],
    ['my: a unit plan', unitPlan, 'my', ctx(), false],
    ['my: a system account has no own plan', mine, 'my', ctx({ viewerEmployeeId: null }), false],
    ['members: an Employee plan in scope', colleague, 'members', ctx(), true],
    ['members: a unit plan', unitPlan, 'members', ctx(), false],
    ['unit: an OrgUnit plan', unitPlan, 'unit', ctx(), true],
    ['unit: the Company plan', companyPlan, 'unit', ctx(), true],
    ['unit: an Employee plan', mine, 'unit', ctx(), false],
    ['cycles: a plan of the route\'s cycle', mine, 'cycles', ctx({ routeCycleId: 'c2027' }), true],
    ['cycles: a plan of another cycle', mine, 'cycles', ctx({ routeCycleId: 'c2026' }), false],
    ['cycles: no cycle in the route', mine, 'cycles', ctx(), false],
  ] as const)('%s → %s', (_name, p, kind, c, expected) => {
    expect(planRouteAllows(p, kind, c)).toBe(expected);
  });

  it.each(['my', 'members', 'unit', 'cycles'] as const)('%s: refused without goalplan.view over the owner', (kind) => {
    const p = kind === 'unit' ? unitPlan : mine;
    expect(planRouteAllows(p, kind, ctx({ mayView: false, routeCycleId: 'c2027' }))).toBe(false);
  });

  describe('with the real scope check (can + resourceOfOwner)', () => {
    const t = buildTenant('t1');
    const p = (id: string, o: Partial<GoalPlan>) => plan({ id, tenantId: 't1', ownerType: 'Employee', ownerEmployeeId: null, ownerOrgUnitId: null, ...o });
    const allows = (who: Parameters<typeof t.profileOf>[0], target: GoalPlan, kind: Parameters<typeof planRouteAllows>[1]) => {
      const profile = t.profileOf(who);
      return planRouteAllows(target, kind, { mayView: can(profile, 'goalplan.view', resourceOfOwner('t1', target)), viewerEmployeeId: profile.employeeId, routeCycleId: target.cycleId });
    };
    const empPlan = p('emp', { ownerEmployeeId: t.employee('emp') });
    const opsPlan = p('ops-emp', { ownerEmployeeId: t.employee('opsEmp') });
    const salesPlan = p('sales', { ownerType: 'OrgUnit', ownerOrgUnitId: t.unit('sales') });
    const opsUnitPlan = p('ops', { ownerType: 'OrgUnit', ownerOrgUnitId: t.unit('ops') });
    const company = p('company', { ownerType: 'Company', ownerOrgUnitId: t.unit('root') });

    it('a manager opens a plan inside their scope, not one outside it', () => {
      expect(allows('head', empPlan, 'members')).toBe(true);
      expect(allows('head', opsPlan, 'members')).toBe(false);
      expect(allows('head', salesPlan, 'unit')).toBe(true);
      expect(allows('head', opsUnitPlan, 'unit')).toBe(false);
    });

    it('an employee opens only their own plan — through any route', () => {
      expect(allows('emp', empPlan, 'my')).toBe(true);
      expect(allows('emp2', empPlan, 'my')).toBe(false);
      expect(allows('emp2', empPlan, 'members')).toBe(false);
      expect(allows('emp2', empPlan, 'cycles')).toBe(false);
    });

    it('the Company plan is readable by the whole tenant (BR-KPI-63)', () => {
      expect(allows('emp', company, 'unit')).toBe(true);
    });

    it('HR (Tenant scope) opens any plan of the cycle', () => {
      expect(allows('hr', opsPlan, 'cycles')).toBe(true);
      expect(allows('hr', opsUnitPlan, 'cycles')).toBe(true);
    });
  });
});
