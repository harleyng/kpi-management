/**
 * How forms move — BR-KPI-12, 13, 16, 19, 20, 21, 23.
 *
 * - `validateWorkflow` — what `saveWorkflow` refuses.
 * - `resolveStepActors` / `entitlement` — who may act on a step now: its actor, a delegate, or HR as proxy.
 * - `TRANSITIONS` + `transition` — the ONE table of moves; `checkAction` is the only entry the gateway
 *   uses for a person's action: stale step → frozen → entitled → allowed here → `canSubmit` → move.
 * - Time: step deadline, overdue, reminders, unlock — all from a `Clock`, never the machine's.
 * - Launches: due date, recipients, recurring firings.
 *
 * `resolveStepActors` and `resolveRecipients` take whole-tenant lists: they are the reference
 * implementation the mock gateway calls; a database adapter may answer the same question in SQL, so
 * contract tests check outcomes, not that these were called.
 */

import type {
  CyclePeriod,
  Delegation,
  Employee,
  EmployeeAssignment,
  EvaluationColumn,
  FormInstance,
  FormLaunch,
  FormLaunchRule,
  FormStatus,
  FormType,
  GoalPlan,
  GoalPlanStatus,
  Id,
  IsoDate,
  IsoDateTime,
  JobPosition,
  OrgUnit,
  OverdueBehaviour,
  PerformanceCycle,
  PeriodType,
  PersonFormAction,
  Role,
  StepAction,
  UserAccount,
  UserRole,
  WorkflowStep,
  WorkPlanStatus,
} from '@/data/types';
import { isWorkFormType } from '@/data/types';
import { ruleIssue, type ErrorCode, type RuleIssue } from './errorCatalog';
import { canSubmit, type CanSubmitInput } from './formRules';
import { cycleAllowsLaunch } from './cycleRules';
import { PLAN_STATUS_ON_CANCEL, PLAN_STATUS_ON_COMPLETE, ownerStepNo, planStatusOnEnterStep, type Decision } from './goalPlanRules';
import { addDays, isIsoDate, isWithin, minDate, todayOf, toZonedDate, type Clock } from './isoDate';
import { WORK_PLAN_STATUS_ON_CANCEL, WORK_PLAN_STATUS_ON_COMPLETE, workPlanStatusOnEnterStep } from './workRules';
import { descendantUnitIds, isEmployedDuring, isEmployedOn, managerOf, primaryAssignmentOn, scopeCoversEmployee, scopeSubjectOn } from './orgRules';

export type Refusal = { ok: false; code: ErrorCode; detail: string; issues: RuleIssue[] };
const refuse = (code: ErrorCode, detail: string, issues: RuleIssue[] = []): Refusal => ({ ok: false, code, detail, issues });

const TERMINAL: readonly FormStatus[] = ['Completed', 'Cancelled'];
export const isTerminal = (form: Pick<FormInstance, 'status'>) => TERMINAL.includes(form.status);
const blank = (text: string | null) => text === null || text.trim() === '';

const ordered = (steps: readonly WorkflowStep[]) => [...steps].sort((a, b) => a.stepNo - b.stepNo);
const lastStepNo = (steps: readonly WorkflowStep[]) => Math.max(...steps.map((s) => s.stepNo));

// ─── Workflow configuration ────────────────────────────────────────────────────────────────────

/**
 * What `saveWorkflow` refuses (ERR-KPI-06, `ref` = the step): steps numbered 1…n; at least one way
 * forward per step; RETURN never on step 1 and only backwards; AUTO_FORWARD never on the last step;
 * LOCK only on registration (a GOAL_CHANGE plan is already locked and an evaluation has no plan to
 * lock, so the form could never be released); registration and monthly work need ≥ 2 steps including
 * the owner's, and monthly work never ends on the employee's step; a ROLE step names its role.
 * `autoApprove` (PEND-02) only on the last step, never step 1, on a step that allows APPROVE; and no
 * AUTO_FORWARD into it — the form would complete with no person deciding.
 */
export function validateWorkflow(formType: FormType, steps: readonly WorkflowStep[]): RuleIssue[] {
  if (steps.length === 0) return [ruleIssue('ERR-KPI-06', null, 'STEPS_REQUIRED')];
  const issues: RuleIssue[] = [];
  const sorted = ordered(steps);
  const n = sorted.length;
  const bad = (step: WorkflowStep | null, detail: string) => issues.push(ruleIssue('ERR-KPI-06', step?.id ?? null, detail));
  sorted.forEach((step, i) => {
    if (step.stepNo !== i + 1) bad(step, 'STEP_NUMBERS');
    if (!step.allowedActions.includes('SUBMIT') && !step.allowedActions.includes('APPROVE')) bad(step, 'NO_FORWARD_ACTION');
    if (step.allowedActions.includes('RETURN') && step.stepNo === 1) bad(step, 'RETURN_ON_FIRST_STEP');
    if (step.returnToStepNo !== null && !(step.returnToStepNo >= 1 && step.returnToStepNo < step.stepNo)) bad(step, 'RETURN_TARGET_INVALID');
    if (step.onOverdue === 'AUTO_FORWARD' && step.stepNo === n) bad(step, 'AUTO_FORWARD_ON_LAST_STEP');
    if (step.onOverdue === 'LOCK' && formType !== 'GOAL_SETTING') bad(step, 'LOCK_NOT_ALLOWED');
    if (step.slaDays !== null && !(Number.isInteger(step.slaDays) && step.slaDays >= 0)) bad(step, 'SLA_INVALID');
    if (step.remindDaysBefore !== null && !(Number.isInteger(step.remindDaysBefore) && step.remindDaysBefore >= 0)) bad(step, 'REMIND_INVALID');
    if (step.actorRule === 'ROLE' && step.actorRoleId === null) bad(step, 'ROLE_REQUIRED');
    if (step.autoApprove) {
      if (step.stepNo !== n) bad(step, 'AUTO_APPROVE_NOT_LAST');
      if (step.stepNo === 1) bad(step, 'AUTO_APPROVE_ON_FIRST_STEP');
      if (!step.allowedActions.includes('APPROVE')) bad(step, 'AUTO_APPROVE_NEEDS_APPROVE');
    }
    if (step.onOverdue === 'AUTO_FORWARD' && sorted[i + 1]?.autoApprove) bad(step, 'AUTO_FORWARD_INTO_AUTO_APPROVE');
  });
  if (formType === 'GOAL_SETTING' || isWorkFormType(formType)) {
    if (n < 2) bad(null, 'TOO_FEW_STEPS');
    if (!sorted.some((s) => s.actorRule === 'SELF')) bad(null, 'OWNER_STEP_REQUIRED');
  }
  // Monthly work: completing the form locks the plan / records the month, so the employee never
  // takes the last step — no one approves or scores their own month (PEND-14).
  if (isWorkFormType(formType) && sorted[n - 1].actorRule === 'SELF') bad(sorted[n - 1], 'SELF_LAST_STEP');
  return issues;
}

// ─── Actors ────────────────────────────────────────────────────────────────────────────────────

/** The tenant's people, as the actor rules need them. */
export interface ActorDirectory {
  employees: readonly Employee[];
  assignments: readonly EmployeeAssignment[];
  users: readonly UserAccount[];
  userRoles: readonly UserRole[];
  roles: readonly Role[];
  units: readonly OrgUnit[];
}

/** The Active account of an employee, if any. */
export function userOfEmployee(employeeId: Id | null, users: readonly UserAccount[]): UserAccount | null {
  if (employeeId === null) return null;
  return users.find((u) => u.employeeId === employeeId && u.status === 'Active') ?? null;
}

/**
 * The users who may act on `step` for `subjectEmployeeId` today (BR-KPI-20). Lines are read at the
 * time of the action — a manager change mid-form moves the step to the new manager. For someone who
 * has left, lines are read on their last working day, so their last month's evaluation still reaches
 * their manager and HR; their own SELF step has nobody (overdue then carries the form on).
 * The subject is never an actor of a non-SELF step on their own form (no self-approval).
 * An empty list means nobody is assigned: HR can still act as proxy (`entitlement`).
 */
