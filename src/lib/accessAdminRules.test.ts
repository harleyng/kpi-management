import { describe, expect, it } from 'vitest';
import type { RolePermission } from '@/data/types';
import { assignment, employee, orgUnit, role, TENANT, user, userRole } from '@/test/builders';
import {
  accessIssues,
  accountIssues,
  accountPlan,
  isProtectedUserRole,
  scopeCoverage,
  tenantAdmins,
  userRoleIssues,
  userRoleRemovalIssues,
  widestScope,
  type AccessState,
} from './accessAdminRules';
import type { RuleIssue } from './errorCatalog';
import { permissionId, permissionRows } from './permissionRules';

const TODAY = '2027-04-06';
const details = (issues: readonly RuleIssue[]) => issues.map((i) => `${i.code}:${i.detail}`);

const e1 = employee({ id: 'e1' });
const e2 = employee({ id: 'e2', employeeCode: 'E2', email: 'e2@x.test' });
const gone = employee({ id: 'gone', employeeCode: 'G', email: 'g@x.test', employmentStatus: 'Resigned', leftOn: '2027-03-10' });
const employees = [e1, e2, gone];

describe('accounts — BR-KPI-71', () => {
  const u1 = user({ id: 'u1', employeeId: 'e1', login: 'an.nv' });
  const ctx = { accounts: [u1], employees, today: TODAY };
  const draft = (o: Partial<ReturnType<typeof user>> = {}) => {
    const { lastLoginAt: _drop, ...row } = user({ employeeId: 'e2', login: 'binh.tt', displayName: 'Bình', ...o });
    return { ...row, id: undefined };
  };

  it('accepts a new account for a person without one', () => {
    expect(accountIssues(draft(), null, ctx)).toEqual([]);
  });

  it.each([
    ['a login in another case', { login: 'AN.NV' }, ['ERR-KPI-06:LOGIN_TAKEN']],
    ['a login with spaces', { login: 'an nv' }, ['ERR-KPI-06:LOGIN_INVALID']],
    ['a blank display name', { displayName: ' ' }, ['ERR-KPI-06:REQUIRED']],
    ['a second Active account for the same person', { employeeId: 'e1', login: 'an.nv2' }, ['ERR-KPI-06:ACCOUNT_EXISTS']],
    ['an Active account for someone who has left', { employeeId: 'gone', login: 'son.dv' }, ['ERR-KPI-06:EMPLOYEE_LEFT']],
  ] as const)('refuses %s', (_, change, expected) => {
    expect(details(accountIssues(draft(change), null, ctx))).toEqual(expected);
  });

  it('allows an Inactive second account (an old login kept for history)', () => {
    expect(accountIssues(draft({ employeeId: 'e1', login: 'an.nv.cu', status: 'Inactive' }), null, ctx)).toEqual([]);
  });

  it('the person behind an account cannot change', () => {
    expect(details(accountIssues({ ...u1, employeeId: 'e2' }, u1, ctx))).toEqual(['ERR-KPI-06:EMPLOYEE_IMMUTABLE']);
  });

  it('a new account of an employee is granted EMPLOYEE / Self; a system account or an update is not', () => {
    expect(accountPlan(draft(), null)).toEqual({ grantEmployeeSelf: true });
    expect(accountPlan(draft({ employeeId: null }), null)).toEqual({ grantEmployeeSelf: false });
    expect(accountPlan(u1, u1)).toEqual({ grantEmployeeSelf: false });
  });
});

