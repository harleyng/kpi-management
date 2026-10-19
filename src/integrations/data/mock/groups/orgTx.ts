import type { Employee, EmployeeAssignment, Id, JobPosition, OrgUnit, RolePermission, UserAccount, UserRole } from '@/data/types';
import { accessIssues, accountIssues, accountPlan, userRoleIssues, userRoleRemovalIssues, type AccessState, type AccountDraft } from '@/lib/accessAdminRules';
import { KpiError } from '@/lib/errorCatalog';
import { todayOf } from '@/lib/isoDate';
import { assignmentIssues, employeeIssues, positionIssues, resignationPlan, transferPlan, unitIssues, type Draft } from '@/lib/orgAdminRules';
import { clockOf } from '../authorize';
import { removeRow, validateTransaction } from '../integrity';
import { newId, upsert, whereEq } from '../rows';
import type { Tx } from '../store';
import { throwIssues } from '../workflowContext';

/**
 * The org writes at transaction level (Track T1) — what `org.save*` run, and what T4's
 * `actuals.commitImport` calls for an OrgData batch (a gateway method cannot call another one), so an
 * imported person gets exactly the guards, the transfer (B1) and the account's EMPLOYEE / Self (B2)
 * that the screens do. Commit order for an import: employees → assignments → accounts.
 *
 * Each helper: write the rows → `validateTransaction` (references in the tenant, owners, unique
 * indexes, CHECKs — so another tenant's id is refused exactly like a missing one, before any rule
 * reads it) → the business rules (`orgAdminRules`, `accessAdminRules`) on the written state against
 * the stored row → `throwIssues`. Nothing is saved unless the whole write commits.
 */

const todayIn = (tx: Tx) => todayOf(clockOf(tx));

function orgRows(tx: Tx) {
  return {
    units: tx.all('OrgUnit'),
    positions: tx.all('JobPosition'),
    employees: tx.all('Employee'),
    assignments: tx.all('EmployeeAssignment'),
    accounts: tx.all('UserAccount'),
    plans: tx.all('GoalPlan'),
    cycles: tx.all('PerformanceCycle'),
    today: todayIn(tx),
  };
}

const stored = <C extends 'OrgUnit' | 'JobPosition' | 'Employee' | 'EmployeeAssignment' | 'UserAccount' | 'UserRole'>(tx: Tx, c: C, id: Id | undefined) =>
  id === undefined ? null : tx.get(c, id);

export function saveOrgUnitTx(tx: Tx, input: Draft<OrgUnit>): OrgUnit {
  const prev = stored(tx, 'OrgUnit', input.id);
  const saved = upsert(tx, 'OrgUnit', input, { create: () => ({}) });
  validateTransaction(tx);
  throwIssues(unitIssues(saved, prev, orgRows(tx)));
  return saved;
}

export function savePositionTx(tx: Tx, input: Draft<JobPosition>): JobPosition {
  const prev = stored(tx, 'JobPosition', input.id);
  const saved = upsert(tx, 'JobPosition', input, { create: () => ({}) });
  validateTransaction(tx);
  throwIssues(positionIssues(saved, prev, orgRows(tx)));
  return saved;
}

/** B3 — recording a last working day ends the assignments that run past it, in the same write. */
export function saveEmployeeTx(tx: Tx, input: Draft<Employee>): Employee {
  const prev = stored(tx, 'Employee', input.id);
  const saved = upsert(tx, 'Employee', input, { create: () => ({}) });
  for (const ended of resignationPlan(saved, prev, tx.all('EmployeeAssignment'))) tx.update('EmployeeAssignment', ended);
  validateTransaction(tx);
  throwIssues(employeeIssues(saved, prev, orgRows(tx)));
  return saved;
}

/** B1 — a new primary assignment from D ends the running one on D − 1, in the same write. */
export function saveAssignmentTx(tx: Tx, input: Draft<EmployeeAssignment>): EmployeeAssignment {
  const prev = stored(tx, 'EmployeeAssignment', input.id);
  const plan = transferPlan(input, prev, tx.all('EmployeeAssignment'));
  throwIssues(plan.issues);
  if (plan.end) tx.update('EmployeeAssignment', plan.end);
  const saved = upsert(tx, 'EmployeeAssignment', input, { create: () => ({}) });
  validateTransaction(tx);
  throwIssues(assignmentIssues(saved, prev, orgRows(tx)));
  return saved;
}

