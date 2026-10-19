/**
 * Who may change a Goal Plan right now, whether "Gửi" is open, and who may see a PRIVATE goal —
 * the decisions the gateway guard and the T3 screens SHARE, so a control the screen enables is a
 * write the gateway accepts (and vice versa).
 *
 * Layering: this file sits ABOVE `goalPlanRules` and `workflowRules` and composes them; neither of
 * them imports it back (`workflowRules` already imports `goalPlanRules`, so the composition cannot
 * live in either). It decides nothing new — every refusal is theirs; it only names the reason.
 */

import type {
  CalcMethod,
  CyclePeriod,
  CycleStatus,
  Delegation,
  EmployeeAssignment,
  FormInstance,
  Goal,
  GoalPeriodTarget,
  GoalPlan,
  GoalTargetLevel,
  Id,
  IsoDate,
  Kgi,
  KpiDefinition,
  OrgUnit,
  WorkflowStep,
} from '@/data/types';
import { ruleIssue, type ErrorCode, type RuleIssue } from './errorCatalog';
import { levelsMissingIssue } from './calcRules';
import { activeGoals, canEditPlan, ownerStepNo, periodTargetIssues, submitIssues, type Decision } from './goalPlanRules';
import { managerOf, primaryAssignmentOn, unitAncestry } from './orgRules';
import { can, resourceOfOwner, resourceOfSubject, type AccessProfile } from './permissionRules';
import {
  checkAction,
  editRefusal,
  editStanding,
  entitlementContextOf,
  isDelegationValid,
  isTerminal,
  type ActorDirectory,
  type ActorInput,
  type EntitlementContext,
} from './workflowRules';
import type { Clock } from './isoDate';

// ─── Editability ───────────────────────────────────────────────────────────────────────────────

/**
 * Why a plan is (not) editable for this person now — what the screen says under the plan header.
 * `UNKNOWN` = an input has not loaded or failed: the screen stays read-only, never editable.
 */
export type PlanEditReason =
  | 'EDITABLE'
  | 'UNKNOWN'
  | 'LOCKED'
  | 'CYCLE_CLOSED'
  | 'STEP_NO_EDIT'
  | 'NOT_STEP_ACTOR'
  | 'DELEGATION_EXPIRED'
  | 'SELF_APPROVAL'
  | 'NOT_OWNER'
  | 'ADMIN_ONLY'
  | 'NO_PERMISSION';

export interface OpenRegistration {
  form: FormInstance;
  /** The form's workflow steps, in order. */
  steps: readonly WorkflowStep[];
  /** `workflowRules.entitlementContextOf` for the form's current step. */
  ctx: EntitlementContext;
}

export interface PlanEditInput {
  plan: Pick<GoalPlan, 'status'>;
  cycleStatus: CycleStatus;
  /** The plan's open GOAL_SETTING form, if any (at most one). */
  openRegistration: OpenRegistration | null;
  actor: { userId: Id; employeeId: Id | null };
  /** The plan's employee, or the head of its unit (Company / OrgUnit plan). */
  planOwnerEmployeeId: Id | null;
  /** Maintains plans tenant-wide: `can(profile, 'goalplan.edit', Tenant)`. */
  actorIsPlanAdmin: boolean;
}

export interface PlanEditability {
  decision: Decision;
  reason: PlanEditReason;
  /** The standing the edit is made with (`onBehalfOfUserId` of a delegate / proxy); `null` without an open form. */
  standing: ActorInput | null;
  /** Locked while a registration form is open: the form is frozen until HR unlocks (BR-KPI-13, 14). */
  formFrozen: boolean;
}

/** What the screen assumes while an input is loading or failed: read-only, with the reason. */
export const UNKNOWN_EDITABILITY: PlanEditability = {
  decision: { ok: false, code: 'ERR-KPI-01' },
  reason: 'UNKNOWN',
  standing: null,
  formFrozen: false,
};

const refusalReason = (detail: string): PlanEditReason => {
  switch (detail) {
    case 'EDIT_NOT_ALLOWED':
      return 'STEP_NO_EDIT';
    case 'SELF_APPROVAL':
      return 'SELF_APPROVAL';
    case 'FROZEN':
      return 'LOCKED';
    default:
      return 'NOT_STEP_ACTOR';
  }
};

