import type { CollectionName, RowOf } from '@/data/fixtures/types';
import {
  GOAL_PLAN_INITIAL_STATUS,
  isWorkFormType,
  WORK_PLAN_INITIAL_STATUS,
  type EvaluationItem,
  type FormInstance,
  type FormLaunch,
  type FormType,
  type GoalPlan,
  type Id,
  type WorkflowStep,
  type WorkPlan,
} from '@/data/types';
import { entryBlockers, isResultFinalised } from '@/lib/actualRules';
import { KpiError, toKpiError, type RuleIssue } from '@/lib/errorCatalog';
import { computedItemPct, itemsOnEnterColumn, sameActual, type ItemCalcContext } from '@/lib/formRules';
import { periodActual, periodTarget, type ActualContext } from '@/lib/resultRules';
import { planStatusOnEnterStep, type Decision } from '@/lib/goalPlanRules';
import { DEFAULT_WORK_SCORING, reviewClearCopiedCells, reviewColumnPrefill, workPlanStatusOnEnterStep, workResultOf, workReviewEffects } from '@/lib/workRules';
import { planEditability, type OpenRegistration } from '@/lib/planAccessRules';
import { todayOf } from '@/lib/isoDate';
import { resourceOfSubject } from '@/lib/permissionRules';
import {
  assigneesOf,
  editRefusal,
  editStanding,
  entitlementContextOf,
  initialStep,
  isTerminal,
  launchDueDate,
  resolveRecipients,
  resolveStepActors,
  type ActorDirectory,
  type EntitlementContext,
  type Recipients,
  type Refusal,
} from '@/lib/workflowRules';
import { writeActualSnapshot } from './actualWrites';
import { actorCan, authorizeActor, clockOf } from './authorize';
import { newId } from './rows';
import type { Tx } from './store';

/**
 * What the workflow methods (forms, launches, the scheduler, plan lock and plan-edit guards) all need
 * from a transaction: the rules' inputs built from its rows, and the ONE way a rule's refusal becomes
 * a thrown `KpiError`. Nothing here decides anything — every decision is a `src/lib/*Rules.ts` call.
 */

// ─── Refusals ──────────────────────────────────────────────────────────────────────────────────

/** A workflow rule's refusal, thrown as is: its code, its detail, its issues. */
export function throwRefusal(r: Refusal): never {
  throw new KpiError(r.code, r.detail, r.issues);
}

/** A rule's issue list: the first issue's code, every issue kept (`toKpiError`). Nothing when empty. */
export function throwIssues(issues: readonly RuleIssue[]): void {
  if (issues.length > 0) throw toKpiError(issues);
}

/** A rule's `Decision`; `detail` says what was refused. */
export function throwDecision(decision: Decision, detail: string): void {
  if (!decision.ok) throw new KpiError(decision.code, detail);
}

/**
 * A row a write PAYLOAD names — ERR-KPI-06 worded exactly like the integrity check's missing
 * reference, so another tenant's id is indistinguishable from an unknown one (contract rule 1).
 */
export function refOrInvalid<C extends CollectionName>(tx: Tx, c: C, id: Id | null | undefined, label: string): RowOf<C> {
  const row = typeof id === 'string' ? tx.find(c, id) : undefined;
  if (!row) throw new KpiError('ERR-KPI-06', `${label}: ${c} ${String(id)} not found`);
  return row;
}

// ─── Rule inputs ───────────────────────────────────────────────────────────────────────────────

const directories = new WeakMap<Tx, ActorDirectory>();

/** The tenant's people as the actor rules need them (org rows never change inside a workflow write). */
export function directoryOf(tx: Tx): ActorDirectory {
  const cached = directories.get(tx);
  if (cached) return cached;
  const dir: ActorDirectory = {
    employees: tx.all('Employee'),
    assignments: tx.all('EmployeeAssignment'),
    users: tx.all('UserAccount'),
    userRoles: tx.all('UserRole'),
    roles: tx.all('Role'),
    units: tx.all('OrgUnit'),
  };
  directories.set(tx, dir);
  return dir;
}

/** A workflow's steps, in order. */
export function stepsOf(tx: Tx, workflowId: Id): WorkflowStep[] {
  return tx
    .all('WorkflowStep')
    .filter((s) => s.workflowId === workflowId)
    .sort((a, b) => a.stepNo - b.stepNo);
}

