/**
 * Goal Plan rules — weights, goal count, who may edit, the plan's status along registration, lock and
 * unlock, and applying an approved adjustment. BR-KPI-02…05, 12, 14, 15.
 */

import type { ErrorCode } from './errorCatalog';
import type { Aggregation, CyclePeriod, Goal, GoalChangeItem, GoalDraft, GoalPeriodTarget, GoalPlan, GoalPlanStatus, Id, IsoDate, Kgi, PeriodType, WorkflowStep } from '@/data/types';
import { ruleIssue, type RuleIssue } from './errorCatalog';
import { isIsoDate, todayOf, type Clock } from './isoDate';

/** BR-KPI-04 — a sum of 99.99 or 100.01 from rounding counts as 100. */
export const WEIGHT_TOLERANCE = 0.01;
/** BR-KPI-03. */
export const GOAL_COUNT = { min: 5, max: 8 } as const;
/** BR-KPI-02 — advisory: Submit is gated on weights and goal count only (new-flow §2). */
export const KGI_COUNT = { min: 3, max: 5 } as const;

/** The goal fields the plan checks read — a stored `Goal` or a `PlannedGoal`. */
export type GoalLike = Pick<
  Goal,
  'id' | 'name' | 'weight' | 'status' | 'dataSourceId' | 'targetType' | 'targetValue' | 'targetText' | 'startDate' | 'dueDate'
>;

/**
 * A goal as it WOULD be after an adjustment's proposal is applied (`planAfterChanges`). Never stored:
 * an ADD's id is `planned:<change item id>`, only so issues can point at the row.
 */
export type PlannedGoal = GoalLike;

export const activeGoals = <G extends Pick<Goal, 'status'>>(goals: readonly G[]): G[] => goals.filter((g) => g.status === 'Active');

/** Σ weight of the ACTIVE goals (cancelled and replaced goals carry no weight). */
export function totalWeight(goals: readonly Pick<Goal, 'status' | 'weight'>[]): number {
  return activeGoals(goals).reduce((sum, g) => sum + g.weight, 0);
}

/** |Σ − 100| ≤ 0.01 — never `=== 100`. The 1e-9 absorbs the float error of the subtraction itself. */
export function isWeightComplete(total: number): boolean {
  return Number.isFinite(total) && Math.abs(total - 100) <= WEIGHT_TOLERANCE + 1e-9;
}

/** ERR-KPI-07 when the active weights miss 100%, with the total for the screen to show. */
export function weightIssue(goals: readonly Pick<Goal, 'status' | 'weight'>[]): RuleIssue | null {
  const total = totalWeight(goals);
  return isWeightComplete(total) ? null : ruleIssue('ERR-KPI-07', null, null, { totalWeight: total });
}

const blank = (value: string | null) => value === null || value.trim() === '';

/** Per-goal problems that block a submit (ERR-KPI-06, `ref` = the goal). */
function goalIssues(goal: GoalLike): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const invalid = (detail: string) => issues.push(ruleIssue('ERR-KPI-06', goal.id, detail));
  if (blank(goal.name)) invalid('NAME_REQUIRED');
  if (!Number.isFinite(goal.weight) || goal.weight <= 0) invalid('WEIGHT_INVALID');
  if (blank(goal.dataSourceId)) invalid('DATA_SOURCE_REQUIRED'); // BR-KPI-05 "KPI phải đo được"
  if (goal.targetType === 'NUMERIC' ? goal.targetValue === null : blank(goal.targetText)) invalid('TARGET_REQUIRED');
  if (goal.dueDate < goal.startDate) invalid('DATES_INVALID');
  return issues;
}

/**
 * What stands between a plan and "Gửi" (BR-KPI-03, 04, 05). `blocking` is ordered most important first
 * — weights, then count, then each goal; `warnings` never block (the KGI count, BR-KPI-02).
 */
