/**
 * Monthly work scoring — PEND-14 (CMC item 4, `docs/plans/KPI_monthly_work_plan.md` §5), step 8.0:
 * the calculation part only. The work entities (`WorkPlan`, `WorkTask`, `WorkReview`…) arrive with
 * step 8.1, so these functions read the few fields they need through structural types; a stored
 * entity satisfies them as it is.
 *
 * The CMC form (NV p. 73, QL p. 129):
 * - KQcv — each task scored 0–100; KQcv = Σ score × the task's weight / 100.
 * - KLcv — one criterion, "Ý thức chấp hành kỷ luật và thái độ làm việc".
 * - Hsht = 70% × KQcv + 30% × KLcv; below 80 the manager must set Hsnv with a reason.
 *
 * As everywhere in `src/lib`, a missing score is `null`, never 0 (BR-KPI-32), and a task the manager
 * cancelled mid-month drops out of KQcv with the remaining weights normalised to 100 (`ASSUMPTION Q64`).
 * A task's link to a KPI (`linkedGoalId`, Q63) never touches the score, and neither does its
 * visibility. Nothing here rounds: the screens round for display.
 *
 * Step 8.1 adds the rules the gateway refuses with: what blocks sending a plan, who may change a
 * task when, what blocks sending a review column, and the month's result snapshot.
 */

import type { CyclePeriod, EvaluationColumn, Goal, GoalPlan, Id, WorkflowStep, WorkPlanStatus, WorkReview, WorkReviewItem, WorkTask, WorkTaskStatus } from '@/data/types';
import { ruleIssue, type RuleIssue } from './errorCatalog';
import { isWeightComplete, planStatusOnEnterStep } from './goalPlanRules';

// ─── Configuration ─────────────────────────────────────────────────────────────────────────────

/** The tenant's scoring settings (`WorkScoringConfig` from step 8.1; `ASSUMPTION Q62`). */
export interface WorkScoring {
  /** KQcv's share of Hsht, in % (CMC: 70). */
  resultWeight: number;
  /** KLcv's share of Hsht, in % (CMC: 30). */
  disciplineWeight: number;
  /** Hsht strictly below this requires Hsnv with a reason (CMC: 80 — exactly 80 does not). */
  hsnvThreshold: number;
  /**
   * The scale of every score on the form — task scores, KLcv and Hsnv (`ASSUMPTION Q61`, Q62). CMC
   * prints 1–100 beside KLcv and 0–100 beside a task; one 0–100 scale covers both.
   */
  scoreMin: number;
  scoreMax: number;
}

/** CMC's values — what a tenant gets until HR changes them (D-W5). */
export const DEFAULT_WORK_SCORING: Readonly<WorkScoring> = {
  resultWeight: 70,
  disciplineWeight: 30,
  hsnvThreshold: 80,
  scoreMin: 0,
  scoreMax: 100,
};

/** What `saveWorkScoringConfig` must refuse (ERR-KPI-06, `ref` = the field). */
export function workScoringIssues(config: WorkScoring): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const invalid = (ref: keyof WorkScoring, detail: string) => issues.push(ruleIssue('ERR-KPI-06', ref, detail));
  const { resultWeight, disciplineWeight, hsnvThreshold, scoreMin, scoreMax } = config;
  if (!Number.isFinite(resultWeight) || resultWeight < 0) invalid('resultWeight', 'WEIGHT_INVALID');
  if (!Number.isFinite(disciplineWeight) || disciplineWeight < 0) invalid('disciplineWeight', 'WEIGHT_INVALID');
  if (issues.length === 0 && !isWeightComplete(resultWeight + disciplineWeight)) {
    issues.push(ruleIssue('ERR-KPI-07', null, null, { totalWeight: resultWeight + disciplineWeight }));
  }
  if (!Number.isFinite(scoreMin) || !Number.isFinite(scoreMax) || scoreMin < 0 || scoreMax <= scoreMin) {
    invalid('scoreMax', 'SCALE_INVALID');
  } else if (!Number.isFinite(hsnvThreshold) || hsnvThreshold < scoreMin || hsnvThreshold > scoreMax) {
    invalid('hsnvThreshold', 'THRESHOLD_OUT_OF_RANGE');
  }
  return issues;
}

