import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getDataGateway } from '@/integrations/data';
import type { Id, IsoDateTime } from '@/data/types';
import { DEFAULT_LATENCY_MS, devActions } from '@/lib/devStore';
import type { SessionDirectory } from '@/lib/sessionRules';
import { queryKey, TENANTS_KEY } from './keys';

/**
 * The reads the simulated session is built from (Phase 1.3).
 *
 * ⚠️ The ONE exception to "hooks read `tenantId` from `useSession()`": these run inside the
 * `SessionProvider`, before a session exists, so they take the tenant explicitly. Every other hook
 * keeps reading it from `useSession()`.
 *
 * - `tenantsKey` is the platform exception (its subject is the tenant itself, so there is no tenant
 *   to key it by). Tenants change only through tenant management, hence `staleTime: Infinity`.
 * - `sessionDirectoryKey(tenantId)` is ONE query for everything a session needs, loaded with
 *   `Promise.all` — never `allSettled`: a partial directory (roles without their permissions) would
 *   fail open or closed at random, so one failure fails the whole session, loudly.
 *   Invalidate it when accounts, user roles, role permissions, roles, org units, assignments or
 *   employees change — `useGatewayEventInvalidation` does it (`keys.ts`, root `sessionDirectory`).
 */

export const tenantsKey = () => TENANTS_KEY;

export function useTenants() {
  return useQuery({
    queryKey: tenantsKey(),
    queryFn: () => getDataGateway().platform.listTenants(),
    staleTime: Infinity,
  });
}

export const sessionDirectoryKey = (tenantId: Id) => queryKey(tenantId, 'sessionDirectory');

const DIRECTORY_STALE_MS = 5 * 60 * 1000;

async function loadDirectory(tenantId: Id): Promise<SessionDirectory> {
  const gateway = getDataGateway();
  // Read the clock once here, so an adapter whose clock fails is the session's error state rather
  // than a crash during render.
  gateway.clock.now();
  const { org } = gateway;
  const [accounts, employees, roles, permissions, rolePermissions, userRoles, orgUnits, assignments] = await Promise.all([
    org.listUserAccounts(tenantId),
    org.listEmployees(tenantId, { includeResigned: true }),
    org.listRoles(tenantId),
    org.listPermissions(tenantId),
    org.listRolePermissions(tenantId),
    org.listUserRoles(tenantId),
    org.listOrgUnits(tenantId),
    // Every date: the profile picks the assignments effective "today", which moves (dev.setNow).
    org.listAssignments(tenantId),
  ]);
  return { tenantId, accounts, employees, roles, permissions, rolePermissions, userRoles, orgUnits, assignments };
}

/** `tenantId` null (no usable tenant yet) leaves the query disabled — check that BEFORE reading `isPending`. */
export function useSessionDirectory(tenantId: Id | null) {
  return useQuery({
    queryKey: sessionDirectoryKey(tenantId ?? ''),
    queryFn: () => loadDirectory(tenantId!),
    enabled: tenantId !== null,
    staleTime: DIRECTORY_STALE_MS,
  });
}

/** "Now" from the gateway's one clock (the dev toolbar moves it) — never `new Date()`. */
export function readGatewayNow(): IsoDateTime {
  return getDataGateway().clock.now();
}

/**
 * Whether the adapter offers mock-only controls (`dev`) — the demo toolbar and the empty session
 * state's reseed button. Shown whenever they exist, not gated on the build mode: the Vercel
 * prototype is itself a demo.
 */
export function hasDevControls(): boolean {
  return getDataGateway().dev !== undefined;
}

/**
 * Reloads the seed for every tenant (mock only), puts latency and failure mode back to their
 * defaults, and clears the whole cache — `resetSeed` emits no events, and every cached row may be
 * one that no longer exists.
 *
 * The cache is cleared with `resetQueries()`: it drops every query's data like `clear()`, but also
 * refetches the queries on screen — after `clear()` a mounted `useQuery` keeps showing its old
 * result and never refetches.
 */
export function useResetSeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const dev = getDataGateway().dev;
      if (!dev) throw new Error('resetSeed is only available on the mock adapter');
      await dev.resetSeed();
      // Before the refetch below: a refetch under an injected failure would fail the fresh seed.
      dev.setFailureMode({ enabled: false });
      dev.setLatency(DEFAULT_LATENCY_MS);
    },
    onSuccess: () => {
      devActions.reset();
      return queryClient.resetQueries();
    },
  });
}