/** The form's current step (`undefined` once it is closed). */
export const stepOf = (form: FormInstance, steps: readonly WorkflowStep[]) =>
  steps.find((s) => s.id === form.currentStepId && s.workflowId === form.workflowId);

/** The form's Goal Plan, if it has one. */
export const planOfForm = (tx: Tx, form: FormInstance): GoalPlan | null => (form.goalPlanId ? (tx.find('GoalPlan', form.goalPlanId) ?? null) : null);

/** Who a form on `plan` is about: the plan's employee, or the head of its unit (Company / OrgUnit). */
export function planOwnerEmployeeId(tx: Tx, plan: GoalPlan): Id | null {
  if (plan.ownerEmployeeId !== null) return plan.ownerEmployeeId;
  return plan.ownerOrgUnitId ? (tx.find('OrgUnit', plan.ownerOrgUnitId)?.headEmployeeId ?? null) : null;
}

/** The plan's open form of `formType` (at most one — `canStartForm`, `resolveRecipients`). */
export const openFormOn = (tx: Tx, goalPlanId: Id, formType: FormType): FormInstance | undefined =>
  tx.all('FormInstance').find((f) => f.goalPlanId === goalPlanId && f.formType === formType && !isTerminal(f));

/**
 * Everything `entitlement` needs about the transaction's actor and the form's current step: its
 * actors now, the delegations, and the actor's proxy / cancel rights over the subject (Phase 1.3).
 */
export function entitlementCtx(tx: Tx, form: FormInstance, step: WorkflowStep | undefined): EntitlementContext {
  const subject = resourceOfSubject(tx.tenantId, form.subjectEmployeeId);
  return entitlementContextOf(form, step, {
    dir: directoryOf(tx),
    delegations: tx.all('Delegation'),
    clock: clockOf(tx),
    actorMayProxy: actorCan(tx, 'form.proxy', subject),
    actorMayCancel: actorCan(tx, 'form.cancel', subject),
  });
}

/** Who must act on the form's current step now (step actors and their valid delegates). */
export function assigneesFor(tx: Tx, form: FormInstance): Id[] {
  if (isTerminal(form)) return [];
  const step = stepOf(form, stepsOf(tx, form.workflowId));
  if (!step) return [];
  const clock = clockOf(tx);
  return assigneesOf(form, resolveStepActors(step, form.subjectEmployeeId, directoryOf(tx), clock), tx.all('Delegation'), clock);
}

/**
 * EDIT on a form by the transaction's actor (`saveEvaluationItems`, `saveGoalChangeItems`): refused
 * per `editRefusal` (04 state / 05 entitlement); allowed → the person acted for is recorded on the
 * write's events and audit rows. Returns the form's current step.
 */
export function assertMayEdit(tx: Tx, form: FormInstance): WorkflowStep {
  const steps = stepsOf(tx, form.workflowId);
  const step = stepOf(form, steps);
  const ctx = entitlementCtx(tx, form, step);
  const standing = editStanding(form, tx.ctx.actorUserId as Id, ctx);
  const refusal = editRefusal(form, steps, planOfForm(tx, form), standing, ctx);
  if (refusal) throwRefusal(refusal);
  tx.onBehalfOfUserId = standing.onBehalfOfUserId;
  return step as WorkflowStep;
}

/**
 * The goal-plan edit guard (`saveKgi`, `saveGoal`, levels, period targets, alignments) —
 * `goalPlanRules.canEditPlan` with its context filled from the rows: the cycle closed; the plan's
 * open registration form and whether this actor may EDIT at its current step (`editRefusal`); the
 * actor owns the plan (its employee, or the head of its unit); the actor maintains plans tenant-wide.
 * An unknown plan is left to the integrity check, which answers exactly as for any missing id.
 */
