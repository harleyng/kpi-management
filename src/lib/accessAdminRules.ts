/**
 * Access guards (Track T1, WBS 4.1.5–4.1.6) — accounts, role assignments, the role → permission
 * matrix, and the rails that keep the company administrable. `RuleIssue[]`, never thrown; shared by
 * the screens (pre-check) and the gateway (`mock/groups/orgTx.ts`). Ids are resolved by the caller
 * first, like `orgAdminRules`. A Syntra decision throughout (`ASSUMPTION Q12`, `Q24`).
 */

import type {
  Employee,
  EmployeeAssignment,
  Id,
  IsoDate,
  OrgUnit,
  Permission,
  Role,
  RolePermission,
  ScopeType,
  UserAccount,
  UserRole,
} from '@/data/types';
import { ruleIssue, type RuleIssue } from './errorCatalog';
import type { Draft } from './orgAdminRules';
import { isStillEmployedOn, scopeCoversEmployee, scopeSubjectOn } from './orgRules';
import { buildAccessProfile, can, permissionId } from './permissionRules';

const blank = (value: string | null | undefined) => value === null || value === undefined || value.trim() === '';
const sameText = (a: string, b: string) => a.trim().toLocaleLowerCase('vi') === b.trim().toLocaleLowerCase('vi');

// ─── Accounts (BR-KPI-71) ──────────────────────────────────────────────────────────────────────

/** A login is letters, digits, `.`, `_` and `-` — what the simulated sign-in shows and searches. */
const LOGIN = /^[a-z0-9._-]+$/i;

export type AccountDraft = Omit<Draft<UserAccount>, 'lastLoginAt'>;

export function accountIssues(
  next: AccountDraft,
  prev: UserAccount | null,
  ctx: { accounts: readonly UserAccount[]; employees: readonly Employee[]; today: IsoDate },
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (blank(next.login)) issues.push(ruleIssue('ERR-KPI-06', 'login', 'REQUIRED'));
  else if (!LOGIN.test(next.login.trim())) issues.push(ruleIssue('ERR-KPI-06', 'login', 'LOGIN_INVALID'));
  else if ((prev === null || !sameText(prev.login, next.login)) && ctx.accounts.some((a) => a.id !== next.id && sameText(a.login, next.login))) {
    issues.push(ruleIssue('ERR-KPI-06', 'login', 'LOGIN_TAKEN'));
  }
  if (blank(next.displayName)) issues.push(ruleIssue('ERR-KPI-06', 'displayName', 'REQUIRED'));

  // The person behind an account is fixed at creation: re-pointing it would carry their roles, their
  // EMPLOYEE / Self row and their history to someone else.
  if (prev && prev.employeeId !== next.employeeId) issues.push(ruleIssue('ERR-KPI-06', 'employeeId', 'EMPLOYEE_IMMUTABLE'));

  const activating = next.status === 'Active' && (prev === null || prev.status !== 'Active');
  if (activating && next.employeeId !== null) {
    if (ctx.accounts.some((a) => a.id !== next.id && a.employeeId === next.employeeId && a.status === 'Active')) {
      issues.push(ruleIssue('ERR-KPI-06', 'employeeId', 'ACCOUNT_EXISTS'));
    }
    const person = ctx.employees.find((e) => e.id === next.employeeId);
    if (person && !isStillEmployedOn(person, ctx.today)) issues.push(ruleIssue('ERR-KPI-06', 'status', 'EMPLOYEE_LEFT'));
  }
  return issues;
}

/** B2 — a new account of an employee also gets EMPLOYEE / Self, in the same write (BR-KPI-62). */
export function accountPlan(next: AccountDraft, prev: UserAccount | null): { grantEmployeeSelf: boolean } {
  return { grantEmployeeSelf: prev === null && next.employeeId !== null };
}

// ─── Role assignments (BR-KPI-72) ──────────────────────────────────────────────────────────────

