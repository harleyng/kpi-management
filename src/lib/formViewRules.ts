/**
 * What a SCREEN needs to know about a form — Track T5 (WBS 4.5.2–4.5.5). This module decides
 * nothing new: every answer is a composition of `workflowRules` / `formRules`, taken in the same
 * order the gateway takes them, so the buttons a screen shows are the actions `forms.act` accepts
 * (pinned by `formViewRules.parity.test.ts` against the mock).
 *
 * It is a DISPLAY HINT. The gateway is the authority: a refusal it returns anyway (the form moved
 * on, a delegation expired between two renders) is shown, never hidden (decisions-log, T5).
 *
 * - `formStanding` — the current step, who must act, the deadline, and what THIS user may do now.
 * - `submitCheckInput` — the one builder of `canSubmit`'s input from rows, shared with the mock.
 * - `stepTiming` — the cheap per-row facts a list shows (step, deadline, overdue).
 * - `delegationState`, `goalDraftFromGoal` / `goalDraftFromKpi`, `workflowEditWarnings`.
 */

import type {
  CyclePeriod,
  Delegation,
  DelegationState,
  EvaluationColumn,
  EvaluationItem,
  FormInstance,
  FormType,
  Goal,
  GoalChangeItem,
  GoalDraft,
  GoalPlan,
  GoalTargetLevel,
  Id,
  IsoDate,
  Kgi,
  KpiDefinition,
  PersonFormAction,
  WorkflowStep,
  WorkTask,
} from '@/data/types';
import type { CanSubmitInput } from './formRules';
import { todayOf, type Clock } from './isoDate';
import type { SessionDirectory } from './sessionRules';
import {
  TRANSITIONS,
  assigneesOf,
  editRefusal,
  editStanding,
  entitlement,
  isFrozen,
  isOverdue,
  isTerminal,
  resolveStepActors,
  stepDeadline,
  userOfEmployee,
  type ActorDirectory,
  type ActorInput,
  type EntitlementContext,
} from './workflowRules';

// ─── Inputs ────────────────────────────────────────────────────────────────────────────────────

/** The session's directory as the actor rules read it (no extra query: the session already holds it). */
export function actorDirectoryOf(
  dir: Pick<SessionDirectory, 'accounts' | 'employees' | 'roles' | 'userRoles' | 'orgUnits' | 'assignments'>,
): ActorDirectory {
  return {
    employees: dir.employees,
    assignments: dir.assignments,
    users: dir.accounts,
    userRoles: dir.userRoles,
    roles: dir.roles,
    units: dir.orgUnits,
  };
}

/** A form's workflow steps, in order. */
export function stepsOfForm(form: Pick<FormInstance, 'workflowId'>, steps: readonly WorkflowStep[]): WorkflowStep[] {
  return steps.filter((s) => s.workflowId === form.workflowId).sort((a, b) => a.stepNo - b.stepNo);
}

/** The form's current step, or `null` once it is closed (or its step is unknown). */
export function currentStepOf(form: Pick<FormInstance, 'workflowId' | 'currentStepId'>, steps: readonly WorkflowStep[]): WorkflowStep | null {
  return steps.find((s) => s.id === form.currentStepId && s.workflowId === form.workflowId) ?? null;
}

// ─── The content check (BR-KPI-18) ─────────────────────────────────────────────────────────────

/** Rows the content check reads. Any superset works: the builder keeps only the form's own. */
export interface SubmitRows {
  goals: readonly Goal[];
  kgis: readonly Kgi[];
  items: readonly EvaluationItem[];
  changeItems: readonly GoalChangeItem[];
  /** Monthly work (PEND-14): the tasks and the months a WORK_PLAN form's check reads. Default none. */
  workTasks?: readonly WorkTask[];
  periods?: readonly Pick<CyclePeriod, 'id' | 'startDate' | 'endDate'>[];
}

/**
 * `canSubmit`'s input for this form at this step — THE builder, used by the mock's `forms.act` and
 * by the screens' blockers, so both check exactly the same rows:
 * - GOAL_SETTING / GOAL_CHANGE — every goal of the plan (no status filter: the rules filter), every KGI;
 * - KPI_EVAL — the goals of the form's items (a goal superseded mid-period still counts on its form);
 * - WORK_PLAN — every task of the form's `WorkPlan` (cancelled ones too: the rule drops them) and its month.
 */
