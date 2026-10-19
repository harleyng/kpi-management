import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/contexts/useSession';
import { getDataGateway } from '@/integrations/data';
import { queryKey } from './keys';

/**
 * G4 · Số liệu thực hiện — the reads other tracks need now (T3: a goal's data source, BR-KPI-05).
 * Track T4 adds its own hooks beside these; extend, do not duplicate.
 */

const ACTUALS_CATALOGUE_STALE_MS = 5 * 60 * 1000;

export const dataSourcesKey = (tenantId: string) => queryKey(tenantId, 'dataSources');

export function useDataSources() {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: dataSourcesKey(tenantId),
    queryFn: () => getDataGateway().actuals.listDataSources(tenantId),
    staleTime: ACTUALS_CATALOGUE_STALE_MS,
  });
}
