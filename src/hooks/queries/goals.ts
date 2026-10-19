import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/contexts/useSession';
import type { Id } from '@/data/types';
import { getDataGateway } from '@/integrations/data';
import type { GoalFilter, GoalPlanFilter } from '@/integrations/data/types';
import { queryKey } from './keys';

/**
 * G3 · Kế hoạch mục tiêu — the READS Track T4 needs (cycles, periods, plans, goals, month splits).
 * Track T3 owns this file: it adds the writes and may reshape these when it merges first (plan §6.3,
 * merge order T3 → T4) — the names and filter types follow the contract so the two meet cleanly.
 */

export const cyclesKey = (tenantId: string) => queryKey(tenantId, 'cycles', 'list');
export function useCycles() {
  const { tenantId } = useSession();
  return useQuery({ queryKey: cyclesKey(tenantId), queryFn: () => getDataGateway().goals.listCycles(tenantId) });
}

export const periodsKey = (tenantId: string, cycleId: Id | null) => queryKey(tenantId, 'cycles', 'periods', cycleId);
export function usePeriods(cycleId: Id | null) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: periodsKey(tenantId, cycleId),
    queryFn: () => getDataGateway().goals.listPeriods(tenantId, cycleId as Id),
    enabled: cycleId !== null,
  });
}

export const goalPlansKey = (tenantId: string, filter: GoalPlanFilter) => queryKey(tenantId, 'goalPlans', filter);
export function useGoalPlans(filter: GoalPlanFilter, options: { enabled?: boolean } = {}) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: goalPlansKey(tenantId, filter),
    queryFn: () => getDataGateway().goals.listGoalPlans(tenantId, filter),
    enabled: options.enabled ?? true,
  });
}

export const goalsKey = (tenantId: string, filter: GoalFilter) => queryKey(tenantId, 'goals', 'list', filter);
export function useGoals(filter: GoalFilter, options: { enabled?: boolean } = {}) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: goalsKey(tenantId, filter),
    queryFn: () => getDataGateway().goals.listGoals(tenantId, filter),
    enabled: options.enabled ?? true,
  });
}

/** The month splits of the plans' goals (BR-KPI-11). */
export const periodTargetsKey = (tenantId: string, goalPlanId: Id | null) => queryKey(tenantId, 'goals', 'periodTargets', goalPlanId);
export function usePeriodTargetsOfPlan(goalPlanId: Id | null) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: periodTargetsKey(tenantId, goalPlanId),
    queryFn: () => getDataGateway().goals.listPeriodTargets(tenantId, { goalPlanId: goalPlanId as Id }),
    enabled: goalPlanId !== null,
  });
}

/** The month splits of a list of goals — the id list sorted, so the key does not depend on order. */
export const goalsPeriodTargetsKey = (tenantId: string, goalIds: readonly Id[]) => queryKey(tenantId, 'goals', 'periodTargetsOf', [...goalIds].sort());
export function usePeriodTargets(goalIds: readonly Id[] | null) {
  const { tenantId } = useSession();
  const ids = goalIds ? [...goalIds].sort() : [];
  return useQuery({
    queryKey: goalsPeriodTargetsKey(tenantId, ids),
    queryFn: () => getDataGateway().goals.listPeriodTargets(tenantId, { goalIds: ids }),
    enabled: goalIds !== null,
  });
}