export function submitCheckInput(
  form: Pick<FormInstance, 'id' | 'formType' | 'goalPlanId' | 'workPlanId' | 'periodId'>,
  step: WorkflowStep,
  steps: readonly WorkflowStep[],
  rows: SubmitRows,
): CanSubmitInput {
  const planGoals = form.goalPlanId ? rows.goals.filter((g) => g.goalPlanId === form.goalPlanId) : [];
  const kgis = form.goalPlanId ? rows.kgis.filter((k) => k.goalPlanId === form.goalPlanId) : [];
  switch (form.formType) {
    case 'KPI_EVAL': {
      const items = rows.items.filter((i) => i.formId === form.id);
      const goalIds = new Set(items.map((i) => i.goalId));
      return { formType: 'KPI_EVAL', step, items, goals: rows.goals.filter((g) => goalIds.has(g.id)) };
    }
    case 'GOAL_SETTING':
      return { formType: 'GOAL_SETTING', stepNo: step.stepNo, steps, goals: planGoals, kgis };
    case 'GOAL_CHANGE':
      return { formType: 'GOAL_CHANGE', goals: planGoals, changeItems: rows.changeItems.filter((i) => i.formId === form.id), kgis };
    case 'WORK_PLAN': {
      const period = (rows.periods ?? []).find((p) => p.id === form.periodId) ?? null;
      const tasks = (rows.workTasks ?? []).filter((t) => t.workPlanId === form.workPlanId);
      return { formType: 'WORK_PLAN', stepNo: step.stepNo, steps, tasks, period };
    }
    case 'WORK_REVIEW':
      return { formType: 'WORK_REVIEW' };
  }
}

// ─── Standing ──────────────────────────────────────────────────────────────────────────────────

export interface FormStandingInput {
  form: FormInstance;
  /** The tenant's steps (or the form's workflow's) — any order. */
  steps: readonly WorkflowStep[];
  /**
   * The form's Goal Plan. `undefined` = not loaded yet: a registration then offers nothing but
   * CANCEL, because whether it is frozen depends on the plan. `null` = the form has no plan.
   */
  plan: Pick<GoalPlan, 'status'> | null | undefined;
  directory: ActorDirectory;
  delegations: readonly Delegation[];
  userId: Id;
  /** `can('form.proxy', resourceOfSubject(form.subjectEmployeeId))` — the gateway's resource. */
  mayProxy: boolean;
  /** `can('form.cancel', resourceOfSubject(form.subjectEmployeeId))`. */
  mayCancel: boolean;
  clock: Clock;
}

/** Why the user has no step action now — the first that applies. */
export type ReadOnlyReason = 'CLOSED' | 'LOADING' | 'OWN_REVIEW' | 'NOT_YOUR_STEP' | 'FROZEN';

export type StandingMode = 'ACTOR' | 'DELEGATE' | 'PROXY';

export interface FormStanding {
  steps: WorkflowStep[];
  step: WorkflowStep | null;
  /** The step's actors now (`resolveStepActors`); empty = nobody assigned (HR may act as proxy). */
  stepActors: Id[];
  /** Actors plus their valid delegates — who must act now. */
  assignees: Id[];
  deadline: IsoDate | null;
  overdue: boolean;
  frozen: boolean;
  /**
   * The standing every write of this user is sent with (`act`'s `onBehalfOfUserId` / `delegationId`)
   * — the gateway's `editStanding` order: ACTOR, then a valid DELEGATE, then PROXY on behalf of the
   * first actor (or of nobody when the step has none). `null` when the user may not act on the step.
   */
  standing: ActorInput | null;
  mode: StandingMode | null;
  /** SUBMIT / APPROVE / RETURN the step allows AND the user is entitled to now; CANCEL with the right. */
  actions: PersonFormAction[];
  /** "Lưu nháp" / editing the proposal — the step allows EDIT and the user is entitled. */
  canEdit: boolean;
  /** The evaluation column "Lưu nháp" writes, when `canEdit`. */
  editColumn: EvaluationColumn | null;
  /** Where RETURN would send the form. */
  returnTarget: WorkflowStep | null;
  readOnlyReason: ReadOnlyReason | null;
}

const STEP_ACTIONS_SHOWN = ['SUBMIT', 'APPROVE', 'RETURN'] as const;

/**
 * What `userId` may do on the form now, in the gateway's order (`checkAction`, `assertMayEdit`):
 * closed → (registration whose plan is not loaded) → the subject on a review step of their own form
 * → not entitled → frozen. CANCEL depends on the cancel right alone (`entitlement`), is never frozen,
 * and is always sent as the user themself.
 */