export function submitIssues(goals: readonly GoalLike[], kgis: readonly Kgi[]): { blocking: RuleIssue[]; warnings: RuleIssue[] } {
  const active = activeGoals(goals);
  const blocking: RuleIssue[] = [];
  const weight = weightIssue(goals);
  if (weight) blocking.push(weight);
  if (active.length < GOAL_COUNT.min || active.length > GOAL_COUNT.max) {
    blocking.push(ruleIssue('ERR-KPI-08', null, null, { count: active.length, min: GOAL_COUNT.min, max: GOAL_COUNT.max }));
  }
  for (const goal of active) blocking.push(...goalIssues(goal));

  const warnings: RuleIssue[] = [];
  if (kgis.length < KGI_COUNT.min || kgis.length > KGI_COUNT.max) {
    warnings.push(ruleIssue('ERR-KPI-06', null, 'KGI_COUNT', { count: kgis.length, min: KGI_COUNT.min, max: KGI_COUNT.max }));
  }
  return { blocking, warnings };
}

// ─── Editability ───────────────────────────────────────────────────────────────────────────────

export type Decision = { ok: true } | { ok: false; code: ErrorCode };
const allow: Decision = { ok: true };
const refuse = (code: ErrorCode): Decision => ({ ok: false, code });

/** Facts the caller resolves before asking — so this rule needs neither the workflow nor permissions. */
export interface PlanEditContext {
  cycleClosed: boolean;
  /** The plan's open GOAL_SETTING form: may THIS actor act on its current step now, and does it allow EDIT? (`workflowRules.mayEditAtCurrentStep`) */
  openRegistrationForm: { actorMayEditNow: boolean } | null;
  actorIsOwner: boolean;
  /** HR's right to maintain plans directly (`permissionRules`, Phase 1.3). */
  actorIsPlanAdmin: boolean;
}

/**
 * Who may change a plan's goals (`saveGoal`, `deleteGoal`, levels, alignments).
 * - Locked, or the cycle closed → ERR-KPI-04: a locked plan changes only through GOAL_CHANGE (BR-KPI-14).
 * - While a registration form is open → only the actor of its current step, if that step allows EDIT
 *   (the manager cascading at step 1, the employee at step 2, the manager at step 3…).
 * - No open form → Draft/Returned: the owner or a plan admin; Submitted/Approved: a plan admin only.
 */
export function canEditPlan(plan: Pick<GoalPlan, 'status'>, ctx: PlanEditContext): Decision {
  if (plan.status === 'Locked' || ctx.cycleClosed) return refuse('ERR-KPI-04');
  if (ctx.openRegistrationForm) return ctx.openRegistrationForm.actorMayEditNow ? allow : refuse('ERR-KPI-05');
  if (plan.status === 'Draft' || plan.status === 'Returned') return ctx.actorIsOwner || ctx.actorIsPlanAdmin ? allow : refuse('ERR-KPI-05');
  return ctx.actorIsPlanAdmin ? allow : refuse('ERR-KPI-04');
}

// ─── The plan's status along registration (BR-KPI-12) ─────────────────────────────────────────

/** The owner's step: the first SELF step (step 1 as a defensive default — `validateWorkflow` requires one). */
export function ownerStepNo(steps: readonly Pick<WorkflowStep, 'stepNo' | 'actorRule'>[]): number {
  const self = steps.filter((s) => s.actorRule === 'SELF').map((s) => s.stepNo);
  return self.length > 0 ? Math.min(...self) : 1;
}

/**
 * The plan's status when its registration form ENTERS step `stepNo`, with s = the owner's step and n
 * = the last step: k ≤ s → Draft (Returned when it came back by RETURN); s < k < n → Submitted;
 * k = n → Approved when someone between the owner and the last step already approved, else Submitted.
 * Default 4 steps (manager cascades → employee → manager → HR): Draft, Draft, Submitted, Approved;
 * the final APPROVE locks it (`planStatusOnComplete`).
 */
