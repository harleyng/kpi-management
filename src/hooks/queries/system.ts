import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/contexts/useSession';
import type { AuditLog } from '@/data/types';
import { getDataGateway } from '@/integrations/data';
import type { AuditLogFilter } from '@/integrations/data/types';
import { queryKey } from './keys';

/**
 * G7 · Hệ thống — the audit-log read T3's lock history needs (WBS 4.3.6). Track T7 owns the audit
 * screen and extends this file. The `auditLog` root refreshes on every change, so mount the query
 * only while it is on screen (`enabled`).
 */

export const auditLogKey = (tenantId: string, filter: AuditLogFilter) => queryKey(tenantId, 'auditLog', filter);

/** Every entry matching `filter` (all pages) — meant for one record's history, not the whole log. */
export function useAuditEntries(filter: AuditLogFilter, options: { enabled?: boolean } = {}) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: auditLogKey(tenantId, filter),
    queryFn: async () => {
      const items: AuditLog[] = [];
      let cursor: string | undefined;
      do {
        const page = await getDataGateway().system.listAuditLog(tenantId, filter, { limit: 500, cursor });
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return items;
    },
    enabled: options.enabled ?? true,
  });
}
