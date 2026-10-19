/**
 * Entering an actual — BR-KPI-10, 32, 43, 52, 56, 57. What `actuals.recordActual` refuses, what the
 * Excel import (WBS 4.4.3) checks on every row and what the API sync (4.4.5) checks on every
 * reading: the same rule answers all three.
 */

import type { CyclePeriod, Goal, GoalActual, GoalPlanStatus, Id, IsoDate, PeriodResult, SyncRunStatus } from '@/data/types';
import { ruleIssue, type IssueDetail, type RuleIssue } from './errorCatalog';

export { canRejectImport } from './importRules';

/** A plan takes actuals only once it is agreed (`ASSUMPTION Q21`). */
export const PLAN_STATUSES_TAKING_ACTUALS: readonly GoalPlanStatus[] = ['Approved', 'Locked'];

export interface ActualEntryInput {
  actual: { actualValue: number | null; actualText: string | null };
  goal: Pick<Goal, 'status' | 'targetType'>;
  /** The status of the goal's plan. */
  planStatus: GoalPlanStatus;
  /** The cycle of the goal's plan. */
  goalCycleId: Id;
  period: Pick<CyclePeriod, 'cycleId' | 'isLocked' | 'startDate' | 'periodType'>;
  /** A Final or Locked result exists for the goal's plan and this period (`isResultFinalised`). */
  resultsFinalised: boolean;
  /** Today in the tenant's zone (the gateway clock). */
  asOf: IsoDate;
}

/** The details `actualIssues` raises about the VALUE (the others are about the goal, plan or period). */
export const VALUE_ISSUES: readonly IssueDetail[] = ['ACTUAL_REQUIRED', 'ACTUAL_TYPE_MISMATCH'];

const blank = (text: string | null) => text === null || text.trim() === '';

/**
 * Why NOTHING can be entered for this goal and period, whatever the value — what the entry screen
 * shows before anyone types (most important first):
 * 1. the plan is not Approved / Locked → ERR-KPI-04 PLAN_NOT_APPROVED (`ASSUMPTION Q21`);
 * 2. the period is locked for actuals → 04 PERIOD_LOCKED;
 * 3. the plan's result for the period is already Final / Locked → 04 RESULT_FINAL (BR-KPI-43);
 * 4. the goal is not Active (Changed / Cancelled) → 06 GOAL_NOT_ACTIVE;
 * 5. the period belongs to another cycle → 06 PERIOD_NOT_IN_CYCLE;
 * 6. the period is a Quarter / Half / Year → 06 PERIOD_NOT_MONTH — actuals are monthly and a longer
 *    period adds its months up (`aggregatePeriodActuals`), so an own quarter actual can never
 *    silently override them (`ASSUMPTION Q22`);
 * 7. the period has not started → 06 PERIOD_NOT_STARTED (`ASSUMPTION Q18`).
 */
export function entryBlockers(input: Omit<ActualEntryInput, 'actual'>): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const { goal, period } = input;
  if (!PLAN_STATUSES_TAKING_ACTUALS.includes(input.planStatus)) issues.push(ruleIssue('ERR-KPI-04', 'goalId', 'PLAN_NOT_APPROVED'));
  if (period.isLocked) issues.push(ruleIssue('ERR-KPI-04', 'periodId', 'PERIOD_LOCKED'));
  if (input.resultsFinalised) issues.push(ruleIssue('ERR-KPI-04', 'periodId', 'RESULT_FINAL'));
  if (goal.status !== 'Active') issues.push(ruleIssue('ERR-KPI-06', 'goalId', 'GOAL_NOT_ACTIVE'));
  if (period.cycleId !== input.goalCycleId) issues.push(ruleIssue('ERR-KPI-06', 'periodId', 'PERIOD_NOT_IN_CYCLE'));
  if (period.periodType !== 'Month') issues.push(ruleIssue('ERR-KPI-06', 'periodId', 'PERIOD_NOT_MONTH'));
  if (period.startDate > input.asOf) issues.push(ruleIssue('ERR-KPI-06', 'periodId', 'PERIOD_NOT_STARTED'));
  return issues;
}

