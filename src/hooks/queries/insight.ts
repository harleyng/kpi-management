import { useMutation, useQuery } from '@tanstack/react-query';
import { useSession } from '@/contexts/useSession';
import type { Id } from '@/data/types';
import { getInsightGateway } from '@/integrations/insight';
import { snapshotDigest, type DashboardSnapshot } from '@/lib/dashboardRules';
import { queryKey } from './keys';

/**
 * The simulated assistant (WBS 4.7.4, BR-KPI-89). Keys carry the snapshot's DIGEST, so an answer is
 * cached exactly as long as the numbers it was written from — new figures are a new key; the `insight`
 * root depends on no entity. Nothing is persisted: a question is a mutation with no side effect.
 * Failures stay on the query / mutation for the card to show (ERR-KPI-06 for a foreign snapshot).
 */

export const insightKey = (tenantId: Id, kind: 'summary' | 'explain', digest: string, nodeId: Id | null = null) =>
  queryKey(tenantId, 'insight', kind, digest, nodeId);

export function useInsightSummary(snapshot: DashboardSnapshot | null) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: insightKey(tenantId, 'summary', snapshot ? snapshotDigest(snapshot) : 'none'),
    queryFn: () => getInsightGateway().summarise(tenantId, snapshot as DashboardSnapshot),
    enabled: snapshot !== null,
    staleTime: Infinity,
  });
}

export function useExplainInsight(snapshot: DashboardSnapshot | null, nodeId: Id | null) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: insightKey(tenantId, 'explain', snapshot ? snapshotDigest(snapshot) : 'none', nodeId),
    queryFn: () => getInsightGateway().explain(tenantId, snapshot as DashboardSnapshot, nodeId as Id),
    enabled: snapshot !== null && nodeId !== null,
    staleTime: Infinity,
  });
}

/** Asks one question about the snapshot. The card shows the answer, or the catalogue copy of the failure. */
export function useAskInsight() {
  const { tenantId } = useSession();
  return useMutation({
    mutationFn: ({ snapshot, question }: { snapshot: DashboardSnapshot; question: string }) => getInsightGateway().ask(tenantId, snapshot, question),
  });
}