/**
 * May this person change the plan's goals, KGIs, levels, split and alignments now (BR-KPI-12, 14, 23)?
 * `goalPlanRules.canEditPlan`, with its "may act at the open form's current step" filled in by
 * `workflowRules.editStanding` + `editRefusal` — exactly what the gateway's `assertPlanEditable` asks.
 */
export function planEditability(input: PlanEditInput): PlanEditability {
  const { plan, openRegistration: open, actor } = input;
  let standing: ActorInput | null = null;
  let refusal: ReturnType<typeof editRefusal> = null;
  if (open) {
    standing = editStanding(open.form, actor.userId, open.ctx);
    refusal = editRefusal(open.form, open.steps, plan, standing, open.ctx);
  }
  const cycleClosed = input.cycleStatus === 'Closed';
  const decision = canEditPlan(plan, {
    cycleClosed,
    openRegistrationForm: open ? { actorMayEditNow: refusal === null } : null,
    actorIsOwner: actor.employeeId !== null && actor.employeeId === input.planOwnerEmployeeId,
    actorIsPlanAdmin: input.actorIsPlanAdmin,
  });
  const formFrozen = plan.status === 'Locked' && open !== null;
  if (decision.ok) return { decision, reason: 'EDITABLE', standing: open ? standing : null, formFrozen };

  let reason: PlanEditReason;
  if (plan.status === 'Locked') reason = 'LOCKED';
  else if (cycleClosed) reason = 'CYCLE_CLOSED';
  else if (open && refusal) {
    reason = refusalReason(refusal.detail);
    // The subject waiting on a reviewer's step is simply "someone else's step"; SELF_APPROVAL is named
    // only when they would otherwise BE its actor (e.g. their own manager on paper).
    if (reason === 'SELF_APPROVAL' && !open.ctx.stepActors.includes(actor.userId)) reason = 'NOT_STEP_ACTOR';
    if (reason === 'NOT_STEP_ACTOR' && hasExpiredDelegation(open, actor.userId)) reason = 'DELEGATION_EXPIRED';
  } else reason = plan.status === 'Draft' || plan.status === 'Returned' ? 'NOT_OWNER' : 'ADMIN_ONLY';
  return { decision, reason, standing: null, formFrozen };
}

/** A delegation to this user from a current step actor, for this form type, that is no longer valid. */
function hasExpiredDelegation(open: OpenRegistration, userId: Id): boolean {
  return open.ctx.delegations.some(
    (d) =>
      d.toUserId === userId &&
      open.ctx.stepActors.includes(d.fromUserId) &&
      d.formType === open.form.formType &&
      !isDelegationValid(d, open.form.formType, open.ctx.clock),
  );
}

// ─── "Gửi" on the registration form ────────────────────────────────────────────────────────────

export interface SubmitAvailability {
  /** `true` = `forms.act` SUBMIT would be accepted now (a dry run of the same `checkAction`). */
  allowed: boolean;
  /**
   * The button's wording: the manager's SUBMIT before the owner's step hands the unfinished plan to
   * the employee ("Chuyển cho nhân viên", BR-KPI-12); from the owner's step on it is "Gửi".
   */
  kind: 'HAND_TO_OWNER' | 'SUBMIT';
  /** Whether the step even shows a SUBMIT to this person (an actor / delegate / proxy of it). */
  visible: boolean;
  /** Why not, when not allowed: the refusal's code and detail, plus content issues (ERR-KPI-07/08/06). */
  refusal: { code: ErrorCode; detail: string } | null;
  issues: RuleIssue[];
  /** What `forms.act` must be sent (both people recorded for a delegate / proxy, BR-KPI-21). */
  actor: ActorInput | null;
}

export interface SubmitInput {
  form: FormInstance;
  steps: readonly WorkflowStep[];
  plan: Pick<GoalPlan, 'status'>;
  goals: readonly Goal[];
  kgis: readonly Kgi[];
  userId: Id;
  ctx: EntitlementContext;
  clock: Clock;
}

