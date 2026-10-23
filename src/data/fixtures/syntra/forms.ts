import type { Delegation, FormInstance, FormLaunch, FormStatus, FormType, Goal, GoalDraft, Id, IsoDate, RecipientFilter, StepAction } from '@/data/types';
import { targetForPeriod } from '@/lib/calcRules';
import { computedItemPct } from '@/lib/formRules';
import { EVAL_DUE_DAYS } from '../catalog';
import { createPrng } from '../prng';
import type { IdFn, SeedRows, Workflows } from '../shared';
import { T, vn } from '../timeline';
import type { SyntraActuals } from './actuals';
import { AUTO_LOCK_AT, REENTERED, type SyntraGoals } from './goals';
import { DEPARTMENTS, type DepartmentCode, type SyntraOrg } from './org';

/**
 * Forms, their history and the launches that created them (design v2 §5 "Forms and history").
 * Every form's `FormStepAction` rows REPLAY to its current step and status: Open = no recorded
 * action yet; saved scores are EDIT and record nothing (BR-KPI-23); an overdue step is handled once
 * per entry by the tick after its deadline (BR-KPI-13); the scheduler last ran at 04-01 09:00.
 */

const STAFF_LEVELS: RecipientFilter = {
  orgUnitIds: [],
  includeChildUnits: false,
  positionIds: [],
  jobLevels: ['TeamLead', 'Specialist', 'Staff'],
  employmentStatuses: [],
  employeeIds: [],
};

/** Evaluation times of a normal month: self, manager, HR (each before its step deadline). */
const EVAL_STEPS: Record<string, readonly [string, string, string]> = {
  T01: [vn('2027-02-03 10:00'), vn('2027-02-05 15:00'), vn('2027-02-07 11:00')],
  T02: [vn('2027-03-03 10:00'), vn('2027-03-05 15:00'), vn('2027-03-07 11:00')],
};
const EVAL_LAUNCH: Record<string, string> = { T01: T.evalT01, T02: T.evalT02, T03: T.evalT03 };
const EVAL_DUE: Record<string, IsoDate> = { T01: '2027-02-13', T02: '2027-03-13', T03: '2027-04-13' };

export interface SyntraForms {
  delegations: { active: Delegation; expired: Delegation; revoked: Delegation };
  /** Forms by key: `GS:E017`, `EVAL:T03:E020`, `GC:open`… */
  form(key: string): FormInstance;
  launches: { registration: FormLaunch; newHire: FormLaunch; evaluation: Record<string, FormLaunch> };
}