interface RoleRowContext {
  roles: readonly Role[];
  accounts: readonly UserAccount[];
}

/** The EMPLOYEE / Self row of an account that has an employee — every such account keeps it. */
export function isProtectedUserRole(row: Pick<UserRole, 'userId' | 'roleId' | 'scopeType'>, ctx: RoleRowContext): boolean {
  const role = ctx.roles.find((r) => r.id === row.roleId);
  const account = ctx.accounts.find((a) => a.id === row.userId);
  return role?.code === 'EMPLOYEE' && row.scopeType === 'Self' && account !== undefined && account.employeeId !== null;
}

export function userRoleIssues(
  next: Draft<UserRole>,
  prev: UserRole | null,
  ctx: RoleRowContext & { userRoles: readonly UserRole[] },
): RuleIssue[] {
  if (prev && isProtectedUserRole(prev, ctx)) {
    const same = prev.userId === next.userId && prev.roleId === next.roleId && prev.scopeType === next.scopeType && prev.scopeOrgUnitId === next.scopeOrgUnitId && prev.includeChildren === next.includeChildren;
    return same ? [] : [ruleIssue('ERR-KPI-06', 'roleId', 'EMPLOYEE_SELF_REQUIRED')];
  }
  const issues: RuleIssue[] = [];
  const role = ctx.roles.find((r) => r.id === next.roleId);
  const account = ctx.accounts.find((a) => a.id === next.userId);
  if (role?.code === 'EMPLOYEE' && account && account.employeeId === null) issues.push(ruleIssue('ERR-KPI-06', 'roleId', 'EMPLOYEE_ROLE_NEEDS_EMPLOYEE'));
  if (role && role.code !== 'EMPLOYEE' && next.scopeType === 'Self') issues.push(ruleIssue('ERR-KPI-06', 'scopeType', 'SELF_SCOPE_ROLE'));
  if (next.scopeType === 'OrgUnit' && next.scopeOrgUnitId === null) issues.push(ruleIssue('ERR-KPI-06', 'scopeOrgUnitId', 'REQUIRED'));
  const duplicate = ctx.userRoles.some(
    (r) => r.id !== next.id && r.userId === next.userId && r.roleId === next.roleId && r.scopeType === next.scopeType && r.scopeOrgUnitId === next.scopeOrgUnitId,
  );
  if (duplicate) issues.push(ruleIssue('ERR-KPI-06', 'roleId', 'ROLE_DUPLICATE'));
  return issues;
}

export function userRoleRemovalIssues(row: UserRole, ctx: RoleRowContext): RuleIssue[] {
  return isProtectedUserRole(row, ctx) ? [ruleIssue('ERR-KPI-06', 'roleId', 'EMPLOYEE_SELF_REQUIRED')] : [];
}

// ─── Keeping the company administrable (BR-KPI-72) ─────────────────────────────────────────────

/** The rows a change can touch; everything else is `AccessContext`. */
export interface AccessState {
  accounts: readonly UserAccount[];
  userRoles: readonly UserRole[];
  rolePermissions: readonly RolePermission[];
}

export interface AccessContext {
  tenantId: Id;
  actorUserId: Id;
  roles: readonly Role[];
  permissions: readonly Permission[];
  units: readonly OrgUnit[];
  employees: readonly Employee[];
  assignments: readonly EmployeeAssignment[];
  today: IsoDate;
}

/** Active accounts of this tenant holding ADMIN with a company-wide scope. */
export function tenantAdmins(state: AccessState, ctx: Pick<AccessContext, 'tenantId' | 'roles'>): UserAccount[] {
  const admin = ctx.roles.find((r) => r.code === 'ADMIN' && r.tenantId === ctx.tenantId);
  if (!admin) return [];
  const holders = new Set(state.userRoles.filter((r) => r.tenantId === ctx.tenantId && r.roleId === admin.id && r.scopeType === 'Tenant').map((r) => r.userId));
  return state.accounts.filter((a) => a.tenantId === ctx.tenantId && a.status === 'Active' && holders.has(a.id));
}