describe('role assignments — BR-KPI-62, 72', () => {
  const roles = [role({ id: 'r-EMPLOYEE', code: 'EMPLOYEE' }), role({ id: 'r-MANAGER', code: 'MANAGER' }), role({ id: 'r-ADMIN', code: 'ADMIN' })];
  const accounts = [user({ id: 'u1', employeeId: 'e1' }), user({ id: 'sys', employeeId: null, login: 'sys' })];
  const selfRow = userRole({ id: 'self', userId: 'u1', roleId: 'r-EMPLOYEE', scopeType: 'Self' });
  const ctx = { roles, accounts, userRoles: [selfRow] };
  const draft = (o: Partial<ReturnType<typeof userRole>>) => ({ ...userRole({ userId: 'u1', ...o }), id: undefined });

  it('protects the EMPLOYEE / Self row of an account with an employee', () => {
    expect(isProtectedUserRole(selfRow, ctx)).toBe(true);
    expect(details(userRoleRemovalIssues(selfRow, ctx))).toEqual(['ERR-KPI-06:EMPLOYEE_SELF_REQUIRED']);
    expect(details(userRoleIssues({ ...selfRow, scopeType: 'Tenant' }, selfRow, ctx))).toEqual(['ERR-KPI-06:EMPLOYEE_SELF_REQUIRED']);
    expect(userRoleIssues(selfRow, selfRow, ctx)).toEqual([]);
  });

  it.each([
    ['MANAGER on a Self scope', { roleId: 'r-MANAGER', scopeType: 'Self' }, ['ERR-KPI-06:SELF_SCOPE_ROLE']],
    ['EMPLOYEE for a system account', { userId: 'sys', roleId: 'r-EMPLOYEE', scopeType: 'Self' }, ['ERR-KPI-06:EMPLOYEE_ROLE_NEEDS_EMPLOYEE']],
    ['an OrgUnit scope without a unit', { roleId: 'r-MANAGER', scopeType: 'OrgUnit', scopeOrgUnitId: null }, ['ERR-KPI-06:REQUIRED']],
    ['the same role and scope twice', { roleId: 'r-EMPLOYEE', scopeType: 'Self' }, ['ERR-KPI-06:ROLE_DUPLICATE']],
  ] as const)('refuses %s', (_, change, expected) => {
    expect(details(userRoleIssues(draft(change), null, ctx))).toEqual(expected);
  });

  it('accepts MANAGER over a unit and its children', () => {
    expect(userRoleIssues(draft({ roleId: 'r-MANAGER', scopeType: 'OrgUnit', scopeOrgUnitId: 'ou-root', includeChildren: true }), null, ctx)).toEqual([]);
  });
});

describe('keeping the company administrable — BR-KPI-72', () => {
  const roles = [role({ id: 'r-ADMIN', code: 'ADMIN' }), role({ id: 'r-HR', code: 'HR' })];
  const grant = (roleId: string, codes: readonly string[]): RolePermission[] => codes.map((c) => ({ tenantId: TENANT, roleId, permissionId: `perm.${c}` }));
  const base: AccessState = {
    accounts: [user({ id: 'admin', employeeId: 'e1', login: 'admin' }), user({ id: 'hr', employeeId: 'e2', login: 'hr' })],
    userRoles: [
      userRole({ id: 'ur-admin', userId: 'admin', roleId: 'r-ADMIN' }),
      userRole({ id: 'ur-hr', userId: 'hr', roleId: 'r-HR' }),
    ],
    rolePermissions: [...grant('r-ADMIN', ['org.manage', 'user.manage', 'org.view']), ...grant('r-HR', ['user.manage'])],
  };
  const ctx = { tenantId: TENANT, actorUserId: 'hr', roles, permissions: permissionRows(), units: [orgUnit()], employees, assignments: [], today: TODAY };

  it('counts Active company-wide ADMINs of this tenant only', () => {
    expect(tenantAdmins(base, ctx).map((a) => a.id)).toEqual(['admin']);
    const foreign = { ...base, userRoles: [...base.userRoles, userRole({ id: 'x', userId: 'hr', roleId: 'r-ADMIN', tenantId: 'other' })] };
    expect(tenantAdmins(foreign, ctx).map((a) => a.id)).toEqual(['admin']);
  });

  it.each([
    ['removing the last ADMIN row', { userRoles: [base.userRoles[1]] }],
    ['deactivating the last ADMIN account', { accounts: [{ ...base.accounts[0], status: 'Inactive' as const }, base.accounts[1]] }],
    ['narrowing the last ADMIN to a unit', { userRoles: [{ ...base.userRoles[0], scopeType: 'OrgUnit' as const, scopeOrgUnitId: 'ou-root' }, base.userRoles[1]] }],
  ])('refuses %s (LAST_ADMIN)', (_, change) => {
    expect(details(accessIssues(base, { ...base, ...change }, ctx))).toEqual(['ERR-KPI-15:LAST_ADMIN']);
  });

  it('refuses taking org.manage or user.manage from ADMIN', () => {
    const after = { ...base, rolePermissions: [...grant('r-ADMIN', ['org.manage', 'org.view']), ...grant('r-HR', ['user.manage'])] };
    expect(details(accessIssues(base, after, ctx))).toEqual(['ERR-KPI-15:ADMIN_PERMISSIONS']);
    // The admin doing it to themself also locks themself out.
    expect(details(accessIssues(base, after, { ...ctx, actorUserId: 'admin' }))).toEqual(['ERR-KPI-15:ADMIN_PERMISSIONS', 'ERR-KPI-15:SELF_LOCKOUT']);
  });

  it('refuses the actor taking user.manage from themself, not from someone else', () => {
    const after = { ...base, rolePermissions: [...grant('r-ADMIN', ['org.manage', 'user.manage']), ...grant('r-HR', [])] };
    expect(details(accessIssues(base, after, ctx))).toEqual(['ERR-KPI-15:SELF_LOCKOUT']);
    expect(accessIssues(base, after, { ...ctx, actorUserId: 'admin' })).toEqual([]);
  });

  it('refuses only a loss: a state that was already short stays editable', () => {
    const short = { ...base, userRoles: [base.userRoles[1]] };
    expect(accessIssues(short, short, ctx)).toEqual([]);
  });

  it('a second ADMIN makes removing the first one fine', () => {
    const two = { ...base, userRoles: [...base.userRoles, userRole({ id: 'ur-hr-admin', userId: 'hr', roleId: 'r-ADMIN' })] };
    expect(accessIssues(two, { ...two, userRoles: two.userRoles.filter((r) => r.id !== 'ur-admin') }, ctx)).toEqual([]);
    expect(permissionId('user.manage')).toBe('perm.user.manage');
  });
});