export function assertPlanEditable(tx: Tx, goalPlanId: Id | null | undefined): void {
  const plan = typeof goalPlanId === 'string' ? tx.find('GoalPlan', goalPlanId) : undefined;
  if (!plan) return;
  const actor = authorizeActor(tx, tx.ctx.actorUserId as Id);
  const open = openFormOn(tx, plan.id, 'GOAL_SETTING');
  let openRegistration: OpenRegistration | null = null;
  if (open) {
    const steps = stepsOf(tx, open.workflowId);
    openRegistration = { form: open, steps, ctx: entitlementCtx(tx, open, stepOf(open, steps)) };
  }
  const editable = planEditability({
    plan,
    cycleStatus: tx.find('PerformanceCycle', plan.cycleId)?.status ?? 'Active',
    openRegistration,
    actor: { userId: actor.id, employeeId: actor.employeeId },
    planOwnerEmployeeId: planOwnerEmployeeId(tx, plan),
    actorIsPlanAdmin: actorCan(tx, 'goalplan.edit', { kind: 'Tenant', tenantId: tx.tenantId }),
  });
  // The edit names the person acted for when made as a delegate or proxy (BR-KPI-21, 23).
  if (editable.decision.ok && editable.standing) tx.onBehalfOfUserId = editable.standing.onBehalfOfUserId;
  throwDecision(editable.decision, `goal plan ${plan.id} cannot be edited by this user now`);
}

// ─── Plan status ───────────────────────────────────────────────────────────────────────────────

/**
 * Moves a Goal Plan to `to` with its lock stamp — the one place a plan's status is written: Locked →
 * `lockedAt` now, audited LOCK; out of Locked → `lockedAt` cleared, audited UNLOCK; with `reason`
 * on the audit row. Emits `goalPlan.statusChanged`. No-op when the status is already `to`.
 */
export function setPlanStatus(tx: Tx, plan: GoalPlan, to: GoalPlan['status'], reason: string | null = null): GoalPlan {
  if (plan.status === to) return plan;
  const locking = to === 'Locked';
  const unlocking = plan.status === 'Locked';
  const action = locking ? 'LOCK' : unlocking ? 'UNLOCK' : undefined;
  const saved = tx.update('GoalPlan', { ...plan, status: to, lockedAt: locking ? tx.now : null }, { action, reason });
  tx.emit({ type: 'goalPlan.statusChanged', goalPlanId: plan.id, from: plan.status, to });
  return saved;
}

/**
 * Moves a monthly `WorkPlan` to `to` — the one place its status is written: → Locked stamps
 * `approvedAt` now and `approvedBy` = `approver` (the person who pressed Duyệt — a delegate or proxy
 * included, the history row names whom they acted for; `null` for a system move), audited LOCK; out of
 * Locked clears both (UNLOCK — no path reaches it in P1). No-op when the status is already `to`.
 */
export function setWorkPlanStatus(tx: Tx, plan: WorkPlan, to: WorkPlan['status'], approver: Id | null, reason: string | null = null): WorkPlan {
  if (plan.status === to) return plan;
  const locking = to === 'Locked';
  const unlocking = plan.status === 'Locked';
  const action = locking ? 'LOCK' : unlocking ? 'UNLOCK' : undefined;
  return tx.update(
    'WorkPlan',
    { ...plan, status: to, approvedAt: locking ? tx.now : null, approvedBy: locking ? approver : null },
    { action, reason },
  );
}

/**
 * After a WORK_PLAN form moved (`forms.act`, the scheduler's AUTO_FORWARD): its plan follows
 * (`TransitionResult.workPlanStatus`). A missing plan fails as an integrity error, never silently.
 */
export function syncWorkPlan(tx: Tx, form: FormInstance, workPlanStatus: WorkPlan['status'] | null, approver: Id | null, reason: string | null): void {
  if (workPlanStatus === null || form.workPlanId === null) return;
  const plan = tx.get('WorkPlan', form.workPlanId);
  // A Locked plan has no unlock in P1: no form move takes it out of Locked (a relaunch never reaches one).
  if (plan.status === 'Locked' && workPlanStatus !== 'Locked') return;
  setWorkPlanStatus(tx, plan, workPlanStatus, approver, reason);
}

/** The review's step columns in words, for the audit rows of a prefill. */
const PREFILL_REASON = { MANAGER: 'Điền sẵn cột Quản lý từ cột Tự đánh giá', FINAL: 'Điền cột HR ghi nhận bằng cột Quản lý' } as const;

