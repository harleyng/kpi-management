import { createContext, useContext } from 'react';
import type { Id, RoleCode, Tenant } from '@/data/types';
import type { AccessProfile, PermissionCode, PermissionResource } from '@/lib/permissionRules';
import type { SessionPerson } from '@/lib/sessionRules';

/**
 * The signed-in session — **SIMULATED** (plan §3.3). There is no login: the top bar picks a tenant
 * and a person from the seed, and the demo can switch between them to walk a multi-role flow
 * (NV → QL → HR → BOD) without signing in again. A person's access is the union of their roles
 * (BR-KPI-60); there is no "active role".
 *
 * The whole app reads identity only through `useSession()`, so when real authentication arrives
 * only this file and its provider change.
 *
 * `SessionProvider` renders its children only once a session is resolved, so inside the app a
 * session ALWAYS exists — no consumer handles "no session". Every function here is referentially
 * stable for a given person and day: put them in dependency arrays freely.
 */

export interface SessionUser {
  /** The account id — what every gateway write takes as `actorUserId`. */
  id: Id;
  /** `null` for a system account with no person behind it ("Của tôi" is then empty, not an error). */
  employeeId: Id | null;
  name: string;
  email: string;
}

export interface SessionContextValue {
  /** The tenant every gateway call is scoped to (CLAUDE.md, critical rule 4). */
  tenantId: Id;
  tenantName: string;
  tenant: Tenant;
  user: SessionUser;
  /** The roles held, in `ROLE_CODES` order. For display — gate behaviour with `can`. */
  roles: RoleCode[];
  hasRole: (role: RoleCode) => boolean;
  /**
   * `can(code)` — does this person hold the permission at all (a menu item, a button)?
   * `can(code, resource)` — over THIS data? Build the resource with `resourceOfOwner` /
   * `resourceOfSubject` from `src/lib/permissionRules.ts`; a `null` resource denies.
   * Form actions (SUBMIT / APPROVE / RETURN) are NOT a `can` question — `workflowRules` decides
   * them from the step's actor rule (BR-KPI-61).
   */
  can: (code: PermissionCode, resource?: PermissionResource | null) => boolean;
  /** The precomputed profile `can` reads — for pure rules that take it (`canOpenPath`). */
  access: AccessProfile;
  /** "Today" in the tenant's zone, from the gateway clock — the date scopes resolve on. */
  today: string;
  /** The tenant's Active tenants and people — the switcher's lists. */
  tenants: Tenant[];
  people: SessionPerson[];
  /** Switches tenant and goes to the home page (the open page belonged to the other tenant). */
  switchTenant: (tenantId: Id) => void;
  /** Switches person; stays on the page if they may open it, else goes home with a notice. */
  switchUser: (userId: Id) => void;
  /** `true` while identity is simulated — drives the "Dữ liệu giả lập" banner. */
  isSimulated: boolean;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>.');
  return ctx;
}