/** A score outside the scale (ERR-KPI-06 `SCORE_OUT_OF_RANGE`, `data` = the bounds). `null` = not scored yet, valid. */
export function workScoreIssue(score: number | null, config: WorkScoring, ref: string | null = null): RuleIssue | null {
  if (score === null) return null;
  if (Number.isFinite(score) && score >= config.scoreMin && score <= config.scoreMax) return null;
  return ruleIssue('ERR-KPI-06', ref, 'SCORE_OUT_OF_RANGE', { min: config.scoreMin, max: config.scoreMax });
}

// ─── Task weights ──────────────────────────────────────────────────────────────────────────────

/** The task fields the weight rules read — a `WorkTask` (8.1) satisfies it. */
export interface WeightedTask {
  id: Id;
  weight: number;
  /** Set when the manager cancelled the task after approval (Q64); a cancelled task carries no weight. */
  cancelledAt: string | null;
}

const liveTasks = <T extends WeightedTask>(tasks: readonly T[]): T[] => tasks.filter((t) => t.cancelledAt === null);

/** Σ weight of the tasks not cancelled. */
export function totalTaskWeight(tasks: readonly WeightedTask[]): number {
  return liveTasks(tasks).reduce((sum, t) => sum + t.weight, 0);
}

/**
 * What blocks sending a plan on its weights (BR-KPI-04's ±0.01): a task not cancelled with a weight
 * ≤ 0 (ERR-KPI-06 `WEIGHT_INVALID`, `ref` = the task) and a total off 100% (ERR-KPI-07 with the total).
 */
export function taskWeightIssues(tasks: readonly WeightedTask[]): RuleIssue[] {
  const issues: RuleIssue[] = liveTasks(tasks)
    .filter((t) => !Number.isFinite(t.weight) || t.weight <= 0)
    .map((t) => ruleIssue('ERR-KPI-06', t.id, 'WEIGHT_INVALID'));
  const total = totalTaskWeight(tasks);
  if (!isWeightComplete(total)) issues.push(ruleIssue('ERR-KPI-07', null, null, { totalWeight: total }));
  return issues;
}

/**
 * The weights KQcv uses (`ASSUMPTION Q64`): cancelled tasks dropped, the rest scaled to total 100.
 * An approved plan already totals 100, so nothing moves until a task is cancelled. No live task, or
 * live weights that do not add up to a positive number → `[]` (nothing to score).
 */
export function effectiveWeights(tasks: readonly WeightedTask[]): { taskId: Id; weight: number }[] {
  const live = liveTasks(tasks);
  if (live.some((t) => !Number.isFinite(t.weight) || t.weight < 0)) return [];
  const total = totalTaskWeight(live);
  if (!(total > 0)) return [];
  return live.map((t) => ({ taskId: t.id, weight: (t.weight / total) * 100 }));
}

// ─── Scores ────────────────────────────────────────────────────────────────────────────────────

/** One task's score in one column of the review (SELF / MANAGER / FINAL). */
export interface TaskScore {
  taskId: Id;
  score: number | null;
}

/**
 * KQcv = Σ score × effective weight / 100. `null` — never 0 — when a live task has no score (or a
 * non-finite one), or when there is no live task at all. A score for a cancelled or unknown task is
 * ignored. The scores are expected on the scale (`workScoreIssue` gates the submit).
 */
export function kqcv(tasks: readonly WeightedTask[], scores: readonly TaskScore[]): number | null {
  const weights = effectiveWeights(tasks);
  if (weights.length === 0) return null;
  const byTask = new Map(scores.map((s) => [s.taskId, s.score]));
  let total = 0;
  for (const { taskId, weight } of weights) {
    const score = byTask.get(taskId) ?? null;
    if (score === null || !Number.isFinite(score)) return null;
    total += score * weight;
  }
  return total / 100;
}