export function resolveStepActors(step: WorkflowStep, subjectEmployeeId: Id, dir: ActorDirectory, clock: Clock): Id[] {
  const subject = dir.employees.find((e) => e.id === subjectEmployeeId);
  if (!subject) return [];
  const today = todayOf(clock);
  const asOf = subject.leftOn !== null && subject.leftOn < today ? subject.leftOn : today;
  const employed = (employeeId: Id | null) => {
    const e = dir.employees.find((x) => x.id === employeeId);
    return e !== undefined && isEmployedOn(e, today);
  };
  const userIdOf = (employeeId: Id | null) => (employed(employeeId) ? userOfEmployee(employeeId, dir.users)?.id ?? null : null);
  const subjectUserId = userOfEmployee(subjectEmployeeId, dir.users)?.id ?? null;

  let actors: Id[];
  switch (step.actorRule) {
    case 'SELF':
      return isEmployedOn(subject, today) && subjectUserId !== null ? [subjectUserId] : [];
    case 'DIRECT_MANAGER':
      actors = [userIdOf(managerOf(subjectEmployeeId, dir.assignments, asOf))].filter((id): id is Id => id !== null);
      break;
    case 'MANAGER_L2': {
      const manager = managerOf(subjectEmployeeId, dir.assignments, asOf);
      const l2 = manager === null ? null : managerOf(manager, dir.assignments, today);
      actors = [userIdOf(l2)].filter((id): id is Id => id !== null);
      break;
    }
    case 'HR':
    case 'CNB':
    case 'ROLE': {
      const roleId = step.actorRule === 'ROLE' ? step.actorRoleId : dir.roles.find((r) => r.code === step.actorRule)?.id;
      if (!roleId) return [];
      // Routing a form about a former employee is still HR's job: their lines as of their last day.
      const scopeSubject = { ...scopeSubjectOn(subject, dir.assignments, asOf), inScope: true };
      actors = dir.userRoles
        .filter((ur) => ur.roleId === roleId)
        .filter((ur) => {
          const account = dir.users.find((u) => u.id === ur.userId && u.status === 'Active');
          if (!account || (account.employeeId !== null && !employed(account.employeeId))) return false;
          return scopeCoversEmployee(ur, scopeSubject, { units: dir.units, actorEmployeeId: account.employeeId });
        })
        .map((ur) => ur.userId);
      break;
    }
  }
  return [...new Set(actors)].filter((id) => id !== subjectUserId);
}

/** One step of a form's route as it stands now — what the start dialog shows. */
export interface RouteStep {
  step: WorkflowStep;
  /** `resolveStepActors` today; empty = nobody is assigned (HR acts as proxy, or a SELF step with no account). */
  actorUserIds: Id[];
}

/**
 * Who would act at each step of `steps` (one workflow) for `subjectEmployeeId`, in step order, read
 * NOW with `resolveStepActors` — the same lookup the inbox uses. Lines are read again at each action,
 * so this is a forecast: a manager change moves a step. Delegates are not added (they act for these).
 */
export function registrationRoute(steps: readonly WorkflowStep[], subjectEmployeeId: Id, dir: ActorDirectory, clock: Clock): RouteStep[] {
  return [...steps].sort((a, b) => a.stepNo - b.stepNo).map((step) => ({ step, actorUserIds: resolveStepActors(step, subjectEmployeeId, dir, clock) }));
}

/** The due date a form started by hand gets by default when its steps carry no SLA. */
export const DEFAULT_START_DUE_DAYS = 7;

/**
 * Days from start to the default due date of a form started by hand: the sum of its steps' SLAs, so
 * the last steps are not squeezed by the due date (`stepDeadline` takes the earlier of the two);
 * `DEFAULT_START_DUE_DAYS` when no step has an SLA.
 */
export function defaultStartDueDays(steps: readonly Pick<WorkflowStep, 'slaDays'>[]): number {
  const total = steps.reduce((sum, s) => sum + (s.slaDays ?? 0), 0);
  return total > 0 ? total : DEFAULT_START_DUE_DAYS;
}

/** A delegation grants `formType` steps between its dates (tenant zone, inclusive) until revoked (BR-KPI-21). */
export function isDelegationValid(delegation: Delegation, formType: FormType, clock: Clock): boolean {
  if (delegation.formType !== formType) return false;
  if (delegation.revokedAt !== null && Date.parse(delegation.revokedAt) <= Date.parse(clock.now)) return false;
  return isWithin(todayOf(clock), delegation.validFrom, delegation.validTo);
}

export interface ActorInput {
  actorUserId: Id;
  onBehalfOfUserId: Id | null;
  delegationId: Id | null;
}

export interface EntitlementContext {
  /** `resolveStepActors` for the current step. */
  stepActors: readonly Id[];
  delegations: readonly Delegation[];
  /** May act for others on this subject's forms — `can(profile, 'form.proxy', subject)` (Phase 1.3). */
  actorMayProxy: boolean;
  /** May cancel this subject's forms — `can(profile, 'form.cancel', subject)`; a separate right from proxy. */
  actorMayCancel: boolean;
  /** The subject's own account — never an actor of a non-SELF step on their own form. */
  subjectUserId: Id | null;
  clock: Clock;
}

/** What `entitlementContextOf` needs besides the form and step — all loaded for one tenant. */
export interface EntitlementInputs {
  dir: ActorDirectory;
  delegations: readonly Delegation[];
  clock: Clock;
  /** `can(profile, 'form.proxy', subject)` — from the same access profile the gateway builds. */
  actorMayProxy: boolean;
  /** `can(profile, 'form.cancel', subject)`. */
  actorMayCancel: boolean;
}

/**
 * The `EntitlementContext` of a form's current step — the ONE builder the gateway (`workflowContext`)
 * and the screens share (T3), so a button the screen enables is the button `forms.act` accepts.
 * `step` undefined (a closed form) → nobody is a step actor.
 */
export function entitlementContextOf(
  form: Pick<FormInstance, 'subjectEmployeeId'>,
  step: WorkflowStep | undefined,
  inputs: EntitlementInputs,
): EntitlementContext {
  return {
    stepActors: step ? resolveStepActors(step, form.subjectEmployeeId, inputs.dir, inputs.clock) : [],
    delegations: inputs.delegations,
    actorMayProxy: inputs.actorMayProxy,
    actorMayCancel: inputs.actorMayCancel,
    subjectUserId: userOfEmployee(form.subjectEmployeeId, inputs.dir.users)?.id ?? null,
    clock: inputs.clock,
  };
}

export type Entitlement =
  | { ok: true; mode: 'ACTOR' | 'DELEGATE' | 'PROXY' | 'ADMIN'; actorUserId: Id; onBehalfOfUserId: Id | null; delegationId: Id | null }
  | Refusal;

/**
 * Whether `input.actorUserId` may take `action` on the form's current step now. Both people are
 * always kept: a delegate or proxy acts with `onBehalfOfUserId` = the step's actor (BR-KPI-21).
 * - CANCEL — only with the cancel right (HR/ADMIN by default), as themself.
 * - DELEGATE — a delegation valid now, from a current step actor, to this user, for this form type.
 * - PROXY — HR/ADMIN on behalf of a current step actor; or on behalf of nobody when the step has no
 *   actor at all (a top manager with no manager, an unfilled role), so no form can get stuck.
 */
