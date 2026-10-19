import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { HOME_URL, NAV_GROUPS } from '@/components/layout/navConfig';
import { SessionEmpty, SessionError, SessionLoading } from '@/components/layout/SessionScreens';
import type { Id, IsoDate, RoleCode } from '@/data/types';
import {
  hasDevControls,
  readGatewayNow,
  useResetSeed,
  useSessionDirectory,
  useTenants,
} from '@/hooks/queries/session';
import { errorSpecOf } from '@/lib/errorCatalog';
import { buildAccessProfile, can as checkPermission, canOpenPath } from '@/lib/permissionRules';
import { pickAccount, pickTenant, sessionPeople, tenantToday, type SessionDirectory } from '@/lib/sessionRules';
import { sessionActions, useSessionStore } from '@/lib/sessionStore';
import { SessionContext, type SessionContextValue } from './useSession';

/**
 * Provider for the simulated session. The contract lives in `./useSession.ts`.
 *
 * tenants → the stored tenant (or the first Active) → ONE directory query for that tenant → the
 * stored person (or the first Active) → the access profile as of "today" in the tenant's zone.
 * Stored ids are only a preference: they are checked against what was just loaded.
 *
 * - Children render only once a session exists. The FIRST load shows the shell skeleton; a tenant
 *   switch shows it again (the previous tenant's profile is never shown as the new one's); a person
 *   switch inside a tenant is instant — same directory.
 * - A failed background refetch keeps the session and says so in a toast: unmounting the whole app
 *   over a refresh would be worse, and silence would hide it.
 * - Switching happens in event handlers, never in an effect: no navigation during render, nothing
 *   for StrictMode to run twice.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const storedTenantId = useSessionStore((s) => s.tenantId);
  const userIdByTenant = useSessionStore((s) => s.userIdByTenant);

  const tenantsQuery = useTenants();
  const tenant = useMemo(
    () => (tenantsQuery.data ? pickTenant(tenantsQuery.data, storedTenantId) : null),
    [tenantsQuery.data, storedTenantId],
  );
  const activeTenants = useMemo(
    () => (tenantsQuery.data ?? []).filter((t) => t.status === 'Active'),
    [tenantsQuery.data],
  );

  const directoryQuery = useSessionDirectory(tenant?.id ?? null);
  const directory: SessionDirectory | undefined =
    tenant && directoryQuery.data?.tenantId === tenant.id ? directoryQuery.data : undefined;

  const account = useMemo(
    () => (tenant && directory ? pickAccount(tenant.id, directory.accounts, userIdByTenant[tenant.id] ?? null) : null),
    [tenant, directory, userIdByTenant],
  );

  // "Today" from the gateway's one clock, re-read every render so a day change or `dev.setNow`
  // rebuilds the profile; the string is stable within a day, so the memos below hold.
  let today: IsoDate | null = null;
  let clockError: unknown = null;
  if (tenant && directory) {
    try {
      today = tenantToday(readGatewayNow(), tenant.timezone);
    } catch (error) {
      clockError = error;
    }
  }

  const profile = useMemo(
    () =>
      tenant && directory && account && today
        ? buildAccessProfile({ ...directory, tenantId: tenant.id, account, asOf: today })
        : null,
    [tenant, directory, account, today],
  );
  const people = useMemo(() => (directory && today ? sessionPeople(directory, today) : []), [directory, today]);

  // Write a corrected selection back (a stored id that no longer resolves), so the next load starts
  // from what is on screen. Equality-guarded: it runs once per correction.
  useEffect(() => {
    if (tenant && tenant.id !== storedTenantId) sessionActions.selectTenant(tenant.id);
  }, [tenant, storedTenantId]);
  useEffect(() => {
    if (tenant && account && userIdByTenant[tenant.id] !== account.id) sessionActions.selectUser(tenant.id, account.id);
  }, [tenant, account, userIdByTenant]);

  // A background refetch that failed while a session is on screen: keep it, but say so — once.
  const { error: directoryError, errorUpdatedAt } = directoryQuery;
  const toastedErrorAt = useRef(0);
  useEffect(() => {
    if (directory && directoryError && errorUpdatedAt !== toastedErrorAt.current) {
      toastedErrorAt.current = errorUpdatedAt;
      toast.error(errorSpecOf(directoryError).title);
    }
  }, [directory, directoryError, errorUpdatedAt]);

  // What the switch handlers read — kept in a ref so the handlers stay referentially stable.
  // `navigate` too: React Router v6 hands out a NEW navigate function after every location change,
  // so depending on it would re-create the whole session value (and re-render every consumer) on
  // each navigation.
  const latest = useRef({ tenant, directory, today, pathname, navigate });
  useEffect(() => {
    latest.current = { tenant, directory, today, pathname, navigate };
  });

  const switchTenant = useCallback((tenantId: Id) => {
    sessionActions.selectTenant(tenantId);
    latest.current.navigate(HOME_URL);
  }, []);

  const switchUser = useCallback((userId: Id) => {
    const { tenant: t, directory: dir, today: asOf, pathname: path, navigate: go } = latest.current;
    if (!t || !dir || !asOf) return;
    const next = dir.accounts.find((a) => a.id === userId && a.tenantId === t.id && a.status === 'Active');
    if (!next) return;
    sessionActions.selectUser(t.id, userId);
    // Decided here, from the directory already loaded, before the new profile renders — so the
    // guard never flashes and nothing navigates during render.
    const nextProfile = buildAccessProfile({ ...dir, tenantId: t.id, account: next, asOf });
    if (!canOpenPath(path, NAV_GROUPS, nextProfile)) {
      go(HOME_URL);
      toast(`Đã chuyển về Trang chủ vì ${next.displayName} không có quyền mở trang trước.`);
    }
  }, []);

  const value = useMemo<SessionContextValue | null>(() => {
    if (!tenant || !account || !profile || !today) return null;
    const person = people.find((p) => p.userId === account.id);
    const roles: RoleCode[] = [...profile.roleCodes];
    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenant,
      user: {
        id: account.id,
        employeeId: account.employeeId,
        name: account.displayName,
        email: person?.email ?? account.login,
      },
      roles,
      hasRole: (role: RoleCode) => roles.includes(role),
      can: (code, resource) => checkPermission(profile, code, resource),
      access: profile,
      today,
      tenants: activeTenants,
      people,
      switchTenant,
      switchUser,
      isSimulated: true,
    };
  }, [tenant, account, profile, today, people, activeTenants, switchTenant, switchUser]);

  const resetSeed = useResetSeed();
  const onResetSeed = hasDevControls() ? () => resetSeed.mutate() : undefined;

  // Only a FIRST load that failed replaces the app: a failed background refetch (the demo toolbar's
  // simulated failure) keeps the tenants already loaded — otherwise the toolbar that switched the
  // failure on would unmount with the app and could not switch it off.
  if (tenantsQuery.error && !tenantsQuery.data) {
    return <SessionError error={tenantsQuery.error} onRetry={() => void tenantsQuery.refetch()} />;
  }
  if (!tenantsQuery.data) return <SessionLoading />;
  if (!tenant) {
    return (
      <SessionEmpty
        reason="noTenant"
        otherTenants={[]}
        onSwitchTenant={switchTenant}
        onResetSeed={onResetSeed}
        resetting={resetSeed.isPending}
      />
    );
  }
  if (!directory) {
    if (directoryQuery.error) {
      return <SessionError error={directoryQuery.error} onRetry={() => void directoryQuery.refetch()} />;
    }
    return <SessionLoading />;
  }
  if (clockError) return <SessionError error={clockError} onRetry={() => void directoryQuery.refetch()} />;
  if (!value) {
    return (
      <SessionEmpty
        reason="noAccount"
        otherTenants={activeTenants.filter((t) => t.id !== tenant.id)}
        onSwitchTenant={switchTenant}
        onResetSeed={onResetSeed}
        resetting={resetSeed.isPending}
      />
    );
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
