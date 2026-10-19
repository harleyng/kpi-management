/**
 * Weighted score, adjustment, rounding and roll-up — BR-KPI-35, 36, 40; WBS 4.6.2.
 *
 * A goal without an achievement (no actual, not computable, or not yet scored on the form) is
 * MISSING: it is left out of both sums of the provisional score and marks the result incomplete —
 * it is never scored as 0 and never silently dropped. A result can be finalised only when complete.
 */

import type { Aggregation, GoalStatus, Id } from '@/data/types';
import { ruleIssue, type RuleIssue } from './errorCatalog';
import { weightIssue } from './goalPlanRules';

export interface ScoreLine {
  goalId: Id;
  weight: number;
  status: GoalStatus;
  /** The achievement % (`calcRules.achievementPct`, or the form's column); `null` = missing. */
  achievementPct: number | null;
}

export interface WeightedScore {
  /** Σ(a × w) / Σw over the scored active goals — PROVISIONAL unless `complete`; `null` when none is scored. */
  score: number | null;
  scoredWeight: number;
  /** Σw over every active goal. */
  totalWeight: number;
  /** Every active goal has an achievement. */
  complete: boolean;
  missingGoalIds: Id[];
}

const scored = (line: ScoreLine): line is ScoreLine & { achievementPct: number } =>
  line.achievementPct !== null && Number.isFinite(line.achievementPct);

/** BR-KPI-35 — over ACTIVE goals only (Changed and Cancelled carry no weight). */
export function weightedScore(lines: readonly ScoreLine[]): WeightedScore {
  const active = lines.filter((l) => l.status === 'Active');
  const done = active.filter(scored);
  const scoredWeight = done.reduce((sum, l) => sum + l.weight, 0);
  const totalWeight = active.reduce((sum, l) => sum + l.weight, 0);
  const missingGoalIds = active.filter((l) => !scored(l)).map((l) => l.goalId);
  return {
    score: scoredWeight > 0 ? done.reduce((sum, l) => sum + l.achievementPct * l.weight, 0) / scoredWeight : null,
    scoredWeight,
    totalWeight,
    complete: active.length > 0 && missingGoalIds.length === 0,
    missingGoalIds,
  };
}

/** `ResultDetail.weightedScore` — the points one goal contributes when the weights sum to 100. */
export function lineWeightedScore(achievementPct: number | null, weight: number): number | null {
  return achievementPct === null ? null : (achievementPct * weight) / 100;
}

/**
 * What blocks finalising a period result (BR-KPI-43): an unscored goal (ERR-KPI-09, one per goal) or
 * weights that are not 100% (ERR-KPI-07). A provisional score must never reach payroll.
 */
export function finalizeIssues(lines: readonly ScoreLine[]): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const weight = weightIssue(lines);
  if (weight) issues.push(weight);
  const { missingGoalIds, complete } = weightedScore(lines);
  for (const goalId of missingGoalIds) issues.push(ruleIssue('ERR-KPI-09', goalId, 'NOT_SCORED'));
  if (!complete && missingGoalIds.length === 0) issues.push(ruleIssue('ERR-KPI-09', null, 'NO_GOALS'));
  return issues;
}

export const canFinalize = (lines: readonly ScoreLine[]): boolean => finalizeIssues(lines).length === 0;

/**
 * BR-KPI-40 — the adjustment (violations, attendance) is ADDED in points on the score scale, positive
 * or negative; the result never goes below 0.
 */
export function adjustedScore(totalScore: number | null, adjustmentPct: number): number | null {
  if (totalScore === null || !Number.isFinite(totalScore) || !Number.isFinite(adjustmentPct)) return null;
  return Math.max(0, totalScore + adjustmentPct);
}

/**
 * Two decimals, half away from zero — done ONCE, when a result is finalised (BR-KPI-35). Shifting
 * the decimal point through the string form avoids `Math.round(x * 100)`'s float error
 * (1.005 * 100 = 100.49999…).
 */
export function roundScore(value: number): number {
  if (!Number.isFinite(value)) return value;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const text = String(abs);
  if (text.includes('e')) return abs < 1 ? 0 : value; // < 1e-6 rounds to 0; ≥ 1e21 has no decimals
  const rounded = Number(`${Math.round(Number(`${text}e2`))}e-2`);
  return rounded === 0 ? 0 : sign * rounded;
}

/** The score a rating reads (BR-KPI-41): the finalised total, adjusted, rounded once. */
export function ratedScore(totalScore: number | null, adjustmentPct: number): number | null {
  const adjusted = adjustedScore(totalScore, adjustmentPct);
  return adjusted === null ? null : roundScore(adjusted);
}

/** How a stored result's score is made up, for the screens (T6 4.6.2). */
export interface ScoreBreakdown {
  /** The weighted score of the result's goal lines, before the adjustment; `null` when none is scored. */
  raw: number | null;
  /** Every goal has an achievement — otherwise `raw` is provisional. */
  complete: boolean;
  totalWeight: number;
  /** Points, as stored. */
  adjustment: number;
  /** `PeriodResult.totalScore` AS STORED (adjusted; rounded once if Final / Locked) — never re-derived. */
  total: number | null;
  /** The adjustment took the score below 0, so the total was held at 0 (BR-KPI-40). */
  clamped: boolean;
}

/**
 * BR-KPI-40 — the parts of a stored result side by side. `total` is NOT `raw + adjustment`: the 0 floor
 * and the one-time rounding sit between them, so a screen shows the three numbers and never sums them.
 */
export function scoreBreakdown(
  result: { totalScore: number | null; adjustmentPct: number },
  details: readonly { goalId: Id; weight: number; achievementPct: number | null }[],
): ScoreBreakdown {
  const score = weightedScore(details.map((d) => ({ ...d, status: 'Active' as const })));
  return {
    raw: score.score,
    complete: score.complete,
    totalWeight: score.totalWeight,
    adjustment: result.adjustmentPct,
    total: result.totalScore,
    clamped: score.score !== null && score.score + result.adjustmentPct < 0,
  };
}

/**
 * BR-KPI-36, `ASSUMPTION Q8` — a parent KPI flagged `rollUpFromChildren` takes the SUM of its CASCADE
 * children's current actuals. Any child without an actual (or no children at all) → no actual.
 */
export function rollUpActual(childActuals: readonly (number | null)[]): number | null {
  if (childActuals.length === 0 || childActuals.some((v) => v === null)) return null;
  return (childActuals as number[]).reduce((sum, v) => sum + v, 0);
}

/**
 * Period actuals added up to a longer period (ERD `KPI_DEFINITION.aggregation`), in period order:
 * SUM and AVG need every period; LAST is the last period's value. A missing period → no actual.
 */
export function aggregatePeriodActuals(values: readonly (number | null)[], aggregation: Aggregation): number | null {
  if (values.length === 0) return null;
  if (aggregation === 'LAST') return values[values.length - 1];
  if (values.some((v) => v === null)) return null;
  const sum = (values as number[]).reduce((s, v) => s + v, 0);
  return aggregation === 'SUM' ? sum : sum / values.length;
}
