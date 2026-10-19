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
  PersonFormAction,
  Role,
  StepAction,
  UserAccount,
  UserRole,
  WorkflowStep,
} from '@/data/types';
import { ruleIssue, type ErrorCode, type RuleIssue } from './errorCatalog';
import { canSubmit, type CanSubmitInput } from './formRules';
import { PLAN_STATUS_ON_CANCEL, PLAN_STATUS_ON_COMPLETE, planStatusOnEnterStep } from './goalPlanRules';
import { addDays, isWithin, minDate, todayOf, toZonedDate, type Clock } from './isoDate';
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
 * lock, so the form could never be released); registration needs ≥ 2 steps including the owner's;
 * a ROLE step names its role.
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
  });
  if (formType === 'GOAL_SETTING') {
    if (n < 2) bad(null, 'TOO_FEW_STEPS');
    if (!sorted.some((s) => s.actorRule === 'SELF')) bad(null, 'OWNER_STEP_REQUIRED');
  }
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
  /** HR/ADMIN whose scope covers the subject (`permissionRules`, Phase 1.3). */
  actorIsProxyAdmin: boolean;
  /** The subject's own account — never an actor of a non-SELF step on their own form. */
  subjectUserId: Id | null;
  clock: Clock;
}

export type Entitlement =
  | { ok: true; mode: 'ACTOR' | 'DELEGATE' | 'PROXY' | 'ADMIN'; actorUserId: Id; onBehalfOfUserId: Id | null; delegationId: Id | null }
  | Refusal;

/**
 * Whether `input.actorUserId` may take `action` on the form's current step now. Both people are
 * always kept: a delegate or proxy acts with `onBehalfOfUserId` = the step's actor (BR-KPI-21).
 * - CANCEL — HR/ADMIN only, as themself.
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
    return ctx.actorIsProxyAdmin && onBehalfOfUserId === null && delegationId === null ? granted('ADMIN') : refuse('ERR-KPI-05', 'CANCEL_NOT_ALLOWED');
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
    if (!ctx.actorIsProxyAdmin) return refuse('ERR-KPI-05', 'PROXY_NOT_ALLOWED');
    return ctx.stepActors.includes(onBehalfOfUserId) ? granted('PROXY') : refuse('ERR-KPI-05', 'NOT_STEP_ACTOR');
  }
  if (ctx.stepActors.includes(actorUserId)) return granted('ACTOR');
  if (ctx.stepActors.length === 0 && ctx.actorIsProxyAdmin) return granted('PROXY');
  return refuse('ERR-KPI-05', 'NOT_STEP_ACTOR');
}

// ─── The transition table ──────────────────────────────────────────────────────────────────────

export type TransitionAction = PersonFormAction | 'AUTO_FORWARD' | 'AUTO_LOCK';

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
  const base = { ok: true as const, record, applyGoalChanges: false, planStatus: null as GoalPlanStatus | null, nextStep: null as WorkflowStep | null };
  const registration = form.formType === 'GOAL_SETTING';

  switch (target.kind) {
    case 'enter': {
      const next = own.find((s) => s.stepNo === target.stepNo);
      if (!next) return refuse('ERR-KPI-04', 'STEP_UNKNOWN');
      return {
        ...base,
        nextStep: next,
        form: { status: 'InProgress', currentStepId: next.id, currentStepEnteredAt: now, overdueHandledAt: null },
        planStatus: registration ? planStatusOnEnterStep(next.stepNo, own, target.viaReturn) : null,
      };
    }
    case 'complete':
      return {
        ...base,
        form: { status: 'Completed', currentStepId: null, currentStepEnteredAt: null, overdueHandledAt: null },
        planStatus: registration ? PLAN_STATUS_ON_COMPLETE : null,
        applyGoalChanges: form.formType === 'GOAL_CHANGE',
      };
    case 'cancel':
      return {
        ...base,
        form: { status: 'Cancelled', currentStepId: null, currentStepEnteredAt: null, overdueHandledAt: null },
        planStatus: registration ? PLAN_STATUS_ON_CANCEL : null,
      };
    case 'stay':
      return {
        ...base,
        form: { status: 'InProgress', currentStepId: form.currentStepId, currentStepEnteredAt: form.currentStepEnteredAt, overdueHandledAt: now },
        planStatus: action === 'AUTO_LOCK' ? 'Locked' : null,
      };
  }
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
      (check.formType !== 'GOAL_SETTING' || check.stepNo === step.stepNo);
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

/** Whether the actor may EDIT the subject's plan or scores at the current step now (BR-KPI-23). */
export function mayEditAtCurrentStep(
  form: FormInstance,
  steps: readonly WorkflowStep[],
  plan: Pick<GoalPlan, 'status'> | null,
  actor: ActorInput,
  ctx: EntitlementContext,
): boolean {
  if (isTerminal(form)) return false;
  const step = steps.find((s) => s.id === form.currentStepId);
  if (!step || !step.allowedActions.includes('EDIT') || isFrozen(form, step, plan)) return false;
  return entitlement(form, step, 'EDIT', actor, ctx).ok;
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
    if (!step || step.onOverdue === null || !isOverdue(form, step, clock)) continue;
    let behaviour = step.onOverdue;
    if (behaviour === 'AUTO_FORWARD' && step.stepNo >= lastStepNo(own)) behaviour = 'REMIND';
    if (behaviour === 'LOCK' && form.formType !== 'GOAL_SETTING') behaviour = 'REMIND';
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
  if (launch.formType === 'KPI_EVAL' && launch.periodId === null) bad('PERIOD_REQUIRED');
  if (launch.formType === 'GOAL_SETTING' && launch.cycleId === null) bad('CYCLE_REQUIRED');
  if (!Number.isInteger(launch.dueDays) || launch.dueDays < 0) bad('DUE_DAYS_INVALID');
  if (launch.recipientMode === 'FILTER' && launch.recipientFilter === null) bad('FILTER_REQUIRED');
  return issues;
}

