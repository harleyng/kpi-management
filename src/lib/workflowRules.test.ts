import { describe, expect, it } from 'vitest';
import type { FormInstance, WorkflowStep } from '@/data/types';
import {
  TZ,
  assignment,
  delegation,
  employee,
  evaluationItem,
  evaluationSteps,
  form,
  goals,
  launch,
  launchRule,
  months2027,
  orgUnit,
  period,
  plan,
  position,
  registrationSteps,
  role,
  step,
  user,
  userRole,
} from '@/test/builders';
import type { CanSubmitInput } from './formRules';
import {
  TRANSITIONS,
  checkAction,
  dueScheduledLaunches,
  entitlement,
  isDelegationValid,
  isFrozen,
  isInInbox,
  isOverdue,
  isReminderDue,
  launchDueDate,
  launchRuleFirings,
  mayEditAtCurrentStep,
  onUnlock,
  overdueActions,
  reminderKey,
  remindersDue,
  resolveRecipients,
  resolveStepActors,
  stepDeadline,
  transition,
  validateLaunch,
  validateWorkflow,
  type ActorDirectory,
  type CheckActionInput,
  type EntitlementContext,
} from './workflowRules';

const at = (now: string) => ({ now, tz: TZ });
const CLOCK = at('2027-02-03T03:00:00.000Z'); // 3 Feb, 10:00 in Hồ Chí Minh

/** e1 (employee) → m1 (manager) → l2 (director); hr1 is HR for the whole tenant. */
const units = [orgUnit({ id: 'root' }), orgUnit({ id: 'sale', parentId: 'root' }), orgUnit({ id: 'hr', parentId: 'root' })];
const people = ['e1', 'm1', 'm2', 'l2', 'hr1', 'hr2'];
const dir: ActorDirectory = {
  employees: people.map((id) => employee({ id })),
  assignments: [
    assignment({ employeeId: 'e1', orgUnitId: 'sale', managerEmployeeId: 'm1' }),
    assignment({ employeeId: 'm1', orgUnitId: 'sale', managerEmployeeId: 'l2' }),
    assignment({ employeeId: 'm2', orgUnitId: 'sale', managerEmployeeId: 'l2' }),
    assignment({ employeeId: 'l2', orgUnitId: 'root', managerEmployeeId: null }),
    assignment({ employeeId: 'hr1', orgUnitId: 'hr', managerEmployeeId: 'l2' }),
    assignment({ employeeId: 'hr2', orgUnitId: 'hr', managerEmployeeId: 'l2' }),
  ],
  users: people.map((id) => user({ id: `u-${id}`, employeeId: id, login: id })),
  userRoles: [userRole({ userId: 'u-hr1', roleId: 'r-HR', scopeType: 'Tenant' }), userRole({ userId: 'u-hr2', roleId: 'r-HR', scopeType: 'OrgUnit', scopeOrgUnitId: 'hr' })],
  roles: [role({ code: 'HR' }), role({ code: 'CNB' })],
  units,
};

const [selfStep, managerStep, hrStep] = evaluationSteps();
const reg = registrationSteps();

describe('validateWorkflow', () => {
  it('accepts the default registration and evaluation workflows', () => {
    expect(validateWorkflow('GOAL_SETTING', reg)).toEqual([]);
    expect(validateWorkflow('KPI_EVAL', evaluationSteps())).toEqual([]);
  });

  const details = (...args: Parameters<typeof validateWorkflow>) => validateWorkflow(...args).map((i) => i.detail);
  it.each([
    ['KPI_EVAL', [step({ stepNo: 1, allowedActions: ['SUBMIT', 'RETURN'] })], 'RETURN_ON_FIRST_STEP'],
    ['KPI_EVAL', [step({ stepNo: 1 }), step({ stepNo: 2, allowedActions: ['APPROVE'], onOverdue: 'AUTO_FORWARD' })], 'AUTO_FORWARD_ON_LAST_STEP'],
    ['KPI_EVAL', [step({ stepNo: 1, onOverdue: 'LOCK' }), step({ stepNo: 2, allowedActions: ['APPROVE'] })], 'LOCK_NOT_ALLOWED'],
    ['GOAL_CHANGE', [step({ stepNo: 1, onOverdue: 'LOCK' }), step({ stepNo: 2, allowedActions: ['APPROVE'] })], 'LOCK_NOT_ALLOWED'],
    ['GOAL_SETTING', [step({ stepNo: 1 })], 'TOO_FEW_STEPS'],
    ['GOAL_SETTING', [step({ stepNo: 1, actorRule: 'DIRECT_MANAGER' }), step({ stepNo: 2, actorRule: 'HR', allowedActions: ['APPROVE'] })], 'OWNER_STEP_REQUIRED'],
    ['KPI_EVAL', [step({ stepNo: 1 }), step({ stepNo: 3, allowedActions: ['APPROVE'] })], 'STEP_NUMBERS'],
    ['KPI_EVAL', [step({ stepNo: 1, allowedActions: ['EDIT'] })], 'NO_FORWARD_ACTION'],
    ['KPI_EVAL', [step({ stepNo: 1 }), step({ stepNo: 2, allowedActions: ['APPROVE', 'RETURN'], returnToStepNo: 2 })], 'RETURN_TARGET_INVALID'],
    ['KPI_EVAL', [step({ stepNo: 1, actorRule: 'ROLE', actorRoleId: null })], 'ROLE_REQUIRED'],
    ['KPI_EVAL', [step({ stepNo: 1, slaDays: -1 })], 'SLA_INVALID'],
    ['KPI_EVAL', [], 'STEPS_REQUIRED'],
  ] as const)('%s %# → %s', (formType, steps, detail) => {
    expect(details(formType, steps)).toContain(detail);
  });
});