/** Hsht = resultWeight% × KQcv + disciplineWeight% × KLcv. Either side missing → `null`. */
export function hsht(kqcvScore: number | null, klcv: number | null, config: WorkScoring): number | null {
  if (kqcvScore === null || klcv === null || !Number.isFinite(kqcvScore) || !Number.isFinite(klcv)) return null;
  return (config.resultWeight * kqcvScore + config.disciplineWeight * klcv) / 100;
}

/** The float noise a weighted sum can carry (70% × 80 + 30% × 80 must count as 80, not 79.999…). */
const THRESHOLD_EPSILON = 1e-9;

/** Hsnv is required when Hsht is strictly below the threshold (80 itself does not require it). */
export function hsnvRequired(hshtScore: number | null, config: WorkScoring): boolean {
  return hshtScore !== null && hshtScore < config.hsnvThreshold - THRESHOLD_EPSILON;
}

const blank = (text: string | null) => text === null || text.trim() === '';

/**
 * The manager's Hsnv decision (ERR-KPI-06, `ref` = `hsnv` / `hsnvReason`): when required, both a score
 * on the scale and a reason. When not required nothing is checked — the field is not shown.
 */
export function hsnvIssues(hshtScore: number | null, hsnv: number | null, reason: string | null, config: WorkScoring): RuleIssue[] {
  if (!hsnvRequired(hshtScore, config)) return [];
  const issues: RuleIssue[] = [];
  if (hsnv === null) issues.push(ruleIssue('ERR-KPI-06', 'hsnv', 'HSNV_REQUIRED'));
  else {
    const range = workScoreIssue(hsnv, config, 'hsnv');
    if (range) issues.push(range);
  }
  if (blank(reason)) issues.push(ruleIssue('ERR-KPI-06', 'hsnvReason', 'HSNV_REASON_REQUIRED'));
  return issues;
}

/**
 * The month's final score (D-W6, `ASSUMPTION Q61`): Hsnv when it is required, else Hsht. A Hsnv left
 * from before a rescoring lifted Hsht to the threshold is ignored; a required Hsnv not yet set → `null`.
 */
export function finalWorkScore(hshtScore: number | null, hsnv: number | null, config: WorkScoring): number | null {
  if (hshtScore === null) return null;
  return hsnvRequired(hshtScore, config) ? hsnv : hshtScore;
}

// ─── Sending a plan ────────────────────────────────────────────────────────────────────────────

/** The task fields the plan check reads — a `WorkTask` satisfies it. */
export interface PlannedTask extends WeightedTask {
  name: string;
  startDate: string;
  dueDate: string;
}

/**
 * What blocks sending the month's plan (ERR-KPI-06, `ref` = the task): no live task (`PLAN_EMPTY`);
 * the weights (`taskWeightIssues`); a blank name (`NAME_REQUIRED`); a due date before the start
 * (`DATES_ORDER`); a task that does not overlap the month at all (`DATES_OUTSIDE_PERIOD`). A task may
 * run across months — carried-over work starts before the month (`ASSUMPTION Q68`).
 */
export function planSubmitIssues(tasks: readonly PlannedTask[], period: Pick<CyclePeriod, 'startDate' | 'endDate'>): RuleIssue[] {
  const live = liveTasks(tasks);
  if (live.length === 0) return [ruleIssue('ERR-KPI-06', null, 'PLAN_EMPTY')];
  const issues: RuleIssue[] = [];
  for (const t of live) {
    if (t.name.trim() === '') issues.push(ruleIssue('ERR-KPI-06', t.id, 'NAME_REQUIRED'));
    if (t.dueDate < t.startDate) issues.push(ruleIssue('ERR-KPI-06', t.id, 'DATES_ORDER'));
    else if (t.startDate > period.endDate || t.dueDate < period.startDate) issues.push(ruleIssue('ERR-KPI-06', t.id, 'DATES_OUTSIDE_PERIOD'));
  }
  return [...issues, ...taskWeightIssues(tasks)];
}

