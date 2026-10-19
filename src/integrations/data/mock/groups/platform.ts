import { KpiError } from '@/lib/errorCatalog';
import type { PlatformGateway } from '../../types';
import type { Runtime } from '../runtime';

export function platformGroup(rt: Runtime): PlatformGateway {
  return {
    listTenants: rt.platformRead('platform.listTenants', (g) => [...g.tenants.values()]),
    getTenant: rt.platformRead('platform.getTenant', (g, tenantId: string) => {
      const tenant = g.tenants.get(tenantId);
      if (!tenant) throw new KpiError('ERR-KPI-02', `tenant ${tenantId} not found`);
      return tenant;
    }),
    saveTenant: rt.saveTenant('platform.saveTenant'),
  };
}