/**
 * Whether the value fits the goal: nothing entered → ERR-KPI-06 ACTUAL_REQUIRED (a missing actual is
 * never stored as 0, BR-KPI-32); a NUMERIC goal takes a finite number and no text, a TEXT goal
 * non-blank text and no number → 06 ACTUAL_TYPE_MISMATCH (BR-KPI-10). A negative number is accepted
 * (a loss against a profit target is a real result).
 */
export function valueIssues(actual: ActualEntryInput['actual'], goal: Pick<Goal, 'targetType'>): RuleIssue[] {
  const hasNumber = actual.actualValue !== null;
  const hasText = !blank(actual.actualText);
  if (!hasNumber && !hasText) return [ruleIssue('ERR-KPI-06', 'actual', 'ACTUAL_REQUIRED')];
  const fits =
    goal.targetType === 'NUMERIC'
      ? typeof actual.actualValue === 'number' && Number.isFinite(actual.actualValue) && !hasText
      : hasText && actual.actualValue === null;
  return fits ? [] : [ruleIssue('ERR-KPI-06', 'actual', 'ACTUAL_TYPE_MISMATCH', { targetType: goal.targetType })];
}

/** Every reason the actual cannot be recorded: `entryBlockers`, then `valueIssues`. */
export function actualIssues(input: ActualEntryInput): RuleIssue[] {
  return [...entryBlockers(input), ...valueIssues(input.actual, input.goal)];
}

/** Whether the plan's result for the period is Final or Locked (input of `entryBlockers`). */
export function isResultFinalised(results: readonly Pick<PeriodResult, 'goalPlanId' | 'periodId' | 'status'>[], goalPlanId: Id, periodId: Id): boolean {
  return results.some((r) => r.goalPlanId === goalPlanId && r.periodId === periodId && r.status !== 'Draft');
}

/** The current snapshot of (goal, period), if any (BR-KPI-52). */
export function currentActual<A extends Pick<GoalActual, 'goalId' | 'periodId' | 'isCurrent'>>(actuals: readonly A[], goalId: Id, periodId: Id): A | null {
  return actuals.find((a) => a.goalId === goalId && a.periodId === periodId && a.isCurrent) ?? null;
}

// ─── The API sync (WBS 4.4.5, BR-KPI-56) ─────────────────────────────────────────────────────────

/**
 * A sync never overwrites a number a person put there: when the current snapshot came from manual
 * entry or an Excel batch, the reading is skipped (`ASSUMPTION Q23`). Over its own earlier reading
 * (API) the latest wins.
 */
export function syncKeepsHumanActual(current: Pick<GoalActual, 'sourceType'> | null): boolean {
  return current !== null && current.sourceType !== 'API';
}

/**
 * The run's status from what it did: something loaded and nothing failed → Succeeded; loaded and
 * failed → PartiallyFailed; nothing loaded but something failed → Failed. Nothing loaded and nothing
 * failed is Succeeded when every goal was skipped (the people's numbers stand), else Failed (the run
 * found nothing to load at all).
 */
export function syncRunStatus(recordsOk: number, recordsError: number, recordsSkipped: number): SyncRunStatus {
  if (recordsOk > 0) return recordsError > 0 ? 'PartiallyFailed' : 'Succeeded';
  if (recordsError > 0) return 'Failed';
  return recordsSkipped > 0 ? 'Succeeded' : 'Failed';
}

// ─── Evidence (WBS 4.4.6, BR-KPI-57) ─────────────────────────────────────────────────────────────

/** An evidence link is an absolute http(s) URL with a host; it is stored, never fetched. */
export function isEvidenceUrl(url: string): boolean {
  const text = url.trim();
  if (text === '' || /\s/.test(text)) return false;
  try {
    const parsed = new URL(text);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== '';
  } catch {
    return false;
  }
}

/**
 * A connection's schedule, when it is the monthly shape P1 uses ("m h d * *": day d of every month at
 * h:m) — the screen words it; anything else is shown as written. No cron runs in P1 (`runSync` is
 * started by hand); the schedule documents what a real backend would do.
 */
export function monthlySchedule(cron: string | null): { day: number; hour: number; minute: number } | null {
  if (cron === null) return null;
  const m = /^(\d{1,2}) (\d{1,2}) (\d{1,2}) \* \*$/.exec(cron.trim());
  if (!m) return null;
  const [minute, hour, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return minute < 60 && hour < 24 && day >= 1 && day <= 31 ? { day, hour, minute } : null;
}