export function entitlement(
  form: Pick<FormInstance, 'formType'>,
  step: Pick<WorkflowStep, 'actorRule'>,
  action: StepAction,
  input: ActorInput,
  ctx: EntitlementContext,
): Entitlement {
  const { actorUserId, onBehalfOfUserId, delegationId } = input;
  const granted = (mode: 'ACTOR' | 'DELEGATE' | 'PROXY' | 'ADMIN'): Entitlement => ({ ok: true, mode, actorUserId, onBehalfOfUserId, delegationId });

  if (action === 'CANCEL') {
    return ctx.actorMayCancel && onBehalfOfUserId === null && delegationId === null ? granted('ADMIN') : refuse('ERR-KPI-05', 'CANCEL_NOT_ALLOWED');
  }
  if (step.actorRule !== 'SELF' && ctx.subjectUserId !== null && actorUserId === ctx.subjectUserId) {
    return refuse('ERR-KPI-05', 'SELF_APPROVAL');
  }
  if (delegationId !== null) {
    const d = ctx.delegations.find((x) => x.id === delegationId);
    if (!d || onBehalfOfUserId === null || d.fromUserId !== onBehalfOfUserId || d.toUserId !== actorUserId) return refuse('ERR-KPI-05', 'DELEGATION_MISMATCH');
    if (!isDelegationValid(d, form.formType, ctx.clock)) return refuse('ERR-KPI-05', 'DELEGATION_NOT_VALID');
    if (!ctx.stepActors.includes(onBehalfOfUserId)) return refuse('ERR-KPI-05', 'DELEGATOR_NOT_ACTOR');
    return granted('DELEGATE');
  }
  if (onBehalfOfUserId !== null) {
    if (!ctx.actorMayProxy) return refuse('ERR-KPI-05', 'PROXY_NOT_ALLOWED');
    return ctx.stepActors.includes(onBehalfOfUserId) ? granted('PROXY') : refuse('ERR-KPI-05', 'NOT_STEP_ACTOR');
  }
  if (ctx.stepActors.includes(actorUserId)) return granted('ACTOR');
  if (ctx.stepActors.length === 0 && ctx.actorMayProxy) return granted('PROXY');
  return refuse('ERR-KPI-05', 'NOT_STEP_ACTOR');
}

// ─── The transition table ──────────────────────────────────────────────────────────────────────

export type TransitionAction = PersonFormAction | 'AUTO_FORWARD' | 'AUTO_LOCK' | 'AUTO_APPROVE';

type Target = { kind: 'enter'; stepNo: number; viaReturn: boolean } | { kind: 'complete' } | { kind: 'cancel' } | { kind: 'stay' };

interface TransitionRule {
  /** Why the action cannot be taken at this step, or `null`. */
  refusal(step: WorkflowStep, form: Pick<FormInstance, 'formType'>, n: number, comment: string | null): Refusal | null;
  target(step: WorkflowStep, n: number): Target;
}

const forward = (step: WorkflowStep, n: number): Target => (step.stepNo < n ? { kind: 'enter', stepNo: step.stepNo + 1, viaReturn: false } : { kind: 'complete' });
const needs = (step: WorkflowStep, action: 'SUBMIT' | 'APPROVE' | 'RETURN') =>
  step.allowedActions.includes(action) ? null : refuse('ERR-KPI-04', 'ACTION_NOT_ALLOWED');

/** THE table. Every move a form can make is here; the gateway never moves a form any other way. */
export const TRANSITIONS: Readonly<Record<TransitionAction, TransitionRule>> = {
  SUBMIT: { refusal: (step) => needs(step, 'SUBMIT'), target: forward },
  APPROVE: { refusal: (step) => needs(step, 'APPROVE'), target: forward },
  RETURN: {
    refusal: (step, _form, _n, comment) =>
      needs(step, 'RETURN') ?? (step.stepNo === 1 ? refuse('ERR-KPI-04', 'RETURN_ON_FIRST_STEP') : null) ?? (blank(comment) ? refuse('ERR-KPI-06', 'COMMENT_REQUIRED') : null),
    target: (step) => ({ kind: 'enter', stepNo: step.returnToStepNo ?? step.stepNo - 1, viaReturn: true }),
  },
  CANCEL: {
    refusal: (_step, _form, _n, comment) => (blank(comment) ? refuse('ERR-KPI-06', 'COMMENT_REQUIRED') : null),
    target: () => ({ kind: 'cancel' }),
  },
  AUTO_FORWARD: {
    refusal: (step, _form, n) =>
      step.onOverdue !== 'AUTO_FORWARD' ? refuse('ERR-KPI-04', 'NOT_CONFIGURED') : step.stepNo >= n ? refuse('ERR-KPI-04', 'AUTO_FORWARD_ON_LAST_STEP') : null,
    target: forward,
  },
  AUTO_LOCK: {
    refusal: (step, form) =>
      step.onOverdue !== 'LOCK' || form.formType !== 'GOAL_SETTING' ? refuse('ERR-KPI-04', 'NOT_CONFIGURED') : null,
    target: () => ({ kind: 'stay' }),
  },
  // PEND-02 — the system approves a step configured to (`settleAutoSteps`), the moment the form enters it.
  AUTO_APPROVE: {
    refusal: (step) => (step.autoApprove && step.allowedActions.includes('APPROVE') ? null : refuse('ERR-KPI-04', 'NOT_CONFIGURED')),
    target: forward,
  },
};

/** The form columns a move writes. */
export type FormPatch = Pick<FormInstance, 'status' | 'currentStepId' | 'currentStepEnteredAt' | 'overdueHandledAt'>;

export interface TransitionResult {
  ok: true;
  form: FormPatch;
  /** The step entered, or `null` when the form completed, was cancelled or stayed. */
  nextStep: WorkflowStep | null;
  /** The Goal Plan's new status (GOAL_SETTING; AUTO_LOCK), or `null` for no change. Locked → the caller sets `lockedAt`. */
  planStatus: GoalPlanStatus | null;
  /** The month's `WorkPlan` new status (WORK_PLAN), or `null`. Locked → the caller stamps `approvedAt` / `approvedBy`. */
  workPlanStatus: WorkPlanStatus | null;
  /** GOAL_CHANGE's final approval: apply the proposal (`goalPlanRules.applyGoalChanges`). */
  applyGoalChanges: boolean;
  /** The history row, without the people (see `checkAction`). */
  record: { formId: Id; stepId: Id; action: StepAction; comment: string | null; actedAt: IsoDateTime };
}

/**
 * One move by the table, with no question of WHO (see `entitlement`) or WHETHER the content is
 * ready (see `canSubmit`) — `checkAction` composes all three. Entering a step stamps
 * `currentStepEnteredAt` and clears `overdueHandledAt`; the first recorded action makes an Open form
 * InProgress (BR-KPI-13, 23).
 */
export function transition(
  form: FormInstance,
  steps: readonly WorkflowStep[],
  action: TransitionAction,
  ctx: { clock: Clock; comment: string | null },
): TransitionResult | Refusal {
  if (isTerminal(form)) return refuse('ERR-KPI-04', 'FORM_CLOSED');
  const own = steps.filter((s) => s.workflowId === form.workflowId);
  const step = own.find((s) => s.id === form.currentStepId);
  if (!step) return refuse('ERR-KPI-04', 'STEP_UNKNOWN');
  const n = lastStepNo(own);
  const rule = TRANSITIONS[action];
  const refusal = rule.refusal(step, form, n, ctx.comment);
  if (refusal) return refusal;

  const now = ctx.clock.now;
  const target = rule.target(step, n);
  const record = { formId: form.id, stepId: step.id, action, comment: ctx.comment, actedAt: now };
  const base = {
    ok: true as const,
    record,
    applyGoalChanges: false,
    planStatus: null as GoalPlanStatus | null,
    workPlanStatus: null as WorkPlanStatus | null,
    nextStep: null as WorkflowStep | null,
  };
  const registration = form.formType === 'GOAL_SETTING';
  const workPlan = form.formType === 'WORK_PLAN';

  switch (target.kind) {
    case 'enter': {
      const next = own.find((s) => s.stepNo === target.stepNo);
      if (!next) return refuse('ERR-KPI-04', 'STEP_UNKNOWN');
      return {
        ...base,
        nextStep: next,
        form: { status: 'InProgress', currentStepId: next.id, currentStepEnteredAt: now, overdueHandledAt: null },
        planStatus: registration ? planStatusOnEnterStep(next.stepNo, own, target.viaReturn) : null,
        workPlanStatus: workPlan ? workPlanStatusOnEnterStep(next.stepNo, own, target.viaReturn) : null,
      };
    }
    case 'complete':
      return {
        ...base,
        form: { status: 'Completed', currentStepId: null, currentStepEnteredAt: null, overdueHandledAt: null },
        planStatus: registration ? PLAN_STATUS_ON_COMPLETE : null,
        workPlanStatus: workPlan ? WORK_PLAN_STATUS_ON_COMPLETE : null,
        applyGoalChanges: form.formType === 'GOAL_CHANGE',
      };
    case 'cancel':
      return {
        ...base,
        form: { status: 'Cancelled', currentStepId: null, currentStepEnteredAt: null, overdueHandledAt: null },
        planStatus: registration ? PLAN_STATUS_ON_CANCEL : null,
        workPlanStatus: workPlan ? WORK_PLAN_STATUS_ON_CANCEL : null,
      };
    case 'stay':
      return {
        ...base,
        form: { status: 'InProgress', currentStepId: form.currentStepId, currentStepEnteredAt: form.currentStepEnteredAt, overdueHandledAt: now },
        planStatus: action === 'AUTO_LOCK' ? 'Locked' : null,
      };
  }
}

