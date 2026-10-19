import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useSession } from '@/contexts/useSession';
import type { Employee, EmployeeAssignment, Id, JobPosition, OrgUnit, Permission, Role, RolePermission, Tenant, UserAccount, UserRole } from '@/data/types';
import { getDataGateway } from '@/integrations/data';
import type { AssignmentFilter, DataGateway, EmployeeFilter, Upsert } from '@/integrations/data/types';
import { errorSpecOf, KpiError, type RuleIssue } from '@/lib/errorCatalog';
import { orgIssueText } from '@/lib/orgIssueCopy';
import { combineQueries, type QueryState } from '@/lib/queryState';
import { queryKey, TENANTS_KEY, type KeyRoot } from './keys';

/**
 * G1 · Tổ chức & người dùng — the shared pickers' reads (Phase 1.4) and Track T1's screens.
 *
 * Keys are `[tenantId, root, ...params]` (CLAUDE.md rule 7), so switching tenant can never serve
 * another tenant's cached rows and `[tenantId, root]` invalidates every variant of a list.
 * The org changes rarely during a session, hence the long `staleTime`. Every write's events
 * invalidate the roots that read its entities (`useGatewayEventInvalidation`); the mutations below
 * also invalidate their own roots on settle, so a screen never waits on the bus to refresh.
 */

const ORG_STALE_MS = 5 * 60 * 1000;

export const orgUnitsKey = (tenantId: string) => queryKey(tenantId, 'orgUnits');

export function useOrgUnits() {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: orgUnitsKey(tenantId),
    queryFn: () => getDataGateway().org.listOrgUnits(tenantId),
    staleTime: ORG_STALE_MS,
  });
}

/**
 * `filter` goes into the key as-is. Do not pass a picker's live search text here: every keystroke
 * would be a new key and a pending flash — pickers filter the loaded list on the client.
 */
export const employeesKey = (tenantId: string, filter: EmployeeFilter = {}) =>
  queryKey(tenantId, 'employees', filter);

export function useEmployees(filter: EmployeeFilter = {}) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: employeesKey(tenantId, filter),
    queryFn: () => getDataGateway().org.listEmployees(tenantId, filter),
    staleTime: ORG_STALE_MS,
  });
}

export const positionsKey = (tenantId: string) => queryKey(tenantId, 'positions');

export function usePositions() {
  const { tenantId } = useSession();
  return useQuery({ queryKey: positionsKey(tenantId), queryFn: () => getDataGateway().org.listPositions(tenantId), staleTime: ORG_STALE_MS });
}

export const assignmentsKey = (tenantId: string, filter: AssignmentFilter = {}) => queryKey(tenantId, 'assignments', filter);

/** Without a filter: every assignment of every date — what the guards' pre-checks need. */
export function useAssignments(filter: AssignmentFilter = {}) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: assignmentsKey(tenantId, filter),
    queryFn: () => getDataGateway().org.listAssignments(tenantId, filter),
    staleTime: ORG_STALE_MS,
  });
}

export const userAccountsKey = (tenantId: string) => queryKey(tenantId, 'userAccounts');

export function useUserAccounts() {
  const { tenantId } = useSession();
  return useQuery({ queryKey: userAccountsKey(tenantId), queryFn: () => getDataGateway().org.listUserAccounts(tenantId), staleTime: ORG_STALE_MS });
}

/** Roles, their permission rows and the role assignments share the `roles` root (KEY_ROOTS). */
export const rolesKey = (tenantId: string) => queryKey(tenantId, 'roles', 'list');
export const rolePermissionsKey = (tenantId: string) => queryKey(tenantId, 'roles', 'permissions');
export const userRolesKey = (tenantId: string) => queryKey(tenantId, 'roles', 'userRoles');
export const permissionsKey = (tenantId: string) => queryKey(tenantId, 'roles', 'catalogue');

export function useRoles() {
  const { tenantId } = useSession();
  return useQuery({ queryKey: rolesKey(tenantId), queryFn: () => getDataGateway().org.listRoles(tenantId), staleTime: ORG_STALE_MS });
}

export function useRolePermissions() {
  const { tenantId } = useSession();
  return useQuery({ queryKey: rolePermissionsKey(tenantId), queryFn: () => getDataGateway().org.listRolePermissions(tenantId), staleTime: ORG_STALE_MS });
}