export function planStatusOnEnterStep(
  stepNo: number,
  steps: readonly Pick<WorkflowStep, 'stepNo' | 'actorRule'>[],
  viaReturn: boolean,
): GoalPlanStatus {
  const s = ownerStepNo(steps);
  const n = Math.max(...steps.map((step) => step.stepNo));
  if (stepNo <= s) return viaReturn ? 'Returned' : 'Draft';
  if (stepNo < n) return 'Submitted';
  return n > s + 1 ? 'Approved' : 'Submitted';
}

/** HR records the plan: the final APPROVE of registration locks it (BR-KPI-12 step 4). */
export const PLAN_STATUS_ON_COMPLETE: GoalPlanStatus = 'Locked';
/** Cancelling a registration form puts the plan back to Draft (BR-KPI-23). */
export const PLAN_STATUS_ON_CANCEL: GoalPlanStatus = 'Draft';

/**
 * The status a plan returns to when HR unlocks it: where its open registration form stands (the form
 * re-enters that step, `workflowRules.onUnlock`), or Approved when registration had finished.
 */
export function statusAfterUnlock(
  openRegistrationForm: { stepNo: number; steps: readonly Pick<WorkflowStep, 'stepNo' | 'actorRule'>[] } | null,
): GoalPlanStatus {
  return openRegistrationForm ? planStatusOnEnterStep(openRegistrationForm.stepNo, openRegistrationForm.steps, false) : 'Approved';
}

/** HR can lock any plan that is not already locked (BR-KPI-14); an open form on it freezes. */
export function canLock(plan: Pick<GoalPlan, 'status'>): Decision {
  return plan.status === 'Locked' ? refuse('ERR-KPI-04') : allow;
}

/** Unlocking needs a reason and a new due date not in the past (BR-KPI-13, 14). */
export function canUnlock(
  plan: Pick<GoalPlan, 'status'>,
  input: { reason: string; newDueDate: IsoDate },
  clock: Clock,
): { ok: true } | { ok: false; issues: RuleIssue[] } {
  if (plan.status !== 'Locked') return { ok: false, issues: [ruleIssue('ERR-KPI-04', null, 'NOT_LOCKED')] };
  const issues: RuleIssue[] = [];
  if (blank(input.reason)) issues.push(ruleIssue('ERR-KPI-06', 'reason', 'REASON_REQUIRED'));
  if (!isIsoDate(input.newDueDate) || input.newDueDate < todayOf(clock)) issues.push(ruleIssue('ERR-KPI-06', 'newDueDate', 'DUE_DATE_INVALID'));
  return issues.length ? { ok: false, issues } : { ok: true };
}

// ─── Adjustment (GOAL_CHANGE, BR-KPI-15) ──────────────────────────────────────────────────────

/**
 * Problems with a GOAL_CHANGE proposal itself (ERR-KPI-06, `ref` = the change item). `draft: true`
 * is "Lưu nháp" (`saveGoalChangeItems`): a reason may still be missing — the submit requires it.
 */
export function changeItemIssues(
  goals: readonly Pick<Goal, 'id' | 'status'>[],
  items: readonly GoalChangeItem[],
  options: { draft?: boolean } = {},
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const touched = new Set<Id>();
  for (const item of items) {
    const invalid = (detail: string) => issues.push(ruleIssue('ERR-KPI-06', item.id, detail));
    if (!options.draft && blank(item.reason)) invalid('REASON_REQUIRED');
    if (item.changeType === 'ADD') {
      if (item.goalId !== null) invalid('ADD_HAS_GOAL');
    } else {
      const target = goals.find((g) => g.id === item.goalId);
      if (!target || target.status !== 'Active') invalid('GOAL_NOT_ACTIVE');
      else if (touched.has(target.id)) invalid('GOAL_CHANGED_TWICE');
      else touched.add(target.id);
    }
    if (item.changeType === 'CANCEL' ? item.proposed !== null : item.proposed === null) invalid('PROPOSAL_MISMATCH');
  }
  return issues;
}