/**
 * Whether this person may SUBMIT the plan's registration form now — a dry run of `checkAction`
 * (`forms.act`'s only entry): the form is open at the step shown, not frozen, the person is entitled
 * (as actor, delegate or proxy — `editStanding`), the step allows SUBMIT, and the content passes
 * `canSubmit` (from the owner's step on: 100%, 5–8 goals, every goal measurable). The gateway re-runs
 * it on the click.
 */
export function submitAvailability(input: SubmitInput): SubmitAvailability {
  const { form, steps } = input;
  const step = steps.find((s) => s.id === form.currentStepId && s.workflowId === form.workflowId);
  const kind = step && step.stepNo < ownerStepNo(steps) ? 'HAND_TO_OWNER' : 'SUBMIT';
  const actor = editStanding(form, input.userId, input.ctx);
  const visible =
    step !== undefined &&
    step.allowedActions.includes('SUBMIT') &&
    (input.ctx.stepActors.includes(input.userId) || actor.onBehalfOfUserId !== null || (input.ctx.stepActors.length === 0 && input.ctx.actorMayProxy));
  const { clock: _clock, ...entitlement } = input.ctx;
  const checked = checkAction({
    form,
    steps,
    plan: input.plan,
    action: 'SUBMIT',
    expectedStepId: form.currentStepId ?? '',
    comment: null,
    actor,
    entitlement,
    submitCheck: step ? { formType: 'GOAL_SETTING', stepNo: step.stepNo, steps, goals: input.goals, kgis: input.kgis } : null,
    clock: input.clock,
  });
  if (checked.ok) return { allowed: true, kind, visible, refusal: null, issues: [], actor };
  return { allowed: false, kind, visible, refusal: { code: checked.code, detail: checked.detail }, issues: checked.issues, actor: null };
}

// ─── PRIVATE goals (D2) ────────────────────────────────────────────────────────────────────────

export interface GoalViewer {
  /** `null` for a system account. */
  employeeId: Id | null;
  access: AccessProfile;
  tenantId: Id;
}

export interface VisibilityContext {
  assignments: readonly EmployeeAssignment[];
  units: readonly Pick<OrgUnit, 'id' | 'headEmployeeId'>[];
  today: IsoDate;
}

/** The employee(s) a goal belongs to: its own owner and the plan's (the unit head for a unit plan). */
function goalOwners(goal: Pick<Goal, 'ownerEmployeeId'>, plan: Pick<GoalPlan, 'ownerEmployeeId' | 'ownerOrgUnitId'>, ctx: VisibilityContext): Id[] {
  const planOwner = plan.ownerEmployeeId ?? (plan.ownerOrgUnitId ? (ctx.units.find((u) => u.id === plan.ownerOrgUnitId)?.headEmployeeId ?? null) : null);
  return [...new Set([goal.ownerEmployeeId, planOwner].filter((id): id is Id => id !== null))];
}

/** Is `viewer` in `employeeId`'s manager chain today (any level up; cycle-safe)? */
function isAboveInChain(viewer: Id, employeeId: Id, ctx: VisibilityContext): boolean {
  const seen = new Set<Id>([employeeId]);
  let current = managerOf(employeeId, ctx.assignments, ctx.today);
  while (current !== null && !seen.has(current)) {
    if (current === viewer) return true;
    seen.add(current);
    current = managerOf(current, ctx.assignments, ctx.today);
  }
  return false;
}

/**
 * D2, BR-KPI-08 (product owner, T3 Phase 1): a PUBLIC goal is seen by everyone who sees the plan; a
 * PRIVATE one only by its owner (the goal's or the plan's — the unit head for a unit plan), anyone
 * in that owner's manager chain as of today, and holders of a Tenant scope over plans (HR, C&B, BOD,
 * Admin by default). **Enforced on screens only** — the gateway still returns the row (reads are not
 * filtered per user before Phase 5's RLS). Aggregates (allocation buckets, totals) still count it.
 */
export function canSeeGoal(
  goal: Pick<Goal, 'visibility' | 'ownerEmployeeId'>,
  plan: Pick<GoalPlan, 'ownerEmployeeId' | 'ownerOrgUnitId'>,
  viewer: GoalViewer,
  ctx: VisibilityContext,
): boolean {
  if (goal.visibility === 'PUBLIC') return true;
  if (can(viewer.access, 'goalplan.view', { kind: 'Tenant', tenantId: viewer.tenantId })) return true;
  if (viewer.employeeId === null) return false;
  const owners = goalOwners(goal, plan, ctx);
  return owners.includes(viewer.employeeId) || owners.some((owner) => isAboveInChain(viewer.employeeId as Id, owner, ctx));
}