/**
 * After a WORK_REVIEW form moved (`forms.act`; the scheduler's AUTO_FORWARD): `workRules.workReviewEffects`
 * of the step entered — a RETURN to the employee clears the manager's untouched copies, entering MANAGER fills
 * its empty cells from SELF, entering FINAL copies MANAGER; a completion records the month's ONE
 * `WorkResult` from FINAL (`workResultOf`, tasks and scoring read here, never from the caller). Each row
 * changed is written with the reason, so the audit tells a prefill from a person's edit. A cancel does nothing.
 * The FINAL check (`canSubmit`) makes the result complete; one that is not is refused, never stored null.
 * `passed` — the steps an automatic approval (PEND-02, `settleAutoSteps`) entered and left in the same
 * write: their entry effects run first, in order, so an HR step that records by itself still copies the
 * manager's column before the ONE result is recorded. No content check runs on that FINAL: it is a full
 * copy of MANAGER (comments cleared), which passed `reviewSubmitIssues` on the manager's send, so
 * `workFinalOverrideIssues` would find nothing; the `finalScore === null` refusal is the backstop.
 */
export function syncWorkReview(tx: Tx, form: FormInstance, action: string, entered: WorkflowStep | null, completed: boolean, passed: readonly WorkflowStep[] = []): void {
  if (form.formType !== 'WORK_REVIEW' || action === 'CANCEL') return;
  const moves = [
    // A RETURN never passes a step (autoApprove sits only on the last step), so passed steps are never "via return".
    ...passed.map((step) => workReviewEffects(step.evaluationColumn, false, false)),
    workReviewEffects(entered?.evaluationColumn ?? null, action === 'RETURN', completed),
  ].filter((e) => e.prefill || e.clearCopies || e.recordResult);
  if (moves.length === 0) return;
  const review = tx.all('WorkReview').find((r) => r.formId === form.id);
  if (!review) throw new KpiError('ERR-KPI-02', `WorkReview of form ${form.id} not found`);
  const items = tx.all('WorkReviewItem').filter((i) => i.formId === form.id);
  let rows = { review, items };
  const write = (next: typeof rows, reason: string) => {
    if (JSON.stringify(next.review) !== JSON.stringify(rows.review)) tx.update('WorkReview', next.review, { reason });
    next.items.forEach((item, i) => {
      if (JSON.stringify(item) !== JSON.stringify(rows.items[i])) tx.update('WorkReviewItem', item, { reason });
    });
    rows = next;
  };
  for (const effects of moves) {
    if (effects.clearCopies) write(reviewClearCopiedCells(rows), 'Bỏ các ô Quản lý chép từ cột Tự đánh giá khi phiếu trả về nhân viên');
    if (effects.prefill) write(reviewColumnPrefill(rows, effects.prefill), PREFILL_REASON[effects.prefill]);
  }
  if (moves.some((e) => e.recordResult)) {
    const plan = tx.get('WorkPlan', review.workPlanId);
    const tasks = tx.all('WorkTask').filter((t) => t.workPlanId === plan.id);
    const scores = workResultOf(rows.review, rows.items, tasks, tx.all('WorkScoringConfig')[0] ?? DEFAULT_WORK_SCORING);
    if (scores.finalScore === null) throw new KpiError('ERR-KPI-06', 'RESULT_INCOMPLETE');
    tx.insert('WorkResult', { id: newId(), tenantId: tx.tenantId, employeeId: plan.employeeId, periodId: plan.periodId, workPlanId: plan.id, formId: form.id, ...scores, recordedAt: tx.now });
  }
}

// ─── Launches ──────────────────────────────────────────────────────────────────────────────────

/**
 * Fires a launch (NOW, a due SCHEDULED one, or a rule firing): recipients resolved NOW by
 * `resolveRecipients`; a Draft Employee plan for a registration subject who has none; one form per
 * subject at step 1 (due = launch date + `dueDays`); a registration moves its plan to step 1's status
 * (a Locked plan stays Locked — its form is then frozen until HR unlocks it); an evaluation gets one
 * item per Active goal with the CURRENT actual as its read-only snapshot (BR-KPI-17). Monthly work
 * (PEND-14): a WORK_PLAN or WORK_REVIEW form names the subject's `WorkPlan` for the month, created
 * Draft when there is none; a review also gets its `WorkReview` and one item per live task. The launch
 * becomes Launched; `form.launched` is emitted. The skipped recipients are returned (the event type
 * has no field for them).
 */