export function formStanding(input: FormStandingInput): FormStanding {
  const { form, plan, directory, delegations, userId, mayProxy, mayCancel, clock } = input;
  const steps = stepsOfForm(form, input.steps);
  const step = currentStepOf(form, steps);
  const base: FormStanding = {
    steps,
    step,
    stepActors: [],
    assignees: [],
    deadline: null,
    overdue: false,
    frozen: false,
    standing: null,
    mode: null,
    actions: [],
    canEdit: false,
    editColumn: null,
    returnTarget: null,
    readOnlyReason: 'CLOSED',
  };
  if (isTerminal(form) || step === null) return base;

  const stepActors = resolveStepActors(step, form.subjectEmployeeId, directory, clock);
  const subjectUserId = userOfEmployee(form.subjectEmployeeId, directory.users)?.id ?? null;
  const ctx: EntitlementContext = { stepActors, delegations, actorMayProxy: mayProxy, actorMayCancel: mayCancel, subjectUserId, clock };
  const cancel: PersonFormAction[] = mayCancel ? ['CANCEL'] : [];
  const returnNo = step.returnToStepNo ?? step.stepNo - 1;
  const timed: FormStanding = {
    ...base,
    stepActors,
    assignees: assigneesOf(form, stepActors, delegations, clock),
    deadline: stepDeadline(form, step, clock.tz),
    overdue: isOverdue(form, step, clock),
    returnTarget: step.allowedActions.includes('RETURN') ? (steps.find((s) => s.stepNo === returnNo) ?? null) : null,
    actions: cancel,
  };

  if (form.formType === 'GOAL_SETTING' && plan === undefined) return { ...timed, readOnlyReason: 'LOADING' };
  const frozen = isFrozen(form, step, plan ?? null);
  if (step.actorRule !== 'SELF' && subjectUserId !== null && userId === subjectUserId) {
    return { ...timed, frozen, readOnlyReason: 'OWN_REVIEW' };
  }

  const standing = editStanding(form, userId, ctx);
  // The person half of `entitlement` is the same for every non-CANCEL action.
  const who = entitlement(form, step, 'SUBMIT', standing, ctx);
  if (!who.ok) return { ...timed, frozen, readOnlyReason: frozen ? 'FROZEN' : 'NOT_YOUR_STEP' };
  const entitled = { ...timed, frozen, standing, mode: who.mode as StandingMode };
  if (frozen) return { ...entitled, readOnlyReason: 'FROZEN' };

  const n = Math.max(...steps.map((s) => s.stepNo));
  // The monthly work review does not move yet (`checkAction` refuses WORK_FORM_NOT_BUILT until 8.3): offer no move.
  const moves = form.formType === 'WORK_REVIEW'
    ? []
    : STEP_ACTIONS_SHOWN.filter(
        // A non-blank comment stands in for the one the dialog will ask for: only the step decides here.
        (action) => TRANSITIONS[action].refusal(step, form, n, '—') === null,
      );
  const canEdit = editRefusal(form, steps, plan ?? null, standing, ctx) === null;
  return {
    ...entitled,
    actions: [...moves, ...cancel],
    canEdit,
    editColumn: canEdit ? step.evaluationColumn : null,
    readOnlyReason: null,
  };
}

// ─── Lists ─────────────────────────────────────────────────────────────────────────────────────

export interface StepTiming {
  step: WorkflowStep | null;
  deadline: IsoDate | null;
  overdue: boolean;
}

/** The per-row facts a list shows — no actor resolution, so it stays cheap on a page of 50 forms. */
export function stepTiming(form: FormInstance, steps: readonly WorkflowStep[], clock: Clock): StepTiming {
  const step = isTerminal(form) ? null : currentStepOf(form, steps);
  if (!step) return { step: null, deadline: null, overdue: false };
  return { step, deadline: stepDeadline(form, step, clock.tz), overdue: isOverdue(form, step, clock) };
}

// ─── Delegations (BR-KPI-21) ───────────────────────────────────────────────────────────────────

/**
 * Where a delegation stands now — the same boundaries `isDelegationValid` uses: revoked from
 * `revokedAt` (an instant), valid between its dates in the tenant's zone, both inclusive.
 */
export function delegationState(d: Pick<Delegation, 'validFrom' | 'validTo' | 'revokedAt'>, clock: Clock): DelegationState {
  if (d.revokedAt !== null && Date.parse(d.revokedAt) <= Date.parse(clock.now)) return 'Revoked';
  const today = todayOf(clock);
  if (today < d.validFrom) return 'Upcoming';
  if (today > d.validTo) return 'Expired';
  return 'Active';
}

/** Revoking makes sense while it still grants (or will grant) something. */
export const isDelegationRevocable = (state: DelegationState) => state === 'Upcoming' || state === 'Active';

// ─── Adjustment proposals (BR-KPI-15) ──────────────────────────────────────────────────────────