/** A move and the system's own approvals that follow it, merged into what is written once. */
export interface SettledMove extends TransitionResult {
  /** Every history row, in order: the move itself, then each AUTO_APPROVE (no actor). */
  records: TransitionResult['record'][];
  /** The steps the form passed through and left at once (their entry effects still apply). */
  passedSteps: WorkflowStep[];
}

/**
 * PEND-02 — a move that enters a step with `autoApprove` is followed, in the same write, by the
 * system's AUTO_APPROVE of that step (no content check: the person before already passed it). The
 * result is written ONCE: the form's final position, the LAST plan status (a registration goes straight
 * to Locked, never through Approved), `applyGoalChanges` if any part asks for it, and every history row.
 * A move entering no such step is returned as it is.
 */
export function settleAutoSteps(form: FormInstance, steps: readonly WorkflowStep[], moved: TransitionResult, clock: Clock): SettledMove | Refusal {
  const settled: SettledMove = { ...moved, records: [moved.record], passedSteps: [] };
  let current = { ...form, ...moved.form };
  let entered = moved.nextStep;
  while (entered?.autoApprove) {
    const auto = transition(current, steps, 'AUTO_APPROVE', { clock, comment: null });
    if (!auto.ok) return auto;
    settled.passedSteps.push(entered);
    settled.records.push(auto.record);
    settled.form = auto.form;
    settled.nextStep = auto.nextStep;
    settled.planStatus = auto.planStatus ?? settled.planStatus;
    settled.workPlanStatus = auto.workPlanStatus ?? settled.workPlanStatus;
    settled.applyGoalChanges = settled.applyGoalChanges || auto.applyGoalChanges;
    current = { ...current, ...auto.form };
    entered = auto.nextStep;
  }
  return settled;
}

/**
 * A form is FROZEN — no person may move it, only CANCEL — when its step's overdue LOCK has fired, or
 * its registration plan was locked by HR while the form was open. HR unlocking the plan releases it
 * (`onUnlock`).
 */
export function isFrozen(form: FormInstance, step: Pick<WorkflowStep, 'onOverdue'>, plan: Pick<GoalPlan, 'status'> | null): boolean {
  if (isTerminal(form)) return false;
  if (form.overdueHandledAt !== null && step.onOverdue === 'LOCK') return true;
  return form.formType === 'GOAL_SETTING' && plan?.status === 'Locked';
}

export interface CheckActionInput {
  form: FormInstance;
  steps: readonly WorkflowStep[];
  /** The form's Goal Plan (registration / adjustment), for the frozen check. */
  plan: Pick<GoalPlan, 'status'> | null;
  action: PersonFormAction;
  /** The step the screen showed (`FormActionInput.expectedStepId`). */
  expectedStepId: Id;
  comment: string | null;
  actor: ActorInput;
  entitlement: Omit<EntitlementContext, 'clock'>;
  /** The content check for SUBMIT / APPROVE (built by the caller per form type); ignored otherwise. */
  submitCheck: CanSubmitInput | null;
  clock: Clock;
}

export interface CheckedAction extends Omit<TransitionResult, 'record'> {
  mode: 'ACTOR' | 'DELEGATE' | 'PROXY' | 'ADMIN';
  /** The full history row: both people are always recorded (BR-KPI-21). */
  record: TransitionResult['record'] & { actorUserId: Id; onBehalfOfUserId: Id | null; delegationId: Id | null };
}

/**
 * THE entry point for a person acting on a form (`forms.act`). In order: the form is still open and
 * at the step the screen showed (ERR-KPI-04); not frozen; the actor is entitled (ERR-KPI-05); the
 * table allows the action here; for SUBMIT / APPROVE the content passes `canSubmit` (ERR-KPI-07/08/09).
 * Only then the move. A refusal changes nothing.
 */
export function checkAction(input: CheckActionInput): CheckedAction | Refusal {
  const { form, steps, action, clock } = input;
  if (isTerminal(form)) return refuse('ERR-KPI-04', 'FORM_CLOSED');
  if (form.currentStepId !== input.expectedStepId) return refuse('ERR-KPI-04', 'STALE_STEP');
  const step = steps.find((s) => s.id === form.currentStepId && s.workflowId === form.workflowId);
  if (!step) return refuse('ERR-KPI-04', 'STEP_UNKNOWN');
  // Monthly work review (PEND-14): completing it must record the month's WorkResult — wired in step
  // 8.3. Until then only HR's CANCEL goes through.
  if (form.formType === 'WORK_REVIEW' && action !== 'CANCEL') return refuse('ERR-KPI-04', 'WORK_FORM_NOT_BUILT');
  if (action !== 'CANCEL' && isFrozen(form, step, input.plan)) return refuse('ERR-KPI-04', 'FROZEN');

  const who = entitlement(form, step, action, input.actor, { ...input.entitlement, clock });
  if (!who.ok) return who;

  const moved = transition(form, steps, action, { clock, comment: input.comment });
  if (!moved.ok) return moved;

  if (action === 'SUBMIT' || action === 'APPROVE') {
    const check = input.submitCheck;
    if (check === null) throw new Error('checkAction: SUBMIT/APPROVE needs a submitCheck');
    // The check must describe THIS form at THIS step — a lenient one built for another would skip it.
    const matches =
      check.formType === form.formType &&
      (check.formType !== 'KPI_EVAL' || check.step.id === step.id) &&
      (check.formType !== 'GOAL_SETTING' || check.stepNo === step.stepNo) &&
      (check.formType !== 'WORK_PLAN' || check.stepNo === step.stepNo);
    if (!matches) return refuse('ERR-KPI-04', 'SUBMIT_CHECK_MISMATCH');
    const content = canSubmit(check);
    if (!content.ok) return refuse(content.issues[0].code, 'CONTENT_INCOMPLETE', content.issues);
  }

  return {
    ...moved,
    mode: who.mode,
    record: { ...moved.record, actorUserId: who.actorUserId, onBehalfOfUserId: who.onBehalfOfUserId, delegationId: who.delegationId },
  };
}

/**
 * Why the actor may NOT EDIT the subject's plan or scores at the current step now (BR-KPI-23), or
 * `null` when they may: the form is closed, the step does not allow EDIT, or it is frozen →
 * ERR-KPI-04 (the state is wrong for anyone); the actor is not entitled → ERR-KPI-05.
 */
export function editRefusal(
  form: FormInstance,
  steps: readonly WorkflowStep[],
  plan: Pick<GoalPlan, 'status'> | null,
  actor: ActorInput,
  ctx: EntitlementContext,
): Refusal | null {
  if (isTerminal(form)) return refuse('ERR-KPI-04', 'FORM_CLOSED');
  const step = steps.find((s) => s.id === form.currentStepId && s.workflowId === form.workflowId);
  if (!step) return refuse('ERR-KPI-04', 'STEP_UNKNOWN');
  if (!step.allowedActions.includes('EDIT')) return refuse('ERR-KPI-04', 'EDIT_NOT_ALLOWED');
  if (isFrozen(form, step, plan)) return refuse('ERR-KPI-04', 'FROZEN');
  const who = entitlement(form, step, 'EDIT', actor, ctx);
  return who.ok ? null : who;
}