describe('resolveStepActors — who acts, read at the time of the action', () => {
  it.each([
    [selfStep, ['u-e1']],
    [managerStep, ['u-m1']],
    [step({ actorRule: 'MANAGER_L2' }), ['u-l2']],
    [hrStep, ['u-hr1']], // hr2's scope is the HR unit only
  ])('%# → %j', (s, expected) => {
    expect(resolveStepActors(s, 'e1', dir, CLOCK)).toEqual(expected);
  });

  it('follows a manager change mid-form: the step moves to the new manager', () => {
    const moved: ActorDirectory = {
      ...dir,
      assignments: [
        assignment({ id: 'old', employeeId: 'e1', orgUnitId: 'sale', managerEmployeeId: 'm1', effectiveTo: '2027-02-14' }),
        assignment({ id: 'new', employeeId: 'e1', orgUnitId: 'sale', managerEmployeeId: 'm2', effectiveFrom: '2027-02-15' }),
        ...dir.assignments.filter((a) => a.employeeId !== 'e1'),
      ],
    };
    expect(resolveStepActors(managerStep, 'e1', moved, at('2027-02-14T10:00:00.000Z'))).toEqual(['u-m1']);
    expect(resolveStepActors(managerStep, 'e1', moved, at('2027-02-15T10:00:00.000Z'))).toEqual(['u-m2']);
  });

  it('never makes the subject an actor of a review step on their own form', () => {
    // hr1's own evaluation reaches the HR step: only other HR users may act
    const both: ActorDirectory = { ...dir, userRoles: [...dir.userRoles, userRole({ userId: 'u-hr2', roleId: 'r-HR', scopeType: 'Tenant' })] };
    expect(resolveStepActors(hrStep, 'hr1', both, CLOCK)).toEqual(['u-hr2']);
  });

  it('a top manager with no manager leaves the step unassigned (HR proxies)', () => {
    expect(resolveStepActors(managerStep, 'l2', dir, CLOCK)).toEqual([]);
  });

  it('a leaver has no SELF actor, but their manager and HR still get the form', () => {
    const left: ActorDirectory = {
      ...dir,
      employees: dir.employees.map((e) => (e.id === 'e1' ? { ...e, leftOn: '2027-01-15', employmentStatus: 'Resigned' as const } : e)),
      assignments: dir.assignments.map((a) => (a.employeeId === 'e1' ? { ...a, effectiveTo: '2027-01-15' } : a)),
    };
    expect(resolveStepActors(selfStep, 'e1', left, CLOCK)).toEqual([]);
    expect(resolveStepActors(managerStep, 'e1', left, CLOCK)).toEqual(['u-m1']);
    expect(resolveStepActors(hrStep, 'e1', left, CLOCK)).toEqual(['u-hr1']);
  });

  it('skips an inactive account', () => {
    const inactive: ActorDirectory = { ...dir, users: dir.users.map((u) => (u.id === 'u-m1' ? { ...u, status: 'Inactive' as const } : u)) };
    expect(resolveStepActors(managerStep, 'e1', inactive, CLOCK)).toEqual([]);
  });
});