export function useUserRoles() {
  const { tenantId } = useSession();
  return useQuery({ queryKey: userRolesKey(tenantId), queryFn: () => getDataGateway().org.listUserRoles(tenantId), staleTime: ORG_STALE_MS });
}

/** The global catalogue — it never changes while the app runs. */
export function usePermissions() {
  const { tenantId } = useSession();
  return useQuery({ queryKey: permissionsKey(tenantId), queryFn: () => getDataGateway().org.listPermissions(tenantId), staleTime: Infinity });
}

/** Every org row the T1 screens and the guards' pre-checks read — complete lists, resigned people included. */
export interface OrgDirectory {
  units: OrgUnit[];
  positions: JobPosition[];
  employees: Employee[];
  assignments: EmployeeAssignment[];
  accounts: UserAccount[];
}

/**
 * The five org lists together. `data` is set only when ALL of them loaded: a pre-check run on a
 * partial list would answer "allowed" for the wrong reason, so the screens disable an action while
 * `data` is missing ("Đang tải dữ liệu…").
 */
export function useOrgDirectory(): { data: OrgDirectory | undefined; query: QueryState } {
  const units = useOrgUnits();
  const positions = usePositions();
  const employees = useEmployees({ includeResigned: true });
  const assignments = useAssignments();
  const accounts = useUserAccounts();
  const query = combineQueries([units, positions, employees, assignments, accounts]);
  const data = useMemo(
    () =>
      units.data && positions.data && employees.data && assignments.data && accounts.data
        ? { units: units.data, positions: positions.data, employees: employees.data, assignments: assignments.data, accounts: accounts.data }
        : undefined,
    [units.data, positions.data, employees.data, assignments.data, accounts.data],
  );
  return { data, query };
}

/** The org directory plus every access row — what "Người dùng & quyền" and its guards read. */
export interface AccessDirectory extends OrgDirectory {
  roles: Role[];
  userRoles: UserRole[];
  rolePermissions: RolePermission[];
  permissions: Permission[];
}

export function useAccessDirectory(): { data: AccessDirectory | undefined; query: QueryState } {
  const org = useOrgDirectory();
  const roles = useRoles();
  const userRoles = useUserRoles();
  const rolePermissions = useRolePermissions();
  const permissions = usePermissions();
  const query = combineQueries([org.query, roles, userRoles, rolePermissions, permissions]);
  const data = useMemo(
    () =>
      org.data && roles.data && userRoles.data && rolePermissions.data && permissions.data
        ? { ...org.data, roles: roles.data, userRoles: userRoles.data, rolePermissions: rolePermissions.data, permissions: permissions.data }
        : undefined,
    [org.data, roles.data, userRoles.data, rolePermissions.data, permissions.data],
  );
  return { data, query };
}

// ─── Writes ────────────────────────────────────────────────────────────────────────────────────

/** The rule issues of a failed write — what a form marks inline. Empty for any other failure. */
export function issuesOf(error: unknown): readonly RuleIssue[] {
  return error instanceof KpiError ? error.issues : [];
}

/** A failed write, in the catalogue's words: the entry's title, and the first rule's sentence when there is one. */
export function toastWriteError(error: unknown): void {
  const spec = errorSpecOf(error);
  const [first] = issuesOf(error);
  const description = first ? orgIssueText(first) : (spec.message ?? undefined);
  toast.error(spec.title, description ? { description } : undefined);
}

interface OrgMutationOptions {
  /** The roots this write changes — invalidated on settle (success or failure). */
  roots: readonly KeyRoot[];
  /** The toast on success; omitted = no toast (the screen says it). */
  success?: string;
  /** Also refresh the tenant list (a tenant write). */
  tenants?: boolean;
}

/**
 * The one shape of a T1 write: the actor comes from the session, a failure is toasted with the
 * catalogue copy and its `issues` stay on `mutation.error` for the form (`issuesOf`), and the roots
 * are invalidated whatever happened (a refused write may have raced a change).
 */
function useOrgMutation<V, R>(run: (gateway: DataGateway, tenantId: Id, actorUserId: Id, variables: V) => Promise<R>, options: OrgMutationOptions) {
  const { tenantId, user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: V) => run(getDataGateway(), tenantId, user.id, variables),
    onSuccess: () => {
      if (options.success) toast.success(options.success);
    },
    onError: toastWriteError,
    onSettled: async () => {
      await Promise.all([
        ...options.roots.map((root) => queryClient.invalidateQueries({ queryKey: [tenantId, root] })),
        ...(options.tenants ? [queryClient.invalidateQueries({ queryKey: TENANTS_KEY })] : []),
      ]);
    },
  });
}