/** Whether the actor may EDIT the subject's plan or scores at the current step now (BR-KPI-23). */
export function mayEditAtCurrentStep(
  form: FormInstance,
  steps: readonly WorkflowStep[],
  plan: Pick<GoalPlan, 'status'> | null,
  actor: ActorInput,
  ctx: EntitlementContext,
): boolean {
  return editRefusal(form, steps, plan, actor, ctx) === null;
}

/**
 * The standing a user EDITs with when the call names nobody else ("Lưu nháp", `saveGoal` — their
 * contracts carry no `onBehalfOfUserId`): as themself when they are a step actor; else as the delegate
 * of a step actor under a delegation valid now; else, with the proxy right, on behalf of the first
 * step actor; else as themself (which `entitlement` then refuses). Both people end up recorded.
 */
export function editStanding(form: Pick<FormInstance, 'formType'>, userId: Id, ctx: EntitlementContext): ActorInput {
  const self: ActorInput = { actorUserId: userId, onBehalfOfUserId: null, delegationId: null };
  if (ctx.stepActors.includes(userId)) return self;
  const delegation = ctx.delegations.find(
    (d) => d.toUserId === userId && ctx.stepActors.includes(d.fromUserId) && isDelegationValid(d, form.formType, ctx.clock),
  );
  if (delegation) return { actorUserId: userId, onBehalfOfUserId: delegation.fromUserId, delegationId: delegation.id };
  if (ctx.actorMayProxy && ctx.stepActors.length > 0 && ctx.subjectUserId !== userId) {
    return { actorUserId: userId, onBehalfOfUserId: ctx.stepActors[0], delegationId: null };
  }
  return self;
}

/** The evaluation column the current step fills, i.e. what "Lưu nháp" may write (D6). */
export function editableColumn(step: Pick<WorkflowStep, 'evaluationColumn'>): EvaluationColumn | null {
  return step.evaluationColumn;
}

// ─── Time (BR-KPI-13) ──────────────────────────────────────────────────────────────────────────

/** min(entered + SLA, form due date), in the tenant's zone; the form's due date when the step has no SLA. */
export function stepDeadline(form: Pick<FormInstance, 'dueDate' | 'currentStepEnteredAt'>, step: Pick<WorkflowStep, 'slaDays'>, tz: string): IsoDate {
  if (step.slaDays === null || form.currentStepEnteredAt === null) return form.dueDate;
  return minDate(addDays(toZonedDate(form.currentStepEnteredAt, tz), step.slaDays), form.dueDate);
}

/** Past the deadline: the deadline day itself is still on time. "Overdue" is never a stored status. */
export function isOverdue(form: FormInstance, step: Pick<WorkflowStep, 'slaDays'>, clock: Clock): boolean {
  return !isTerminal(form) && todayOf(clock) > stepDeadline(form, step, clock.tz);
}

/** The key that makes one reminder per step entry: T7 uses it as the notification's `sourceEventId`. */
export function reminderKey(form: Pick<FormInstance, 'id' | 'currentStepId' | 'currentStepEnteredAt'>): string {
  return `remind:${form.id}:${form.currentStepId}:${form.currentStepEnteredAt}`;
}

/** Within `remindDaysBefore` of the deadline and not yet overdue. */
export function isReminderDue(form: FormInstance, step: Pick<WorkflowStep, 'slaDays' | 'remindDaysBefore'>, clock: Clock): boolean {
  if (isTerminal(form) || step.remindDaysBefore === null) return false;
  const deadline = stepDeadline(form, step, clock.tz);
  const today = todayOf(clock);
  return today >= addDays(deadline, -step.remindDaysBefore) && today <= deadline;
}

export interface OverdueAction {
  formId: Id;
  stepId: Id;
  behaviour: OverdueBehaviour;
  /** What to record and move by (`transition`); `null` for REMIND, which records nothing. */
  action: 'AUTO_FORWARD' | 'AUTO_LOCK' | null;
}

/**
 * What a step will REALLY do when it runs over — its configured `onOverdue`, except that a
 * misconfigured AUTO_FORWARD on the last step, or LOCK outside registration, falls back to REMIND
 * (BR-KPI-13). `null` = nothing configured. The scheduler acts on it and the deadline reminder (T7)
 * warns about it, so the warning never promises a lock or a hand-on that will not happen.
 */
export function effectiveOverdueBehaviour(
  form: Pick<FormInstance, 'formType'>,
  step: Pick<WorkflowStep, 'onOverdue' | 'stepNo'>,
  workflowSteps: readonly Pick<WorkflowStep, 'stepNo' | 'autoApprove'>[],
): OverdueBehaviour | null {
  const behaviour = step.onOverdue;
  if (behaviour === 'AUTO_FORWARD' && step.stepNo >= Math.max(...workflowSteps.map((s) => s.stepNo))) return 'REMIND';
  // Never forward into a step that approves itself: the form would complete with nobody deciding.
  if (behaviour === 'AUTO_FORWARD' && workflowSteps.find((s) => s.stepNo === step.stepNo + 1)?.autoApprove) return 'REMIND';
  if (behaviour === 'LOCK' && form.formType !== 'GOAL_SETTING') return 'REMIND';
  return behaviour;
}

/**
 * What one scheduler tick must do about overdue forms (BR-KPI-13). Once per entry into a step
 * (`overdueHandledAt` is null), one move per form per tick — call it ONCE per tick on the forms as
 * they were. REMIND only sets `overdueHandledAt` and emits `form.overdue`. A misconfigured
 * AUTO_FORWARD on the last step, or LOCK outside registration, falls back to REMIND.
 */
export function overdueActions(forms: readonly FormInstance[], steps: readonly WorkflowStep[], clock: Clock): OverdueAction[] {
  const actions: OverdueAction[] = [];
  for (const form of forms) {
    if (isTerminal(form) || form.overdueHandledAt !== null) continue;
    const own = steps.filter((s) => s.workflowId === form.workflowId);
    const step = own.find((s) => s.id === form.currentStepId);
    const behaviour = step ? effectiveOverdueBehaviour(form, step, own) : null;
    if (!step || behaviour === null || !isOverdue(form, step, clock)) continue;
    actions.push({
      formId: form.id,
      stepId: step.id,
      behaviour,
      action: behaviour === 'AUTO_FORWARD' ? 'AUTO_FORWARD' : behaviour === 'LOCK' ? 'AUTO_LOCK' : null,
    });
  }
  return actions;
}

/** The forms whose step reminder is due, with the key that keeps it to one per step entry. */
export function remindersDue(forms: readonly FormInstance[], steps: readonly WorkflowStep[], clock: Clock): { formId: Id; stepId: Id; key: string }[] {
  return forms.flatMap((form) => {
    const step = steps.find((s) => s.id === form.currentStepId && s.workflowId === form.workflowId);
    return step && isReminderDue(form, step, clock) ? [{ formId: form.id, stepId: step.id, key: reminderKey(form) }] : [];
  });
}

/**
 * HR unlocked the plan of a frozen registration form: the step starts again from now with the new due
 * date, so the next tick does not lock it straight back (BR-KPI-13). `null` for a closed form.
 */
export function onUnlock(
  form: FormInstance,
  newDueDate: IsoDate,
  clock: Clock,
): Pick<FormInstance, 'dueDate' | 'currentStepEnteredAt' | 'overdueHandledAt'> | null {
  if (isTerminal(form)) return null;
  return { dueDate: newDueDate, currentStepEnteredAt: clock.now, overdueHandledAt: null };
}

/** REMIND: the scheduler handled the step's overdue once — no move, no history row (BR-KPI-13). `null` for a closed form. */
export function markHandled(form: Pick<FormInstance, 'status'>, clock: Clock): Pick<FormInstance, 'overdueHandledAt'> | null {
  return isTerminal(form) ? null : { overdueHandledAt: clock.now };
}

/**
 * Who must act on the current step now — its actors, plus anyone holding a valid delegation from one
 * of them (what `form.stepActed` / `form.dueSoon` / `form.overdue` carry as `assigneeUserIds`).
 */
