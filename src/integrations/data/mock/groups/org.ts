import type { Employee, EmployeeAssignment, Id, RolePermission } from '@/data/types';
import { descendantUnitIds, isEffectiveOn } from '@/lib/orgRules';
import { matchesSearch } from '@/lib/search';
import type { AssignmentFilter, EmployeeFilter, OrgGateway } from '../../types';
import { removeRow } from '../integrity';
import { eqOpt, upsert, whereEq } from '../rows';
import type { Runtime } from '../runtime';
import type { Tx } from '../store';

/** `undefined` date = any assignment ever (EmployeeFilter.activeOn: "omitted, no date filter"). */
const effective = (a: EmployeeAssignment, date: string | undefined) => date === undefined || isEffectiveOn(a, date);

function listEmployees(tx: Tx, filter: EmployeeFilter = {}): Employee[] {
  const assignments = tx.all('EmployeeAssignment');
  const unitIds =
    filter.orgUnitId === undefined
      ? null
      : filter.includeChildUnits
        ? descendantUnitIds(tx.all('OrgUnit'), filter.orgUnitId)
        : new Set<Id>([filter.orgUnitId]);
  const hasAssignment = (employeeId: Id, ok: (a: EmployeeAssignment) => boolean) =>
    assignments.some((a) => a.employeeId === employeeId && effective(a, filter.activeOn) && ok(a));

  return tx.all('Employee').filter((e) => {
    if (!filter.includeResigned && e.employmentStatus === 'Resigned') return false;
    if (unitIds && !hasAssignment(e.id, (a) => unitIds.has(a.orgUnitId))) return false;
    if (filter.managerEmployeeId !== undefined && !hasAssignment(e.id, (a) => a.managerEmployeeId === filter.managerEmployeeId)) return false;
    if (filter.activeOn !== undefined && !hasAssignment(e.id, () => true)) return false;
    if (filter.search !== undefined && !matchesSearch(filter.search, [e.fullName, e.employeeCode, e.email])) return false;
    return true;
  });
}

function listAssignments(tx: Tx, filter: AssignmentFilter = {}): EmployeeAssignment[] {
  return tx
    .all('EmployeeAssignment')
    .filter(
      (a) =>
        eqOpt(filter.employeeId, a.employeeId) &&
        eqOpt(filter.orgUnitId, a.orgUnitId) &&
        (filter.managerEmployeeId === undefined || a.managerEmployeeId === filter.managerEmployeeId) &&
        effective(a, filter.activeOn),
    );
}

export function orgGroup(rt: Runtime): OrgGateway {
  return {
    listOrgUnits: rt.read('org.listOrgUnits', (tx) => tx.all('OrgUnit')),
    saveOrgUnit: rt.write('org.saveOrgUnit', (tx, input: Parameters<OrgGateway['saveOrgUnit']>[2]) =>
      upsert(tx, 'OrgUnit', input, { create: () => ({}) }),
    ),

    listPositions: rt.read('org.listPositions', (tx) => tx.all('JobPosition')),
    savePosition: rt.write('org.savePosition', (tx, input: Parameters<OrgGateway['savePosition']>[2]) =>
      upsert(tx, 'JobPosition', input, { create: () => ({}) }),
    ),

    listEmployees: rt.read('org.listEmployees', (tx, filter?: EmployeeFilter) => listEmployees(tx, filter)),
    getEmployee: rt.read('org.getEmployee', (tx, employeeId: Id) => tx.get('Employee', employeeId)),
    saveEmployee: rt.write('org.saveEmployee', (tx, input: Parameters<OrgGateway['saveEmployee']>[2]) =>
      upsert(tx, 'Employee', input, { create: () => ({}) }),
    ),

    listAssignments: rt.read('org.listAssignments', (tx, filter?: AssignmentFilter) => listAssignments(tx, filter)),
    saveAssignment: rt.write('org.saveAssignment', (tx, input: Parameters<OrgGateway['saveAssignment']>[2]) =>
      upsert(tx, 'EmployeeAssignment', input, { create: () => ({}) }),
    ),

    listUserAccounts: rt.read('org.listUserAccounts', (tx) => tx.all('UserAccount')),
    getUserAccount: rt.read('org.getUserAccount', (tx, userId: Id) => tx.get('UserAccount', userId)),
    saveUserAccount: rt.write('org.saveUserAccount', (tx, input: Parameters<OrgGateway['saveUserAccount']>[2]) =>
      upsert(tx, 'UserAccount', input, { create: () => ({ lastLoginAt: null }) }),
    ),

    listRoles: rt.read('org.listRoles', (tx) => tx.all('Role')),
    listPermissions: rt.read('org.listPermissions', (tx) => [...tx.globals.permissions.values()]),
    listRolePermissions: rt.read('org.listRolePermissions', (tx) => tx.all('RolePermission')),
    setRolePermissions: rt.write('org.setRolePermissions', (tx, roleId: Id, permissionIds: readonly Id[]) => {
      tx.get('Role', roleId);
      for (const row of whereEq(tx, 'RolePermission', 'roleId', roleId)) removeRow(tx, 'RolePermission', `${row.roleId}|${row.permissionId}`);
      return permissionIds.map((permissionId) =>
        tx.insert('RolePermission', { tenantId: tx.tenantId, roleId, permissionId } satisfies RolePermission),
      );
    }),

    listUserRoles: rt.read('org.listUserRoles', (tx, userId?: Id) => tx.all('UserRole').filter((r) => eqOpt(userId, r.userId))),
    saveUserRole: rt.write('org.saveUserRole', (tx, input: Parameters<OrgGateway['saveUserRole']>[2]) =>
      upsert(tx, 'UserRole', input, { create: () => ({}) }),
    ),
    deleteUserRole: rt.write('org.deleteUserRole', (tx, userRoleId: Id) => {
      removeRow(tx, 'UserRole', userRoleId);
    }),
  };
}
