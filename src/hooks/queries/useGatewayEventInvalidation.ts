import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Id } from '@/data/types';
import { getDataGateway } from '@/integrations/data';
import { rootsAffectedBy, TENANTS_KEY, type KeyRoot } from './keys';

/**
 * Keeps the query cache in step with the gateway: every `entity.changed` of the session's tenant
 * invalidates the roots that read that entity (`keys.ts`). Mounted ONCE, by `GatewayEventBridge`.
 *
 * - Roots are collected and flushed once per microtask, so an import that commits 300 rows
 *   refetches each screen once, not 300 times.
 * - The subscription follows the tenant: switching tenant unsubscribes the old one. Under
 *   StrictMode the effect runs, cleans up and runs again — harmless, and a flush scheduled by a
 *   disposed subscription does nothing.
 * - A mutation therefore does not need to invalidate keys of entities the gateway announces.
 */
export function useGatewayEventInvalidation(tenantId: Id | null): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (tenantId === null) return;
    let disposed = false;
    let pending: Set<KeyRoot> | null = null;
    let tenants = false;

    const flush = () => {
      const roots = pending;
      pending = null;
      if (disposed || roots === null) return;
      for (const root of roots) void queryClient.invalidateQueries({ queryKey: [tenantId, root] });
      if (tenants) void queryClient.invalidateQueries({ queryKey: TENANTS_KEY });
      tenants = false;
    };

    const unsubscribe = getDataGateway().events.subscribe(tenantId, (event) => {
      if (event.type !== 'entity.changed') return;
      if (event.entityName === 'Tenant') tenants = true;
      if (pending === null) {
        pending = new Set();
        queueMicrotask(flush);
      }
      for (const root of rootsAffectedBy(event.entityName)) pending.add(root);
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [tenantId, queryClient]);
}