export function assigneesOf(form: Pick<FormInstance, 'formType' | 'status'>, stepActors: readonly Id[], delegations: readonly Delegation[], clock: Clock): Id[] {
  if (isTerminal(form)) return [];
  const delegates = delegations.filter((d) => stepActors.includes(d.fromUserId) && isDelegationValid(d, form.formType, clock)).map((d) => d.toUserId);
  return [...new Set([...stepActors, ...delegates])];
}

/** Whether `userId` should see the form in their inbox: a current step actor, or their valid delegate. */
export function isInInbox(form: FormInstance, userId: Id, stepActors: readonly Id[], delegations: readonly Delegation[], clock: Clock): boolean {
  if (isTerminal(form)) return false;
  if (stepActors.includes(userId)) return true;
  return delegations.some((d) => d.toUserId === userId && stepActors.includes(d.fromUserId) && isDelegationValid(d, form.formType, clock));
}

// ─── Launches (BR-KPI-19, D5) ──────────────────────────────────────────────────────────────────

/** Launch date + `dueDays` ("7 ngày sau ngày khởi chạy", HR guide p. 92), in the tenant's zone. */
export function launchDueDate(launchedAt: IsoDateTime, dueDays: number, tz: string): IsoDate {
  return addDays(toZonedDate(launchedAt, tz), dueDays);
}

/** What `createLaunch` / `saveLaunchRule` refuse (ERR-KPI-06). GOAL_CHANGE is started by hand (BR-KPI-15). */
export function validateLaunch(
  launch: Pick<FormLaunch, 'formType' | 'periodId' | 'cycleId' | 'dueDays' | 'recipientMode' | 'recipientFilter'>,
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const bad = (detail: string) => issues.push(ruleIssue('ERR-KPI-06', null, detail));
  if (launch.formType === 'GOAL_CHANGE') bad('NOT_LAUNCHABLE');
  if ((launch.formType === 'KPI_EVAL' || isWorkFormType(launch.formType)) && launch.periodId === null) bad('PERIOD_REQUIRED');
  if (launch.formType === 'GOAL_SETTING' && launch.cycleId === null) bad('CYCLE_REQUIRED');
  if (!Number.isInteger(launch.dueDays) || launch.dueDays < 0) bad('DUE_DAYS_INVALID');
  if (launch.recipientMode === 'FILTER' && launch.recipientFilter === null) bad('FILTER_REQUIRED');
  return issues;
}

/**
 * The period types a form type is launched for — ONE table for launches and rules: monthly work is for a
 * Month (PEND-14); the KPI evaluation is the FORMAL one, for a Quarter or the Year (PEND-09, `ASSUMPTION
 * Q52, Q60` — the monthly continuous evaluation is the work review). A type not listed takes no period.
 */
export const LAUNCH_PERIOD_TYPES: Readonly<Partial<Record<FormType, readonly PeriodType[]>>> = {
  KPI_EVAL: ['Quarter', 'Year'],
  WORK_PLAN: ['Month'],
  WORK_REVIEW: ['Month'],
};

/** A launch's period fits its form type (`LAUNCH_PERIOD_TYPES`): 06 `MONTH_REQUIRED` (monthly work) / `EVAL_PERIOD_NOT_FORMAL` (evaluation). */
export function launchPeriodIssues(formType: FormType, period: Pick<CyclePeriod, 'periodType'> | null): RuleIssue[] {
  const allowed = LAUNCH_PERIOD_TYPES[formType];
  if (!allowed || period === null || allowed.includes(period.periodType)) return [];
  return [ruleIssue('ERR-KPI-06', 'periodId', isWorkFormType(formType) ? 'MONTH_REQUIRED' : 'EVAL_PERIOD_NOT_FORMAL')];
}

/**
 * PEND-01 — where a form may start (`FormLaunch.startStepNo`, `StartFormInput.startStepNo`): `null`
 * (step 1) or a whole step of the workflow up to the owner's own (SELF) step — starting later would skip
 * the owner (06 `START_STEP_INVALID`). Not registration-only: any form with a SELF step may start there
 * (Plan B's WORK_PLAN); a workflow with no SELF step starts at 1.
 */
export function startStepIssues(startStepNo: number | null | undefined, steps: readonly Pick<WorkflowStep, 'stepNo' | 'actorRule'>[]): RuleIssue[] {
  if (startStepNo === null || startStepNo === undefined) return [];
  const ok = Number.isInteger(startStepNo) && startStepNo >= 1 && startStepNo <= ownerStepNo(steps) && steps.some((s) => s.stepNo === startStepNo);
  return ok ? [] : [ruleIssue('ERR-KPI-06', 'startStepNo', 'START_STEP_INVALID')];
}

/** The steps a form may start at (PEND-01): step 1 up to the owner's (SELF) step, in order. */
export function startStepChoices<S extends Pick<WorkflowStep, 'stepNo' | 'actorRule'>>(steps: readonly S[]): S[] {
  const owner = ownerStepNo(steps);
  return [...steps].sort((a, b) => a.stepNo - b.stepNo).filter((s) => s.stepNo <= owner);
}

/** One way to store "step 1": `null` (PEND-01). */
export const normaliseStartStepNo = (startStepNo: number | null | undefined): number | null =>
  startStepNo === undefined || startStepNo === null || startStepNo === 1 ? null : startStepNo;

/**
 * The step a form is created at: `startStepNo` when it is (still) valid, else step 1 — a scheduled
 * launch can outlive an edit of its workflow, and a scheduler tick must not die on it.
 */
export function initialStep<S extends Pick<WorkflowStep, 'stepNo' | 'actorRule'>>(steps: readonly S[], startStepNo: number | null | undefined): S | undefined {
  const sorted = [...steps].sort((a, b) => a.stepNo - b.stepNo);
  if (startStepIssues(startStepNo, sorted).length === 0 && startStepNo != null) return sorted.find((s) => s.stepNo === startStepNo);
  return sorted[0];
}

/** One-off SCHEDULED launches whose time has come. */
export function dueScheduledLaunches(launches: readonly FormLaunch[], clock: Clock): FormLaunch[] {
  return launches.filter((l) => l.status === 'Scheduled' && Date.parse(l.scheduledAt) <= Date.parse(clock.now));
}

export type RecipientSkipReason = 'ALREADY_HAS_FORM' | 'NO_APPROVED_PLAN' | 'NO_PRIMARY_ASSIGNMENT' | 'NOT_EMPLOYED' | 'NO_WORK_TASKS';

export interface RecipientContext {
  employees: readonly Employee[];
  assignments: readonly EmployeeAssignment[];
  units: readonly OrgUnit[];
  positions: readonly JobPosition[];
  existingForms: readonly FormInstance[];
  plans: readonly GoalPlan[];
  /** The evaluation period (KPI_EVAL). */
  period: CyclePeriod | null;
  /** The day the launch fires, in the tenant's zone. */
  launchDate: IsoDate;
  /**
   * WORK_REVIEW: each employee's month plan — its status and number of live (not cancelled) tasks.
   * A month is reviewed only when its plan is Locked (`NO_APPROVED_PLAN`) with at least one live task
   * (`NO_WORK_TASKS`) — `ASSUMPTION Q69`: once a review exists the list is frozen, so an unapproved or
   * empty plan could never be fixed or scored. Missing = no plan.
   */
  workPlans?: ReadonlyMap<Id, { status: GoalPlanStatus; liveTasks: number }>;
}

export interface Recipients {
  subjects: Id[];
  /** GOAL_SETTING subjects with no plan for the cycle yet: create their Draft Employee plan. */
  needsDraftPlan: Id[];
  skipped: { employeeId: Id; reason: RecipientSkipReason }[];
}

/**
 * Who receives a form when a launch FIRES (recipients are resolved then, not when scheduled):
 * - employed — registration: on the launch date; evaluation: at least one day of the period, so
 *   someone who left on 15 Jan still gets January's evaluation;
 * - ALL, or FILTER: AND across fields, OR within one, an empty list = any; units with their children
 *   when asked; position and job level from the primary assignment;
 * - skipped (and reported): no primary assignment, already has a non-cancelled form of this type for
 *   this period (KPI_EVAL) / this cycle (GOAL_SETTING), an evaluation without an Approved/Locked plan,
 *   a monthly work review for a month whose plan is not Locked or has no live task (`ASSUMPTION Q69`).
 * People excluded by the filter or not employed are left out silently, unless named by hand.
 */
