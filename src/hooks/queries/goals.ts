import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/contexts/useSession';
import type { Id } from '@/data/types';
import { getDataGateway } from '@/integrations/data';
import type { GoalFilter, GoalPlanFilter } from '@/integrations/data/types';
import { queryKey } from './keys';

/**
 * G3 · Kế hoạch mục tiêu — READS ONLY, added by T6 for the result screens. Track T3 owns this domain
 * and appends its writes below (merge-time reconciliation; T6 merges last, plan §6.3).
 * Keys are `[tenantId, root, ...params]` (CLAUDE.md rule 7).
 */

const CYCLE_STALE_MS = 5 * 60 * 1000;

export const cyclesKey = (tenantId: string) => queryKey(tenantId, 'cycles', 'list');

export function useCycles() {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: cyclesKey(tenantId),
    queryFn: () => getDataGateway().goals.listCycles(tenantId),
    staleTime: CYCLE_STALE_MS,
  });
}

export const periodsKey = (tenantId: string, cycleId: Id | null) => queryKey(tenantId, 'cycles', 'periods', cycleId);

/** Disabled until a cycle is chosen. */
export function usePeriods(cycleId: Id | null) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: periodsKey(tenantId, cycleId),
    queryFn: () => getDataGateway().goals.listPeriods(tenantId, cycleId as Id),
    enabled: cycleId !== null,
    staleTime: CYCLE_STALE_MS,
  });
}

export const goalPlansKey = (tenantId: string, filter: GoalPlanFilter = {}) => queryKey(tenantId, 'goalPlans', filter);

export function useGoalPlans(filter: GoalPlanFilter = {}, options: { enabled?: boolean } = {}) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: goalPlansKey(tenantId, filter),
    queryFn: () => getDataGateway().goals.listGoalPlans(tenantId, filter),
    enabled: options.enabled ?? true,
  });
}

export const goalsKey = (tenantId: string, filter: GoalFilter = {}) => queryKey(tenantId, 'goals', filter);

export function useGoals(filter: GoalFilter = {}, options: { enabled?: boolean } = {}) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: goalsKey(tenantId, filter),
    queryFn: () => getDataGateway().goals.listGoals(tenantId, filter),
    enabled: options.enabled ?? true,
  });
}