/** The permissions ADMIN may never lose — without them nobody could repair the org or the matrix. */
export const ADMIN_LOCKED_PERMISSIONS = ['org.manage', 'user.manage'] as const;

function adminKeepsLocked(state: AccessState, ctx: Pick<AccessContext, 'tenantId' | 'roles'>): boolean {
  const admin = ctx.roles.find((r) => r.code === 'ADMIN' && r.tenantId === ctx.tenantId);
  if (!admin) return false;
  const held = new Set(state.rolePermissions.filter((rp) => rp.roleId === admin.id).map((rp) => rp.permissionId));
  return ADMIN_LOCKED_PERMISSIONS.every((code) => held.has(permissionId(code)));
}

function actorManagesUsers(state: AccessState, ctx: AccessContext): boolean {
  const account = state.accounts.find((a) => a.id === ctx.actorUserId);
  if (!account) return false;
  const profile = buildAccessProfile({
    tenantId: ctx.tenantId,
    account,
    roles: ctx.roles,
    userRoles: state.userRoles,
    permissions: ctx.permissions,
    rolePermissions: state.rolePermissions,
    orgUnits: ctx.units,
    assignments: ctx.assignments,
    employees: ctx.employees,
    asOf: ctx.today,
  });
  return can(profile, 'user.manage');
}

/**
 * Compares the access rows before and after a change and refuses (ERR-KPI-15) what it would break:
 * the last Active company-wide ADMIN, ADMIN's `org.manage` / `user.manage`, or the actor's own
 * `user.manage`. Only a LOSS is refused — a state that was already short stays editable.
 */
export function accessIssues(before: AccessState, after: AccessState, ctx: AccessContext): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (tenantAdmins(before, ctx).length > 0 && tenantAdmins(after, ctx).length === 0) issues.push(ruleIssue('ERR-KPI-15', null, 'LAST_ADMIN'));
  if (adminKeepsLocked(before, ctx) && !adminKeepsLocked(after, ctx)) issues.push(ruleIssue('ERR-KPI-15', null, 'ADMIN_PERMISSIONS'));
  if (actorManagesUsers(before, ctx) && !actorManagesUsers(after, ctx)) issues.push(ruleIssue('ERR-KPI-15', null, 'SELF_LOCKOUT'));
  return issues;
}

// ─── Scope preview ─────────────────────────────────────────────────────────────────────────────

export type ScopeDraft = Pick<UserRole, 'userId' | 'scopeType' | 'scopeOrgUnitId' | 'includeChildren'>;

/** How many people (still employed today) a role assignment's scope reaches — "Phạm vi này gồm N nhân viên". */
export function scopeCoverage(
  draft: ScopeDraft,
  ctx: { accounts: readonly UserAccount[]; employees: readonly Employee[]; assignments: readonly EmployeeAssignment[]; units: readonly OrgUnit[]; today: IsoDate },
): number {
  const actorEmployeeId = ctx.accounts.find((a) => a.id === draft.userId)?.employeeId ?? null;
  const row: UserRole = { id: '', tenantId: '', roleId: '', ...draft };
  return ctx.employees.filter((e) => scopeCoversEmployee(row, scopeSubjectOn(e, ctx.assignments, ctx.today), { units: ctx.units, actorEmployeeId })).length;
}

const SCOPE_WIDTH: Readonly<Record<ScopeType, number>> = { Self: 0, DirectReports: 1, OrgUnit: 2, Tenant: 3 };

/** The widest scope among an account's role assignments ("Phạm vi rộng nhất"); `null` with none. */
export function widestScope(rows: readonly Pick<UserRole, 'scopeType'>[]): ScopeType | null {
  return rows.reduce<ScopeType | null>((best, r) => (best === null || SCOPE_WIDTH[r.scopeType] > SCOPE_WIDTH[best] ? r.scopeType : best), null);
}