// ─── Who may change a task, when ───────────────────────────────────────────────────────────────

/** ADD / UPDATE / REMOVE edit the list (before approval); CANCEL and PROGRESS act on one task after it. */
export type TaskEdit = 'ADD' | 'UPDATE' | 'REMOVE' | 'CANCEL' | 'PROGRESS';

export interface TaskEditContext {
  planStatus: GoalPlan['status'];
  /**
   * Whether the actor may EDIT at the open WORK_PLAN form's current step — `null` = yes, else the
   * workflow's refusal (`workflowRules.editRefusal`, 04 state / 05 entitlement). No open form → an
   * ERR-KPI-04 issue.
   */
  editAtStep: RuleIssue | null;
  /** The actor is the plan's employee. */
  isSubject: boolean;
  /** The actor is the employee's direct manager today. */
  isManager: boolean;
  /**
   * The actor may act FOR the direct manager on an approved plan (BR-KPI-21): a delegate holding a
   * WORK_PLAN delegation from the manager valid today, or HR with the proxy right over the employee.
   * The write then names the manager as the person acted for.
   */
  mayActForManager: boolean;
  /** A WORK_REVIEW form exists for the month: the task list is frozen (its items were taken). */
  reviewLaunched: boolean;
  /** The month's `WorkResult` is recorded: nothing about its tasks changes. */
  resultRecorded: boolean;
  /** Live (not cancelled) tasks on the plan — the last one cannot be cancelled. Omitted = not checked. */
  liveTaskCount?: number;
}

/**
 * Who may change what (plan §6, CMC QL pp. 126–127):
 * - before approval (not Locked): ADD / UPDATE / REMOVE by whoever may EDIT at the WORK_PLAN form's
 *   current step; there is nothing to cancel or to track yet (`NOT_APPROVED`);
 * - after approval (Locked): the list is fixed (`WORK_PLAN_LOCKED`) — only the manager cancels a live task
 *   with a reason (`ASSUMPTION Q64`), and the employee or the manager updates progress;
 * - once the month's review exists, the list is frozen for every edit but PROGRESS
 *   (`REVIEW_LAUNCHED`); once its result is recorded, for every edit (`RESULT_RECORDED`).
 */
export function taskEditBlockers(
  ctx: TaskEditContext,
  edit: TaskEdit,
  task: { id?: Id; cancelledAt: string | null } | null = null,
  reason: string | null = null,
): RuleIssue[] {
  const ref = task?.id ?? null;
  const refuse = (code: 'ERR-KPI-04' | 'ERR-KPI-05' | 'ERR-KPI-06', detail: string) => [ruleIssue(code, ref, detail)];
  if (ctx.resultRecorded) return refuse('ERR-KPI-04', 'RESULT_RECORDED');
  if (ctx.reviewLaunched && edit !== 'PROGRESS') return refuse('ERR-KPI-04', 'REVIEW_LAUNCHED');
  // A cancelled task stays, struck through: never edited, tracked or removed (review items and the log point at it).
  if (task?.cancelledAt && edit !== 'ADD') return refuse('ERR-KPI-04', 'TASK_CANCELLED');
  if (ctx.planStatus !== 'Locked') {
    if (edit === 'CANCEL' || edit === 'PROGRESS') return refuse('ERR-KPI-04', 'NOT_APPROVED');
    return ctx.editAtStep ? [{ ...ctx.editAtStep, ref }] : [];
  }
  if (edit === 'PROGRESS') return ctx.isSubject || ctx.isManager || ctx.mayActForManager ? [] : refuse('ERR-KPI-05', 'NOT_SUBJECT_OR_MANAGER');
  if (edit === 'CANCEL') {
    if (!ctx.isManager && !ctx.mayActForManager) return refuse('ERR-KPI-05', 'MANAGER_ONLY');
    // Cancelling the last live task would leave a month nothing can score (KQcv null for good).
    if (ctx.liveTaskCount !== undefined && ctx.liveTaskCount <= 1) return refuse('ERR-KPI-04', 'LAST_LIVE_TASK');
    return blank(reason) ? refuse('ERR-KPI-06', 'CANCEL_REASON_REQUIRED') : [];
  }
  return refuse('ERR-KPI-04', 'WORK_PLAN_LOCKED');
}

