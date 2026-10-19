/**
 * An in-test tenant for the permission and session tests — built WITHOUT the mock gateway, so the
 * rules are tested on their own. Not a `*.test.ts`, so Vitest does not run it; nothing in the app
 * imports it, so it never reaches the bundle.
 *
 * Ids carry the tenant (`t1-emp-head`), so a cross-tenant leak shows up as a wrong id in a failure.
 * Roles and role permissions come from `DEFAULT_ROLE_PERMISSIONS` / `DEFAULT_ROLE_SCOPE`, so the tests
 * exercise the real defaults the seed will load.
 *
 *   root (Company) ── sales (Department) ── salesA (Team)
 *        │                       └──────── salesB (Team, Inactive)
 *        └── ops (Department)
 *
 * People (asOf 2027-02-15): ceo (BOD, root) · head (MANAGER of sales) · lead (salesA, reports to head)
 * · emp (salesA, reports to lead) · emp2 (salesB, reports to head) · opsEmp (ops, reports to ceo) ·
 * hr (HR) · cnb (C&B) · admin (ADMIN) · left (resigned 2027-01-31, assignment closed) · idle (account
 * Inactive). Plus `system`: an ADMIN account with no employee.
 */

import {
  ROLE_CODES,
  type Employee,
  type EmployeeAssignment,
  type Id,
  type IsoDate,
  type OrgUnit,
  type Role,
  type RoleCode,
  type Tenant,
  type UserAccount,
  type UserRole,
} from '@/data/types';
import {
  DEFAULT_ROLE_SCOPE,
  buildAccessProfile,
  defaultRolePermissionRows,
  permissionRows,
  type AccessInputs,
  type AccessProfile,
} from './permissionRules';

export const AS_OF: IsoDate = '2027-02-15';

export const PEOPLE = ['ceo', 'head', 'lead', 'emp', 'emp2', 'opsEmp', 'hr', 'cnb', 'admin', 'left', 'idle'] as const;
export type Person = (typeof PEOPLE)[number];
export type AccountKey = Person | 'system';

export const UNITS = ['root', 'sales', 'salesA', 'salesB', 'ops'] as const;
export type UnitKey = (typeof UNITS)[number];

/** The role(s) beyond EMPLOYEE each account holds by default. */
const MAIN_ROLE: Readonly<Record<AccountKey, RoleCode | null>> = {
  ceo: 'BOD',
  head: 'MANAGER',
  lead: null,
  emp: null,
  emp2: null,
  opsEmp: null,
  hr: 'HR',
  cnb: 'CNB',
  admin: 'ADMIN',
  left: null,
  idle: null,
  system: 'ADMIN',
};

export interface TestTenant extends Omit<AccessInputs, 'account' | 'asOf'> {
  tenant: Tenant;
  accounts: UserAccount[];
  unit: (key: UnitKey) => Id;
  employee: (key: Person) => Id;
  user: (key: AccountKey) => Id;
  role: (code: RoleCode) => Id;
  /** The access inputs for one account, every array shared with the tenant. */
  inputsFor: (key: AccountKey, overrides?: Partial<AccessInputs>) => AccessInputs;
  profileOf: (key: AccountKey, overrides?: Partial<AccessInputs>) => AccessProfile;
  /** A USER_ROLE row for `key` — to give someone a non-default grant in a test. */
  grant: (key: AccountKey, code: RoleCode, scope: Pick<UserRole, 'scopeType' | 'scopeOrgUnitId' | 'includeChildren'>) => UserRole;
}

