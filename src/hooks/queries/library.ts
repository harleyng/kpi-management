import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/contexts/useSession';
import { getDataGateway } from '@/integrations/data';
import type { KpiDefinitionFilter } from '@/integrations/data/types';

/**
 * G2 · Thư viện KPI — reads the shared `KpiPicker` needs (Phase 1.4). Track T2 adds the writes.
 * Keys are `[tenantId, root, ...params]` (CLAUDE.md rule 7). The library changes rarely during a session.
 */

const LIBRARY_STALE_MS = 5 * 60 * 1000;

export const kpiDefinitionsKey = (tenantId: string, filter: KpiDefinitionFilter = {}) =>
  [tenantId, 'kpiDefinitions', filter] as const;

export function useKpiDefinitions(filter: KpiDefinitionFilter = {}) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: kpiDefinitionsKey(tenantId, filter),
    queryFn: () => getDataGateway().library.listKpiDefinitions(tenantId, filter),
    staleTime: LIBRARY_STALE_MS,
  });
}

export const perspectivesKey = (tenantId: string) => [tenantId, 'perspectives'] as const;

export function usePerspectives() {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: perspectivesKey(tenantId),
    queryFn: () => getDataGateway().library.listPerspectives(tenantId),
    staleTime: LIBRARY_STALE_MS,
  });
}

export const measureUnitsKey = (tenantId: string) => [tenantId, 'measureUnits'] as const;

export function useMeasureUnits() {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: measureUnitsKey(tenantId),
    queryFn: () => getDataGateway().library.listMeasureUnits(tenantId),
    staleTime: LIBRARY_STALE_MS,
  });
}
