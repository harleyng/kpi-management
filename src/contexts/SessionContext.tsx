import { useMemo, type ReactNode } from 'react';
import { ROLE_CODES, type RoleCode } from '@/data/types';
import { SessionContext, type SessionContextValue } from './useSession';

/**
 * Provider for the simulated session. The contract lives in `./useSession.ts`.
 *
 * Phase 0 placeholder: one fixed demo identity holding every role, so every menu group is
 * reachable while the screens are still placeholders. TODO Phase 1.3 replaces it with the seed's
 * tenants and users and a real switcher.
 */
const PLACEHOLDER_ROLES: RoleCode[] = [...ROLE_CODES];

export function SessionProvider({ children }: { children: ReactNode }) {
  const value = useMemo<SessionContextValue>(
    () => ({
      tenantId: 'tenant-placeholder',
      tenantName: 'Syntra',
      user: { id: 'user-placeholder', name: 'Người dùng demo', email: 'demo@syntra.local' },
      roles: PLACEHOLDER_ROLES,
      hasRole: (role: RoleCode) => PLACEHOLDER_ROLES.includes(role),
      isSimulated: true,
    }),
    [],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