describe('entitlement — actor, delegate, proxy (BR-KPI-21)', () => {
  const evalForm = form();
  const ctx = (o: Partial<EntitlementContext> = {}): EntitlementContext => ({
    stepActors: ['u-m1'], delegations: [], actorIsProxyAdmin: false, subjectUserId: 'u-e1', clock: CLOCK, ...o,
  });
  const as = (actorUserId: string, onBehalfOfUserId: string | null = null, delegationId: string | null = null) => ({ actorUserId, onBehalfOfUserId, delegationId });
  const outcome = (r: ReturnType<typeof entitlement>) => (r.ok ? r.mode : r.detail);

  it('lets the step actor act as themself', () => {
    expect(entitlement(evalForm, managerStep, 'APPROVE', as('u-m1'), ctx())).toMatchObject({ ok: true, mode: 'ACTOR', onBehalfOfUserId: null });
    expect(outcome(entitlement(evalForm, managerStep, 'APPROVE', as('u-m2'), ctx()))).toBe('NOT_STEP_ACTOR');
  });

  describe('a delegation, valid only for its form type, both dates inclusive, until revoked', () => {
    const d = delegation({ fromUserId: 'u-m1', toUserId: 'u-m2', validFrom: '2027-02-01', validTo: '2027-02-10' });
    const run = (now: string, o: Partial<typeof d> = {}) =>
      outcome(entitlement(evalForm, managerStep, 'APPROVE', as('u-m2', 'u-m1', 'd1'), ctx({ delegations: [{ ...d, ...o }], clock: at(now) })));

    it.each([
      ['2027-02-01T00:00:00+07:00', 'DELEGATE'],
      ['2027-02-10T23:59:00+07:00', 'DELEGATE'], // the last valid day
      ['2027-02-11T00:00:00+07:00', 'DELEGATION_NOT_VALID'], // expired mid-form: refused from that moment
      ['2027-01-31T23:59:00+07:00', 'DELEGATION_NOT_VALID'],
    ])('at %s → %s', (now, expected) => {
      expect(run(now)).toBe(expected);
    });

    it('stops at revocation, not before', () => {
      expect(run('2027-02-05T03:00:00.000Z', { revokedAt: '2027-02-05T03:00:00.000Z' })).toBe('DELEGATION_NOT_VALID');
      expect(run('2027-02-05T03:00:00.000Z', { revokedAt: '2027-02-06T03:00:00.000Z' })).toBe('DELEGATE');
    });

    it('is refused for another form type, another delegate, or a delegator no longer the actor', () => {
      expect(run('2027-02-05T03:00:00.000Z', { formType: 'GOAL_SETTING' })).toBe('DELEGATION_NOT_VALID');
      expect(run('2027-02-05T03:00:00.000Z', { toUserId: 'u-l2' })).toBe('DELEGATION_MISMATCH');
      const moved = entitlement(evalForm, managerStep, 'APPROVE', as('u-m2', 'u-m1', 'd1'), ctx({ delegations: [d], stepActors: ['u-l2'], clock: at('2027-02-05T03:00:00.000Z') }));
      expect(outcome(moved)).toBe('DELEGATOR_NOT_ACTOR');
    });
  });

  it('lets HR act as proxy for the step actor, recording both people', () => {
    expect(entitlement(evalForm, managerStep, 'APPROVE', as('u-hr1', 'u-m1'), ctx({ actorIsProxyAdmin: true }))).toEqual({
      ok: true, mode: 'PROXY', actorUserId: 'u-hr1', onBehalfOfUserId: 'u-m1', delegationId: null,
    });
    expect(outcome(entitlement(evalForm, managerStep, 'APPROVE', as('u-m2', 'u-m1'), ctx()))).toBe('PROXY_NOT_ALLOWED');
    expect(outcome(entitlement(evalForm, managerStep, 'APPROVE', as('u-hr1', 'u-l2'), ctx({ actorIsProxyAdmin: true })))).toBe('NOT_STEP_ACTOR');
  });

  it('lets HR unstick a step nobody is assigned to', () => {
    expect(entitlement(evalForm, managerStep, 'APPROVE', as('u-hr1'), ctx({ stepActors: [], actorIsProxyAdmin: true }))).toMatchObject({ ok: true, mode: 'PROXY', onBehalfOfUserId: null });
    expect(outcome(entitlement(evalForm, managerStep, 'APPROVE', as('u-hr1'), ctx({ stepActors: [] })))).toBe('NOT_STEP_ACTOR');
  });

  it('refuses self-approval, even for HR', () => {
    expect(outcome(entitlement(evalForm, hrStep, 'APPROVE', as('u-hr1'), ctx({ stepActors: ['u-hr1'], subjectUserId: 'u-hr1', actorIsProxyAdmin: true })))).toBe('SELF_APPROVAL');
    expect(outcome(entitlement(evalForm, selfStep, 'SUBMIT', as('u-e1'), ctx({ stepActors: ['u-e1'] })))).toBe('ACTOR');
  });

  it('lets only HR/ADMIN cancel, as themself', () => {
    expect(outcome(entitlement(evalForm, managerStep, 'CANCEL', as('u-hr1'), ctx({ actorIsProxyAdmin: true })))).toBe('ADMIN');
    expect(outcome(entitlement(evalForm, managerStep, 'CANCEL', as('u-m1'), ctx()))).toBe('CANCEL_NOT_ALLOWED');
  });

  it('isDelegationValid uses the tenant-zone date', () => {
    const d = delegation({ validFrom: '2027-02-01', validTo: '2027-02-01' });
    expect(isDelegationValid(d, 'KPI_EVAL', at('2027-01-31T17:00:00.000Z'))).toBe(true); // 1 Feb 00:00 +07
    expect(isDelegationValid(d, 'KPI_EVAL', at('2027-01-31T16:59:00.000Z'))).toBe(false);
  });
});

describe('TRANSITIONS — the one table', () => {
  it('covers every action a form can record', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual(['APPROVE', 'AUTO_FORWARD', 'AUTO_LOCK', 'CANCEL', 'RETURN', 'SUBMIT']);
  });
});

/** A content check that describes `f` at its current step and passes. */
function passingCheck(f: FormInstance, steps: WorkflowStep[]): CanSubmitInput {
  const current = steps.find((s) => s.id === f.currentStepId) as WorkflowStep;
  const planGoals = goals(5);
  if (f.formType === 'GOAL_SETTING') return { formType: 'GOAL_SETTING', stepNo: current.stepNo, steps, goals: planGoals, kgis: [] };
  const done = { selfAchievementPct: 100, selfComment: 'ok', managerAchievementPct: 100, managerComment: 'ok', finalAchievementPct: 100, finalComment: 'ok' };
  return { formType: 'KPI_EVAL', step: current, goals: planGoals, items: planGoals.map((g) => evaluationItem({ goalId: g.id, ...done })) };
}

/** Drives `checkAction` and applies its patch, the way the gateway will. */
function act(
  f: FormInstance,
  steps: WorkflowStep[],
  action: CheckActionInput['action'],
  actorUserId: string,
  o: Partial<CheckActionInput> = {},
) {
  const result = checkAction({
    form: f, steps, plan: null, action, expectedStepId: f.currentStepId ?? '', comment: action === 'RETURN' || action === 'CANCEL' ? 'Lý do' : null,
    actor: { actorUserId, onBehalfOfUserId: null, delegationId: null },
    entitlement: { stepActors: [actorUserId], delegations: [], actorIsProxyAdmin: false, subjectUserId: 'u-e1' },
    submitCheck: passingCheck(f, steps),
    clock: CLOCK, ...o,
  });
  if (!result.ok) throw new Error(`refused: ${result.code} ${result.detail}`);
  return { result, form: { ...f, ...result.form } };
}

