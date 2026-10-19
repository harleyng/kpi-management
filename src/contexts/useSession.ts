import { createContext, useContext } from 'react';
import type { RoleCode } from '@/data/types';

/**
 * The signed-in session — **SIMULATED** (plan §3.3). There is no login: the user picks a tenant,
 * a person and a role from the seed, and can switch between them to walk a multi-role flow
 * (NV → QL → HR) without signing in again.
 *
 * The whole app reads identity only through `useSession()`, so when real authentication arrives
 * only this file and its provider change.
 *
 * TODO Phase 1.3:
 * - `tenantId` / `user` / `roles` resolved from the seed through `getDataGateway()`;
 * - `switchTenant`, `switchUser` (the switcher in the top bar), persisted in localStorage;
 * - `can(action, resource)` delegating to `src/lib/permissionRules.ts`.
 */

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export interface SessionContextValue {
  /** The tenant every gateway call is scoped to (CLAUDE.md, critical rule 4). */
  tenantId: string;
  tenantName: string;
  user: SessionUser;
  roles: RoleCode[];
  hasRole: (role: RoleCode) => boolean;
  /** `true` while identity is simulated — drives the "Dữ liệu giả lập" banner. */
  isSimulated: boolean;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>.');
  return ctx;
}