const draftFields = (draft: GoalDraft): Omit<GoalDraft, 'targetLevels'> => {
  const { targetLevels: _levels, ...fields } = draft;
  return fields;
};

/** The plan's goals as they would be after `items` (BR-KPI-15) — what GOAL_CHANGE's submit/approve checks. */
export function planAfterChanges(goals: readonly Goal[], items: readonly GoalChangeItem[]): PlannedGoal[] {
  const byGoal = new Map(items.filter((i) => i.goalId !== null).map((i) => [i.goalId as Id, i]));
  const result: PlannedGoal[] = [];
  for (const goal of goals) {
    const change = byGoal.get(goal.id);
    if (!change) result.push(goal);
    else if (change.changeType === 'CANCEL') result.push({ ...goal, status: 'Cancelled' });
    else if (change.proposed) {
      result.push({ ...goal, status: 'Changed' });
      result.push({ ...draftFields(change.proposed), id: `planned:${change.id}`, status: 'Active' });
    }
  }
  for (const item of items) {
    if (item.changeType === 'ADD' && item.proposed) result.push({ ...draftFields(item.proposed), id: `planned:${item.id}`, status: 'Active' });
  }
  return result;
}

/** What the final APPROVE of a GOAL_CHANGE writes. */
export interface GoalChangeEffects {
  creates: { goal: Goal; targetLevels: GoalDraft['targetLevels'] }[];
  statusChanges: { goalId: Id; status: 'Changed' | 'Cancelled' }[];
}

/**
 * BR-KPI-15 — MODIFY creates a new Active goal that `replacesGoalId` the old one (→ Changed, kept for
 * history); CANCEL marks the goal Cancelled; ADD creates a goal. `newId` is the caller's id source.
 */
export function applyGoalChanges(
  plan: Pick<GoalPlan, 'id' | 'tenantId'>,
  goals: readonly Goal[],
  items: readonly GoalChangeItem[],
  newId: () => Id,
): { ok: true; effects: GoalChangeEffects } | { ok: false; issues: RuleIssue[] } {
  const issues = changeItemIssues(goals, items);
  if (issues.length) return { ok: false, issues };
  const effects: GoalChangeEffects = { creates: [], statusChanges: [] };
  let nextSort = Math.max(-1, ...goals.map((g) => g.sortOrder)) + 1;
  const create = (draft: GoalDraft, replaces: Goal | null) =>
    effects.creates.push({
      goal: {
        ...draftFields(draft),
        id: newId(),
        tenantId: plan.tenantId,
        goalPlanId: plan.id,
        status: 'Active',
        replacesGoalId: replaces?.id ?? null,
        sortOrder: replaces ? replaces.sortOrder : nextSort++,
      },
      targetLevels: draft.targetLevels,
    });

  for (const item of items) {
    const old = goals.find((g) => g.id === item.goalId) ?? null;
    if (item.changeType === 'CANCEL' && old) effects.statusChanges.push({ goalId: old.id, status: 'Cancelled' });
    if (item.changeType === 'MODIFY' && old && item.proposed) {
      effects.statusChanges.push({ goalId: old.id, status: 'Changed' });
      create(item.proposed, old);
    }
    if (item.changeType === 'ADD' && item.proposed) create(item.proposed, null);
  }
  return { ok: true, effects };
}

// ─── Plan summaries (WBS 4.3.2, 4.3.6) ─────────────────────────────────────────────────────────

export interface PlanSummary {
  /** Σ weight of the Active goals. */
  totalWeight: number;
  weightComplete: boolean;
  /** Active goals (Changed / Cancelled carry no weight and do not count). */
  goalCount: number;
  goalCountOk: boolean;
}