describe('the evaluation, self → manager → HR (BR-KPI-16)', () => {
  const steps = evaluationSteps();
  const okCheck: CanSubmitInput = { formType: 'GOAL_SETTING', stepNo: 1, steps: reg, goals: [], kgis: [] };

  it('runs through every step to Completed, stamping each entry and recording both people', () => {
    let f = form({ currentStepId: 's1', status: 'Open' });
    const one = act(f, steps, 'SUBMIT', 'u-e1');
    expect(one.form).toMatchObject({ status: 'InProgress', currentStepId: 's2', currentStepEnteredAt: CLOCK.now, overdueHandledAt: null });
    expect(one.result.planStatus).toBeNull();
    f = one.form;
    const two = act(f, steps, 'APPROVE', 'u-hr1', {
      actor: { actorUserId: 'u-hr1', onBehalfOfUserId: 'u-m1', delegationId: null },
      entitlement: { stepActors: ['u-m1'], delegations: [], actorIsProxyAdmin: true, subjectUserId: 'u-e1' },
    });
    expect(two.result.record).toMatchObject({ action: 'APPROVE', stepId: 's2', actorUserId: 'u-hr1', onBehalfOfUserId: 'u-m1', delegationId: null });
    expect(two.result.mode).toBe('PROXY');
    const three = act(two.form, steps, 'APPROVE', 'u-hr1');
    expect(three.form).toMatchObject({ status: 'Completed', currentStepId: null });
    expect(three.result.nextStep).toBeNull();
  });

  it('refuses a SUBMIT whose content is incomplete, and names the items', () => {
    const planGoals = goals(5);
    const items = planGoals.map((g) => evaluationItem({ goalId: g.id }));
    const result = checkAction({
      form: form(), steps, plan: null, action: 'SUBMIT', expectedStepId: 's1', comment: null,
      actor: { actorUserId: 'u-e1', onBehalfOfUserId: null, delegationId: null },
      entitlement: { stepActors: ['u-e1'], delegations: [], actorIsProxyAdmin: false, subjectUserId: 'u-e1' },
      submitCheck: { formType: 'KPI_EVAL', step: selfStep, items, goals: planGoals }, clock: CLOCK,
    });
    expect(result).toMatchObject({ ok: false, code: 'ERR-KPI-09', detail: 'CONTENT_INCOMPLETE' });
    if (!result.ok) expect(result.issues).toHaveLength(5);
  });

  it('checks who before what: an outsider gets ERR-KPI-05 even with incomplete content', () => {
    const result = checkAction({
      form: form(), steps, plan: null, action: 'SUBMIT', expectedStepId: 's1', comment: null,
      actor: { actorUserId: 'u-m2', onBehalfOfUserId: null, delegationId: null },
      entitlement: { stepActors: ['u-e1'], delegations: [], actorIsProxyAdmin: false, subjectUserId: 'u-e1' },
      submitCheck: okCheck, clock: CLOCK,
    });
    expect(result).toMatchObject({ ok: false, code: 'ERR-KPI-05' });
  });

  it('insists on a content check for SUBMIT / APPROVE — no path skips canSubmit', () => {
    expect(() => act(form(), steps, 'SUBMIT', 'u-e1', { submitCheck: null })).toThrow();
  });

  it.each([
    ['another form type', okCheck],
    ['another step', { ...passingCheck(form(), steps), step: managerStep } as CanSubmitInput],
  ])('refuses a content check built for %s', (_label, submitCheck) => {
    expect(() => act(form(), steps, 'SUBMIT', 'u-e1', { submitCheck })).toThrow('SUBMIT_CHECK_MISMATCH');
  });

  it('refuses a registration check for an earlier (lenient) step', () => {
    const atOwner = form({ formType: 'GOAL_SETTING', periodId: null, currentStepId: 's2' });
    const lenient: CanSubmitInput = { formType: 'GOAL_SETTING', stepNo: 1, steps: reg, goals: [], kgis: [] };
    expect(() => act(atOwner, reg, 'SUBMIT', 'u-e1', { submitCheck: lenient })).toThrow('SUBMIT_CHECK_MISMATCH');
  });

  it.each([
    [{ expectedStepId: 's2' }, 'STALE_STEP'], // the form moved on since the screen loaded
    [{ form: form({ status: 'Completed', currentStepId: null }) }, 'FORM_CLOSED'],
  ])('refuses %j → %s', (o, detail) => {
    const result = checkAction({
      form: form(), steps, plan: null, action: 'SUBMIT', expectedStepId: 's1', comment: null,
      actor: { actorUserId: 'u-e1', onBehalfOfUserId: null, delegationId: null },
      entitlement: { stepActors: ['u-e1'], delegations: [], actorIsProxyAdmin: false, subjectUserId: 'u-e1' },
      submitCheck: okCheck, clock: CLOCK, ...o,
    });
    expect(result).toMatchObject({ ok: false, code: 'ERR-KPI-04', detail });
  });
});