/** A MODIFY proposal starts as a copy of the goal as it stands, with its levels. */
export function goalDraftFromGoal(goal: Goal, levels: readonly GoalTargetLevel[]): GoalDraft {
  return {
    kgiId: goal.kgiId,
    kpiDefId: goal.kpiDefId,
    name: goal.name,
    description: goal.description,
    formulaText: goal.formulaText,
    perspectiveId: goal.perspectiveId,
    kriType: goal.kriType,
    visibility: goal.visibility,
    unitId: goal.unitId,
    calcMethodId: goal.calcMethodId,
    dataSourceId: goal.dataSourceId,
    weight: goal.weight,
    targetType: goal.targetType,
    targetValue: goal.targetValue,
    targetText: goal.targetText,
    selfAssignedValue: goal.selfAssignedValue,
    rollUpFromChildren: goal.rollUpFromChildren,
    startDate: goal.startDate,
    dueDate: goal.dueDate,
    ownerEmployeeId: goal.ownerEmployeeId,
    targetLevels: levels
      .filter((l) => l.goalId === goal.id)
      .map(({ levelCode, targetValue, targetText, scorePct }) => ({ levelCode, targetValue, targetText, scorePct })),
  };
}

export interface NewGoalFields {
  weight: number;
  targetValue: number | null;
  dataSourceId: Id;
  /** The plan's period — a new goal runs over the same dates as the plan's goals. */
  startDate: IsoDate;
  dueDate: IsoDate;
  ownerEmployeeId: Id | null;
}

/** An ADD proposal from a library KPI: name, perspective, unit, method and formula inherited (BR-KPI-05/06). */
export function goalDraftFromKpi(kpi: KpiDefinition, fields: NewGoalFields): GoalDraft {
  return {
    kgiId: null,
    kpiDefId: kpi.id,
    name: kpi.name,
    description: kpi.definition,
    formulaText: kpi.formulaText,
    perspectiveId: kpi.perspectiveId,
    kriType: null, // D4: hidden until Q6
    visibility: 'PUBLIC',
    unitId: kpi.unitId,
    calcMethodId: kpi.calcMethodId,
    dataSourceId: fields.dataSourceId,
    weight: fields.weight,
    targetType: 'NUMERIC',
    targetValue: fields.targetValue,
    targetText: null,
    selfAssignedValue: null,
    rollUpFromChildren: false,
    startDate: fields.startDate,
    dueDate: fields.dueDate,
    ownerEmployeeId: fields.ownerEmployeeId,
    targetLevels: [],
  };
}

// ─── Workflow configuration (WBS 4.5.1) ────────────────────────────────────────────────────────

/**
 * What an edit to a step means for forms already in it — steps are not versioned, so every running
 * form reads the edited step at once (`stepDeadline`, `isFrozen`, `canSubmit`):
 * - `APPLIES_NOW` — the SLA or overdue behaviour changed: deadlines and the next tick follow it;
 * - `LOCK_RELEASED` — no longer LOCK: forms frozen by an earlier overdue are released;
 * - `LOCK_ADDED` — now LOCK: an overdue registration freezes its plan at the next tick;
 * - `COMMENT_REQUIRED` — a comment becomes mandatory on every item before the next submit;
 * - `AUTO_APPROVE_ADDED` — forms that ENTER the step from now on approve themselves; forms already
 *   waiting there stay with HR (the auto-approval happens on entry only, PEND-02).
 */
export type WorkflowEditWarning = 'APPLIES_NOW' | 'LOCK_RELEASED' | 'LOCK_ADDED' | 'COMMENT_REQUIRED' | 'AUTO_APPROVE_ADDED';

export function workflowEditWarnings(
  before: Pick<WorkflowStep, 'slaDays' | 'onOverdue' | 'requiresComment' | 'evaluationColumn'> & Partial<Pick<WorkflowStep, 'autoApprove'>>,
  after: Pick<WorkflowStep, 'slaDays' | 'onOverdue' | 'requiresComment'> & Partial<Pick<WorkflowStep, 'autoApprove'>>,
  formType: FormType,
): WorkflowEditWarning[] {
  const warnings: WorkflowEditWarning[] = [];
  if (before.slaDays !== after.slaDays || before.onOverdue !== after.onOverdue) warnings.push('APPLIES_NOW');
  if (before.onOverdue === 'LOCK' && after.onOverdue !== 'LOCK') warnings.push('LOCK_RELEASED');
  if (before.onOverdue !== 'LOCK' && after.onOverdue === 'LOCK' && formType === 'GOAL_SETTING') warnings.push('LOCK_ADDED');
  if (!before.requiresComment && after.requiresComment && formType === 'KPI_EVAL' && before.evaluationColumn !== null) {
    warnings.push('COMMENT_REQUIRED');
  }
  if (!before.autoApprove && after.autoApprove) warnings.push('AUTO_APPROVE_ADDED');
  return warnings;
}