/** The figures the plan header and HR's plan table show — one pass over one goals read, no per-row queries. */
export function planSummaries(planIds: readonly Id[], goals: readonly Pick<Goal, 'goalPlanId' | 'status' | 'weight'>[]): Map<Id, PlanSummary> {
  const byPlan = new Map<Id, Pick<Goal, 'goalPlanId' | 'status' | 'weight'>[]>(planIds.map((id) => [id, []]));
  for (const goal of goals) byPlan.get(goal.goalPlanId)?.push(goal);
  return new Map([...byPlan].map(([id, list]) => [id, planSummary(list)]));
}

export function planSummary(goals: readonly Pick<Goal, 'status' | 'weight'>[]): PlanSummary {
  const total = totalWeight(goals);
  const count = activeGoals(goals).length;
  return { totalWeight: total, weightComplete: isWeightComplete(total), goalCount: count, goalCountOk: count >= GOAL_COUNT.min && count <= GOAL_COUNT.max };
}

/** What is left to reach 100% (never negative) — the weight a new or cascaded goal is offered. */
export function remainingWeight(goals: readonly Pick<Goal, 'status' | 'weight'>[]): number {
  return Math.max(0, Math.round((100 - totalWeight(goals)) * 100) / 100);
}

/** The `sortOrder` a goal added to the plan takes: after every goal it already has. */
export function nextSortOrder(goals: readonly Pick<Goal, 'sortOrder'>[]): number {
  return goals.reduce((max, g) => Math.max(max, g.sortOrder + 1), 0);
}

// ─── Period split (WBS 4.3.5, BR-KPI-11) ───────────────────────────────────────────────────────

/** The precision `evenSplit` works in: 4 decimals, so a share of "tỷ" or of a ratio keeps its meaning. */
const SPLIT_SCALE = 10_000;

/**
 * "Chia đều" — the goal's target spread over `periods` (one period type, any order) by the KPI's
 * aggregation (`ASSUMPTION Q15`): SUM → equal shares at 4 decimals with the remainder on the LAST
 * period, so Σ is exactly the target; AVG and LAST → the target in every period. A TEXT goal, a goal
 * with no target, or one with no aggregation (typed in, not from the library) has nothing to spread → [].
 */
export function evenSplit(
  goal: Pick<Goal, 'targetType' | 'targetValue'>,
  aggregation: Aggregation | null,
  periods: readonly Pick<CyclePeriod, 'id' | 'startDate'>[],
): { periodId: Id; targetValue: number }[] {
  if (goal.targetType !== 'NUMERIC' || goal.targetValue === null || !Number.isFinite(goal.targetValue) || aggregation === null) return [];
  const ordered = [...periods].sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
  if (ordered.length === 0) return [];
  const target = goal.targetValue;
  if (aggregation !== 'SUM') return ordered.map((p) => ({ periodId: p.id, targetValue: target }));
  const total = Math.round(target * SPLIT_SCALE);
  const share = Math.trunc(total / ordered.length);
  return ordered.map((p, i) => ({
    periodId: p.id,
    targetValue: (i === ordered.length - 1 ? total - share * (ordered.length - 1) : share) / SPLIT_SCALE,
  }));
}

/**
 * The period type a goal's target is split by (BR-KPI-11, PEND-04 — the "Phân bổ theo quý / tháng" label
 * on the goal row and the split panel): `null` when nothing is split; with mixed types
 * (`SPLIT_MIXED_TYPES`) the type of the earliest split period. Rows of unknown periods are ignored.
 */
export function splitPeriodType(
  goalId: Id,
  targets: readonly Pick<GoalPeriodTarget, 'goalId' | 'periodId'>[],
  periods: readonly Pick<CyclePeriod, 'id' | 'periodType' | 'startDate'>[],
): PeriodType | null {
  const byId = new Map(periods.map((p) => [p.id, p]));
  const split = targets.flatMap((t) => (t.goalId === goalId && byId.has(t.periodId) ? [byId.get(t.periodId) as Pick<CyclePeriod, 'periodType' | 'startDate'>] : []));
  if (split.length === 0) return null;
  return split.reduce((first, p) => (p.startDate < first.startDate ? p : first)).periodType;
}

