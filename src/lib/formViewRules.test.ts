import { describe, expect, it } from 'vitest';
import type { KpiDefinition } from '@/data/types';
import {
  TZ,
  assignment,
  delegation,
  employee,
  evaluationItem,
  evaluationSteps,
  form,
  goal,
  goalChange,
  goals,
  kgi,
  level,
  orgUnit,
  plan,
  registrationSteps,
  role,
  step,
  user,
  userRole,
} from '@/test/builders';
import {
  actorDirectoryOf,
  delegationState,
  formStanding,
  goalDraftFromGoal,
  goalDraftFromKpi,
  isDelegationRevocable,
  stepTiming,
  submitCheckInput,
  workflowEditWarnings,
  type FormStandingInput,
} from './formViewRules';
import { canSubmit } from './formRules';
import { checkAction, type ActorDirectory } from './workflowRules';

const at = (now: string) => ({ now, tz: TZ });
const CLOCK = at('2027-02-03T03:00:00.000Z'); // 3 Feb, 10:00 in Hồ Chí Minh

/** e1 (employee) → m1 (manager) → l2 (director, no manager); hr1, hr2 HR for the whole tenant. */
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
  userRoles: [userRole({ userId: 'u-hr1', roleId: 'r-HR' }), userRole({ userId: 'u-hr2', roleId: 'r-HR' })],
  roles: [role({ code: 'HR' })],
  units: [orgUnit({ id: 'root' }), orgUnit({ id: 'sale', parentId: 'root' }), orgUnit({ id: 'hr', parentId: 'root' })],
};

/** Evaluation steps that also allow EDIT (the seed's shape), so "Lưu nháp" can be asserted. */
const evalSteps = evaluationSteps().map((s) => ({ ...s, allowedActions: [...s.allowedActions, 'EDIT' as const] }));
const [selfStep, managerStep, hrStep] = evalSteps;

const standing = (o: Partial<FormStandingInput> = {}) =>
  formStanding({
    form: form({ currentStepId: managerStep.id, status: 'InProgress' }),
    steps: evalSteps,
    plan: plan({ status: 'Locked' }),
    directory: dir,
    delegations: [],
    userId: 'u-m1',
    mayProxy: false,
    mayCancel: false,
    clock: CLOCK,
    ...o,
  });

describe('actorDirectoryOf', () => {
  it('maps the session directory onto the actor rules\' names', () => {
    const d = actorDirectoryOf({ accounts: dir.users, employees: dir.employees, roles: dir.roles, userRoles: dir.userRoles, orgUnits: dir.units, assignments: dir.assignments });
    expect(d).toEqual(dir);
  });
});