export function buildForms(s: SeedRows, id: IdFn, org: SyntraOrg, g: SyntraGoals, a: SyntraActuals, wf: Workflows): SyntraForms {
  const prng = createPrng(20270401);
  const user = org.userId;
  const managerOf = (code: string) => org.person(code).manager as string;
  /** HR acts at HR steps — on HR's own form, the HCNS head (who also holds HR) does. */
  const hrFor = (subject: string) => (subject === 'E035' ? 'E012' : 'E035');
  const forms = new Map<string, FormInstance>();
  const seq = new Map<Id, number>();

  // ─── Delegations (BR-KPI-21): revoked, never deleted ───────────────────────────────────────
  const delegation = (key: string, from: string, to: string, validFrom: IsoDate, validTo: IsoDate, revokedAt: string | null) =>
    s.add('Delegation', { id: id('Delegation', key), fromUserId: user(from), toUserId: user(to), formType: 'KPI_EVAL', validFrom, validTo, revokedAt });
  const delegations = {
    // Marketing head → her team lead, during leave.
    active: delegation('active', 'E007', 'E019', '2027-04-01', '2027-04-15', null),
    // CSKH head → the Kinh doanh head (a peer), for two weeks in March.
    expired: delegation('expired', 'E008', 'E006', '2027-03-01', '2027-03-15', null),
    // Công nghệ head → his team lead, ended early on 03-20.
    revoked: delegation('revoked', 'E011', 'E031', '2027-03-01', '2027-04-30', vn('2027-03-20 10:00')),
  };

  // ─── Builders ────────────────────────────────────────────────────────────────────────────────
  const addForm = (
    key: string,
    f: {
      type: FormType;
      subject: string;
      planOwner: string;
      periodLabel: string | null;
      launchId: Id | null;
      launchedAt: string;
      dueDate: IsoDate;
      status: FormStatus;
      step: number | null;
      enteredAt: string | null;
      overdueHandledAt?: string | null;
    },
  ) => {
    const row = s.add('FormInstance', {
      id: id('FormInstance', key),
      workflowId: wf.id(f.type),
      formType: f.type,
      subjectEmployeeId: org.employeeId(f.subject),
      goalPlanId: g.plan(f.planOwner).id,
      periodId: f.periodLabel ? g.period(f.periodLabel).id : null,
      currentStepId: f.step === null ? null : wf.step(f.type, f.step).id,
      currentStepEnteredAt: f.enteredAt,
      overdueHandledAt: f.overdueHandledAt ?? null,
      status: f.status,
      dueDate: f.dueDate,
      launchedAt: f.launchedAt,
      launchId: f.launchId,
    });
    forms.set(key, row);
    return row;
  };

  const act = (
    form: FormInstance,
    stepNo: number,
    actor: string | null,
    action: StepAction,
    at: string,
    extra: { comment?: string; onBehalfOf?: string; delegation?: Delegation } = {},
  ) => {
    const n = (seq.get(form.id) ?? 0) + 1;
    seq.set(form.id, n);
    s.add('FormStepAction', {
      id: id('FormStepAction', form.id, n),
      formId: form.id,
      stepId: wf.step(form.formType, stepNo).id,
      actorUserId: actor === null ? null : user(actor),
      onBehalfOfUserId: extra.onBehalfOf ? user(extra.onBehalfOf) : null,
      delegationId: extra.delegation?.id ?? null,
      action,
      comment: extra.comment ?? null,
      actedAt: at,
    });
  };

  const launch = (key: string, l: Omit<FormLaunch, 'id' | 'tenantId'>) => s.add('FormLaunch', { id: id('FormLaunch', key), ...l });

  // ─── Registration of the unit plans (December 2026, started by hand; no Company form) ────────
  for (const dept of DEPARTMENTS) {
    const head = org.headOf(dept).code;
    const director = managerOf(head);
    const form = addForm(`GS:${dept}`, {
      type: 'GOAL_SETTING', subject: head, planOwner: dept, periodLabel: null, launchId: null,
      launchedAt: T.unitPlansStarted, dueDate: T.unitPlansDue, status: 'Completed', step: null, enteredAt: null,
    });
    const [s1, s2, s3, s4] = T.unitPlanSteps;
    act(form, 1, director, 'SUBMIT', s1);
    act(form, 2, head, 'SUBMIT', s2);
    act(form, 3, director, 'APPROVE', s3);
    act(form, 4, 'E035', 'APPROVE', s4);
  }

  // ─── Registration of staff plans: launch of 01-04 (BR-KPI-12, 13, 19) ───────────────────────
  const registration = launch('GS-2027', {
    workflowId: wf.id('GOAL_SETTING'), formType: 'GOAL_SETTING', name: 'Đăng ký KPI năm 2027', timing: 'NOW',
    scheduledAt: T.registrationLaunch, launchRuleId: null, cycleId: g.cycleId, periodId: null, dueDays: 14,
    recipientMode: 'FILTER', recipientFilter: STAFF_LEVELS, status: 'Launched', launchedAt: T.registrationLaunch,
    createdBy: user('E035'), createdAt: T.registrationLaunch,
  });
  const [r1, r2, r3, r4] = T.registrationSteps;
  const allStaff = DEPARTMENTS.flatMap((d) => org.staffOf(d as DepartmentCode)).filter((p) => p.code !== 'E018');
  for (const person of allStaff) {
    const code = person.code;
    const manager = managerOf(code);
    const lockAt = AUTO_LOCK_AT[code];
    const base = { type: 'GOAL_SETTING' as const, subject: code, planOwner: code, periodLabel: null, launchId: registration.id, launchedAt: T.registrationLaunch };
    if (!lockAt) {
      const form = addForm(`GS:${code}`, { ...base, dueDate: T.registrationDue, status: 'Completed', step: null, enteredAt: null });
      act(form, 1, manager, 'SUBMIT', r1);
      act(form, 2, code, 'SUBMIT', r2);
      act(form, 3, manager, 'APPROVE', r3);
      act(form, 4, hrFor(code), 'APPROVE', r4);
      continue;
    }
    // Auto-locked at the step it was stuck on; four were unlocked on 04-05 (new due date 04-15).
    const lockStep = lockAt === T.autoLockAtStep2 ? 2 : lockAt === T.autoLockAtStep3 ? 3 : 4;
    const reentered = (REENTERED as readonly string[]).includes(code);
    const returned = code === 'E021';
    const step = returned ? 2 : lockStep;
    const form = addForm(`GS:${code}`, {
      ...base,
      dueDate: reentered ? T.registrationNewDue : T.registrationDue,
      status: 'InProgress',
      step,
      enteredAt: reentered ? (returned ? T.registrationReturn : T.registrationUnlock) : [r1, r1, r2, r3][lockStep - 1],
      overdueHandledAt: reentered ? null : lockAt,
    });
    act(form, 1, manager, 'SUBMIT', r1);
    if (lockStep >= 3) act(form, 2, code, 'SUBMIT', r2);
    if (lockStep >= 4) act(form, 3, manager, 'APPROVE', r3);
    act(form, lockStep, null, 'AUTO_LOCK', lockAt);
    if (returned) {
      act(form, 3, manager, 'RETURN', T.registrationReturn, { comment: 'Cần bổ sung chỉ tiêu học hỏi & phát triển và liên kết với KPI phòng.' });
    }
  }

  // The March new hire: a registration launch of their own (04-05), form at step 1, no action yet.
  const newHire = launch('GS-2027-new-hire', {
    workflowId: wf.id('GOAL_SETTING'), formType: 'GOAL_SETTING', name: 'Đăng ký KPI – nhân sự mới tháng 3/2027', timing: 'NOW',
    scheduledAt: T.newHireLaunch, launchRuleId: null, cycleId: g.cycleId, periodId: null, dueDays: 21,
    recipientMode: 'FILTER', recipientFilter: { ...STAFF_LEVELS, jobLevels: [], employeeIds: [org.employeeId('E018')] },
    status: 'Launched', launchedAt: T.newHireLaunch, createdBy: user('E035'), createdAt: T.newHireLaunch,
  });
  addForm('GS:E018', {
    type: 'GOAL_SETTING', subject: 'E018', planOwner: 'E018', periodLabel: null, launchId: newHire.id,
    launchedAt: T.newHireLaunch, dueDate: T.newHireDue, status: 'Open', step: 1, enteredAt: T.newHireLaunch,
  });
  // A second round scheduled for probation staff, and one HR cancelled before it fired.
  launch('GS-2027-round-2', {
    workflowId: wf.id('GOAL_SETTING'), formType: 'GOAL_SETTING', name: 'Đăng ký KPI bổ sung – đợt 2', timing: 'SCHEDULED',
    scheduledAt: vn('2027-04-15 09:00'), launchRuleId: null, cycleId: g.cycleId, periodId: null, dueDays: 14,
    recipientMode: 'FILTER', recipientFilter: { ...STAFF_LEVELS, jobLevels: [], employmentStatuses: ['Probation'] },
    status: 'Scheduled', launchedAt: null, createdBy: user('E035'), createdAt: vn('2027-04-02 11:00'),
  });
  launch('GS-2027-round-1', {
    workflowId: wf.id('GOAL_SETTING'), formType: 'GOAL_SETTING', name: 'Đăng ký KPI bổ sung – đợt 1', timing: 'SCHEDULED',
    scheduledAt: vn('2027-03-15 09:00'), launchRuleId: null, cycleId: g.cycleId, periodId: null, dueDays: 14,
    recipientMode: 'ALL', recipientFilter: null, status: 'Cancelled', launchedAt: null, createdBy: user('E035'), createdAt: vn('2027-03-02 09:00'),
  });

  // ─── Adjustments (GOAL_CHANGE, BR-KPI-15) ────────────────────────────────────────────────────
  const goalDraft = (goal: Goal): GoalDraft => {
    const levels = s.rows.GoalTargetLevel.filter((l) => l.goalId === goal.id);
    const { id: _id, tenantId: _t, goalPlanId: _p, status: _s, replacesGoalId: _r, sortOrder: _o, ...rest } = goal;
    return { ...rest, targetLevels: levels.map(({ levelCode, targetValue, targetText, scorePct }) => ({ levelCode, targetValue, targetText, scorePct })) };
  };
  const done = addForm('GC:done', {
    type: 'GOAL_CHANGE', subject: 'E026', planOwner: 'E026', periodLabel: null, launchId: null,
    launchedAt: T.changeDoneStart, dueDate: '2027-02-25', status: 'Completed', step: null, enteredAt: null,
  });
  act(done, 1, 'E026', 'SUBMIT', vn('2027-02-15 10:00'));
  act(done, 2, 'E009', 'APPROVE', vn('2027-02-16 10:00'));
  act(done, 3, 'E035', 'APPROVE', vn('2027-02-17 15:00'));
  const { modified, replacement, cancelled, added } = g.change;
  s.add('GoalChangeItem', { id: id('GoalChangeItem', done.id, 1), formId: done.id, goalId: modified.id, changeType: 'MODIFY', proposed: goalDraft(replacement), reason: 'Điều chỉnh mục tiêu tồn kho theo kế hoạch nhập hàng mới.' });
  s.add('GoalChangeItem', { id: id('GoalChangeItem', done.id, 2), formId: done.id, goalId: cancelled.id, changeType: 'CANCEL', proposed: null, reason: 'Lead time do nhà cung cấp quyết định, không còn phù hợp làm KPI cá nhân.' });
  s.add('GoalChangeItem', { id: id('GoalChangeItem', done.id, 3), formId: done.id, goalId: null, changeType: 'ADD', proposed: goalDraft(added), reason: 'Bổ sung chỉ tiêu khiếu nại chất lượng sản phẩm.' });

  // The open adjustment — the ONE unhandled overdue step: deadline 04-02 is after the last tick (04-01).
  const open = addForm('GC:open', {
    type: 'GOAL_CHANGE', subject: 'E029', planOwner: 'E029', periodLabel: null, launchId: null,
    launchedAt: T.changeOpenStart, dueDate: T.changeOpenDue, status: 'InProgress', step: 2, enteredAt: vn('2027-03-30 10:30'), overdueHandledAt: null,
  });
  act(open, 1, 'E029', 'SUBMIT', vn('2027-03-30 10:30'));
  const target = g.goalsOf('E029').find((goal) => goal.targetType === 'NUMERIC' && goal.status === 'Active') as Goal;
  s.add('GoalChangeItem', {
    id: id('GoalChangeItem', open.id, 1), formId: open.id, goalId: target.id, changeType: 'MODIFY',
    proposed: { ...goalDraft(target), targetValue: target.targetValue === null ? null : Math.round(target.targetValue * 0.9 * 100) / 100 },
    reason: 'Đề xuất giảm mục tiêu do thay đổi đối tác vận chuyển từ tháng 4.',
  });

  // ─── Monthly evaluation (KPI_EVAL, BR-KPI-16, D5) ───────────────────────────────────────────
  const rule = s.add('FormLaunchRule', {
    id: id('FormLaunchRule', 'monthly-eval'), workflowId: wf.id('KPI_EVAL'), name: 'Đánh giá KPI hằng tháng', triggerEvent: 'PERIOD_END',
    periodType: 'Month', offsetDays: 1, dueDays: EVAL_DUE_DAYS, recipientMode: 'FILTER', recipientFilter: STAFF_LEVELS, isActive: true,
  });
  const evaluation: Record<string, FormLaunch> = {};
  for (const month of ['T01', 'T02', 'T03']) {
    evaluation[month] = launch(`EVAL-${month}`, {
      workflowId: wf.id('KPI_EVAL'), formType: 'KPI_EVAL', name: `Đánh giá KPI tháng ${month.slice(1)}/2027`, timing: 'RECURRING',
      scheduledAt: EVAL_LAUNCH[month], launchRuleId: rule.id, cycleId: g.cycleId, periodId: g.period(month).id, dueDays: EVAL_DUE_DAYS,
      recipientMode: 'FILTER', recipientFilter: STAFF_LEVELS, status: 'Launched', launchedAt: EVAL_LAUNCH[month], createdBy: null, createdAt: EVAL_LAUNCH[month],
    });
  }

  /** Goals on the form = the plan's Active goals when it opened (E026's February change applies from T02). */
  const goalsAt = (code: string, month: string) =>
    g.goalsOf(code).filter((goal) => {
      if (code !== 'E026') return goal.status === 'Active';
      if (month === 'T01') return goal.id !== g.change.replacement.id && goal.id !== g.change.added.id;
      return goal.status === 'Active';
    });

  const score = () => Math.round(prng.between(16, 22.4)) * 5; // 80…110, people round to 5
  const SELF = ['Hoàn thành theo kế hoạch.', 'Vượt mục tiêu nhờ chương trình khuyến mãi.', 'Chưa đạt do thiếu nguồn lực trong tháng.'];
  const MANAGER = ['Đồng ý với kết quả hệ thống tính.', 'Điều chỉnh theo số liệu đối soát.', 'Cần cải thiện tiến độ, chấm lại theo mức đóng góp thực tế.'];

  /**
   * Where the form stands, which decides what its items hold (PEND-06/07/08): the actual on the form
   * is the recorded one, the SELF column the system's % of it; leaving the employee's step keeps that
   * actual as submitted and starts the manager at the system's %; a manager who scored either kept it
   * or overrode it with a comment; HR's step starts FINAL at the manager's %.
   * - `open` — at the employee's step, nothing saved; `selfSaved` — explanations saved ("Lưu nháp");
   * - `forwarded` — AUTO_FORWARDed to the manager without a self-assessment; `atManager` — submitted;
   * - `atFinal` — the manager scored, at HR's step; `returnedToManager` — HR sent it back; `done`.
   */
  type Stage = 'open' | 'selfSaved' | 'forwarded' | 'atManager' | 'atFinal' | 'returnedToManager' | 'done';
  const calcContext = (goal: Goal) => ({
    goal,
    method: s.rows.CalcMethod.find((m) => m.id === goal.calcMethodId) ?? null,
    tiers: s.rows.CalcTier,
    levels: s.rows.GoalTargetLevel,
  });
  /** HR's one special-case edit (Q47): a FINAL that differs from the manager's, with its reason. */
  const HR_EDIT = { key: 'EVAL:T01:E027', reason: 'Điều chỉnh theo kết quả đối soát cuối kỳ của C&B (trường hợp đặc biệt).' };
  const addItems = (form: FormInstance, code: string, month: string, stage: Stage) => {
    goalsAt(code, month).forEach((goal, i) => {
      const actual = a.currentAt(goal.id, month, form.launchedAt);
      const onForm = { actualValue: actual?.actualValue ?? null, actualText: actual?.actualText ?? null, targetSnapshot: targetForPeriod(goal, s.rows.GoalPeriodTarget, g.period(month).id) };
      const system = computedItemPct(onForm, calcContext(goal));
      const leftSelf = !['open', 'selfSaved'].includes(stage);
      const scored = ['atFinal', 'returnedToManager', 'done'].includes(stage);
      let manager = leftSelf ? system : null;
      let managerComment: string | null = null;
      if (scored) {
        // A manager overrides about one goal in five — always when the system has no % — and says why.
        if (system === null || prng.next() < 0.2) {
          manager = score();
          managerComment = MANAGER[1 + (i % 2)];
        } else if (i % 2 === 0) managerComment = MANAGER[0];
      }
      const hrEdit = stage === 'done' && forms.get(HR_EDIT.key)?.id === form.id && i === 0 && manager !== null;
      s.add('EvaluationItem', {
        id: id('EvaluationItem', form.id, goal.id),
        formId: form.id,
        goalId: goal.id,
        actualSnapshot: onForm.actualValue,
        actualTextSnapshot: onForm.actualText,
        actualValue: onForm.actualValue,
        actualText: onForm.actualText,
        actualEnteredBy: null,
        submittedActualValue: leftSelf ? onForm.actualValue : null,
        submittedActualText: leftSelf ? onForm.actualText : null,
        targetSnapshot: onForm.targetSnapshot,
        selfAchievementPct: system,
        selfComment: stage === 'open' || stage === 'forwarded' ? null : SELF[i % SELF.length],
        managerAchievementPct: manager,
        managerComment,
        finalAchievementPct: scored ? (hrEdit ? Math.max(0, (manager as number) - 5) : manager) : null,
        finalComment: hrEdit ? HR_EDIT.reason : null,
      });
    });
  };

  // Everyone with an Approved/Locked plan at launch: all staff but the March hire (no plan before 04-05).
  for (const month of ['T01', 'T02', 'T03'] as const) {
    for (const person of allStaff) {
      const code = person.code;
      const manager = managerOf(code);
      const hr = hrFor(code);
      const key = `EVAL:${month}:${code}`;
      const base = { type: 'KPI_EVAL' as const, subject: code, planOwner: code, periodLabel: month, launchId: evaluation[month].id, launchedAt: EVAL_LAUNCH[month], dueDate: EVAL_DUE[month] };
      const complete = (selfBy?: { actor: string; onBehalfOf: string }, managerBy?: { actor: string; onBehalfOf: string; delegation: Delegation }) => {
        const [e1, e2, e3] = EVAL_STEPS[month];
        const form = addForm(key, { ...base, status: 'Completed', step: null, enteredAt: null });
        act(form, 1, selfBy?.actor ?? code, 'SUBMIT', e1, selfBy ? { onBehalfOf: selfBy.onBehalfOf } : {});
        act(form, 2, managerBy?.actor ?? manager, 'SUBMIT', e2, managerBy ? { onBehalfOf: managerBy.onBehalfOf, delegation: managerBy.delegation } : {});
        act(form, 3, hr, 'APPROVE', e3);
        addItems(form, code, month, 'done');
      };

      if (month === 'T01') {
        // HR submits one self-assessment as proxy (BR-KPI-21: both people recorded).
        if (code === 'E032') complete({ actor: 'E035', onBehalfOf: 'E032' });
        else complete();
        continue;
      }

      if (month === 'T02') {
        const [e1, e2] = EVAL_STEPS.T02;
        if (code === 'E025' || code === 'E028') {
          // At the manager's step since 03-03; deadline 03-07; REMINDed by the 03-08 tick.
          const form = addForm(key, { ...base, status: 'InProgress', step: 2, enteredAt: e1, overdueHandledAt: vn('2027-03-08 09:00') });
          act(form, 1, code, 'SUBMIT', e1);
          addItems(form, code, month, 'atManager');
        } else if (code === 'E037') {
          // At HR's step since 03-05; deadline 03-07; REMINDed by the 03-08 tick.
          const form = addForm(key, { ...base, status: 'InProgress', step: 3, enteredAt: e2, overdueHandledAt: vn('2027-03-08 09:00') });
          act(form, 1, code, 'SUBMIT', e1);
          act(form, 2, manager, 'SUBMIT', e2);
          addItems(form, code, month, 'atFinal');
        } else if (code === 'E026') {
          // Never self-assessed: step-1 deadline 03-07 → the 03-08 tick AUTO_FORWARDs (PMGM.09); at step 2
          // its deadline is 03-12 → REMINDed by the 03-13 tick.
          const form = addForm(key, { ...base, status: 'InProgress', step: 2, enteredAt: vn('2027-03-08 09:00'), overdueHandledAt: vn('2027-03-13 09:00') });
          act(form, 1, null, 'AUTO_FORWARD', vn('2027-03-08 09:00'));
          addItems(form, code, month, 'forwarded');
        } else if (code === 'E041') {
          // Returned at the LAST step: HR sends it back to the manager on 03-06 (deadline 03-10 → REMINDed 03-11).
          const form = addForm(key, { ...base, status: 'InProgress', step: 2, enteredAt: vn('2027-03-06 10:00'), overdueHandledAt: vn('2027-03-11 09:00') });
          act(form, 1, code, 'SUBMIT', e1);
          act(form, 2, manager, 'SUBMIT', e2);
          act(form, 3, hr, 'RETURN', vn('2027-03-06 10:00'), { comment: 'Điểm quản lý chưa khớp số liệu đối soát, đề nghị chấm lại.' });
          addItems(form, code, month, 'returnedToManager');
        } else if (code === 'E023') {
          // Scored by a delegate inside the (now expired) delegation window.
          complete(undefined, { actor: 'E006', onBehalfOf: 'E008', delegation: delegations.expired });
        } else if (code === 'E033') {
          // Scored by a delegate before the delegation was revoked (03-20).
          complete(undefined, { actor: 'E031', onBehalfOf: 'E011', delegation: delegations.revoked });
        } else {
          complete();
        }
        continue;
      }

      // T03 — launched 04-01 09:00, due 04-13; step-1 deadline 04-07, so nothing here is overdue yet.
      const launchedAt = EVAL_LAUNCH.T03;
      if (code === 'E024') {
        // Left on 03-10: HR cancels the March form (BR-KPI-23: HR/ADMIN, with a reason).
        const form = addForm(key, { ...base, status: 'Cancelled', step: null, enteredAt: null });
        act(form, 1, 'E035', 'CANCEL', vn('2027-04-02 10:00'), { comment: 'Nhân viên nghỉ việc từ 10/03/2027, không đánh giá tháng 3.' });
        addItems(form, code, month, 'open');
      } else if (['E015', 'E016', 'E029', 'E034'].includes(code)) {
        const at = vn({ E015: '2027-04-03 10:00', E016: '2027-04-03 14:00', E029: '2027-04-04 10:00', E034: '2027-04-05 10:00' }[code] as string);
        const form = addForm(key, { ...base, status: 'InProgress', step: 2, enteredAt: at });
        act(form, 1, code, 'SUBMIT', at);
        addItems(form, code, month, 'atManager');
      } else if (code === 'E020' || code === 'E038') {
        const s1 = vn('2027-04-02 10:00');
        const s2 = vn(code === 'E020' ? '2027-04-05 14:00' : '2027-04-05 16:00');
        const form = addForm(key, { ...base, status: 'InProgress', step: 3, enteredAt: s2 });
        act(form, 1, code, 'SUBMIT', s1);
        if (code === 'E020') act(form, 2, 'E019', 'SUBMIT', s2, { onBehalfOf: 'E007', delegation: delegations.active });
        else act(form, 2, manager, 'SUBMIT', s2);
        addItems(form, code, month, 'atFinal');
      } else {
        const form = addForm(key, { ...base, status: 'Open', step: 1, enteredAt: launchedAt });
        // "Lưu nháp": some people have saved self-scores already — EDIT, so still Open.
        addItems(form, code, month, ['E019', 'E022', 'E023', 'E025', 'E031', 'E035'].includes(code) ? 'selfSaved' : 'open');
      }
    }
  }

  // ─── Evidence (BR-KPI-16: the employee attaches it to their self-assessment) ────────────────
  const evidence = (key: string, code: string, month: string, by: string, at: string, src: { url?: string; fileId?: Id }, note: string) => {
    const goal = goalsAt(code, month)[0];
    s.add('Evidence', {
      id: id('Evidence', key),
      goalId: goal.id,
      periodId: g.period(month).id,
      actualId: a.current(goal.id, month)?.id ?? null,
      fileId: src.fileId ?? null,
      url: src.url ?? null,
      note,
      uploadedBy: user(by),
      uploadedAt: at,
    });
  };
  evidence('T02-E016', 'E016', 'T02', 'E016', vn('2027-03-03 09:30'), { url: 'https://drive.example/syntra/kd/bao-cao-doanh-so-T02.xlsx' }, 'Báo cáo doanh số tháng 2');
  evidence('T03-E019', 'E019', 'T03', 'E019', vn('2027-04-02 16:00'), { url: 'https://drive.example/syntra/mkt/ket-qua-chien-dich-T03' }, 'Kết quả chiến dịch tháng 3');
  evidence('T03-E022', 'E022', 'T03', 'E022', vn('2027-04-03 16:20'), { fileId: a.files.evidence.id }, 'Biên bản nghiệm thu');
  evidence('T03-E031', 'E031', 'T03', 'E031', vn('2027-04-04 11:00'), { url: 'https://git.example/syntra/release-notes/2027-03' }, 'Ghi chú phát hành tháng 3');

  return {
    delegations,
    form: (key) => {
      const f = forms.get(key);
      if (!f) throw new Error(`seed: no form ${key}`);
      return f;
    },
    launches: { registration, newHire, evaluation },
  };
}