/** The goals `viewer` may see, and how many were hidden (the screen says so — never a silent gap). */
export function visibleGoals<G extends Pick<Goal, 'visibility' | 'ownerEmployeeId' | 'goalPlanId'>>(
  goals: readonly G[],
  plans: readonly Pick<GoalPlan, 'id' | 'ownerEmployeeId' | 'ownerOrgUnitId'>[],
  viewer: GoalViewer,
  ctx: VisibilityContext,
): { goals: G[]; hiddenCount: number } {
  const byId = new Map(plans.map((p) => [p.id, p]));
  const shown = goals.filter((g) => {
    const plan = byId.get(g.goalPlanId);
    // A goal whose plan is not known is treated as unowned: only PUBLIC or a Tenant scope shows it.
    return canSeeGoal(g, plan ?? { ownerEmployeeId: null, ownerOrgUnitId: null }, viewer, ctx);
  });
  return { goals: shown, hiddenCount: goals.length - shown.length };
}

// ─── Assembling the inputs from loaded rows (screens; the parity test) ────────────────────────

/** Everything the screen loaded that the plan decisions read — all of ONE tenant. */
export interface PlanAccessRows {
  plan: GoalPlan;
  cycleStatus: CycleStatus;
  /** The plan's forms (any type, any status) — the open GOAL_SETTING one is picked here. */
  forms: readonly FormInstance[];
  /** Steps of (at least) the open form's workflow. */
  steps: readonly WorkflowStep[];
  delegations: readonly Delegation[];
  dir: ActorDirectory;
  access: AccessProfile;
  actor: { userId: Id; employeeId: Id | null };
  clock: Clock;
}

/** The plan's open registration form (at most one, BR-KPI-19). */
export const openRegistrationOf = (planId: Id, forms: readonly FormInstance[]): FormInstance | null =>
  forms.find((f) => f.goalPlanId === planId && f.formType === 'GOAL_SETTING' && !isTerminal(f)) ?? null;

/** The plan's employee, or the head of its unit (a Company / OrgUnit plan). */
export function planOwnerOf(plan: Pick<GoalPlan, 'ownerEmployeeId' | 'ownerOrgUnitId'>, units: readonly Pick<OrgUnit, 'id' | 'headEmployeeId'>[]): Id | null {
  if (plan.ownerEmployeeId !== null) return plan.ownerEmployeeId;
  return plan.ownerOrgUnitId ? (units.find((u) => u.id === plan.ownerOrgUnitId)?.headEmployeeId ?? null) : null;
}

/** The open registration, with its steps (ordered) and `EntitlementContext` built as the gateway builds it. */
export function openRegistrationFrom(rows: PlanAccessRows): OpenRegistration | null {
  const form = openRegistrationOf(rows.plan.id, rows.forms);
  if (!form) return null;
  const steps = rows.steps.filter((s) => s.workflowId === form.workflowId).sort((a, b) => a.stepNo - b.stepNo);
  const step = steps.find((s) => s.id === form.currentStepId);
  const subject = resourceOfSubject(rows.plan.tenantId, form.subjectEmployeeId);
  const ctx = entitlementContextOf(form, step, {
    dir: rows.dir,
    delegations: rows.delegations,
    clock: rows.clock,
    actorMayProxy: can(rows.access, 'form.proxy', subject),
    actorMayCancel: can(rows.access, 'form.cancel', subject),
  });
  return { form, steps, ctx };
}

/**
 * `planEditability` from loaded rows, preceded by the write's own permission check — exactly what a
 * gateway plan edit runs: `goalplan.edit` over the plan's owner (the authorize hook, ERR-KPI-05
 * `NO_PERMISSION`), then `assertPlanEditable`.
 */
