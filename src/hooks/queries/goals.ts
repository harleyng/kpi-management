import { useQueries, useQuery } from '@tanstack/react-query';
import { useSession } from '@/contexts/useSession';
import type { CyclePeriod, Id } from '@/data/types';
import { combineQueries, type QueryState } from '@/lib/queryState';
import { getDataGateway } from '@/integrations/data';
import type { GoalFilter, GoalPlanFilter, GoalScope } from '@/integrations/data/types';
import { queryKey } from './keys';

/**
 * G3 · Kế hoạch mục tiêu — the READS the forms screens need (T5: the registration form shows the
 * plan, an evaluation shows its goals and levels, a launch picks a cycle and period). Track T3 owns
 * the plan editor and adds the writes beside these; keep one hook per read (merge, don't duplicate).
 */

const CYCLE_STALE_MS = 5 * 60 * 1000;

export const cyclesKey = (tenantId: Id) => queryKey(tenantId, 'cycles', 'list');

export function useCycles() {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: cyclesKey(tenantId),
    queryFn: () => getDataGateway().goals.listCycles(tenantId),
    staleTime: CYCLE_STALE_MS,
  });
}

/** `cycleId` null leaves the query idle (nothing chosen yet). */
export const periodsKey = (tenantId: Id, cycleId: Id | null) => queryKey(tenantId, 'cycles', 'periods', cycleId);

export function usePeriods(cycleId: Id | null) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: periodsKey(tenantId, cycleId),
    queryFn: () => getDataGateway().goals.listPeriods(tenantId, cycleId!),
    enabled: cycleId !== null,
    staleTime: CYCLE_STALE_MS,
  });
}

/**
 * Every period of every cycle — what a list of forms needs to name each form's period. One query per
 * cycle under the same `periodsKey` the single-cycle hook uses (a handful of cycles per tenant).
 */
export function useAllPeriods(): { data: CyclePeriod[] | undefined; query: QueryState } {
  const { tenantId } = useSession();
  const cycles = useCycles();
  const results = useQueries({
    queries: (cycles.data ?? []).map((cycle) => ({
      queryKey: periodsKey(tenantId, cycle.id),
      queryFn: () => getDataGateway().goals.listPeriods(tenantId, cycle.id),
      staleTime: CYCLE_STALE_MS,
    })),
  });
  const query = combineQueries([cycles, ...results]);
  const data = cycles.data && results.every((r) => r.data) ? results.flatMap((r) => r.data ?? []) : undefined;
  return { data, query };
}

export const goalPlansKey = (tenantId: Id, filter: GoalPlanFilter = {}) => queryKey(tenantId, 'goalPlans', 'list', filter);

export function useGoalPlans(filter: GoalPlanFilter = {}) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: goalPlansKey(tenantId, filter),
    queryFn: () => getDataGateway().goals.listGoalPlans(tenantId, filter),
  });
}

export const goalPlanKey = (tenantId: Id, goalPlanId: Id | null) => queryKey(tenantId, 'goalPlans', 'one', goalPlanId);

export function useGoalPlan(goalPlanId: Id | null) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: goalPlanKey(tenantId, goalPlanId),
    queryFn: () => getDataGateway().goals.getGoalPlan(tenantId, goalPlanId!),
    enabled: goalPlanId !== null,
  });
}

export const kgisKey = (tenantId: Id, goalPlanId: Id | null) => queryKey(tenantId, 'kgis', goalPlanId);

export function useKgis(goalPlanId: Id | null) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: kgisKey(tenantId, goalPlanId),
    queryFn: () => getDataGateway().goals.listKgis(tenantId, goalPlanId!),
    enabled: goalPlanId !== null,
  });
}

/** `filter` null leaves the query idle. Sort id lists before passing them (stable key). */
export const goalsKey = (tenantId: Id, filter: GoalFilter | null) => queryKey(tenantId, 'goals', 'list', filter);

export function useGoals(filter: GoalFilter | null) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: goalsKey(tenantId, filter),
    queryFn: () => getDataGateway().goals.listGoals(tenantId, filter!),
    enabled: filter !== null,
  });
}

export const targetLevelsKey = (tenantId: Id, scope: GoalScope | null) => queryKey(tenantId, 'goals', 'levels', scope);

export function useTargetLevels(scope: GoalScope | null) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: targetLevelsKey(tenantId, scope),
    queryFn: () => getDataGateway().goals.listTargetLevels(tenantId, scope!),
    enabled: scope !== null,
  });
}
