/**
 * What the result screens (T6) show for a stored `PeriodResult` — who it is for, where they sit, its
 * rating and why a cell is empty. Display mapping over rows a screen already has; every number comes
 * from the stored result or from `*Rules.ts`, never from here.
 */

import type { CyclePeriod, Employee, EmployeeAssignment, GoalPlan, Id, OrgUnit, PeriodResult, PeriodResultStatus, RatingLevel } from '@/data/types';
import { PERIOD_RESULT_STATUSES } from '@/data/types';
import { payoutNote } from './payrollRules';
import { subjectAssignment } from './resultRules';
import { formatNumber } from './utils';

/** Why the "% hưởng lương KPI" cell shows what it shows. */
export type PayoutState =
  | { kind: 'value'; pct: number }
  /** Company / OrgUnit results are rated but carry no payout (BR-KPI-40). */
  | { kind: 'notApplicable' }
  /** Not rated yet: a goal unscored or weights not 100% (a Draft), or no level matched. */
  | { kind: 'notRated' }
  /** Rated, but no payout rule in force (BR-KPI-42 "chưa có quy tắc", ASSUMPTION Q20). */
  | { kind: 'noRule' }
  /** The rating level the result names no longer exists. */
  | { kind: 'levelMissing' };

export function payoutState(result: Pick<PeriodResult, 'ownerType' | 'payoutPct' | 'ratingLevelId'>, levels: readonly Pick<RatingLevel, 'id'>[]): PayoutState {
  if (result.ownerType !== 'Employee') return { kind: 'notApplicable' };
  if (result.payoutPct !== null) return { kind: 'value', pct: result.payoutPct };
  const note = payoutNote(result, levels);
  return note === 'NOT_RATED' ? { kind: 'notRated' } : note === 'LEVEL_MISSING' ? { kind: 'levelMissing' } : { kind: 'noRule' };
}

export interface ResultRow {
  result: PeriodResult;
  /** The person, the unit, or the company. */
  ownerName: string;
  ownerCode: string | null;
  /** An employee's unit on their last working day in the period (`subjectAssignment`); `null` for a unit / company plan. */
  unitName: string | null;
  level: RatingLevel | null;
}

export interface ResultRowInput {
  results: readonly PeriodResult[];
  plans: readonly GoalPlan[];
  employees: readonly Employee[];
  assignments: readonly EmployeeAssignment[];
  units: readonly OrgUnit[];
  levels: readonly RatingLevel[];
  period: Pick<CyclePeriod, 'endDate'>;
}

/** The fallback owner name when a row's owner cannot be found — never a blank cell. */
export const UNKNOWN_OWNER = 'Không xác định';

/** One display row per result: lookups built once (Maps), never per row. */
export function buildResultRows(input: ResultRowInput): ResultRow[] {
  const plans = new Map(input.plans.map((p) => [p.id, p]));
  const employees = new Map(input.employees.map((e) => [e.id, e]));
  const units = new Map(input.units.map((u) => [u.id, u]));
  const levels = new Map(input.levels.map((l) => [l.id, l]));
  const data = { Employee: input.employees, EmployeeAssignment: input.assignments };

  return input.results.map((result) => {
    const plan = plans.get(result.goalPlanId);
    const level = result.ratingLevelId === null ? null : (levels.get(result.ratingLevelId) ?? null);
    if (!plan) return { result, ownerName: UNKNOWN_OWNER, ownerCode: null, unitName: null, level };
    if (plan.ownerType === 'Employee') {
      const employee = plan.ownerEmployeeId ? employees.get(plan.ownerEmployeeId) : undefined;
      const assignment = subjectAssignment(plan, input.period, data);
      return {
        result,
        ownerName: employee?.fullName ?? UNKNOWN_OWNER,
        ownerCode: employee?.employeeCode ?? null,
        unitName: assignment ? (units.get(assignment.orgUnitId)?.name ?? null) : null,
        level,
      };
    }
    const unit = plan.ownerOrgUnitId ? units.get(plan.ownerOrgUnitId) : undefined;
    return {
      result,
      ownerName: unit?.name ?? UNKNOWN_OWNER,
      ownerCode: unit?.code ?? null,
      unitName: null, // the owner IS the unit (or the company): the name column already says it
      level,
    };
  });
}

/** How many results of each status — for the status line above the table. */
export function statusCounts(results: readonly Pick<PeriodResult, 'status'>[]): Record<PeriodResultStatus, number> {
  const counts = Object.fromEntries(PERIOD_RESULT_STATUSES.map((s) => [s, 0])) as Record<PeriodResultStatus, number>;
  for (const r of results) counts[r.status] += 1;
  return counts;
}

/**
 * Whether an employee may see the numbers of their own result: only once HR has finalised it. A
 * Draft is provisional and may still be adjusted, so "Kết quả của tôi" shows it without figures.
 */
export const isShownToEmployee = (result: Pick<PeriodResult, 'status'>): boolean => result.status !== 'Draft';

/** The Draft ids among `ids` that still exist — a selection after a refetch or a period change. */
export function draftSelection(selected: ReadonlySet<Id>, results: readonly Pick<PeriodResult, 'id' | 'status'>[]): Id[] {
  return results.filter((r) => r.status === 'Draft' && selected.has(r.id)).map((r) => r.id);
}

/** An adjustment in points with its sign — "+1", "−2,5", "0". */
export function formatPoints(points: number): string {
  if (points === 0) return '0';
  const text = formatNumber(Math.abs(points), 2);
  return points > 0 ? `+${text}` : `−${text}`;
}