describe('scope preview', () => {
  const units = [orgUnit({ id: 'root' }), orgUnit({ id: 'sale', parentId: 'root', unitType: 'Department' }), orgUnit({ id: 'team', parentId: 'sale', unitType: 'Team' })];
  const people = [employee({ id: 'm' }), employee({ id: 'a' }), employee({ id: 'b' }), employee({ id: 'c' }), gone];
  const assignments = [
    assignment({ id: '1', employeeId: 'm', orgUnitId: 'sale' }),
    assignment({ id: '2', employeeId: 'a', orgUnitId: 'sale', managerEmployeeId: 'm' }),
    assignment({ id: '3', employeeId: 'b', orgUnitId: 'team', managerEmployeeId: 'm' }),
    assignment({ id: '4', employeeId: 'c', orgUnitId: 'root' }),
    assignment({ id: '5', employeeId: 'gone', orgUnitId: 'sale', managerEmployeeId: 'm', effectiveTo: '2027-03-10' }),
  ];
  const ctx = { accounts: [user({ id: 'um', employeeId: 'm' })], employees: people, assignments, units, today: TODAY };
  const scope = (o: Partial<ReturnType<typeof userRole>>) => ({ userId: 'um', scopeType: 'Tenant' as const, scopeOrgUnitId: null, includeChildren: false, ...o });

  it.each([
    ['Self', scope({ scopeType: 'Self' }), 1],
    ['DirectReports (one level, leavers out)', scope({ scopeType: 'DirectReports' }), 2],
    ['OrgUnit without children', scope({ scopeType: 'OrgUnit', scopeOrgUnitId: 'sale' }), 2],
    ['OrgUnit with children', scope({ scopeType: 'OrgUnit', scopeOrgUnitId: 'sale', includeChildren: true }), 3],
    ['Tenant (still employed)', scope({}), 4],
  ] as const)('%s', (_, draft, count) => {
    expect(scopeCoverage(draft, ctx)).toBe(count);
  });

  it('names the widest scope of an account', () => {
    expect(widestScope([{ scopeType: 'Self' }, { scopeType: 'OrgUnit' }])).toBe('OrgUnit');
    expect(widestScope([])).toBeNull();
  });
});