/**
 * A progress update (ERR-KPI-06): 0–100 %; `Cancelled` only through a cancellation; the status agrees
 * with the % — `Done` is 100, `NotStarted` is 0 (`STATUS_MISMATCH`). `InProgress` may be anywhere.
 */
export function progressIssues(progressPct: number, progressStatus: WorkTaskStatus): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const inRange = Number.isFinite(progressPct) && progressPct >= 0 && progressPct <= 100;
  if (!inRange) issues.push(ruleIssue('ERR-KPI-06', 'progressPct', 'PROGRESS_OUT_OF_RANGE'));
  if (progressStatus === 'Cancelled') issues.push(ruleIssue('ERR-KPI-06', 'progressStatus', 'CANCEL_BY_PROGRESS'));
  else if (inRange && ((progressStatus === 'Done' && progressPct !== 100) || (progressStatus === 'NotStarted' && progressPct !== 0))) {
    issues.push(ruleIssue('ERR-KPI-06', 'progressStatus', 'STATUS_MISMATCH'));
  }
  return issues;
}

/**
 * A task's link to a KPI (`ASSUMPTION Q63`): an Active goal of the employee's OWN Employee plan,
 * Locked, in the cycle the month belongs to — else ERR-KPI-06 `LINKED_GOAL_INVALID`. `null` = no link.
 */
export function linkedGoalIssues(
  goal: Pick<Goal, 'id' | 'status'> | null,
  plan: Pick<GoalPlan, 'ownerType' | 'ownerEmployeeId' | 'status' | 'cycleId'> | null,
  employeeId: Id,
  period: Pick<CyclePeriod, 'cycleId'>,
): RuleIssue[] {
  if (goal === null) return [];
  const ok =
    goal.status === 'Active' &&
    plan !== null &&
    plan.ownerType === 'Employee' &&
    plan.ownerEmployeeId === employeeId &&
    plan.status === 'Locked' &&
    plan.cycleId === period.cycleId;
  return ok ? [] : [ruleIssue('ERR-KPI-06', 'linkedGoalId', 'LINKED_GOAL_INVALID')];
}

// ─── A review column ───────────────────────────────────────────────────────────────────────────

const ITEM_SCORE = { SELF: 'selfScore', MANAGER: 'managerScore', FINAL: 'finalScore' } as const satisfies Record<EvaluationColumn, keyof WorkReviewItem>;
const DISCIPLINE = { SELF: 'selfDisciplineScore', MANAGER: 'managerDisciplineScore', FINAL: 'finalDisciplineScore' } as const satisfies Record<EvaluationColumn, keyof WorkReview>;
const HSNV = { MANAGER: ['managerHsnv', 'managerHsnvReason'], FINAL: ['finalHsnv', 'finalHsnvReason'] } as const;

/** The review's columns by name — what "Lưu nháp" may write at a step of that column. */
export const WORK_REVIEW_COLUMN_FIELDS = {
  SELF: { discipline: 'selfDisciplineScore', comment: 'selfComment', hsnv: null, hsnvReason: null, score: 'selfScore', itemComment: 'selfComment' },
  MANAGER: { discipline: 'managerDisciplineScore', comment: 'managerComment', hsnv: 'managerHsnv', hsnvReason: 'managerHsnvReason', score: 'managerScore', itemComment: 'managerComment' },
  FINAL: { discipline: 'finalDisciplineScore', comment: 'finalComment', hsnv: 'finalHsnv', hsnvReason: 'finalHsnvReason', score: 'finalScore', itemComment: 'finalComment' },
} as const satisfies Record<EvaluationColumn, Record<string, string | null>>;