export function fireLaunch(tx: Tx, launch: FormLaunch): { launch: FormLaunch; formIds: Id[]; skipped: Recipients['skipped'] } {
  const clock = clockOf(tx);
  const steps = stepsOf(tx, launch.workflowId);
  // PEND-01 — the launch's start step; one no longer valid (the workflow was edited since) is step 1.
  const first = initialStep(steps, launch.startStepNo);
  if (!first) throw new KpiError('ERR-KPI-06', `workflow ${launch.workflowId} has no steps`);
  const period = launch.periodId ? tx.get('CyclePeriod', launch.periodId) : null;
  const cycleId = launch.cycleId ?? period?.cycleId ?? null;
  const recipients = resolveRecipients(launch, {
    employees: tx.all('Employee'),
    assignments: tx.all('EmployeeAssignment'),
    units: tx.all('OrgUnit'),
    positions: tx.all('JobPosition'),
    existingForms: tx.all('FormInstance'),
    plans: tx.all('GoalPlan'),
    period,
    launchDate: todayOf(clock),
    workPlans: launch.formType === 'WORK_REVIEW' && period ? workPlansOf(tx, period.id) : undefined,
  });

  for (const employeeId of recipients.needsDraftPlan) {
    if (cycleId === null) break;
    const plan: GoalPlan = {
      id: newId(),
      tenantId: tx.tenantId,
      cycleId,
      planType: 'KPI',
      ownerType: 'Employee',
      ownerOrgUnitId: null,
      ownerEmployeeId: employeeId,
      status: GOAL_PLAN_INITIAL_STATUS,
      lockedAt: null,
    };
    tx.insert('GoalPlan', plan);
  }

  const plans = tx.all('GoalPlan').filter((p) => p.cycleId === cycleId && p.ownerType === 'Employee');
  const evalCtx = launch.formType === 'KPI_EVAL' && period ? actualContextOf(tx, period) : null;
  const dueDate = launchDueDate(clock.now, launch.dueDays, clock.tz);
  const formIds: Id[] = [];
  const work = isWorkFormType(launch.formType);
  for (const subjectEmployeeId of recipients.subjects) {
    const plan = work ? null : (plans.find((p) => p.ownerEmployeeId === subjectEmployeeId) ?? null);
    const workPlan = work && period ? workPlanFor(tx, subjectEmployeeId, period.id) : null;
    const form: FormInstance = {
      id: newId(),
      tenantId: tx.tenantId,
      workflowId: launch.workflowId,
      formType: launch.formType,
      subjectEmployeeId,
      goalPlanId: plan?.id ?? null,
      workPlanId: workPlan?.id ?? null,
      periodId: launch.formType === 'KPI_EVAL' || work ? launch.periodId : null,
      currentStepId: first.id,
      currentStepEnteredAt: clock.now,
      overdueHandledAt: null,
      status: 'Open',
      dueDate,
      launchedAt: clock.now,
      launchId: launch.id,
    };
    tx.insert('FormInstance', form);
    formIds.push(form.id);

    if (launch.formType === 'WORK_REVIEW' && workPlan) addWorkReview(tx, form, workPlan);
    // The plan takes the status of the step the form starts at (Draft at the employee's or a manager's
    // step before it). A Locked plan stays Locked; a review never moves its plan.
    if (launch.formType === 'WORK_PLAN' && workPlan && workPlan.status !== 'Locked') {
      setWorkPlanStatus(tx, tx.get('WorkPlan', workPlan.id), workPlanStatusOnEnterStep(first.stepNo, steps, false), null);
    }
    if (launch.formType === 'GOAL_SETTING' && plan && plan.status !== 'Locked') {
      setPlanStatus(tx, tx.get('GoalPlan', plan.id), planStatusOnEnterStep(first.stepNo, steps, false));
    }
    if (launch.formType === 'KPI_EVAL' && plan) {
      const goals = tx
        .all('Goal')
        .filter((g) => g.goalPlanId === plan.id && g.status === 'Active')
        .sort((a, b) => a.sortOrder - b.sortOrder);
      for (const goal of goals) {
        // The period's actual and target as a result reads them (a quarter adds up its months).
        const actual = evalCtx && period ? periodActual(goal, period, evalCtx) : null;
        const item: EvaluationItem = {
          id: newId(),
          tenantId: tx.tenantId,
          formId: form.id,
          goalId: goal.id,
          actualSnapshot: actual?.actualValue ?? null,
          actualTextSnapshot: actual?.actualText ?? null,
          actualValue: actual?.actualValue ?? null,
          actualText: actual?.actualText ?? null,
          actualEnteredBy: null,
          submittedActualValue: null,
          submittedActualText: null,
          targetSnapshot: evalCtx && period ? periodTarget(goal, period, evalCtx) : null,
          selfAchievementPct: null,
          selfComment: null,
          managerAchievementPct: null,
          managerComment: null,
          finalAchievementPct: null,
          finalComment: null,
        };
        // PEND-07 — the system's % from the first moment the form exists.
        tx.insert('EvaluationItem', { ...item, selfAchievementPct: computedItemPct(item, itemCalcContextOf(tx, goal.id)) });
      }
    }
  }

  const fired = tx.update('FormLaunch', { ...tx.get('FormLaunch', launch.id), status: 'Launched', launchedAt: clock.now });
  tx.emit({ type: 'form.launched', launchId: launch.id, formIds });
  return { launch: fired, formIds, skipped: recipients.skipped };
}

