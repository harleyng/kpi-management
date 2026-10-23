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
 * A task's link to a KPI (`linkedGoalId`, Q63) never touches the score.
 */

import type { Id } from '@/data/types';
import { ruleIssue, type RuleIssue } from './errorCatalog';
import { isWeightComplete } from './goalPlanRules';

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