describe('formStanding — who may do what now', () => {
  it('the step actor gets the step\'s actions as ACTOR, as themself', () => {
    const s = standing();
    expect(s.mode).toBe('ACTOR');
    expect(s.standing).toEqual({ actorUserId: 'u-m1', onBehalfOfUserId: null, delegationId: null });
    expect(s.actions).toEqual(['APPROVE', 'RETURN']);
    expect(s.canEdit).toBe(true);
    expect(s.editColumn).toBe('MANAGER');
    expect(s.returnTarget?.id).toBe(selfStep.id);
    expect(s.stepActors).toEqual(['u-m1']);
    expect(s.readOnlyReason).toBeNull();
  });

  it('the subject at their own SELF step submits and fills the SELF column', () => {
    const s = standing({ form: form({ currentStepId: selfStep.id }), userId: 'u-e1' });
    expect(s.actions).toEqual(['SUBMIT']);
    expect(s.editColumn).toBe('SELF');
    expect(s.returnTarget).toBeNull(); // step 1 has no RETURN
  });

  it('the subject on a review step of their own form gets nothing — even when they hold HR rights', () => {
    for (const mayProxy of [false, true]) {
      const s = standing({ userId: 'u-e1', mayProxy });
      expect(s.actions).toEqual([]);
      expect(s.standing).toBeNull();
      expect(s.readOnlyReason).toBe('OWN_REVIEW');
    }
  });

  it('…but keeps CANCEL when they have the cancel right (CANCEL is never a step decision)', () => {
    expect(standing({ userId: 'u-e1', mayCancel: true }).actions).toEqual(['CANCEL']);
  });

  it('someone with no part in the step reads only', () => {
    const s = standing({ userId: 'u-m2' });
    expect(s.actions).toEqual([]);
    expect(s.readOnlyReason).toBe('NOT_YOUR_STEP');
    expect(s.canEdit).toBe(false);
  });

  describe('delegation (BR-KPI-21)', () => {
    const d1 = delegation({ id: 'd1', fromUserId: 'u-m1', toUserId: 'u-m2' });

    it('a valid delegate acts for the delegator, both recorded', () => {
      const s = standing({ userId: 'u-m2', delegations: [d1] });
      expect(s.mode).toBe('DELEGATE');
      expect(s.standing).toEqual({ actorUserId: 'u-m2', onBehalfOfUserId: 'u-m1', delegationId: 'd1' });
      expect(s.actions).toEqual(['APPROVE', 'RETURN']);
      expect(s.assignees).toEqual(['u-m1', 'u-m2']);
    });

    it('stops granting the day after validTo, and the moment it is revoked', () => {
      expect(standing({ userId: 'u-m2', delegations: [d1], clock: at('2027-02-10T16:59:00.000Z') }).mode).toBe('DELEGATE'); // 10 Feb 23:59
      expect(standing({ userId: 'u-m2', delegations: [d1], clock: at('2027-02-10T17:00:00.000Z') }).readOnlyReason).toBe('NOT_YOUR_STEP');
      const revoked = { ...d1, revokedAt: '2027-02-03T02:00:00.000Z' };
      expect(standing({ userId: 'u-m2', delegations: [revoked] }).readOnlyReason).toBe('NOT_YOUR_STEP');
    });

    it('grants nothing when the delegator is no longer the step\'s actor, or for another form type', () => {
      expect(standing({ userId: 'u-m2', delegations: [{ ...d1, fromUserId: 'u-l2' }] }).actions).toEqual([]);
      expect(standing({ userId: 'u-m2', delegations: [{ ...d1, formType: 'GOAL_SETTING' }] }).actions).toEqual([]);
    });

    it('an actor who is also someone\'s delegate acts as ACTOR', () => {
      const s = standing({ delegations: [delegation({ id: 'dx', fromUserId: 'u-m2', toUserId: 'u-m1' })] });
      expect(s.mode).toBe('ACTOR');
      expect(s.standing?.delegationId).toBeNull();
    });

    it('with two valid delegations from two actors, picks the first — as "Lưu nháp" records it', () => {
      const atHr = form({ currentStepId: hrStep.id, status: 'InProgress' });
      const ds = [
        delegation({ id: 'd-hr1', fromUserId: 'u-hr1', toUserId: 'u-m2' }),
        delegation({ id: 'd-hr2', fromUserId: 'u-hr2', toUserId: 'u-m2' }),
      ];
      const s = standing({ form: atHr, userId: 'u-m2', delegations: ds });
      expect(s.stepActors).toEqual(['u-hr1', 'u-hr2']);
      expect(s.standing).toEqual({ actorUserId: 'u-m2', onBehalfOfUserId: 'u-hr1', delegationId: 'd-hr1' });
    });

    it('a delegate who is ALSO an HR proxy acts as DELEGATE (the narrower grant)', () => {
      const s = standing({ userId: 'u-m2', delegations: [d1], mayProxy: true });
      expect(s.mode).toBe('DELEGATE');
    });
  });

  describe('proxy', () => {
    it('HR with the proxy right acts on behalf of the first step actor', () => {
      const s = standing({ userId: 'u-hr1', mayProxy: true });
      expect(s.mode).toBe('PROXY');
      expect(s.standing).toEqual({ actorUserId: 'u-hr1', onBehalfOfUserId: 'u-m1', delegationId: null });
      expect(s.actions).toEqual(['APPROVE', 'RETURN']);
    });

    it('on a step nobody is assigned to, HR acts on behalf of nobody so the form never gets stuck', () => {
      // l2 has no manager: their manager step has no actor.
      const s = standing({ form: form({ subjectEmployeeId: 'l2', currentStepId: managerStep.id, status: 'InProgress' }), userId: 'u-hr1', mayProxy: true });
      expect(s.stepActors).toEqual([]);
      expect(s.mode).toBe('PROXY');
      expect(s.standing).toEqual({ actorUserId: 'u-hr1', onBehalfOfUserId: null, delegationId: null });
    });

    it('without the proxy right, an unassigned step offers nothing', () => {
      const s = standing({ form: form({ subjectEmployeeId: 'l2', currentStepId: managerStep.id }), userId: 'u-hr1' });
      expect(s.actions).toEqual([]);
    });
  });

  describe('CANCEL — the cancel right alone, sent as the user themself', () => {
    it.each([
      ['an outsider with the right', 'u-m2', true, ['CANCEL']],
      ['the actor without the right', 'u-m1', false, ['APPROVE', 'RETURN']],
      ['the actor with the right', 'u-m1', true, ['APPROVE', 'RETURN', 'CANCEL']],
    ] as const)('%s', (_label, userId, mayCancel, actions) => {
      expect(standing({ userId, mayCancel }).actions).toEqual(actions);
    });
  });

  describe('frozen, closed, not loaded', () => {
    const regSteps = registrationSteps(); // step 2 is the owner's, onOverdue LOCK
    const regForm = form({ formType: 'GOAL_SETTING', periodId: null, workflowId: 'wf1', currentStepId: regSteps[1].id, status: 'InProgress' });

    it('an AUTO_LOCKed registration step offers only CANCEL', () => {
      const frozen = { ...regForm, overdueHandledAt: '2027-02-03T02:00:00.000Z' };
      const s = standing({ form: frozen, steps: regSteps, plan: plan({ status: 'Locked' }), userId: 'u-e1', mayCancel: true });
      expect(s.frozen).toBe(true);
      expect(s.mode).toBe('ACTOR');
      expect(s.actions).toEqual(['CANCEL']);
      expect(s.canEdit).toBe(false);
      expect(s.readOnlyReason).toBe('FROZEN');
    });

    it('a registration whose plan HR locked by hand is frozen too', () => {
      const s = standing({ form: regForm, steps: regSteps, plan: plan({ status: 'Locked' }), userId: 'u-e1' });
      expect(s.frozen).toBe(true);
      expect(s.actions).toEqual([]);
    });

    it('the same registration with a Draft plan is live', () => {
      expect(standing({ form: regForm, steps: regSteps, plan: plan({ status: 'Draft' }), userId: 'u-e1' }).actions).toEqual(['SUBMIT']);
    });

    it('a registration whose plan has not loaded offers nothing but CANCEL (frozen is unknown)', () => {
      const s = standing({ form: regForm, steps: regSteps, plan: undefined, userId: 'u-e1', mayCancel: true });
      expect(s.actions).toEqual(['CANCEL']);
      expect(s.readOnlyReason).toBe('LOADING');
    });

    it('a closed form offers nothing, not even CANCEL', () => {
      const s = standing({ form: form({ status: 'Completed', currentStepId: null }), mayCancel: true });
      expect(s.actions).toEqual([]);
      expect(s.step).toBeNull();
      expect(s.readOnlyReason).toBe('CLOSED');
    });
  });

  describe('time — the step deadline and overdue, from the gateway clock', () => {
    // Self step: SLA 7 days from 1 Feb → 8 Feb; the form is due 8 Feb.
    const atSelf = form({ currentStepId: selfStep.id, currentStepEnteredAt: '2027-02-01T01:00:00.000Z', dueDate: '2027-02-08' });

    it('is on time on the deadline day itself, overdue the day after', () => {
      expect(standing({ form: atSelf, clock: at('2027-02-08T10:00:00.000Z') })).toMatchObject({ deadline: '2027-02-08', overdue: false });
      expect(standing({ form: atSelf, clock: at('2027-02-08T17:00:00.000Z') })).toMatchObject({ overdue: true }); // 9 Feb 00:00
    });

    it('stepTiming gives a list the same facts without resolving actors', () => {
      expect(stepTiming(atSelf, evalSteps, at('2027-02-09T03:00:00.000Z'))).toMatchObject({ deadline: '2027-02-08', overdue: true, step: { id: selfStep.id } });
      expect(stepTiming(form({ status: 'Cancelled', currentStepId: null }), evalSteps, CLOCK)).toEqual({ step: null, deadline: null, overdue: false });
    });
  });

  it('every action it shows passes checkAction with the same standing (no content check involved)', () => {
    const cases: Partial<FormStandingInput>[] = [
      {},
      { userId: 'u-hr1', mayProxy: true },
      { userId: 'u-m2', delegations: [delegation({ id: 'd1' })] },
      { userId: 'u-m2', mayCancel: true },
      { form: form({ subjectEmployeeId: 'l2', currentStepId: managerStep.id, status: 'InProgress' }), userId: 'u-hr1', mayProxy: true },
    ];
    for (const c of cases) {
      const input = { form: form({ currentStepId: managerStep.id, status: 'InProgress' }), userId: 'u-m1', delegations: [] as never[], mayProxy: false, mayCancel: false, ...c };
      const s = standing(input);
      for (const action of s.actions.filter((a) => a === 'RETURN' || a === 'CANCEL')) {
        const actor = action === 'CANCEL' ? { actorUserId: input.userId, onBehalfOfUserId: null, delegationId: null } : s.standing!;
        const result = checkAction({
          form: input.form,
          steps: evalSteps,
          plan: plan({ status: 'Locked' }),
          action,
          expectedStepId: input.form.currentStepId!,
          comment: 'Lý do',
          actor,
          entitlement: {
            stepActors: s.stepActors,
            delegations: input.delegations,
            actorMayProxy: input.mayProxy,
            actorMayCancel: input.mayCancel,
            subjectUserId: 'u-' + input.form.subjectEmployeeId,
          },
          submitCheck: null,
          clock: CLOCK,
        });
        expect(result.ok, `${action} for ${input.userId}`).toBe(true);
      }
    }
  });
});