/** One column's scores as KQcv reads them. Items of cancelled tasks are kept and ignored. */
export function columnScores(items: readonly WorkReviewItem[], column: EvaluationColumn): TaskScore[] {
  return items.map((i) => ({ taskId: i.taskId, score: i[ITEM_SCORE[column]] }));
}

/** KQcv, KLcv and Hsht of one column. */
export function columnTotals(
  column: EvaluationColumn,
  review: WorkReview,
  items: readonly WorkReviewItem[],
  tasks: readonly WeightedTask[],
  config: WorkScoring,
): { kqcv: number | null; klcv: number | null; hsht: number | null } {
  const k = kqcv(tasks, columnScores(items, column));
  const klcv = review[DISCIPLINE[column]];
  return { kqcv: k, klcv, hsht: hsht(k, klcv, config) };
}

/**
 * What blocks sending a review column (ERR-KPI-06, `ref` = the task / field): every live task has a
 * score in the column (`TASK_SCORE_REQUIRED` — a live task with no item counts as unscored), and
 * KLcv is set (`DISCIPLINE_REQUIRED`); every score on the scale; at MANAGER / FINAL, the column's Hsnv
 * and reason when its Hsht is below the threshold. No live task → `PLAN_EMPTY`. A score of 0 is a score.
 */
export function reviewSubmitIssues(
  column: EvaluationColumn,
  review: WorkReview,
  items: readonly WorkReviewItem[],
  tasks: readonly WeightedTask[],
  config: WorkScoring,
): RuleIssue[] {
  const live = liveTasks(tasks);
  if (live.length === 0) return [ruleIssue('ERR-KPI-06', null, 'PLAN_EMPTY')];
  const issues: RuleIssue[] = [];
  const byTask = new Map(items.map((i) => [i.taskId, i[ITEM_SCORE[column]]]));
  for (const t of live) {
    const score = byTask.get(t.id) ?? null;
    if (score === null) issues.push(ruleIssue('ERR-KPI-06', t.id, 'TASK_SCORE_REQUIRED'));
    else {
      const range = workScoreIssue(score, config, t.id);
      if (range) issues.push(range);
    }
  }
  const klcv = review[DISCIPLINE[column]];
  if (klcv === null) issues.push(ruleIssue('ERR-KPI-06', DISCIPLINE[column], 'DISCIPLINE_REQUIRED'));
  else {
    const range = workScoreIssue(klcv, config, DISCIPLINE[column]);
    if (range) issues.push(range);
  }
  if (column !== 'SELF' && issues.length === 0) {
    const [hsnvField, reasonField] = HSNV[column];
    const { hsht: h } = columnTotals(column, review, items, tasks, config);
    issues.push(
      ...hsnvIssues(h, review[hsnvField], review[reasonField], config).map((i) => ({ ...i, ref: i.ref === 'hsnv' ? hsnvField : reasonField })),
    );
  }
  return issues;
}

// ─── The month's result ────────────────────────────────────────────────────────────────────────

export interface WorkResultScores {
  kqcv: number | null;
  klcv: number | null;
  hsht: number | null;
  hsnv: number | null;
  hsnvReason: string | null;
  finalScore: number | null;
}

/**
 * The month's result from the FINAL column — what a `WorkResult` stores. Hsnv (and its reason) is
 * kept only when Hsht requires it: a draft Hsnv left on the review after a rescoring lifted Hsht is
 * not part of the result (it stays on the review row). Hsnv may be above Hsht — it is the manager's
 * decision (`ASSUMPTION Q61`). A required Hsnv still missing → `finalScore` null: not recordable.
 */
