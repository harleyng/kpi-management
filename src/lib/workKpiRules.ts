/**
 * "KPI tháng (tham khảo)" on the monthly work review (PEND-14, plan §7, D-W3): the employee's KPIs for the
 * month, read only — the actual, the month's target and the achievement % exactly as the Results page
 * computes them (`resultRules.actualLines`, `periodActual`, `periodTarget`). Never scored, never part of Hsht,
 * no weighted total (hr-performance-expert, B3). A missing number is `null`, never 0.
 *
 * Kept apart from `workRules` so the scoring rules do not depend on the KPI result rules.
 */

import type { CyclePeriod, Goal, Id } from '@/data/types';
import { monthTargetFromSplit, type NotComputableReason } from './calcRules';
import { actualLines, periodActual, periodTarget, type ActualContext } from './resultRules';

export interface MonthKpiLine {
  goalId: Id;
  name: string;
  actualValue: number | null;
  actualText: string | null;
  target: number | null;
  achievementPct: number | null;
  notComputable: NotComputableReason | null;
  /**
   * Where the month's target comes from: `MONTH` its own split; `DERIVED` the split of the quarter / half /
   * year holding it (ASSUMPTION Q67 — possibly `null`, not computable); `GOAL` the goal's own target (the
   * goal has no split at all).
   */
  targetSource: MonthTargetSource;
}

export type MonthTargetSource = 'MONTH' | 'DERIVED' | 'GOAL';

function targetSourceOf(goal: Goal, period: CyclePeriod, ctx: ActualContext): MonthTargetSource {
  if (ctx.periodTargets.some((t) => t.goalId === goal.id && t.periodId === period.id)) return 'MONTH';
  const aggregation = ctx.kpiDefinitions.find((k) => k.id === goal.kpiDefId)?.aggregation ?? null;
  return monthTargetFromSplit(goal, ctx.periodTargets, period.id, { periods: ctx.periods, aggregation }) === undefined ? 'GOAL' : 'DERIVED';
}

/** One line per Active goal of the plan, in its order. */
export function monthKpiReference(goals: readonly Goal[], period: CyclePeriod, ctx: ActualContext): MonthKpiLine[] {
  const active = goals.filter((g) => g.status === 'Active').sort((a, b) => a.sortOrder - b.sortOrder);
  const lines = new Map(actualLines(active, { ...ctx, period }).map((l) => [l.goalId, l]));
  return active.map((goal) => {
    const actual = periodActual(goal, period, { ...ctx, period });
    const line = lines.get(goal.id);
    return {
      goalId: goal.id,
      name: goal.name,
      actualValue: actual?.actualValue ?? null,
      actualText: actual?.actualText ?? null,
      target: periodTarget(goal, period, ctx),
      achievementPct: line?.achievementPct ?? null,
      notComputable: line?.notComputable ?? null,
      targetSource: targetSourceOf(goal, period, { ...ctx, period }),
    };
  });
}