describe('RETURN', () => {
  const steps = evaluationSteps();
  const atFinal = form({ currentStepId: 's3', status: 'InProgress', overdueHandledAt: '2027-02-02T00:00:00.000Z', currentStepEnteredAt: '2027-02-02T00:00:00.000Z' });

  it('at the LAST step goes back one step, re-stamps the entry and clears the overdue marker', () => {
    const { form: back } = act(atFinal, steps, 'RETURN', 'u-hr1');
    expect(back).toMatchObject({ currentStepId: 's2', currentStepEnteredAt: CLOCK.now, overdueHandledAt: null, status: 'InProgress' });
  });

  it('honours returnToStepNo', () => {
    const custom = steps.map((s) => (s.stepNo === 3 ? { ...s, returnToStepNo: 1 } : s));
    expect(act(atFinal, custom, 'RETURN', 'u-hr1').form.currentStepId).toBe('s1');
  });

  it('is refused on step 1, where it is not allowed, and without a comment', () => {
    const atOne = form({ currentStepId: 's1' });
    const withReturn = steps.map((s) => (s.stepNo === 1 ? { ...s, allowedActions: ['SUBMIT', 'RETURN'] as WorkflowStep['allowedActions'] } : s));
    expect(transition(atOne, withReturn, 'RETURN', { clock: CLOCK, comment: 'x' })).toMatchObject({ ok: false, detail: 'RETURN_ON_FIRST_STEP' });
    expect(transition(atOne, steps, 'RETURN', { clock: CLOCK, comment: 'x' })).toMatchObject({ ok: false, detail: 'ACTION_NOT_ALLOWED' });
    expect(transition(atFinal, steps, 'RETURN', { clock: CLOCK, comment: '  ' })).toMatchObject({ ok: false, code: 'ERR-KPI-06', detail: 'COMMENT_REQUIRED' });
  });
});

describe('registration moves the Goal Plan with it (BR-KPI-12)', () => {
  const f0 = form({ formType: 'GOAL_SETTING', periodId: null, currentStepId: 's1' });

  it('Draft → Submitted → Returned → Submitted → Approved → Locked', () => {
    const s1 = act(f0, reg, 'SUBMIT', 'u-m1'); // manager hands the cascaded plan to the employee
    expect(s1.result.planStatus).toBe('Draft');
    const s2 = act(s1.form, reg, 'SUBMIT', 'u-e1');
    expect(s2.result.planStatus).toBe('Submitted');
    const back = act(s2.form, reg, 'RETURN', 'u-m1');
    expect([back.form.currentStepId, back.result.planStatus]).toEqual(['s2', 'Returned']);
    const again = act(back.form, reg, 'SUBMIT', 'u-e1');
    const approved = act(again.form, reg, 'APPROVE', 'u-m1');
    expect(approved.result.planStatus).toBe('Approved');
    const recorded = act(approved.form, reg, 'APPROVE', 'u-hr1');
    expect([recorded.form.status, recorded.result.planStatus]).toEqual(['Completed', 'Locked']);
  });

  it('cancelling puts the plan back to Draft; only HR/ADMIN may', () => {
    const cancelled = act(f0, reg, 'CANCEL', 'u-hr1', { entitlement: { stepActors: ['u-m1'], delegations: [], actorIsProxyAdmin: true, subjectUserId: 'u-e1' } });
    expect([cancelled.form.status, cancelled.result.planStatus]).toEqual(['Cancelled', 'Draft']);
  });

  it('applies the proposal when a GOAL_CHANGE completes, leaving the plan status alone', () => {
    const change = form({ formType: 'GOAL_CHANGE', periodId: null, currentStepId: 's2' });
    const steps = [step({ stepNo: 1, actorRule: 'SELF' }), step({ stepNo: 2, actorRule: 'DIRECT_MANAGER', allowedActions: ['APPROVE'] })];
    const done = transition(change, steps, 'APPROVE', { clock: CLOCK, comment: null });
    expect(done).toMatchObject({ ok: true, applyGoalChanges: true, planStatus: null });
  });
});

describe('frozen forms (overdue LOCK, or HR locked the plan)', () => {
  const lockStep = reg[1]; // the employee's step: LOCK when overdue
  const frozen = form({ formType: 'GOAL_SETTING', periodId: null, currentStepId: 's2', overdueHandledAt: '2027-02-01T00:00:00.000Z' });

  it('is frozen after an overdue LOCK, or while HR has the plan locked', () => {
    expect(isFrozen(frozen, lockStep, plan({ status: 'Locked' }))).toBe(true);
    expect(isFrozen({ ...frozen, overdueHandledAt: null }, lockStep, plan({ status: 'Locked' }))).toBe(true);
    expect(isFrozen({ ...frozen, overdueHandledAt: null }, lockStep, plan({ status: 'Draft' }))).toBe(false);
    expect(isFrozen(form({ overdueHandledAt: '2027-02-01T00:00:00.000Z' }), selfStep, null)).toBe(false); // REMIND/forward never freeze
  });

  it('refuses every person action except CANCEL', () => {
    const base = {
      form: frozen, steps: reg, plan: plan({ status: 'Locked' as const }), expectedStepId: 's2', comment: 'x',
      actor: { actorUserId: 'u-hr1', onBehalfOfUserId: null, delegationId: null },
      entitlement: { stepActors: ['u-e1'], delegations: [], actorIsProxyAdmin: true, subjectUserId: 'u-e1' },
      submitCheck: null, clock: CLOCK,
    };
    expect(checkAction({ ...base, action: 'SUBMIT' })).toMatchObject({ ok: false, detail: 'FROZEN' });
    expect(checkAction({ ...base, action: 'CANCEL' })).toMatchObject({ ok: true });
  });

  it('unlocking restarts the step with the new due date', () => {
    expect(onUnlock(frozen, '2027-02-20', CLOCK)).toEqual({ dueDate: '2027-02-20', currentStepEnteredAt: CLOCK.now, overdueHandledAt: null });
    expect(onUnlock(form({ status: 'Completed' }), '2027-02-20', CLOCK)).toBeNull();
  });

  it('mayEditAtCurrentStep needs EDIT on the step, entitlement, and no freeze', () => {
    const ctx = { stepActors: ['u-e1'], delegations: [], actorIsProxyAdmin: false, subjectUserId: 'u-e1', clock: CLOCK };
    const editable = { ...frozen, overdueHandledAt: null };
    const me = { actorUserId: 'u-e1', onBehalfOfUserId: null, delegationId: null };
    expect(mayEditAtCurrentStep(editable, reg, plan({ status: 'Draft' }), me, ctx)).toBe(true);
    expect(mayEditAtCurrentStep(editable, reg, plan({ status: 'Locked' }), me, ctx)).toBe(false);
    expect(mayEditAtCurrentStep(editable, reg, plan({ status: 'Draft' }), { ...me, actorUserId: 'u-m2' }, ctx)).toBe(false);
    expect(mayEditAtCurrentStep(form({ currentStepId: 's1' }), evaluationSteps(), null, me, ctx)).toBe(false); // no EDIT there
  });
});

