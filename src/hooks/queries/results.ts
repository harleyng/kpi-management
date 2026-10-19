import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/contexts/useSession';
import { getDataGateway } from '@/integrations/data';
import type { PeriodResultFilter } from '@/integrations/data/types';
import { queryKey } from './keys';

/**
 * G6 · Kết quả — the read Track T4 needs (is a month's result Final, BR-KPI-43). Track T6 owns this
 * file and adds the rest when it merges.
 */
export const periodResultsKey = (tenantId: string, filter: PeriodResultFilter) => queryKey(tenantId, 'results', 'list', filter);
export function usePeriodResults(filter: PeriodResultFilter, options: { enabled?: boolean } = {}) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: periodResultsKey(tenantId, filter),
    queryFn: () => getDataGateway().results.listPeriodResults(tenantId, filter),
    enabled: options.enabled ?? true,
  });
}