/** One-off SCHEDULED launches whose time has come. */
export function dueScheduledLaunches(launches: readonly FormLaunch[], clock: Clock): FormLaunch[] {
  return launches.filter((l) => l.status === 'Scheduled' && Date.parse(l.scheduledAt) <= Date.parse(clock.now));
}

export type RecipientSkipReason = 'ALREADY_HAS_FORM' | 'NO_APPROVED_PLAN' | 'NO_PRIMARY_ASSIGNMENT' | 'NOT_EMPLOYED';

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
 *   this period (KPI_EVAL) / this cycle (GOAL_SETTING), an evaluation without an Approved/Locked plan.
 * People excluded by the filter or not employed are left out silently, unless named by hand.
 */
export function resolveRecipients(launch: Pick<FormLaunch, 'formType' | 'cycleId' | 'periodId' | 'recipientMode' | 'recipientFilter'>, ctx: RecipientContext): Recipients {
  const out: Recipients = { subjects: [], needsDraftPlan: [], skipped: [] };
  const filter = launch.recipientMode === 'FILTER' ? launch.recipientFilter : null;
  const named = new Set(filter?.employeeIds ?? []);
  const evaluation = launch.formType === 'KPI_EVAL';
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
    const employed = evaluation
      ? ctx.period !== null && isEmployedDuring(e, ctx.period.startDate, ctx.period.endDate)
      : isEmployedOn(e, ctx.launchDate);
    if (!employed) {
      if (named.has(e.id)) skip('NOT_EMPLOYED');
      continue;
    }
    const refDate = evaluation && ctx.period
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
        (evaluation ? f.periodId === launch.periodId : f.goalPlanId !== null && planCycle.get(f.goalPlanId) === cycleId),
    );
    if (duplicate) {
      skip('ALREADY_HAS_FORM');
      continue;
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
 * The recurring launches due now (D5): for each active rule, each period of its type in an ACTIVE cycle
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
  const activeCycles = new Set(cycles.filter((c) => c.status === 'Active').map((c) => c.id));
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
