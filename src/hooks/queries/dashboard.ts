import { useMemo } from 'react';
import { useSession } from '@/contexts/useSession';
import type { CyclePeriod, GoalPlan, PerformanceCycle, PeriodResult } from '@/data/types';
import {
  buildDashboard,
  goalAttention,
  operationsReport,
  perspectiveBreakdown,
  type DashboardData,
  type DashboardModel,
} from '@/lib/dashboardRules';
import { combineQueries, type QueryState } from '@/lib/queryState';
import { useFormList, useWorkflowSteps } from './forms';
import { useGoalPlans, useGoalRows, useGoals } from './goals';
import { usePerspectives } from './library';
import { useAssignments, useEmployees, useOrgUnits } from './org';
import { useRatingLevels, useResultDetails } from './results';
import { useGatewayClock } from './session';

/**
 * The live dashboard's reads (WBS 4.7.1–4.7.3, Phase 3). It composes the hooks the other screens use —
 * the same query keys, so the dashboard and T5 / T6 screens share one cache and refresh together on
 * every `entity.changed` — and hands the rows to `src/lib/dashboardRules.ts`, which decides every number.
 *
 * A read that failed makes the whole model unavailable (an error with "Thử lại"), never zeros: a missing
 * assignments list would otherwise show "0 nhân viên" as if it were true.
 */

/** What the dashboard reads the selected cycle and period from (`components/dashboard/useDashboardSelection`). */
export interface DashboardSelection {
  cycle: PerformanceCycle | null;
  period: CyclePeriod | null;
  periods: CyclePeriod[] | undefined;
  /** Results of every period of the cycle (the trend, the difference with the previous period). */
  cycleResults: PeriodResult[] | undefined;
  query: QueryState;
}

export interface DashboardRead {
  data: DashboardData | undefined;
  model: DashboardModel | null | undefined;
  query: QueryState;
}

/** Everything the "Tổng quan" tab needs for the selected period, in the viewer's scope (`buildDashboard`). */
export function useDashboardModel(selection: DashboardSelection): DashboardRead {
  const { tenantId, access } = useSession();
  const { cycle, period, periods, cycleResults } = selection;
  const plans = useGoalPlans({ cycleId: cycle?.id }, { enabled: cycle !== null });
  const units = useOrgUnits();
  const employees = useEmployees({ includeResigned: true });
  const assignments = useAssignments();
  const levels = useRatingLevels(cycle?.ratingScaleId ?? null);
  const needsLevels = (cycle?.ratingScaleId ?? null) !== null;

  const data = useMemo<DashboardData | undefined>(() => {
    if (!periods || !cycleResults || !plans.data || !units.data || !employees.data || !assignments.data || (needsLevels && !levels.data)) return undefined;
    return {
      tenantId,
      periods,
      results: cycleResults,
      plans: plans.data,
      units: units.data,
      employees: employees.data,
      assignments: assignments.data,
      levels: levels.data ?? [],
      access,
    };
  }, [tenantId, access, periods, cycleResults, plans.data, units.data, employees.data, assignments.data, levels.data, needsLevels]);

  const model = useMemo(() => (data && period ? buildDashboard(data, period.id) : data ? null : undefined), [data, period]);
  return { data, model, query: combineQueries([selection.query, plans, units, employees, assignments, ...(needsLevels ? [levels] : [])]) };
}

/**
 * One stored result's goal lines, for the selected unit's side panels: the BSC breakdown (numbers of
 * every line) and "Chỉ tiêu cần chú ý" (names only for goals the viewer may see — D2, BR-KPI-08).
 */
export function useResultLines(result: PeriodResult | null, plan: GoalPlan | null) {
  const details = useResultDetails(result?.id ?? null);
  const filter = { goalPlanIds: plan ? [plan.id] : [] };
  const rows = useGoalRows(filter, { enabled: plan !== null && result !== null });
  const visible = useGoals(filter, plan ? [plan] : undefined, { enabled: plan !== null && result !== null });
  const perspectives = usePerspectives();
  const query = combineQueries([details, rows, visible, perspectives]);
  const view = useMemo(() => {
    if (!result || !details.data || !rows.data || !visible.data || !perspectives.data) return undefined;
    const order = [...perspectives.data].sort((a, b) => a.sortOrder - b.sortOrder);
    return {
      attention: goalAttention(details.data, visible.data.goals),
      perspectives: perspectiveBreakdown(details.data, rows.data, order.map((p) => p.id)),
      perspectiveNames: new Map(order.map((p) => [p.id, p.name])),
    };
  }, [result, details.data, rows.data, visible.data, perspectives.data]);
  return { view, query };
}

/**
 * The "Vận hành" report (WBS 4.7.3): registration progress of the cycle, the period's evaluation
 * forms and results — all in the viewer's scope (BR-KPI-88).
 */
export function useOperationsReport(selection: DashboardSelection, read: DashboardRead) {
  const clock = useGatewayClock();
  const { cycle, period } = selection;
  const evalForms = useFormList({ formType: 'KPI_EVAL', periodId: period?.id }, { enabled: period !== null });
  const regForms = useFormList({ formType: 'GOAL_SETTING' }, { enabled: cycle !== null });
  const steps = useWorkflowSteps();
  const now = clock.now;
  const report = useMemo(() => {
    const { data, model } = read;
    if (!data || !model || !evalForms.data || !regForms.data || !steps.data) return undefined;
    return operationsReport({ data, model, evaluationForms: evalForms.data, registrationForms: regForms.data, steps: steps.data, clock: { now, tz: clock.tz } });
  }, [read, evalForms.data, regForms.data, steps.data, now, clock.tz]);
  return { report, query: combineQueries([read.query, evalForms, regForms, steps]) };
}