export function planEditabilityFrom(rows: PlanAccessRows): PlanEditability {
  if (!can(rows.access, 'goalplan.edit', resourceOfOwner(rows.plan.tenantId, rows.plan))) {
    return { decision: { ok: false, code: 'ERR-KPI-05' }, reason: 'NO_PERMISSION', standing: null, formFrozen: false };
  }
  return planEditability({
    plan: rows.plan,
    cycleStatus: rows.cycleStatus,
    openRegistration: openRegistrationFrom(rows),
    actor: rows.actor,
    planOwnerEmployeeId: planOwnerOf(rows.plan, rows.dir.units),
    actorIsPlanAdmin: can(rows.access, 'goalplan.edit', { kind: 'Tenant', tenantId: rows.plan.tenantId }),
  });
}

/** `submitAvailability` from loaded rows; `null` when the plan has no open registration form. */
export function submitAvailabilityFrom(rows: PlanAccessRows, goals: readonly Goal[], kgis: readonly Kgi[]): SubmitAvailability | null {
  const open = openRegistrationFrom(rows);
  if (!open) return null;
  return submitAvailability({ form: open.form, steps: open.steps, plan: rows.plan, goals, kgis, userId: rows.actor.userId, ctx: open.ctx, clock: rows.clock });
}

// ─── The readiness strip ("Cần xử lý trước khi gửi" / "Lưu ý") ────────────────────────────────

/** Methods that score a number only — a TEXT target under one of them is never computable. */
const NUMERIC_ONLY_METHODS: readonly CalcMethod['methodType'][] = ['RATIO_UP', 'RATIO_DOWN', 'TIERED', 'FORMULA'];

export interface PlanReadiness {
  /** What stops "Gửi" (BR-KPI-03, 04, 05) — empty when the plan could be sent. */
  blocking: RuleIssue[];
  /** Never blocks: the KGI count, the period split (BR-KPI-11), goals that would not be computable. */
  warnings: RuleIssue[];
  /**
   * The same checks as `blocking`, shown as information while the plan is still being built by the
   * manager before the owner's step ("Chuyển cho nhân viên" does not need them, BR-KPI-12).
   */
  info: RuleIssue[];
}

export interface ReadinessContext {
  levels: readonly Pick<GoalTargetLevel, 'goalId'>[];
  periodTargets: readonly Pick<GoalPeriodTarget, 'goalId' | 'periodId' | 'targetValue'>[];
  periods: readonly Pick<CyclePeriod, 'id' | 'periodType' | 'startDate'>[];
  methods: readonly Pick<CalcMethod, 'id' | 'methodType'>[];
  kpiDefinitions: readonly Pick<KpiDefinition, 'id' | 'aggregation'>[];
  /** The registration's current step precedes the owner's (the manager is cascading). */
  beforeOwnerStep: boolean;
}

/**
 * What the plan screen lists above "Gửi". `blocking` = `goalPlanRules.submitIssues` (exactly what
 * `canSubmit` checks from the owner's step on); warnings, per Active goal, `ref` = the goal:
 * - the KGI count outside 3–5 (`KGI_COUNT`, from `submitIssues`);
 * - `periodTargetIssues` (split mismatch / incomplete / mixed / no aggregation);
 * - a LEVELS method with fewer than two levels → `LEVELS_MISSING` (the goal would not be computable);
 * - a TEXT target under a numeric-only method → `TARGET_TYPE_MISMATCH`.
 */
export function planReadiness(goals: readonly Goal[], kgis: readonly Kgi[], ctx: ReadinessContext): PlanReadiness {
  const submit = submitIssues(goals, kgis);
  const warnings: RuleIssue[] = [...submit.warnings];
  for (const goal of activeGoals(goals)) {
    const aggregation = goal.kpiDefId ? (ctx.kpiDefinitions.find((k) => k.id === goal.kpiDefId)?.aggregation ?? null) : null;
    warnings.push(...periodTargetIssues(goal, aggregation, ctx.periodTargets, ctx.periods));
    const method = ctx.methods.find((m) => m.id === goal.calcMethodId);
    const missing = levelsMissingIssue(method?.methodType, ctx.levels.filter((l) => l.goalId === goal.id).length, goal.id);
    if (missing) warnings.push(missing);
    if (method && goal.targetType === 'TEXT' && NUMERIC_ONLY_METHODS.includes(method.methodType)) {
      warnings.push(ruleIssue('ERR-KPI-13', goal.id, 'TARGET_TYPE_MISMATCH'));
    }
  }
  return ctx.beforeOwnerStep ? { blocking: [], warnings, info: submit.blocking } : { blocking: submit.blocking, warnings, info: [] };
}