// ─── Evaluation items (PEND-06/07/08) ──────────────────────────────────────────────────────────

/** What `resultRules.periodActual` / `periodTarget` read, from the transaction. */
export function actualContextOf(tx: Tx, period: ActualContext['period']): ActualContext {
  return {
    period,
    periods: tx.all('CyclePeriod'),
    actuals: tx.all('GoalActual'),
    periodTargets: tx.all('GoalPeriodTarget'),
    methods: tx.all('CalcMethod'),
    tiers: tx.all('CalcTier'),
    levels: tx.all('GoalTargetLevel'),
    kpiDefinitions: tx.all('KpiDefinition'),
    allGoals: tx.all('Goal'),
    alignments: tx.all('GoalAlignment'),
  };
}

/** What the system's % of a goal's item reads: the goal, its method, the tiers and levels. */
export function itemCalcContextOf(tx: Tx, goalId: Id): ItemCalcContext {
  const goal = tx.get('Goal', goalId);
  return {
    goal,
    method: tx.find('CalcMethod', goal.calcMethodId) ?? null,
    tiers: tx.all('CalcTier').filter((t) => t.calcMethodId === goal.calcMethodId),
    levels: tx.all('GoalTargetLevel').filter((l) => l.goalId === goalId),
  };
}

/**
 * Entering a step of an evaluation form (`forms.act` on SUBMIT / APPROVE / RETURN, the scheduler's
 * AUTO_FORWARD): `formRules.itemsOnEnterColumn` for the entered step's column — the system's %
 * recomputed, the manager's default, FINAL = MANAGER — written with `reason` so the audit tells these
 * defaults from a person's edit. Nothing for a step without a column (registration, adjustment).
 */
export function applyColumnEntry(tx: Tx, form: FormInstance, entered: WorkflowStep, left: WorkflowStep | undefined, reason: string): void {
  if (form.formType !== 'KPI_EVAL' || entered.evaluationColumn === null) return;
  const items = tx.all('EvaluationItem').filter((i) => i.formId === form.id);
  const computed = new Map(items.map((i) => [i.id, computedItemPct(i, itemCalcContextOf(tx, i.goalId))]));
  for (const next of itemsOnEnterColumn(items, entered.evaluationColumn, left?.evaluationColumn ?? null, computed)) {
    tx.update('EvaluationItem', next, { reason });
  }
}

/**
 * A completed evaluation records the actuals entered on it (PEND-06, BR-KPI-52): for each item whose
 * actual was CHANGED on the form (≠ its snapshot — an untouched form never reverts a later correction)
 * and is not empty, one `GoalActual` of source FORM becomes the current one (`writeActualSnapshot`).
 * Only a Month form writes: actuals are monthly, a quarter adds up its months (`ASSUMPTION Q36`), so a
 * quarter form's figure stays on the form. A write `actualRules.entryBlockers` refuses (the result is
 * already Final, the period locked) is skipped — the form still completes; the skipped goals are
 * returned for the audit row.
 */