describe('time — deadline, overdue, reminders (BR-KPI-13)', () => {
  // self step: SLA 7 days, AUTO_FORWARD when overdue, reminder 2 days before
  const entered = form({ currentStepEnteredAt: '2027-02-01T01:00:00.000Z', dueDate: '2027-02-28' });

  it('takes min(entered + SLA, due date), in the tenant zone', () => {
    expect(stepDeadline(entered, selfStep, TZ)).toBe('2027-02-08');
    expect(stepDeadline({ ...entered, dueDate: '2027-02-05' }, selfStep, TZ)).toBe('2027-02-05');
    expect(stepDeadline(entered, { slaDays: null }, TZ)).toBe('2027-02-28');
    // entered at 23:30 local on 31 Jan (16:30Z) counts from 31 Jan, at 00:30 local on 1 Feb from 1 Feb
    expect(stepDeadline({ ...entered, currentStepEnteredAt: '2027-01-31T16:30:00.000Z' }, selfStep, TZ)).toBe('2027-02-07');
    expect(stepDeadline({ ...entered, currentStepEnteredAt: '2027-01-31T17:30:00.000Z' }, selfStep, TZ)).toBe('2027-02-08');
  });

  it.each([
    ['2027-02-08T16:59:00.000Z', false], // 23:59 on the deadline day: still on time
    ['2027-02-08T17:00:00.000Z', true], // 00:00 the next day
  ])('at %s overdue: %s', (now, expected) => {
    expect(isOverdue(entered, selfStep, at(now))).toBe(expected);
  });

  it('auto-forwards once per entry into the step, one hop per tick', () => {
    const late = at('2027-02-10T03:00:00.000Z');
    const steps = evaluationSteps().map((s) => (s.stepNo === 2 ? { ...s, slaDays: 1, onOverdue: 'AUTO_FORWARD' as const } : s));
    expect(overdueActions([entered], steps, late)).toEqual([{ formId: 'f1', stepId: 's1', behaviour: 'AUTO_FORWARD', action: 'AUTO_FORWARD' }]);

    const moved = transition(entered, steps, 'AUTO_FORWARD', { clock: late, comment: null });
    expect(moved).toMatchObject({ ok: true, record: { action: 'AUTO_FORWARD' } });
    if (!moved.ok) return;
    const next = { ...entered, ...moved.form };
    expect(next).toMatchObject({ status: 'InProgress', currentStepId: 's2', overdueHandledAt: null });
    // the new step is not overdue yet: nothing more this tick or the next
    expect(overdueActions([next], steps, late)).toEqual([]);
  });

  it('REMIND fires once: after the gateway sets overdueHandledAt nothing repeats; re-entering fires again', () => {
    const remindStep = { ...selfStep, onOverdue: 'REMIND' as const };
    const late = at('2027-02-10T03:00:00.000Z');
    expect(overdueActions([entered], [remindStep], late)).toEqual([{ formId: 'f1', stepId: 's1', behaviour: 'REMIND', action: null }]);
    const handled = { ...entered, overdueHandledAt: late.now };
    expect(overdueActions([handled], [remindStep], late)).toEqual([]);
    const reentered = { ...handled, overdueHandledAt: null, currentStepEnteredAt: '2027-02-01T01:00:00.000Z' };
    expect(overdueActions([reentered], [remindStep], late)).toHaveLength(1);
  });

  it('falls back to REMIND for AUTO_FORWARD on the last step and LOCK outside registration', () => {
    const late = at('2027-03-10T03:00:00.000Z');
    const last = form({ currentStepId: 's3' });
    const steps = evaluationSteps().map((s) => (s.stepNo === 3 ? { ...s, onOverdue: 'AUTO_FORWARD' as const } : s));
    expect(overdueActions([last], steps, late)[0]).toMatchObject({ behaviour: 'REMIND', action: null });
    const lockedEval = evaluationSteps().map((s) => (s.stepNo === 1 ? { ...s, onOverdue: 'LOCK' as const } : s));
    expect(overdueActions([form()], lockedEval, late)[0]).toMatchObject({ behaviour: 'REMIND', action: null });
    expect(transition(last, steps, 'AUTO_FORWARD', { clock: late, comment: null })).toMatchObject({ ok: false, detail: 'AUTO_FORWARD_ON_LAST_STEP' });
  });

  it('locks a registration plan when its step runs over, freezing the form', () => {
    const regForm = form({ formType: 'GOAL_SETTING', periodId: null, currentStepId: 's2', currentStepEnteredAt: '2027-02-01T01:00:00.000Z' });
    const late = at('2027-02-10T03:00:00.000Z');
    expect(overdueActions([regForm], reg, late)[0]).toMatchObject({ behaviour: 'LOCK', action: 'AUTO_LOCK' });
    const locked = transition(regForm, reg, 'AUTO_LOCK', { clock: late, comment: null });
    expect(locked).toMatchObject({ ok: true, planStatus: 'Locked', form: { currentStepId: 's2', overdueHandledAt: late.now } });
  });

  it('ignores closed forms and steps with no overdue behaviour', () => {
    const late = at('2027-03-10T03:00:00.000Z');
    expect(overdueActions([form({ status: 'Completed', currentStepId: null })], evaluationSteps(), late)).toEqual([]);
    expect(overdueActions([form({ currentStepId: 's2' })], evaluationSteps(), late)).toEqual([]);
  });

  it('reminds within remindDaysBefore of the deadline, until it is overdue, with one key per entry', () => {
    expect(isReminderDue(entered, selfStep, at('2027-02-05T03:00:00.000Z'))).toBe(false);
    expect(isReminderDue(entered, selfStep, at('2027-02-06T03:00:00.000Z'))).toBe(true);
    expect(isReminderDue(entered, selfStep, at('2027-02-08T03:00:00.000Z'))).toBe(true);
    expect(isReminderDue(entered, selfStep, at('2027-02-09T03:00:00.000Z'))).toBe(false);
    const due = remindersDue([entered], evaluationSteps(), at('2027-02-06T03:00:00.000Z'));
    const again = remindersDue([entered], evaluationSteps(), at('2027-02-07T03:00:00.000Z'));
    expect(due[0].key).toBe(again[0].key); // two ticks, one notification
    expect(reminderKey({ ...entered, currentStepEnteredAt: '2027-02-02T00:00:00.000Z' })).not.toBe(due[0].key);
  });
});