describe('submitCheckInput — the one builder, shared with the gateway', () => {
  const planGoals = [...goals(5), goal({ id: 'g-old', status: 'Changed' }), goal({ id: 'other', goalPlanId: 'plan2' })];
  const rows = {
    goals: planGoals,
    kgis: [kgi({ id: 'k1' }), kgi({ id: 'k-other', goalPlanId: 'plan2' })],
    items: [evaluationItem({ goalId: 'g1' }), evaluationItem({ goalId: 'g-old' }), evaluationItem({ id: 'x', formId: 'f2', goalId: 'g2' })],
    changeItems: [goalChange({ id: 'c1' }), goalChange({ id: 'c2', formId: 'f2' })],
  };

  it('KPI_EVAL: this form\'s items and THEIR goals — a superseded goal still counts on its form', () => {
    const input = submitCheckInput(form(), managerStep, evalSteps, rows);
    expect(input.formType).toBe('KPI_EVAL');
    if (input.formType !== 'KPI_EVAL') return;
    expect(input.items.map((i) => i.goalId)).toEqual(['g1', 'g-old']);
    expect(input.goals.map((g) => g.id)).toEqual(['g1', 'g-old']);
    expect(input.step).toBe(managerStep);
  });

  it('GOAL_SETTING: every goal of the plan, unfiltered by status, and its KGIs', () => {
    const input = submitCheckInput(form({ formType: 'GOAL_SETTING' }), registrationSteps()[1], registrationSteps(), rows);
    if (input.formType !== 'GOAL_SETTING') throw new Error('type');
    expect(input.goals.map((g) => g.id)).toEqual(['g1', 'g2', 'g3', 'g4', 'g5', 'g-old']);
    expect(input.kgis.map((k) => k.id)).toEqual(['k1']);
    expect(input.stepNo).toBe(2);
  });

  it('GOAL_CHANGE: this form\'s change items', () => {
    const input = submitCheckInput(form({ formType: 'GOAL_CHANGE' }), step(), [step()], rows);
    if (input.formType !== 'GOAL_CHANGE') throw new Error('type');
    expect(input.changeItems.map((c) => c.id)).toEqual(['c1']);
  });

  it('builds a check checkAction accepts for the same form and step (never SUBMIT_CHECK_MISMATCH)', () => {
    const scored = evaluationItem({ goalId: 'g1', managerAchievementPct: 90, managerComment: 'Tốt' });
    const f = form({ currentStepId: managerStep.id, status: 'InProgress' });
    const check = submitCheckInput(f, managerStep, evalSteps, { goals: [goal({ weight: 100 })], kgis: [], items: [scored], changeItems: [] });
    expect(canSubmit(check)).toEqual({ ok: true });
    const result = checkAction({
      form: f, steps: evalSteps, plan: null, action: 'APPROVE', expectedStepId: managerStep.id, comment: null,
      actor: { actorUserId: 'u-m1', onBehalfOfUserId: null, delegationId: null },
      entitlement: { stepActors: ['u-m1'], delegations: [], actorMayProxy: false, actorMayCancel: false, subjectUserId: 'u-e1' },
      submitCheck: check, clock: CLOCK,
    });
    expect(result.ok).toBe(true);
  });
});