export function resolveRecipients(launch: Pick<FormLaunch, 'formType' | 'cycleId' | 'periodId' | 'recipientMode' | 'recipientFilter'>, ctx: RecipientContext): Recipients {
  const out: Recipients = { subjects: [], needsDraftPlan: [], skipped: [] };
  const filter = launch.recipientMode === 'FILTER' ? launch.recipientFilter : null;
  const named = new Set(filter?.employeeIds ?? []);
  const evaluation = launch.formType === 'KPI_EVAL';
  // Period forms: one per subject and period. Monthly work (PEND-14) needs no KPI plan; its plan is
  // for whoever works on the launch day (`ASSUMPTION Q66`), its review for whoever worked in the month.
  const periodForm = evaluation || isWorkFormType(launch.formType);
  const workedInPeriod = evaluation || launch.formType === 'WORK_REVIEW';
  const unitSet = filter && filter.orgUnitIds.length
    ? new Set(filter.orgUnitIds.flatMap((id) => (filter.includeChildUnits ? [...descendantUnitIds(ctx.units, id)] : [id])))
    : null;
  // An evaluation launch may leave `cycleId` empty: its period names the cycle.
  const cycleId = launch.cycleId ?? ctx.period?.cycleId ?? null;
  const planOf = (employeeId: Id) =>
    ctx.plans.find((p) => p.cycleId === cycleId && p.ownerType === 'Employee' && p.ownerEmployeeId === employeeId) ?? null;
  const planCycle = new Map(ctx.plans.map((p) => [p.id, p.cycleId]));

  for (const e of ctx.employees) {
    const skip = (reason: RecipientSkipReason) => out.skipped.push({ employeeId: e.id, reason });
    const employed = workedInPeriod
      ? ctx.period !== null && isEmployedDuring(e, ctx.period.startDate, ctx.period.endDate)
      : isEmployedOn(e, ctx.launchDate);
    if (!employed) {
      if (named.has(e.id)) skip('NOT_EMPLOYED');
      continue;
    }
    const refDate = workedInPeriod && ctx.period
      ? minDate(e.leftOn !== null && e.leftOn < ctx.period.endDate ? e.leftOn : ctx.period.endDate, ctx.launchDate)
      : ctx.launchDate;
    const primary = primaryAssignmentOn(e.id, ctx.assignments, refDate);

    if (filter) {
      const position = ctx.positions.find((p) => p.id === primary?.positionId);
      const matches =
        (filter.employeeIds.length === 0 || named.has(e.id)) &&
        (unitSet === null || (primary !== null && unitSet.has(primary.orgUnitId))) &&
        (filter.positionIds.length === 0 || (primary !== null && filter.positionIds.includes(primary.positionId))) &&
        (filter.jobLevels.length === 0 || (position !== undefined && filter.jobLevels.includes(position.jobLevel))) &&
        (filter.employmentStatuses.length === 0 || filter.employmentStatuses.includes(e.employmentStatus));
      if (!matches) continue;
    }
    if (primary === null) {
      skip('NO_PRIMARY_ASSIGNMENT');
      continue;
    }
    const duplicate = ctx.existingForms.some(
      (f) =>
        f.subjectEmployeeId === e.id &&
        f.formType === launch.formType &&
        f.status !== 'Cancelled' &&
        (periodForm ? f.periodId === launch.periodId : f.goalPlanId !== null && planCycle.get(f.goalPlanId) === cycleId),
    );
    if (duplicate) {
      skip('ALREADY_HAS_FORM');
      continue;
    }
    if (launch.formType === 'WORK_REVIEW') {
      const month = ctx.workPlans?.get(e.id);
      if (month?.status !== 'Locked') {
        skip('NO_APPROVED_PLAN');
        continue;
      }
      if (month.liveTasks === 0) {
        skip('NO_WORK_TASKS');
        continue;
      }
    }
    const plan = planOf(e.id);
    if (evaluation && (plan === null || (plan.status !== 'Approved' && plan.status !== 'Locked'))) {
      skip('NO_APPROVED_PLAN');
      continue;
    }
    out.subjects.push(e.id);
    if (launch.formType === 'GOAL_SETTING' && plan === null) out.needsDraftPlan.push(e.id);
  }
  return out;
}

export interface RuleFiring {
  ruleId: Id;
  periodId: Id;
  cycleId: Id;
  fireDate: IsoDate;
}

/**
 * The recurring launches due now (D5): for each active rule, each period of its type in an Active or
 * Evaluating cycle
 * that ended `offsetDays` ago or more, and has no launch from this rule yet (a cancelled one counts —
 * HR cancelled it on purpose). Missed periods catch up, in order; never twice per (rule, period).
 */
export function launchRuleFirings(
  rules: readonly FormLaunchRule[],
  periods: readonly CyclePeriod[],
  cycles: readonly Pick<PerformanceCycle, 'id' | 'status'>[],
  existingLaunches: readonly Pick<FormLaunch, 'launchRuleId' | 'periodId'>[],
  clock: Clock,
): RuleFiring[] {
  const today = todayOf(clock);
  // Evaluating too: the last period of a cycle ends after the cycle has moved to Evaluating.
  const activeCycles = new Set(cycles.filter((c) => c.status === 'Active' || c.status === 'Evaluating').map((c) => c.id));
  const done = new Set(existingLaunches.filter((l) => l.launchRuleId !== null).map((l) => `${l.launchRuleId}:${l.periodId}`));
  const firings: RuleFiring[] = [];
  for (const rule of rules) {
    if (!rule.isActive) continue;
    for (const period of periods) {
      if (period.periodType !== rule.periodType || !activeCycles.has(period.cycleId)) continue;
      const fireDate = addDays(period.endDate, rule.offsetDays);
      if (fireDate > today || done.has(`${rule.id}:${period.id}`)) continue;
      firings.push({ ruleId: rule.id, periodId: period.id, cycleId: period.cycleId, fireDate });
    }
  }
  return firings.sort((a, b) => (a.fireDate === b.fireDate ? a.ruleId.localeCompare(b.ruleId) : a.fireDate < b.fireDate ? -1 : 1));
}

/** What `createLaunch` refuses about WHEN (ERR-KPI-06): RECURRING comes only from a rule; SCHEDULED is in the future. */
export function launchTimingIssues(launch: Pick<FormLaunch, 'timing' | 'scheduledAt'>, clock: Clock): RuleIssue[] {
  if (launch.timing === 'RECURRING') return [ruleIssue('ERR-KPI-06', 'timing', 'RECURRING_BY_RULE_ONLY')];
  if (launch.timing === 'SCHEDULED') {
    const at = Date.parse(launch.scheduledAt);
    if (!Number.isFinite(at)) return [ruleIssue('ERR-KPI-06', 'scheduledAt', 'SCHEDULE_INVALID')];
    if (at <= Date.parse(clock.now)) return [ruleIssue('ERR-KPI-06', 'scheduledAt', 'SCHEDULE_IN_PAST')];
  }
  return [];
}

/** Only a `Scheduled` launch (which has no forms yet) can be cancelled (ERR-KPI-04). */
export function canCancelLaunch(launch: Pick<FormLaunch, 'status'>): Decision {
  return launch.status === 'Scheduled' ? { ok: true } : { ok: false, code: 'ERR-KPI-04' };
}

/**
 * What `saveLaunchRule` refuses (ERR-KPI-06): a recurring rule launches the evaluation only
 * (registration is launched once, an adjustment is started by hand); whole days ≥ 0; a FILTER rule
 * names its filter.
 */