describe('inbox', () => {
  it('shows the form to its step actors and their valid delegates', () => {
    const d = delegation({ fromUserId: 'u-m1', toUserId: 'u-m2' });
    expect(isInInbox(form(), 'u-m1', ['u-m1'], [], CLOCK)).toBe(true);
    expect(isInInbox(form(), 'u-m2', ['u-m1'], [d], CLOCK)).toBe(true);
    expect(isInInbox(form(), 'u-m2', ['u-m1'], [d], at('2027-03-01T03:00:00.000Z'))).toBe(false);
    expect(isInInbox(form({ status: 'Completed' }), 'u-m1', ['u-m1'], [], CLOCK)).toBe(false);
  });
});

describe('launches (BR-KPI-19, D5)', () => {
  it('sets the due date from the launch day in the tenant zone', () => {
    expect(launchDueDate('2027-02-01T01:00:00.000Z', 7, TZ)).toBe('2027-02-08');
    expect(launchDueDate('2027-01-31T17:30:00.000Z', 7, TZ)).toBe('2027-02-08'); // already 1 Feb locally
  });

  it.each([
    [{ formType: 'GOAL_CHANGE' as const }, 'NOT_LAUNCHABLE'],
    [{ periodId: null }, 'PERIOD_REQUIRED'],
    [{ formType: 'GOAL_SETTING' as const, cycleId: null, periodId: null }, 'CYCLE_REQUIRED'],
    [{ dueDays: -1 }, 'DUE_DAYS_INVALID'],
    [{ recipientMode: 'FILTER' as const, recipientFilter: null }, 'FILTER_REQUIRED'],
  ])('validateLaunch %j → %s', (o, detail) => {
    expect(validateLaunch(launch(o)).map((i) => i.detail)).toContain(detail);
    expect(validateLaunch(launch())).toEqual([]);
  });

  it('finds the SCHEDULED launches that are due', () => {
    const later = launch({ id: 'later', status: 'Scheduled', scheduledAt: '2027-02-04T00:00:00.000Z' });
    const now = launch({ id: 'now', status: 'Scheduled', scheduledAt: '2027-02-03T03:00:00.000Z' });
    expect(dueScheduledLaunches([later, now, launch()], CLOCK).map((l) => l.id)).toEqual(['now']);
  });

  describe('resolveRecipients', () => {
    const jan = period();
    const staff = position({ id: 'pos-staff', jobLevel: 'Staff' });
    const head = position({ id: 'pos-head', jobLevel: 'DeptHead' });
    const ctx = {
      employees: [
        employee({ id: 'a' }),
        employee({ id: 'b' }),
        employee({ id: 'leaver', leftOn: '2027-01-15', employmentStatus: 'Resigned' }),
        employee({ id: 'gone', leftOn: '2026-12-31', employmentStatus: 'Resigned' }),
        employee({ id: 'noplan' }),
        employee({ id: 'nounit' }),
        employee({ id: 'boss' }),
      ],
      assignments: [
        assignment({ employeeId: 'a', orgUnitId: 'team' }),
        assignment({ employeeId: 'b', orgUnitId: 'hr' }),
        assignment({ employeeId: 'leaver', orgUnitId: 'team', effectiveTo: '2027-01-15' }),
        assignment({ employeeId: 'gone', orgUnitId: 'team', effectiveTo: '2026-12-31' }),
        assignment({ employeeId: 'noplan', orgUnitId: 'team' }),
        assignment({ employeeId: 'boss', orgUnitId: 'sale', positionId: 'pos-head' }),
      ],
      units: [...units, orgUnit({ id: 'team', parentId: 'sale' })],
      positions: [staff, head],
      existingForms: [form({ id: 'old', subjectEmployeeId: 'b', periodId: 'T01' }), form({ id: 'x', subjectEmployeeId: 'a', periodId: 'T01', status: 'Cancelled' })],
      plans: ['a', 'b', 'leaver', 'boss', 'nounit'].map((id) => plan({ id: `p-${id}`, ownerEmployeeId: id, status: 'Locked' })),
      period: jan,
      launchDate: '2027-02-01',
    };

    it('ALL: everyone who worked in the period, minus duplicates and those without a locked plan', () => {
      const r = resolveRecipients(launch(), ctx);
      expect(r.subjects.sort()).toEqual(['a', 'boss', 'leaver']); // the leaver worked half of January; a's earlier form was cancelled
      expect(r.skipped).toEqual(
        expect.arrayContaining([
          { employeeId: 'b', reason: 'ALREADY_HAS_FORM' },
          { employeeId: 'noplan', reason: 'NO_APPROVED_PLAN' },
          { employeeId: 'nounit', reason: 'NO_PRIMARY_ASSIGNMENT' },
        ]),
      );
      expect(r.skipped.map((s) => s.employeeId)).not.toContain('gone'); // left out silently
    });

    it('FILTER: AND across fields, OR within one, units with their children', () => {
      const filter = { orgUnitIds: ['sale'], includeChildUnits: true, positionIds: [], jobLevels: ['Staff' as const], employmentStatuses: [], employeeIds: [] };
      expect(resolveRecipients(launch({ recipientMode: 'FILTER', recipientFilter: filter }), ctx).subjects.sort()).toEqual(['a', 'leaver']);
      const noChildren = { ...filter, includeChildUnits: false, jobLevels: [] };
      expect(resolveRecipients(launch({ recipientMode: 'FILTER', recipientFilter: noChildren }), ctx).subjects).toEqual(['boss']);
    });

    it('finds the cycle through the period when an evaluation launch leaves cycleId empty', () => {
      expect(resolveRecipients(launch({ cycleId: null }), ctx).subjects.sort()).toEqual(['a', 'boss', 'leaver']);
    });

    it('reports a person named by hand who is not employed', () => {
      const filter = { orgUnitIds: [], includeChildUnits: false, positionIds: [], jobLevels: [], employmentStatuses: [], employeeIds: ['gone', 'a'] };
      const r = resolveRecipients(launch({ recipientMode: 'FILTER', recipientFilter: filter }), ctx);
      expect(r.subjects).toEqual(['a']);
      expect(r.skipped).toEqual([{ employeeId: 'gone', reason: 'NOT_EMPLOYED' }]);
    });

    it('registration: employed on the launch day; creates missing Draft plans; skips an open registration', () => {
      const regCtx = {
        ...ctx,
        period: null,
        plans: [plan({ id: 'p-a', ownerEmployeeId: 'a', status: 'Draft' })],
        existingForms: [form({ formType: 'GOAL_SETTING', subjectEmployeeId: 'a', goalPlanId: 'p-a', periodId: null })],
      };
      const r = resolveRecipients(launch({ formType: 'GOAL_SETTING', periodId: null }), regCtx);
      expect(r.subjects).not.toContain('leaver'); // gone by the launch day
      expect(r.skipped).toContainEqual({ employeeId: 'a', reason: 'ALREADY_HAS_FORM' });
      expect(r.needsDraftPlan.sort()).toEqual(['b', 'boss', 'noplan']);
    });
  });

  describe('launchRuleFirings — day 1 of each month, once per (rule, period)', () => {
    const cycles = [{ id: 'c2027', status: 'Active' as const }];
    const months = months2027();

    it('fires January on 1 February (period end + 1 day), not before', () => {
      expect(launchRuleFirings([launchRule()], months, cycles, [], at('2027-01-31T16:59:00.000Z'))).toEqual([]);
      expect(launchRuleFirings([launchRule()], months, cycles, [], at('2027-01-31T17:00:00.000Z'))).toEqual([
        { ruleId: 'lr1', periodId: 'T01', cycleId: 'c2027', fireDate: '2027-02-01' },
      ]);
    });

    it('never fires twice: a second tick with the first launch recorded finds nothing', () => {
      const now = at('2027-02-01T03:00:00.000Z');
      const first = launchRuleFirings([launchRule()], months, cycles, [], now);
      const launches = first.map((f) => ({ launchRuleId: f.ruleId, periodId: f.periodId }));
      expect(launchRuleFirings([launchRule()], months, cycles, launches, now)).toEqual([]);
    });

    it('catches up missed months in order', () => {
      const firings = launchRuleFirings([launchRule()], months, cycles, [], at('2027-04-05T03:00:00.000Z'));
      expect(firings.map((f) => [f.periodId, f.fireDate])).toEqual([
        ['T01', '2027-02-01'],
        ['T02', '2027-03-01'],
        ['T03', '2027-04-01'],
      ]);
    });

    it('skips inactive rules, cycles that are not Active, other period types and cancelled launches', () => {
      const now = at('2027-02-05T03:00:00.000Z');
      expect(launchRuleFirings([launchRule({ isActive: false })], months, cycles, [], now)).toEqual([]);
      expect(launchRuleFirings([launchRule()], months, [{ id: 'c2027', status: 'Planning' }], [], now)).toEqual([]);
      expect(launchRuleFirings([launchRule({ periodType: 'Quarter' })], months, cycles, [], now)).toEqual([]);
      expect(launchRuleFirings([launchRule()], months, cycles, [{ launchRuleId: 'lr1', periodId: 'T01' }], now)).toEqual([]);
    });
  });
});