export function buildTenant(tenantId: Id): TestTenant {
  const unit = (key: UnitKey) => `${tenantId}-unit-${key}`;
  const employee = (key: Person) => `${tenantId}-emp-${key}`;
  const user = (key: AccountKey) => `${tenantId}-user-${key}`;
  const role = (code: RoleCode) => `${tenantId}-role-${code}`;

  const tenant: Tenant = {
    id: tenantId,
    code: tenantId.toUpperCase(),
    name: `Công ty ${tenantId}`,
    timezone: 'Asia/Ho_Chi_Minh',
    status: 'Active',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  const orgUnit = (key: UnitKey, parent: UnitKey | null, unitType: OrgUnit['unitType'], head: Person | null): OrgUnit => ({
    id: unit(key),
    tenantId,
    parentId: parent ? unit(parent) : null,
    code: key.toUpperCase(),
    name: `Đơn vị ${key}`,
    unitType,
    headEmployeeId: head ? employee(head) : null,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    status: key === 'salesB' ? 'Inactive' : 'Active',
  });
  const orgUnits: OrgUnit[] = [
    orgUnit('root', null, 'Company', 'ceo'),
    orgUnit('sales', 'root', 'Department', 'head'),
    orgUnit('salesA', 'sales', 'Team', 'lead'),
    orgUnit('salesB', 'sales', 'Team', null),
    orgUnit('ops', 'root', 'Department', null),
  ];

  const employees: Employee[] = PEOPLE.map((key) => ({
    id: employee(key),
    tenantId,
    employeeCode: `${tenantId}-${key}`,
    fullName: `Người ${key}`,
    email: `${key}@${tenantId}.test`,
    hireDate: '2026-01-01',
    employmentStatus: key === 'left' ? 'Resigned' : 'Official',
    leftOn: key === 'left' ? '2027-01-31' : null,
  }));

  const assign = (key: Person, unitKey: UnitKey, manager: Person | null, to: IsoDate | null = null): EmployeeAssignment => ({
    id: `${tenantId}-asg-${key}`,
    tenantId,
    employeeId: employee(key),
    orgUnitId: unit(unitKey),
    positionId: `${tenantId}-pos-1`,
    managerEmployeeId: manager ? employee(manager) : null,
    isPrimary: true,
    effectiveFrom: '2026-01-01',
    effectiveTo: to,
  });
  const assignments: EmployeeAssignment[] = [
    assign('ceo', 'root', null),
    assign('head', 'sales', 'ceo'),
    assign('lead', 'salesA', 'head'),
    assign('emp', 'salesA', 'lead'),
    assign('emp2', 'salesB', 'head'),
    assign('opsEmp', 'ops', 'ceo'),
    assign('hr', 'ops', 'ceo'),
    assign('cnb', 'ops', 'ceo'),
    assign('admin', 'ops', 'ceo'),
    assign('left', 'salesA', 'lead', '2027-01-31'),
    assign('idle', 'ops', 'ceo'),
  ];

  const accountKeys: AccountKey[] = [...PEOPLE, 'system'];
  const accounts: UserAccount[] = accountKeys.map((key) => ({
    id: user(key),
    tenantId,
    employeeId: key === 'system' ? null : employee(key),
    login: `${key}@${tenantId}`,
    displayName: `Người ${key}`,
    authProvider: 'Local',
    status: key === 'idle' || key === 'left' ? 'Inactive' : 'Active',
    lastLoginAt: null,
  }));

  const roles: Role[] = ROLE_CODES.map((code) => ({ id: role(code), tenantId, code, name: code }));

  let seq = 0;
  const grant: TestTenant['grant'] = (key, code, scope) => ({
    id: `${tenantId}-ur-${++seq}`,
    tenantId,
    userId: user(key),
    roleId: role(code),
    ...scope,
  });
  const defaultScope = (key: AccountKey, code: RoleCode) => {
    const scopeType = DEFAULT_ROLE_SCOPE[code];
    const scopeOrgUnitId = scopeType === 'OrgUnit' ? (key === 'head' ? unit('sales') : null) : null;
    return { scopeType, scopeOrgUnitId, includeChildren: scopeType === 'OrgUnit' };
  };
  const userRoles: UserRole[] = accountKeys.flatMap((key) => {
    const rows: UserRole[] = [];
    // BR-KPI-62 — every account with an employee also holds EMPLOYEE / Self.
    if (key !== 'system') rows.push(grant(key, 'EMPLOYEE', defaultScope(key, 'EMPLOYEE')));
    const main = MAIN_ROLE[key];
    if (main) rows.push(grant(key, main, defaultScope(key, main)));
    return rows;
  });

  const base = {
    tenantId,
    roles,
    userRoles,
    permissions: permissionRows(),
    rolePermissions: defaultRolePermissionRows(tenantId, roles),
    orgUnits,
    assignments,
    employees,
  };

  const inputsFor: TestTenant['inputsFor'] = (key, overrides = {}) => ({
    ...base,
    account: accounts.find((a) => a.id === user(key))!,
    asOf: AS_OF,
    ...overrides,
  });

  return {
    ...base,
    tenant,
    accounts,
    unit,
    employee,
    user,
    role,
    grant,
    inputsFor,
    profileOf: (key, overrides) => buildAccessProfile(inputsFor(key, overrides)),
  };
}