/** Within the split tolerance: relative 1e-6, with an absolute 0.005 floor only for a target below 1. */
function splitMatches(expected: number, actual: number): boolean {
  const tolerance = Math.abs(expected) < 1 ? 0.005 : Math.abs(expected) * 1e-6;
  return Math.abs(actual - expected) <= tolerance + 1e-9;
}

/**
 * Warnings on a goal's period split (BR-KPI-11 — they never block a save or "Gửi", product owner,
 * T3 Phase 1). They matter because quarters and the year are built from the month splits
 * (`resultRules`), so a wrong split changes every unit and company result. ERR-KPI-06, `ref` = the
 * goal, in this order (the first that applies):
 * - nothing split, a TEXT goal, or no target → none (the goal's own target applies to every period);
 * - `SPLIT_MIXED_TYPES` — months and quarters mixed in one split;
 * - `SPLIT_NO_AGGREGATION` — informational: a KPI typed in (no library item) has no aggregation, so
 *   each period uses only its OWN split — a quarter is not added up from months, a month is not derived
 *   from its quarter (`calcRules.monthTargetFromSplit` → not computable, ASSUMPTION Q67);
 * - `SPLIT_INCOMPLETE` — some periods of that type have no split (`data`: covered / total): a SUM
 *   quarter holding such a period has no target (not computable, never the annual one); an AVG / LAST
 *   one, and the year, use the goal's target (`resultRules.periodTarget`);
 * - `SPLIT_MISMATCH` — SUM: Σ ≠ target; AVG: the mean ≠ target; LAST: the last period (by date) ≠
 *   target (`data`: expected, actual, aggregation).
 */
export function periodTargetIssues(
  goal: Pick<Goal, 'id' | 'targetType' | 'targetValue'>,
  aggregation: Aggregation | null,
  targets: readonly Pick<GoalPeriodTarget, 'goalId' | 'periodId' | 'targetValue'>[],
  cyclePeriods: readonly Pick<CyclePeriod, 'id' | 'periodType' | 'startDate'>[],
): RuleIssue[] {
  const own = targets.filter((t) => t.goalId === goal.id);
  if (own.length === 0 || goal.targetType !== 'NUMERIC' || goal.targetValue === null) return [];
  const byId = new Map(cyclePeriods.map((p) => [p.id, p]));
  const split = own.flatMap((t) => {
    const p = byId.get(t.periodId);
    return p ? [{ ...t, period: p }] : [];
  });
  const types = new Set<PeriodType>(split.map((s) => s.period.periodType));
  if (types.size > 1) return [ruleIssue('ERR-KPI-06', goal.id, 'SPLIT_MIXED_TYPES')];
  if (aggregation === null) return [ruleIssue('ERR-KPI-06', goal.id, 'SPLIT_NO_AGGREGATION')];

  const [type] = [...types];
  const total = cyclePeriods.filter((p) => p.periodType === type).length;
  if (split.length < total) return [ruleIssue('ERR-KPI-06', goal.id, 'SPLIT_INCOMPLETE', { covered: split.length, total })];

  const ordered = [...split].sort((a, b) => (a.period.startDate < b.period.startDate ? -1 : a.period.startDate > b.period.startDate ? 1 : 0));
  const values = ordered.map((s) => s.targetValue);
  const sum = values.reduce((acc, v) => acc + v, 0);
  const actual = aggregation === 'SUM' ? sum : aggregation === 'AVG' ? sum / values.length : values[values.length - 1];
  return splitMatches(goal.targetValue, actual)
    ? []
    : [ruleIssue('ERR-KPI-06', goal.id, 'SPLIT_MISMATCH', { expected: goal.targetValue, actual, aggregation })];
}
