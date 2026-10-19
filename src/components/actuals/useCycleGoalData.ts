import { useMemo } from 'react';
import type { Id } from '@/data/types';
import { useDataSources } from '@/hooks/queries/actuals';
import { useGoalPlans, useGoals, usePeriodTargets } from '@/hooks/queries/goals';
import { useKpiDefinitions, useMeasureUnits } from '@/hooks/queries/library';
import { useAssignments, useEmployees, useOrgUnits, useUserAccounts } from '@/hooks/queries/org';
import { combineQueries } from '@/lib/queryState';

/**
 * Everything the actuals screens read about a cycle's goals — plans, goals, their month splits, the
 * people and units they belong to, sources, units of measure, logins and KPI codes — with ONE
 * combined state, so a screen shows one skeleton or one error for all of it. No arithmetic here.
 * Goals come through `useGoals`, so a PRIVATE goal the viewer may not see never reaches a list (D2).
 */
export function useCycleGoalData(cycleId: Id | null) {
  const plans = useGoalPlans({ cycleId: cycleId ?? undefined }, { enabled: cycleId !== null });
  const planIds = useMemo(() => (plans.data ? plans.data.map((p) => p.id).sort() : null), [plans.data]);
  const goals = useGoals({ goalPlanIds: planIds ?? [] }, plans.data, { enabled: planIds !== null });
  const goalIds = useMemo(() => (goals.data ? goals.data.goals.map((g) => g.id) : null), [goals.data]);
  const periodTargets = usePeriodTargets(goalIds ? { goalIds } : null);
  const employees = useEmployees({ includeResigned: true });
  const assignments = useAssignments();
  const orgUnits = useOrgUnits();
  const dataSources = useDataSources();
  const units = useMeasureUnits();
  const users = useUserAccounts();
  const kpiDefinitions = useKpiDefinitions();
  const all = [plans, goals, periodTargets, employees, assignments, orgUnits, dataSources, units, users, kpiDefinitions];
  const data =
    plans.data && goals.data && periodTargets.data && employees.data && assignments.data && orgUnits.data && dataSources.data && units.data && users.data && kpiDefinitions.data
      ? {
          plans: plans.data,
          goals: goals.data.goals,
          periodTargets: periodTargets.data,
          employees: employees.data,
          assignments: assignments.data,
          orgUnits: orgUnits.data,
          dataSources: dataSources.data,
          units: units.data,
          users: users.data,
          kpiDefinitions: kpiDefinitions.data,
        }
      : undefined;
  return { data, query: combineQueries(all) };
}