export function workResultOf(review: WorkReview, items: readonly WorkReviewItem[], tasks: readonly WeightedTask[], config: WorkScoring): WorkResultScores {
  const { kqcv: k, klcv, hsht: h } = columnTotals('FINAL', review, items, tasks, config);
  const required = hsnvRequired(h, config);
  return {
    kqcv: k,
    klcv,
    hsht: h,
    hsnv: required ? review.finalHsnv : null,
    hsnvReason: required ? review.finalHsnvReason : null,
    finalScore: finalWorkScore(h, review.finalHsnv, config),
  };
}

// ─── The WORK_PLAN form (step 8.2) ─────────────────────────────────────────────────────────────

/**
 * The plan's status when its WORK_PLAN form ENTERS step `stepNo` — `goalPlanRules.planStatusOnEnterStep`
 * with `Approved` folded into `Submitted`: a work plan has no Approved, the approval IS the lock
 * (`WORK_PLAN_STATUS_ON_COMPLETE`). Up to the employee's step → Draft (Returned via RETURN); after it →
 * Submitted. Bottom-up (employee → manager): Draft, Submitted. Top-down (manager → employee → manager):
 * Draft, Draft, Submitted.
 */
export function workPlanStatusOnEnterStep(
  stepNo: number,
  steps: readonly Pick<WorkflowStep, 'stepNo' | 'actorRule'>[],
  viaReturn: boolean,
): WorkPlanStatus {
  const status = planStatusOnEnterStep(stepNo, steps, viaReturn);
  return status === 'Approved' ? 'Submitted' : status;
}

/** The manager's final approval locks the month's plan. */
export const WORK_PLAN_STATUS_ON_COMPLETE: WorkPlanStatus = 'Locked';
/** HR cancelling the WORK_PLAN form puts the plan back to Draft; its tasks stay (a relaunch reuses it). */
export const WORK_PLAN_STATUS_ON_CANCEL: WorkPlanStatus = 'Draft';

/** A task as "Sao chép tháng trước" reads it. */
export type CopiedTaskSource = Pick<
  WorkTask,
  'name' | 'product' | 'description' | 'unitText' | 'weight' | 'visibility' | 'linkedGoalId' | 'progressStatus' | 'cancelledAt'
>;

const sameTask = (a: Pick<WorkTask, 'name' | 'product'>, b: Pick<WorkTask, 'name' | 'product'>) =>
  a.name.trim().toLowerCase() === b.name.trim().toLowerCase() && (a.product ?? '').trim().toLowerCase() === (b.product ?? '').trim().toLowerCase();

/**
 * "Sao chép tháng trước" (plan §6): last month's tasks not cancelled and not `Done`, as new tasks of
 * `period` — name, product, description, unit, weight and visibility kept; dates = the month; progress
 * starts over (the gateway inserts 0 / NotStarted). A task already in the list (same name and
 * product) is skipped, so a second click adds nothing. A KPI link is kept only inside the same cycle
 * (`linkedGoalIssues` would refuse it in another). Weights are copied as they are: the total shows.
 */
export function copyFromPreviousMonth(
  previous: readonly CopiedTaskSource[],
  current: readonly Pick<WorkTask, 'name' | 'product'>[],
  period: Pick<CyclePeriod, 'startDate' | 'endDate'>,
  sameCycle: boolean,
): { tasks: Omit<WorkTaskInputShape, 'id'>[]; skipped: number } {
  const open = previous.filter((t) => t.cancelledAt === null && t.progressStatus !== 'Done');
  const tasks: Omit<WorkTaskInputShape, 'id'>[] = [];
  let skipped = 0;
  for (const t of open) {
    if (current.some((c) => sameTask(c, t)) || tasks.some((c) => sameTask(c, t))) {
      skipped += 1;
      continue;
    }
    tasks.push({
      name: t.name,
      product: t.product,
      description: t.description,
      unitText: t.unitText,
      weight: t.weight,
      startDate: period.startDate,
      dueDate: period.endDate,
      visibility: t.visibility,
      linkedGoalId: sameCycle ? t.linkedGoalId : null,
    });
  }
  return { tasks, skipped };
}

