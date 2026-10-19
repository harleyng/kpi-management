import type { Employee, EmployeeAssignment, Id } from '@/data/types';
import { descendantUnitIds, isEffectiveOn } from '@/lib/orgRules';
import { matchesSearch } from '@/lib/search';
import type { AssignmentFilter, EmployeeFilter, OrgGateway } from '../../types';
import { eqOpt } from '../rows';
import type { Runtime } from '../runtime';
import type { Tx } from '../store';
import {
  deleteUserRoleTx,
  saveAccountTx,
  saveAssignmentTx,
  saveEmployeeTx,
  saveOrgUnitTx,
  savePositionTx,
  saveUserRoleTx,
  setRolePermissionsTx,
} from './orgTx';

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
    saveOrgUnit: rt.write('org.saveOrgUnit', { permission: 'org.manage' }, (tx, input: Parameters<OrgGateway['saveOrgUnit']>[2]) =>
      saveOrgUnitTx(tx, input),
    ),

    listPositions: rt.read('org.listPositions', (tx) => tx.all('JobPosition')),
    savePosition: rt.write('org.savePosition', { permission: 'org.manage' }, (tx, input: Parameters<OrgGateway['savePosition']>[2]) =>
      savePositionTx(tx, input),
    ),

    listEmployees: rt.read('org.listEmployees', (tx, filter?: EmployeeFilter) => listEmployees(tx, filter)),
    getEmployee: rt.read('org.getEmployee', (tx, employeeId: Id) => tx.get('Employee', employeeId)),
    saveEmployee: rt.write('org.saveEmployee', { permission: 'org.manage' }, (tx, input: Parameters<OrgGateway['saveEmployee']>[2]) =>
      saveEmployeeTx(tx, input),
    ),

    listAssignments: rt.read('org.listAssignments', (tx, filter?: AssignmentFilter) => listAssignments(tx, filter)),
    saveAssignment: rt.write('org.saveAssignment', { permission: 'org.manage' }, (tx, input: Parameters<OrgGateway['saveAssignment']>[2]) =>
      saveAssignmentTx(tx, input),
    ),

    listUserAccounts: rt.read('org.listUserAccounts', (tx) => tx.all('UserAccount')),
    getUserAccount: rt.read('org.getUserAccount', (tx, userId: Id) => tx.get('UserAccount', userId)),
    saveUserAccount: rt.write('org.saveUserAccount', { permission: 'user.manage' }, (tx, input: Parameters<OrgGateway['saveUserAccount']>[2]) =>
      saveAccountTx(tx, input),
    ),

    listRoles: rt.read('org.listRoles', (tx) => tx.all('Role')),
    listPermissions: rt.read('org.listPermissions', (tx) => [...tx.globals.permissions.values()]),
    listRolePermissions: rt.read('org.listRolePermissions', (tx) => tx.all('RolePermission')),
    setRolePermissions: rt.write('org.setRolePermissions', { permission: 'user.manage' }, (tx, roleId: Id, permissionIds: readonly Id[]) =>
      setRolePermissionsTx(tx, roleId, permissionIds),
    ),

    listUserRoles: rt.read('org.listUserRoles', (tx, userId?: Id) => tx.all('UserRole').filter((r) => eqOpt(userId, r.userId))),
    saveUserRole: rt.write('org.saveUserRole', { permission: 'user.manage' }, (tx, input: Parameters<OrgGateway['saveUserRole']>[2]) =>
      saveUserRoleTx(tx, input),
    ),
    deleteUserRole: rt.write('org.deleteUserRole', { permission: 'user.manage' }, (tx, userRoleId: Id) => {
      deleteUserRoleTx(tx, userRoleId);
    }),
  };
}