export function recordFormActuals(tx: Tx, form: FormInstance): { written: Id[]; skipped: Id[] } {
  const done = { written: [] as Id[], skipped: [] as Id[] };
  if (form.formType !== 'KPI_EVAL' || form.periodId === null || form.goalPlanId === null) return done;
  const period = tx.get('CyclePeriod', form.periodId);
  if (period.periodType !== 'Month') return done;
  const plan = tx.get('GoalPlan', form.goalPlanId);
  const subjectUser = tx.all('UserAccount').find((u) => u.employeeId === form.subjectEmployeeId)?.id ?? null;
  const asOf = todayOf(clockOf(tx));
  const finalised = isResultFinalised(tx.all('PeriodResult'), plan.id, period.id);
  for (const item of tx.all('EvaluationItem').filter((i) => i.formId === form.id)) {
    const empty = item.actualValue === null && (item.actualText === null || item.actualText.trim() === '');
    if (empty || sameActual(item, { actualValue: item.actualSnapshot, actualText: item.actualTextSnapshot })) continue;
    const goal = tx.get('Goal', item.goalId);
    // The goal was Active when the form opened; a later adjustment does not stop its month's number.
    const blockers = entryBlockers({ goal: { ...goal, status: 'Active' }, planStatus: plan.status, goalCycleId: plan.cycleId, period, resultsFinalised: finalised, asOf });
    if (blockers.length > 0) {
      done.skipped.push(item.goalId);
      continue;
    }
    writeActualSnapshot(tx, {
      goalId: item.goalId,
      periodId: period.id,
      actualValue: item.actualValue,
      actualText: item.actualValue === null ? item.actualText : null,
      note: null,
      sourceType: 'FORM',
      batchId: null,
      syncRunId: null,
      enteredBy: item.actualEnteredBy ?? subjectUser,
    });
    done.written.push(item.goalId);
  }
  if (done.written.length > 0) {
    tx.emit({ type: 'actuals.recorded', periodId: period.id, goalIds: done.written, sourceType: 'FORM', batchId: null, syncRunId: null });
  }
  return done;
}

/** Each employee's month plan as `resolveRecipients` reads it for a review: status and live tasks. */
function workPlansOf(tx: Tx, periodId: Id): Map<Id, { status: WorkPlan['status']; liveTasks: number }> {
  const plans = tx.all('WorkPlan').filter((p) => p.periodId === periodId);
  const live = new Map<Id, number>();
  for (const t of tx.all('WorkTask')) if (t.cancelledAt === null) live.set(t.workPlanId, (live.get(t.workPlanId) ?? 0) + 1);
  return new Map(plans.map((p) => [p.employeeId, { status: p.status, liveTasks: live.get(p.id) ?? 0 }]));
}

/** The subject's work plan for the month, created Draft when there is none (one per employee and period). */
function workPlanFor(tx: Tx, employeeId: Id, periodId: Id): WorkPlan {
  const existing = tx.all('WorkPlan').find((p) => p.employeeId === employeeId && p.periodId === periodId);
  if (existing) return existing;
  return tx.insert('WorkPlan', {
    id: newId(),
    tenantId: tx.tenantId,
    employeeId,
    periodId,
    status: WORK_PLAN_INITIAL_STATUS,
    approvedAt: null,
    approvedBy: null,
  });
}

/** A review form's discipline row and one empty item per live task of the plan (cancelled tasks are not scored). */
function addWorkReview(tx: Tx, form: FormInstance, workPlan: WorkPlan): void {
  tx.insert('WorkReview', {
    id: newId(),
    tenantId: tx.tenantId,
    formId: form.id,
    workPlanId: workPlan.id,
    selfDisciplineScore: null,
    selfComment: null,
    managerDisciplineScore: null,
    managerComment: null,
    managerHsnv: null,
    managerHsnvReason: null,
    finalDisciplineScore: null,
    finalComment: null,
    finalHsnv: null,
    finalHsnvReason: null,
  });
  const tasks = tx
    .all('WorkTask')
    .filter((t) => t.workPlanId === workPlan.id && t.cancelledAt === null)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  for (const task of tasks) {
    tx.insert('WorkReviewItem', {
      id: newId(),
      tenantId: tx.tenantId,
      formId: form.id,
      taskId: task.id,
      selfScore: null,
      selfComment: null,
      managerScore: null,
      managerComment: null,
      finalScore: null,
      finalComment: null,
    });
  }
}