/** The fields a person types for a task — `WorkTaskInput` without the import from the contract. */
export type WorkTaskInputShape = Pick<
  WorkTask,
  'name' | 'product' | 'description' | 'unitText' | 'weight' | 'startDate' | 'dueDate' | 'visibility' | 'linkedGoalId'
> & { id?: Id };

type MonthPeriod = Pick<CyclePeriod, 'id' | 'periodType' | 'startDate' | 'endDate'>;
const months = <P extends MonthPeriod>(periods: readonly P[]) =>
  periods.filter((p) => p.periodType === 'Month').sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));

/** The month before `period` — the Month period that starts last before it, in any cycle; `null` for the first. */
export function previousMonth<P extends MonthPeriod>(periods: readonly P[], period: Pick<CyclePeriod, 'startDate'>): P | null {
  const before = months(periods).filter((p) => p.startDate < period.startDate);
  return before.at(-1) ?? null;
}

/** The month a monthly-work screen opens on: the one containing today, else the last started, else the first. */
export function defaultWorkMonth<P extends MonthPeriod>(periods: readonly P[], today: string): P | null {
  const list = months(periods);
  return list.find((p) => p.startDate <= today && today <= p.endDate) ?? list.filter((p) => p.startDate <= today).at(-1) ?? list[0] ?? null;
}

/**
 * The month's progress — Σ % complete × effective weight / 100 over the live tasks (cancelled ones drop
 * out and the rest are normalised, like KQcv). Tracking only, never a score. No live task → `null`.
 */
export function weightedProgress(tasks: readonly (WeightedTask & { progressPct: number })[]): number | null {
  const weights = effectiveWeights(tasks);
  if (weights.length === 0) return null;
  const pct = new Map(tasks.map((t) => [t.id, t.progressPct]));
  return weights.reduce((sum, w) => sum + (pct.get(w.taskId) ?? 0) * w.weight, 0) / 100;
}

/**
 * Keeps a progress edit consistent (`progressIssues`): picking `Done` sets 100%, `NotStarted` 0%;
 * typing a % moves `Done` / `NotStarted` to `InProgress` when it no longer fits, and 100% / 0% on an
 * `InProgress` task stays as typed (the person decides whether it is done).
 */
export function followProgress(
  current: { progressPct: number; progressStatus: Exclude<WorkTaskStatus, 'Cancelled'> },
  change: { progressPct: number } | { progressStatus: Exclude<WorkTaskStatus, 'Cancelled'> },
): { progressPct: number; progressStatus: Exclude<WorkTaskStatus, 'Cancelled'> } {
  if ('progressStatus' in change) {
    const s = change.progressStatus;
    return { progressStatus: s, progressPct: s === 'Done' ? 100 : s === 'NotStarted' ? 0 : current.progressPct };
  }
  const pct = change.progressPct;
  const fits = (current.progressStatus === 'Done' && pct === 100) || (current.progressStatus === 'NotStarted' && pct === 0) || current.progressStatus === 'InProgress';
  return { progressPct: pct, progressStatus: fits ? current.progressStatus : 'InProgress' };
}

/**
 * The form a month's plan is worked on: the latest one not cancelled (HR may cancel and relaunch),
 * else the latest cancelled one (to show why), else `null`.
 */
export function currentMonthForm<F extends { status: string; launchedAt: string }>(forms: readonly F[]): F | null {
  const newest = [...forms].sort((a, b) => (a.launchedAt < b.launchedAt ? 1 : a.launchedAt > b.launchedAt ? -1 : 0));
  return newest.find((f) => f.status !== 'Cancelled') ?? newest[0] ?? null;
}