export const useSaveOrgUnit = () =>
  useOrgMutation((g, t, a, input: Upsert<OrgUnit>) => g.org.saveOrgUnit(t, a, input), { roots: ['orgUnits', 'employees'], success: 'Đã lưu đơn vị.' });

export const useSavePosition = () =>
  useOrgMutation((g, t, a, input: Upsert<JobPosition>) => g.org.savePosition(t, a, input), { roots: ['positions'], success: 'Đã lưu chức danh.' });

export const useSaveEmployee = () =>
  useOrgMutation((g, t, a, input: Upsert<Employee>) => g.org.saveEmployee(t, a, input), { roots: ['employees', 'assignments'], success: 'Đã lưu hồ sơ nhân viên.' });

export const useSaveAssignment = () =>
  useOrgMutation((g, t, a, input: Upsert<EmployeeAssignment>) => g.org.saveAssignment(t, a, input), { roots: ['assignments', 'employees'], success: 'Đã lưu phân công.' });

export const useSaveUserAccount = () =>
  useOrgMutation((g, t, a, input: Upsert<UserAccount, 'lastLoginAt'>) => g.org.saveUserAccount(t, a, input), { roots: ['userAccounts', 'roles'], success: 'Đã lưu tài khoản.' });

export const useSaveUserRole = () =>
  useOrgMutation((g, t, a, input: Upsert<UserRole>) => g.org.saveUserRole(t, a, input), { roots: ['roles'], success: 'Đã gán vai trò.' });

export const useDeleteUserRole = () =>
  useOrgMutation((g, t, a, userRoleId: Id) => g.org.deleteUserRole(t, a, userRoleId), { roots: ['roles'], success: 'Đã gỡ vai trò.' });

export const useSetRolePermissions = () =>
  useOrgMutation(
    (g, t, a, v: { roleId: Id; permissionIds: readonly Id[] }): Promise<RolePermission[]> => g.org.setRolePermissions(t, a, v.roleId, v.permissionIds),
    { roots: ['roles'], success: 'Đã lưu quyền của vai trò.' },
  );

/** The tenant record. Its time zone moves "today", so the dated org reads refresh too. */
export const useSaveTenant = () =>
  useOrgMutation((g, _t, a, input: Omit<Tenant, 'createdAt'>) => g.platform.saveTenant(a, input), {
    roots: ['orgUnits', 'employees', 'assignments'],
    tenants: true,
    success: 'Đã lưu thông tin công ty.',
  });

/** Where a resignation stopped: the accounts could not be locked (nothing changed), or they were but the resignation failed. */
export type ResignStage = 'lock' | 'resign';

export class ResignError extends Error {
  constructor(
    readonly stage: ResignStage,
    readonly cause: unknown,
  ) {
    super(`resignation failed at ${stage}`);
    this.name = 'ResignError';
  }
}

/**
 * "Cho nghỉ việc" — LOCKS THE ACCOUNTS FIRST, then records the last working day (which ends the
 * assignments, B3). In that order a failure never leaves someone who has left with a live login.
 * A `ResignError` says which step failed; the dialog stays open and "Thử lại" runs it again (the
 * accounts already locked are no longer in `activeAccounts` once the queries refresh).
 */
export function useResignEmployee() {
  const { tenantId, user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: { employee: Employee; leftOn: string; activeAccounts: readonly UserAccount[] }) => {
      const gateway = getDataGateway();
      for (const account of v.activeAccounts) {
        try {
          await gateway.org.saveUserAccount(tenantId, user.id, { ...account, status: 'Inactive' });
        } catch (error) {
          throw new ResignError('lock', error);
        }
      }
      try {
        return await gateway.org.saveEmployee(tenantId, user.id, { ...v.employee, employmentStatus: 'Resigned', leftOn: v.leftOn });
      } catch (error) {
        throw new ResignError('resign', error);
      }
    },
    onSuccess: () => toast.success('Đã ghi nhận nghỉ việc.'),
    onError: (error) => toastWriteError(error instanceof ResignError ? error.cause : error),
    onSettled: async () => {
      await Promise.all((['employees', 'assignments', 'userAccounts', 'orgUnits'] as const).map((root) => queryClient.invalidateQueries({ queryKey: [tenantId, root] })));
    },
  });
}