// ─── Link targets (WBS 4.3.4) ──────────────────────────────────────────────────────────────────

/**
 * The plans a goal of `plan` may LINK up to (BR-KPI-07): in the same cycle, the owner's direct
 * manager's Employee plan, the OrgUnit plans of the owner's unit and every unit above it, and the
 * Company plan — nearest first. A unit plan links to the units above its own unit. Never the plan itself.
 */
export function linkCandidatePlans(
  plan: Pick<GoalPlan, 'id' | 'cycleId' | 'ownerType' | 'ownerEmployeeId' | 'ownerOrgUnitId'>,
  plans: readonly GoalPlan[],
  ctx: { assignments: readonly EmployeeAssignment[]; units: readonly OrgUnit[]; today: IsoDate },
): GoalPlan[] {
  const sameCycle = plans.filter((p) => p.cycleId === plan.cycleId && p.id !== plan.id);
  const result: GoalPlan[] = [];
  const add = (p: GoalPlan | undefined) => {
    if (p && !result.includes(p)) result.push(p);
  };
  let unitChain: Id[] = [];
  if (plan.ownerType === 'Employee' && plan.ownerEmployeeId) {
    const manager = managerOf(plan.ownerEmployeeId, ctx.assignments, ctx.today);
    if (manager) add(sameCycle.find((p) => p.ownerType === 'Employee' && p.ownerEmployeeId === manager));
    const unit = primaryAssignmentOn(plan.ownerEmployeeId, ctx.assignments, ctx.today)?.orgUnitId;
    unitChain = unit ? unitAncestry(unit, ctx.units) : [];
  } else if (plan.ownerOrgUnitId) {
    unitChain = unitAncestry(plan.ownerOrgUnitId, ctx.units).slice(1);
  }
  for (const unitId of unitChain) add(sameCycle.find((p) => p.ownerType === 'OrgUnit' && p.ownerOrgUnitId === unitId));
  if (plan.ownerType !== 'Company') add(sameCycle.find((p) => p.ownerType === 'Company'));
  return result;
}

// ─── Which plan a route may show (sub-page routes) ─────────────────────────────────────────────

/** The route family a Goal Plan page is mounted under — `/my/kpi/plans`, `/team/kpi/members`, … */
export type PlanRouteKind = 'my' | 'members' | 'unit' | 'cycles';

export interface PlanRouteContext {
  /** `can('goalplan.view', resourceOfOwner(tenantId, plan))` — the caller's scope over the owner (BR-KPI-63 for Company). */
  mayView: boolean;
  /** The viewer's employee; `null` for a system account. */
  viewerEmployeeId: Id | null;
  /** The `:cycleId` of a `/admin/cycles/:cycleId/plans/:planId` route. */
  routeCycleId?: Id | null;
}

/**
 * May this route show this plan? A plan id is typed into a URL, and `getGoalPlan` checks only the
 * tenant — so every plan page asks this before rendering anything of the plan. It needs the scope
 * check (`mayView`) AND the route to fit the plan: `my` → the viewer's own Employee plan; `members`
 * → an Employee plan; `unit` → an OrgUnit or Company plan; `cycles` → a plan of the route's cycle.
 * A refusal is shown as "not found" (ERR-KPI-02), never as "forbidden" — it must not reveal the plan exists.
 */
export function planRouteAllows(plan: Pick<GoalPlan, 'ownerType' | 'ownerEmployeeId' | 'cycleId'>, kind: PlanRouteKind, ctx: PlanRouteContext): boolean {
  if (!ctx.mayView) return false;
  switch (kind) {
    case 'my':
      return plan.ownerType === 'Employee' && ctx.viewerEmployeeId !== null && plan.ownerEmployeeId === ctx.viewerEmployeeId;
    case 'members':
      return plan.ownerType === 'Employee';
    case 'unit':
      return plan.ownerType === 'OrgUnit' || plan.ownerType === 'Company';
    case 'cycles':
      return ctx.routeCycleId != null && plan.cycleId === ctx.routeCycleId;
  }
}