function accessState(tx: Tx): AccessState {
  return { accounts: tx.all('UserAccount'), userRoles: tx.all('UserRole'), rolePermissions: tx.all('RolePermission') };
}

/** Refuses (ERR-KPI-15) a change that would leave the company without an administrator. */
function guardAccess(tx: Tx, before: AccessState): void {
  throwIssues(
    accessIssues(before, accessState(tx), {
      tenantId: tx.tenantId,
      actorUserId: tx.ctx.actorUserId as Id,
      roles: tx.all('Role'),
      permissions: [...tx.globals.permissions.values()],
      units: tx.all('OrgUnit'),
      employees: tx.all('Employee'),
      assignments: tx.all('EmployeeAssignment'),
      today: todayIn(tx),
    }),
  );
}

/** B2 — a new account of an employee also gets EMPLOYEE / Self (BR-KPI-62). */
export function saveAccountTx(tx: Tx, input: AccountDraft): UserAccount {
  const before = accessState(tx);
  const prev = stored(tx, 'UserAccount', input.id);
  const saved = upsert(tx, 'UserAccount', input, { create: () => ({ lastLoginAt: null }) });
  if (accountPlan(saved, prev).grantEmployeeSelf) {
    const employeeRole = tx.all('Role').find((r) => r.code === 'EMPLOYEE');
    if (!employeeRole) throw new KpiError('ERR-KPI-06', 'Role EMPLOYEE not found');
    tx.insert('UserRole', { id: newId(), tenantId: tx.tenantId, userId: saved.id, roleId: employeeRole.id, scopeType: 'Self', scopeOrgUnitId: null, includeChildren: false });
  }
  validateTransaction(tx);
  throwIssues(accountIssues(saved, prev, orgRows(tx)));
  guardAccess(tx, before);
  return saved;
}

export function saveUserRoleTx(tx: Tx, input: Draft<UserRole>): UserRole {
  const before = accessState(tx);
  const prev = stored(tx, 'UserRole', input.id);
  const saved = upsert(tx, 'UserRole', input, { create: () => ({}) });
  validateTransaction(tx);
  throwIssues(userRoleIssues(saved, prev, { roles: tx.all('Role'), accounts: tx.all('UserAccount'), userRoles: tx.all('UserRole') }));
  guardAccess(tx, before);
  return saved;
}

export function deleteUserRoleTx(tx: Tx, userRoleId: Id): void {
  const before = accessState(tx);
  const row = tx.get('UserRole', userRoleId);
  throwIssues(userRoleRemovalIssues(row, { roles: tx.all('Role'), accounts: tx.all('UserAccount') }));
  removeRow(tx, 'UserRole', userRoleId);
  guardAccess(tx, before);
}

/**
 * Replaces a role's permission set by DIFF — only the rows added and removed are written, so the
 * audit log records the real change, not a delete-and-reinsert of every row.
 */
export function setRolePermissionsTx(tx: Tx, roleId: Id, permissionIds: readonly Id[]): RolePermission[] {
  tx.get('Role', roleId);
  if (new Set(permissionIds).size !== permissionIds.length) throw new KpiError('ERR-KPI-06', 'RolePermission: a permission appears twice');
  const before = accessState(tx);
  const wanted = new Set(permissionIds);
  const current = whereEq(tx, 'RolePermission', 'roleId', roleId);
  for (const row of current) if (!wanted.has(row.permissionId)) removeRow(tx, 'RolePermission', `${row.roleId}|${row.permissionId}`);
  const held = new Set(current.map((r) => r.permissionId));
  for (const permissionId of permissionIds) {
    if (!held.has(permissionId)) tx.insert('RolePermission', { tenantId: tx.tenantId, roleId, permissionId } satisfies RolePermission);
  }
  validateTransaction(tx);
  guardAccess(tx, before);
  return permissionIds.map((permissionId) => ({ tenantId: tx.tenantId, roleId, permissionId }));
}