describe('delegationState', () => {
  const d = delegation({ validFrom: '2027-02-05', validTo: '2027-02-10' });
  it.each([
    ['2027-02-04T16:59:00.000Z', 'Upcoming'], // 4 Feb 23:59
    ['2027-02-04T17:00:00.000Z', 'Active'], // 5 Feb 00:00
    ['2027-02-10T16:59:00.000Z', 'Active'],
    ['2027-02-10T17:00:00.000Z', 'Expired'],
  ] as const)('%s → %s', (now, state) => {
    expect(delegationState(d, at(now))).toBe(state);
  });

  it('is revoked from the instant of revokedAt — not before', () => {
    const r = { ...d, revokedAt: '2027-02-06T03:00:00.000Z' };
    expect(delegationState(r, at('2027-02-06T02:59:59.000Z'))).toBe('Active');
    expect(delegationState(r, at('2027-02-06T03:00:00.000Z'))).toBe('Revoked');
  });

  it('only an upcoming or active delegation is worth revoking', () => {
    expect(['Upcoming', 'Active', 'Expired', 'Revoked'].map((s) => isDelegationRevocable(s as never))).toEqual([true, true, false, false]);
  });
});

describe('goal drafts for an adjustment', () => {
  it('MODIFY starts from the goal as it stands, with its own levels only', () => {
    const g = goal({ id: 'g1', weight: 30, targetValue: 50 });
    const draft = goalDraftFromGoal(g, [level({ goalId: 'g1', levelCode: 'L2', targetValue: 50, scorePct: 100 }), level({ goalId: 'g9' })]);
    expect(draft).toMatchObject({ name: g.name, weight: 30, targetValue: 50, calcMethodId: 'cm1', dataSourceId: 'ds1' });
    expect(draft.targetLevels).toEqual([{ levelCode: 'L2', targetValue: 50, targetText: null, scorePct: 100 }]);
    expect(draft).not.toHaveProperty('id');
    expect(draft).not.toHaveProperty('status');
  });

  it('ADD from a library KPI inherits name, perspective, unit, method and formula', () => {
    const kpi: KpiDefinition = {
      id: 'kd1', tenantId: 't1', code: 'KPI-DT', name: 'Doanh thu', perspectiveId: 'p-fin', unitId: 'u-vnd', calcMethodId: 'cm-up',
      defaultDataSourceId: 'ds-erp', definition: 'Tổng doanh thu', formulaText: 'Σ hóa đơn', frequency: 'Month', aggregation: 'SUM',
      isSystem: true, categoryTag: null, status: 'Active',
    };
    const draft = goalDraftFromKpi(kpi, { weight: 10, targetValue: 5, dataSourceId: 'ds-erp', startDate: '2027-01-01', dueDate: '2027-12-31', ownerEmployeeId: 'e1' });
    expect(draft).toMatchObject({
      kpiDefId: 'kd1', name: 'Doanh thu', perspectiveId: 'p-fin', unitId: 'u-vnd', calcMethodId: 'cm-up', formulaText: 'Σ hóa đơn',
      weight: 10, targetValue: 5, targetType: 'NUMERIC', visibility: 'PUBLIC', kriType: null, targetLevels: [],
    });
  });
});

describe('workflowEditWarnings — what an edit means for forms already in the step', () => {
  const base = { slaDays: 3, onOverdue: 'LOCK' as const, requiresComment: false, evaluationColumn: null };
  it.each([
    ['nothing that times or freezes forms', base, { ...base }, 'GOAL_SETTING', []],
    ['a new SLA applies at once', base, { ...base, slaDays: 5 }, 'GOAL_SETTING', ['APPLIES_NOW']],
    ['leaving LOCK releases frozen forms', base, { ...base, onOverdue: 'REMIND' as const }, 'GOAL_SETTING', ['APPLIES_NOW', 'LOCK_RELEASED']],
    ['adding LOCK to registration', { ...base, onOverdue: null }, base, 'GOAL_SETTING', ['APPLIES_NOW', 'LOCK_ADDED']],
    [
      'a comment becomes mandatory on a scoring step',
      { ...base, onOverdue: null, evaluationColumn: 'SELF' as const },
      { ...base, onOverdue: null, requiresComment: true },
      'KPI_EVAL',
      ['COMMENT_REQUIRED'],
    ],
  ] as const)('%s', (_label, before, after, formType, expected) => {
    expect(workflowEditWarnings(before, after, formType)).toEqual(expected);
  });
});