export function validateLaunchRule(
  rule: Pick<FormLaunchRule, 'offsetDays' | 'dueDays' | 'recipientMode' | 'recipientFilter'> & Partial<Pick<FormLaunchRule, 'periodType' | 'isActive'>>,
  formType: FormType,
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const bad = (ref: string | null, detail: string) => issues.push(ruleIssue('ERR-KPI-06', ref, detail));
  if (formType !== 'KPI_EVAL') bad('workflowId', 'RULE_KPI_EVAL_ONLY');
  if (!Number.isInteger(rule.offsetDays) || rule.offsetDays < 0) bad('offsetDays', 'OFFSET_DAYS_INVALID');
  if (!Number.isInteger(rule.dueDays) || rule.dueDays < 0) bad('dueDays', 'DUE_DAYS_INVALID');
  if (rule.recipientMode === 'FILTER' && rule.recipientFilter === null) bad('recipientFilter', 'FILTER_REQUIRED');
  // An ACTIVE rule fires for its period type: it must fit the form type (a stopped monthly rule may stay).
  const allowed = LAUNCH_PERIOD_TYPES[formType];
  if (rule.isActive !== false && rule.periodType !== undefined && allowed && !allowed.includes(rule.periodType)) {
    bad('periodType', isWorkFormType(formType) ? 'MONTH_REQUIRED' : 'EVAL_PERIOD_NOT_FORMAL');
  }
  return issues;
}

// ─── Starting a form by hand (BR-KPI-15, 19) ───────────────────────────────────────────────────

export interface StartFormContext {
  /** The workflow's form type (a form's type is its workflow's). */
  formType: FormType;
  plan: GoalPlan | null;
  /** Who a form on `plan` is about: its employee, or the head of its unit (Company / OrgUnit plans). */
  planOwnerEmployeeId: Id | null;
  /** The plan's cycle. */
  cycle: Pick<PerformanceCycle, 'status'> | null;
  /** The tenant's forms (only open ones matter). */
  forms: readonly Pick<FormInstance, 'formType' | 'goalPlanId' | 'status'>[];
  clock: Clock;
}

/**
 * What `forms.startForm` refuses. A form started by hand is either an adjustment (GOAL_CHANGE) of a
 * Locked plan — at most one open per plan (ERR-KPI-04 `CHANGE_ALREADY_OPEN`) — or the registration
 * (GOAL_SETTING) of a Company / OrgUnit plan, which no launch reaches. An evaluation is never started
 * by hand (`NOT_STARTABLE`). The subject is the plan's owner (its unit's head); the cycle must accept
 * the form type; the due date is a real date, not in the past. Validation (06) before state (04).
 */
export function canStartForm(input: Pick<FormInstance, 'subjectEmployeeId' | 'goalPlanId' | 'periodId' | 'dueDate'>, ctx: StartFormContext): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const bad = (ref: string | null, detail: string) => issues.push(ruleIssue('ERR-KPI-06', ref, detail));
  const { formType, plan } = ctx;
  if (formType === 'KPI_EVAL' || isWorkFormType(formType)) return [ruleIssue('ERR-KPI-06', 'workflowId', 'NOT_STARTABLE')];
  if (plan === null || input.goalPlanId !== plan.id) bad('goalPlanId', 'PLAN_REQUIRED');
  if (input.periodId !== null) bad('periodId', 'PERIOD_NOT_ALLOWED');
  if (!isIsoDate(input.dueDate) || input.dueDate < todayOf(ctx.clock)) bad('dueDate', 'DUE_DATE_INVALID');
  if (plan !== null) {
    if (formType === 'GOAL_SETTING' && plan.ownerType === 'Employee') bad('goalPlanId', 'EMPLOYEE_PLAN_BY_LAUNCH');
    if (ctx.planOwnerEmployeeId === null || input.subjectEmployeeId !== ctx.planOwnerEmployeeId) bad('subjectEmployeeId', 'SUBJECT_NOT_OWNER');
  }
  if (issues.length || plan === null) return issues;

  const open = ctx.forms.some((f) => f.goalPlanId === plan.id && f.formType === formType && !isTerminal(f));
  if (formType === 'GOAL_CHANGE') {
    if (plan.status !== 'Locked') return [ruleIssue('ERR-KPI-04', 'goalPlanId', 'PLAN_NOT_LOCKED')];
    if (open) return [ruleIssue('ERR-KPI-04', 'goalPlanId', 'CHANGE_ALREADY_OPEN')];
  } else {
    // A locked plan changes only through GOAL_CHANGE (BR-KPI-14): registering it again would unlock it unaudited.
    if (plan.status === 'Locked') return [ruleIssue('ERR-KPI-04', 'goalPlanId', 'PLAN_LOCKED')];
    if (open) return [ruleIssue('ERR-KPI-04', 'goalPlanId', 'REGISTRATION_ALREADY_OPEN')];
  }
  if (ctx.cycle === null || !cycleAllowsLaunch(ctx.cycle, formType).ok) return [ruleIssue('ERR-KPI-04', 'goalPlanId', 'CYCLE_NOT_OPEN')];
  return [];
}

// ─── Delegations (BR-KPI-21) ───────────────────────────────────────────────────────────────────

export interface DelegationContext {
  /** The tenant's delegations. */
  existing: readonly Delegation[];
  /** The tenant's accounts. */
  users: readonly UserAccount[];
  /** The delegation being edited (ignored in the overlap checks), or `null` for a new one. */
  editingId: Id | null;
  clock: Clock;
}

const overlaps = (a: Pick<Delegation, 'validFrom' | 'validTo'>, b: Pick<Delegation, 'validFrom' | 'validTo'>) =>
  a.validFrom <= b.validTo && b.validFrom <= a.validTo;

/**
 * What `saveDelegation` refuses (ERR-KPI-06): delegating to oneself; to anyone but an Active account
 * of the tenant; dates that are not real or run backwards; a delegation already over; a CHAIN — the
 * delegate already delegates, or the delegator is someone's delegate, for the same form type over
 * overlapping dates (a delegate acts for the delegator only, never passes it on); and an overlapping
 * duplicate of the same pair and form type. Revoked delegations no longer count.
 */
export function delegationIssues(
  d: Pick<Delegation, 'fromUserId' | 'toUserId' | 'formType' | 'validFrom' | 'validTo'>,
  ctx: DelegationContext,
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const bad = (ref: string, detail: string) => issues.push(ruleIssue('ERR-KPI-06', ref, detail));
  if (d.fromUserId === d.toUserId) bad('toUserId', 'SELF_DELEGATION');
  else if (!ctx.users.some((u) => u.id === d.toUserId && u.status === 'Active')) bad('toUserId', 'TO_USER_INVALID');
  if (!isIsoDate(d.validFrom) || !isIsoDate(d.validTo) || d.validTo < d.validFrom) {
    bad('validTo', 'DATES_INVALID');
    return issues;
  }
  if (d.validTo < todayOf(ctx.clock)) bad('validTo', 'VALID_TO_PAST');
  if (issues.length) return issues;

  const live = ctx.existing.filter((e) => e.id !== ctx.editingId && e.revokedAt === null && e.formType === d.formType && overlaps(e, d));
  if (live.some((e) => e.fromUserId === d.toUserId || e.toUserId === d.fromUserId)) bad('toUserId', 'DELEGATION_CHAIN');
  else if (live.some((e) => e.fromUserId === d.fromUserId && e.toUserId === d.toUserId)) bad('toUserId', 'DELEGATION_DUPLICATE');
  return issues;
}

/**
 * Who may revoke a delegation: the delegator, or someone who manages delegations for the whole
 * tenant (HR — `delegation.manage` with a Tenant scope), else ERR-KPI-05; one already revoked is
 * ERR-KPI-04. An expired one may still be revoked (it changes nothing but the record).
 */
export function canRevokeDelegation(
  d: Pick<Delegation, 'fromUserId' | 'revokedAt'>,
  actor: { actorUserId: Id; actorMayManage: boolean },
  clock: Clock,
): Decision {
  if (actor.actorUserId !== d.fromUserId && !actor.actorMayManage) return { ok: false, code: 'ERR-KPI-05' };
  if (d.revokedAt !== null && Date.parse(d.revokedAt) <= Date.parse(clock.now)) return { ok: false, code: 'ERR-KPI-04' };
  return { ok: true };
}
