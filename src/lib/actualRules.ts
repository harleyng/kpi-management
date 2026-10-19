/**
 * Entering an actual — BR-KPI-10, 32, 43, 52. What `actuals.recordActual` refuses, and what the
 * Excel import (T4, WBS 4.4.3) checks on every row: the same rule answers both.
 */

import type { CyclePeriod, Goal, Id, IsoDate, PeriodResult } from '@/data/types';
import { ruleIssue, type RuleIssue } from './errorCatalog';

export interface ActualEntryInput {
  actual: { actualValue: number | null; actualText: string | null };
  goal: Pick<Goal, 'status' | 'targetType'>;
  /** The cycle of the goal's plan. */
  goalCycleId: Id;
  period: Pick<CyclePeriod, 'cycleId' | 'isLocked' | 'startDate'>;
  /** A Final or Locked result exists for the goal's plan and this period (`isResultFinalised`). */
  resultsFinalised: boolean;
  /** Today in the tenant's zone (the gateway clock). */
  asOf: IsoDate;
}

const blank = (text: string | null) => text === null || text.trim() === '';

/**
 * Every reason the actual cannot be recorded, most important first:
 * 1. the period is locked for actuals → ERR-KPI-04 PERIOD_LOCKED;
 * 2. the plan's result for the period is already Final / Locked → ERR-KPI-04 RESULT_FINAL (a
 *    finalised score never changes under it, BR-KPI-43);
 * 3. the goal is not Active (Changed / Cancelled) → ERR-KPI-06 GOAL_NOT_ACTIVE;
 * 4. the period belongs to another cycle → ERR-KPI-06 PERIOD_NOT_IN_CYCLE;
 * 5. nothing entered → ERR-KPI-06 ACTUAL_REQUIRED (a missing actual is never stored as 0, BR-KPI-32);
 *    the wrong kind for the goal's target type — a NUMERIC goal takes a finite number and no text, a
 *    TEXT goal non-blank text and no number → ERR-KPI-06 ACTUAL_TYPE_MISMATCH (BR-KPI-10);
 * 6. the period has not started yet → ERR-KPI-06 PERIOD_NOT_STARTED (`ASSUMPTION Q18`: no actual
 *    before its period begins).
 * A negative number is accepted (a loss against a profit target is a real result).
 */
export function actualIssues(input: ActualEntryInput): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const { actual, goal, period } = input;
  if (period.isLocked) issues.push(ruleIssue('ERR-KPI-04', null, 'PERIOD_LOCKED'));
  if (input.resultsFinalised) issues.push(ruleIssue('ERR-KPI-04', null, 'RESULT_FINAL'));
  if (goal.status !== 'Active') issues.push(ruleIssue('ERR-KPI-06', 'goalId', 'GOAL_NOT_ACTIVE'));
  if (period.cycleId !== input.goalCycleId) issues.push(ruleIssue('ERR-KPI-06', 'periodId', 'PERIOD_NOT_IN_CYCLE'));

  const hasNumber = actual.actualValue !== null;
  const hasText = !blank(actual.actualText);
  if (!hasNumber && !hasText) {
    issues.push(ruleIssue('ERR-KPI-06', 'actual', 'ACTUAL_REQUIRED'));
  } else {
    const fits =
      goal.targetType === 'NUMERIC'
        ? typeof actual.actualValue === 'number' && Number.isFinite(actual.actualValue) && actual.actualText === null
        : hasText && actual.actualValue === null;
    if (!fits) issues.push(ruleIssue('ERR-KPI-06', 'actual', 'ACTUAL_TYPE_MISMATCH', { targetType: goal.targetType }));
  }

  if (period.startDate > input.asOf) issues.push(ruleIssue('ERR-KPI-06', 'periodId', 'PERIOD_NOT_STARTED'));
  return issues;
}

/** Whether the plan's result for the period is Final or Locked (input 2 of `actualIssues`). */
export function isResultFinalised(results: readonly Pick<PeriodResult, 'goalPlanId' | 'periodId' | 'status'>[], goalPlanId: Id, periodId: Id): boolean {
  return results.some((r) => r.goalPlanId === goalPlanId && r.periodId === periodId && r.status !== 'Draft');
}
