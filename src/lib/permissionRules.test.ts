import { describe, expect, it } from 'vitest';
import { ROLE_CODES, type RoleCode, type UserRole } from '@/data/types';
import {
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_ROLE_SCOPE,
  PERMISSION_CATALOGUE,
  PERMISSION_CODES,
  buildAccessProfile,
  can,
  canOpenPath,
  defaultRolePermissionRows,
  permissionId,
  permissionRows,
  resourceOfOwner,
  resourceOfSubject,
  roleCodesOf,
  visibleNavGroups,
  type PermissionCode,
  type PermissionGatedItem,
  type PermissionResource,
} from './permissionRules';
import { buildTenant, type AccountKey, type TestTenant } from './permissionFixtures.test-util';

const A = buildTenant('t1');
const B = buildTenant('t2');

/** A profile holding exactly one role with one scope — nothing else (no EMPLOYEE baseline). */
function onlyRole(t: TestTenant, key: AccountKey, code: RoleCode, scope: Pick<UserRole, 'scopeType' | 'scopeOrgUnitId' | 'includeChildren'>) {
  return t.profileOf(key, { userRoles: [t.grant(key, code, scope)] });
}
const TENANT_SCOPE = { scopeType: 'Tenant', scopeOrgUnitId: null, includeChildren: false } as const;

const emp = (t: TestTenant, key: Parameters<TestTenant['employee']>[0]): PermissionResource => ({
  kind: 'Employee',
  tenantId: t.tenantId,
  employeeId: t.employee(key),
});
const unit = (t: TestTenant, key: Parameters<TestTenant['unit']>[0]): PermissionResource => ({
  kind: 'OrgUnit',
  tenantId: t.tenantId,
  orgUnitId: t.unit(key),
});
const company = (t: TestTenant): PermissionResource => ({ kind: 'Company', tenantId: t.tenantId });
const wholeTenant = (t: TestTenant): PermissionResource => ({ kind: 'Tenant', tenantId: t.tenantId });

// ─── The catalogue ─────────────────────────────────────────────────────────────────────────────

describe('the permission catalogue', () => {
  it('has 28 unique codes, each with a module, a Vietnamese description and a scope flag', () => {
    expect(PERMISSION_CODES).toHaveLength(28);
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length);
    for (const p of PERMISSION_CATALOGUE) {
      expect(p.code.startsWith(`${p.module}.`)).toBe(true);
      expect(p.description.length).toBeGreaterThan(5);
      expect(typeof p.scopeSensitive).toBe('boolean');
    }
  });

  it('adopts no approval permission — approving is the workflow actor rule (BR-KPI-61)', () => {
    expect(PERMISSION_CODES.some((code) => /approve|submit|return/.test(code))).toBe(false);
  });

  it('derives stable permission ids from the code, the same in every tenant', () => {
    expect(permissionId('goalplan.lock')).toBe('perm.goalplan.lock');
    const rows = permissionRows();
    expect(rows.map((r) => r.id)).toEqual(PERMISSION_CODES.map((c) => `perm.${c}`));
    expect(rows.every((r) => !('tenantId' in r))).toBe(true);
  });

  it('turns the default matrix into rows for one tenant only', () => {
    const rows = defaultRolePermissionRows('t1', [...A.roles, ...B.roles]);
    expect(rows.every((r) => r.tenantId === 't1' && r.roleId.startsWith('t1-'))).toBe(true);
    const total = ROLE_CODES.reduce((n, code) => n + DEFAULT_ROLE_PERMISSIONS[code].length, 0);
    expect(rows).toHaveLength(total);
  });

  it('gives ADMIN every code (product owner, 2026-10-19)', () => {
    expect([...DEFAULT_ROLE_PERMISSIONS.ADMIN].sort()).toEqual([...PERMISSION_CODES].sort());
  });

  it('defaults the scopes: EMPLOYEE Self, MANAGER OrgUnit, the rest Tenant', () => {
    expect(DEFAULT_ROLE_SCOPE).toEqual({
      EMPLOYEE: 'Self',
      MANAGER: 'OrgUnit',
      HR: 'Tenant',
      CNB: 'Tenant',
      BOD: 'Tenant',
      ADMIN: 'Tenant',
    });
  });
});

// ─── Role × code matrix (hand-written from business-rules.md §9 — never derived from the matrix) ──

const MATRIX: Readonly<Record<PermissionCode, string>> = {
  //                        EMP MGR HR CNB BOD ADMIN
  'org.view':              'E M H C B A',
  'org.manage':            '. . . . . A',
  'user.manage':           '. . . . . A',
  'library.view':          'E M H C B A',
  'library.manage':        '. . H C . A',
  'cycle.manage':          '. . H C . A',
  'team.view':             '. M . . . A',
  'goalplan.view':         'E M H C B A',
  'goalplan.edit':         'E M H . . A',
  'goalplan.lock':         '. . H . . A',
  'goalplan.import':       '. . H . . A',
  'actual.view':           'E M H C B A',
  'actual.enter':          '. M H C . A',
  'actual.import':         '. . H C . A',
  'evidence.upload':       'E M H . . A',
  'form.launch':           '. . H C . A',
  'form.start':            '. M H . . A',
  'form.proxy':            '. . H . . A',
  'form.cancel':           '. . H . . A',
  'delegation.manage':     'E M H C B A',
  'result.view':           'E M H C B A',
  'result.finalize':       '. . H C . A',
  'result.export':         '. . . C . A',
  'rating.config':         '. . H C . A',
  'dashboard.view':        '. M H . B A',
  'datasource.manage':     '. . . . . A',
  'notification.manage':   '. . . . . A',
  'audit.view':            '. . . . . A',
};
const COLUMN: Readonly<Record<RoleCode, number>> = { EMPLOYEE: 0, MANAGER: 1, HR: 2, CNB: 3, BOD: 4, ADMIN: 5 };
const expected = (code: PermissionCode, role: RoleCode) => MATRIX[code].split(' ')[COLUMN[role]] !== '.';

describe('role × code matrix (the 1.3 gate)', () => {
  const cases = ROLE_CODES.flatMap((role) => PERMISSION_CODES.map((code) => [role, code, expected(code, role)] as const));

  it.each(cases)('%s holds %s → %s', (role, code, allowed) => {
    const profile = onlyRole(A, 'system', role, TENANT_SCOPE);
    expect(can(profile, code)).toBe(allowed);
  });

  it('the hand-written matrix covers every code', () => {
    expect(Object.keys(MATRIX).sort()).toEqual([...PERMISSION_CODES].sort());
  });

  // An independent guard: a typo in the default matrix AND its table cannot agree by accident here.
  it.each([
    'org.manage',
    'user.manage',
    'goalplan.lock',
    'form.launch',
    'form.proxy',
    'form.cancel',
    'result.finalize',
    'result.export',
    'rating.config',
    'actual.import',
    'audit.view',
    'team.view',
    'dashboard.view',
  ] as const)('an EMPLOYEE never holds %s', (code) => {
    expect(can(A.profileOf('emp'), code)).toBe(false);
  });
});

// ─── Scopes ────────────────────────────────────────────────────────────────────────────────────

describe('scope coverage (as of 2027-02-15)', () => {
  const selfEmp = A.profileOf('emp'); // EMPLOYEE / Self
  const head = A.profileOf('head'); // EMPLOYEE / Self + MANAGER / OrgUnit(sales) + children
  const hr = A.profileOf('hr'); // + HR / Tenant
  const ceo = A.profileOf('ceo'); // + BOD / Tenant

  it.each([
    // [label, profile, code, resource, allowed]
    ['Self covers my own plan', selfEmp, 'goalplan.view', emp(A, 'emp'), true],
    ['Self does not cover a colleague', selfEmp, 'goalplan.view', emp(A, 'emp2'), false],
    ['Self does not cover my team lead', selfEmp, 'goalplan.view', emp(A, 'lead'), false],
    ['Self does not cover my unit plan', selfEmp, 'goalplan.view', unit(A, 'salesA'), false],
    ['Self edits my own plan', selfEmp, 'goalplan.edit', emp(A, 'emp'), true],
    ['OrgUnit+children covers the unit itself', head, 'goalplan.view', unit(A, 'sales'), true],
    ['OrgUnit+children covers a child team', head, 'goalplan.view', unit(A, 'salesA'), true],
    ['OrgUnit+children covers an Inactive child team', head, 'goalplan.view', unit(A, 'salesB'), true],
    ['OrgUnit+children covers people in the subtree', head, 'goalplan.view', emp(A, 'emp'), true],
    ['OrgUnit+children covers people of an Inactive team', head, 'actual.enter', emp(A, 'emp2'), true],
    ['OrgUnit does not cover a sibling unit', head, 'goalplan.view', unit(A, 'ops'), false],
    ['OrgUnit does not cover people of a sibling unit', head, 'goalplan.view', emp(A, 'opsEmp'), false],
    ['OrgUnit does not cover the parent unit', head, 'goalplan.view', unit(A, 'root'), false],
    ['the manager still sees their own plan (union with Self)', head, 'goalplan.view', emp(A, 'head'), true],
    ['Tenant covers everyone', hr, 'goalplan.view', emp(A, 'opsEmp'), true],
    ['Tenant covers every unit', hr, 'goalplan.edit', unit(A, 'ops'), true],
    ['Tenant covers the company plan', hr, 'goalplan.edit', company(A), true],
    ['BOD reads every result', ceo, 'result.view', emp(A, 'emp2'), true],
    ['BOD cannot edit a plan, even its own', ceo, 'goalplan.edit', emp(A, 'emp'), false],
  ] as const)('%s', (_label, profile, code, resource, allowed) => {
    expect(can(profile, code, resource)).toBe(allowed);
  });

  it('covers one level of DirectReports only, never indirect reports or the manager', () => {
    const lead = onlyRole(A, 'lead', 'MANAGER', { scopeType: 'DirectReports', scopeOrgUnitId: null, includeChildren: false });
    expect(can(lead, 'goalplan.view', emp(A, 'emp'))).toBe(true);
    expect(can(lead, 'goalplan.view', emp(A, 'lead'))).toBe(false);
    const head = onlyRole(A, 'head', 'MANAGER', { scopeType: 'DirectReports', scopeOrgUnitId: null, includeChildren: false });
    expect(can(head, 'goalplan.view', emp(A, 'lead'))).toBe(true);
    expect(can(head, 'goalplan.view', emp(A, 'emp2'))).toBe(true);
    expect(can(head, 'goalplan.view', emp(A, 'emp'))).toBe(false); // indirect
    expect(can(head, 'goalplan.view', unit(A, 'sales'))).toBe(false);
  });

  it('never makes a manager their own direct report, even on a self-referencing row', () => {
    const assignments = A.assignments.map((a) =>
      a.employeeId === A.employee('lead') ? { ...a, managerEmployeeId: A.employee('lead') } : a,
    );
    const lead = buildAccessProfile({
      ...A.inputsFor('lead'),
      assignments,
      userRoles: [A.grant('lead', 'MANAGER', { scopeType: 'DirectReports', scopeOrgUnitId: null, includeChildren: false })],
    });
    expect(can(lead, 'goalplan.view', emp(A, 'lead'))).toBe(false);
  });

  it('OrgUnit without children covers the unit only', () => {
    const head = onlyRole(A, 'head', 'MANAGER', { scopeType: 'OrgUnit', scopeOrgUnitId: A.unit('sales'), includeChildren: false });
    expect(can(head, 'goalplan.view', unit(A, 'sales'))).toBe(true);
    expect(can(head, 'goalplan.view', unit(A, 'salesA'))).toBe(false);
    expect(can(head, 'goalplan.view', emp(A, 'emp'))).toBe(false);
    expect(can(head, 'goalplan.view', emp(A, 'head'))).toBe(true); // assigned to sales itself
  });

  it('a unit with no children covers just itself and its people', () => {
    const lead = onlyRole(A, 'lead', 'MANAGER', { scopeType: 'OrgUnit', scopeOrgUnitId: A.unit('salesA'), includeChildren: true });
    expect(can(lead, 'goalplan.view', unit(A, 'salesA'))).toBe(true);
    expect(can(lead, 'goalplan.view', emp(A, 'emp'))).toBe(true);
    expect(can(lead, 'goalplan.view', unit(A, 'sales'))).toBe(false);
  });

  it.each([
    ['null', null],
    ['unknown', 't1-unit-nope'],
    ['of another tenant', 't2-unit-sales'],
  ])('an OrgUnit scope whose unit is %s covers nothing', (_label, scopeOrgUnitId) => {
    const p = onlyRole(A, 'head', 'MANAGER', { scopeType: 'OrgUnit', scopeOrgUnitId, includeChildren: true });
    expect(can(p, 'goalplan.view')).toBe(true); // holds the code…
    expect(can(p, 'goalplan.view', unit(A, 'sales'))).toBe(false); // …over nothing
    expect(can(p, 'goalplan.view', emp(A, 'emp'))).toBe(false);
  });

  it('an OrgUnit scope on the root covers the company plan', () => {
    const p = onlyRole(A, 'ceo', 'MANAGER', { scopeType: 'OrgUnit', scopeOrgUnitId: A.unit('root'), includeChildren: true });
    expect(can(p, 'goalplan.edit', company(A))).toBe(true);
    expect(can(p, 'goalplan.edit', emp(A, 'opsEmp'))).toBe(true);
  });

  it.each([
    ['no root', (units: TestTenant['orgUnits']) => units.map((u) => (u.parentId === null ? { ...u, parentId: A.unit('ops') } : u))],
    ['two roots', (units: TestTenant['orgUnits']) => units.map((u) => (u.id === A.unit('ops') ? { ...u, parentId: null } : u))],
  ])('with %s, the company plan is reachable only through a Tenant scope', (_label, mutate) => {
    const orgUnits = mutate(A.orgUnits);
    const orgScoped = buildAccessProfile({
      ...A.inputsFor('ceo'),
      orgUnits,
      userRoles: [A.grant('ceo', 'MANAGER', { scopeType: 'OrgUnit', scopeOrgUnitId: A.unit('root'), includeChildren: true })],
    });
    expect(can(orgScoped, 'goalplan.edit', company(A))).toBe(false);
    const tenantScoped = buildAccessProfile({ ...A.inputsFor('hr'), orgUnits });
    expect(can(tenantScoped, 'goalplan.edit', company(A))).toBe(true);
  });

  it('terminates on a cycle in the org tree and on a dangling parent', () => {
    const orgUnits = A.orgUnits.map((u) => {
      if (u.id === A.unit('sales')) return { ...u, parentId: A.unit('salesA') }; // sales ⇄ salesA
      if (u.id === A.unit('ops')) return { ...u, parentId: 't1-unit-missing' };
      return u;
    });
    const p = buildAccessProfile({
      ...A.inputsFor('head'),
      orgUnits,
      userRoles: [A.grant('head', 'MANAGER', { scopeType: 'OrgUnit', scopeOrgUnitId: A.unit('sales'), includeChildren: true })],
    });
    expect(can(p, 'goalplan.view', unit(A, 'salesA'))).toBe(true);
    expect(can(p, 'goalplan.view', unit(A, 'sales'))).toBe(true);
    expect(can(p, 'goalplan.view', unit(A, 'ops'))).toBe(false);
  });

  it('acting as proxy and cancelling reach only the forms whose subject is in scope', () => {
    const hrForSales = onlyRole(A, 'hr', 'HR', { scopeType: 'OrgUnit', scopeOrgUnitId: A.unit('sales'), includeChildren: true });
    expect(can(hrForSales, 'form.proxy', emp(A, 'emp'))).toBe(true);
    expect(can(hrForSales, 'form.cancel', emp(A, 'emp2'))).toBe(true);
    expect(can(hrForSales, 'form.proxy', emp(A, 'opsEmp'))).toBe(false);
    expect(can(hrForSales, 'form.cancel', emp(A, 'opsEmp'))).toBe(false);
    expect(can(A.profileOf('hr'), 'form.proxy', emp(A, 'opsEmp'))).toBe(true); // default: Tenant scope
    expect(can(A.profileOf('head'), 'form.proxy', emp(A, 'emp'))).toBe(false); // a manager never proxies
  });

  it('a system account (no employee) with Self covers nobody', () => {
    const p = onlyRole(A, 'system', 'EMPLOYEE', { scopeType: 'Self', scopeOrgUnitId: null, includeChildren: false });
    expect(can(p, 'goalplan.view')).toBe(true);
    expect(can(p, 'goalplan.view', emp(A, 'emp'))).toBe(false);
  });

  it('a scope-free code ignores the scope; a scope-sensitive one on a Tenant resource needs Tenant scope', () => {
    expect(can(head, 'team.view', wholeTenant(A))).toBe(true);
    expect(can(head, 'goalplan.view', wholeTenant(A))).toBe(false);
    expect(can(hr, 'goalplan.view', wholeTenant(A))).toBe(true);
    const cnbInOps = onlyRole(A, 'cnb', 'CNB', { scopeType: 'OrgUnit', scopeOrgUnitId: A.unit('ops'), includeChildren: true });
    expect(can(cnbInOps, 'result.export', wholeTenant(A))).toBe(true);
    expect(can(cnbInOps, 'result.export')).toBe(true);
  });
});

// ─── Dates ─────────────────────────────────────────────────────────────────────────────────────

describe('scopes resolve as of a date', () => {
  const headInputs = A.inputsFor('head');

  it.each([
    ['ends on asOf (inclusive)', { effectiveFrom: '2026-01-01', effectiveTo: '2027-02-15' }, true],
    ['starts on asOf (inclusive)', { effectiveFrom: '2027-02-15', effectiveTo: null }, true],
    ['ended the day before', { effectiveFrom: '2026-01-01', effectiveTo: '2027-02-14' }, false],
    ['starts the day after', { effectiveFrom: '2027-02-16', effectiveTo: null }, false],
  ])('an assignment that %s', (_label, dates, covered) => {
    const assignments = A.assignments.map((a) => (a.employeeId === A.employee('emp') ? { ...a, ...dates } : a));
    const p = buildAccessProfile({ ...headInputs, assignments });
    expect(can(p, 'goalplan.view', emp(A, 'emp'))).toBe(covered);
  });

  it('a person who moved units is covered by the new unit only', () => {
    const moved = [
      ...A.assignments.filter((a) => a.employeeId !== A.employee('opsEmp')),
      { ...A.assignments.find((a) => a.employeeId === A.employee('opsEmp'))!, effectiveTo: '2027-01-31' },
      {
        ...A.assignments.find((a) => a.employeeId === A.employee('opsEmp'))!,
        id: 't1-asg-opsEmp-2',
        orgUnitId: A.unit('salesA'),
        effectiveFrom: '2027-02-01',
        effectiveTo: null,
      },
    ];
    const p = buildAccessProfile({ ...headInputs, assignments: moved });
    expect(can(p, 'goalplan.view', emp(A, 'opsEmp'))).toBe(true);
    const before = buildAccessProfile({ ...headInputs, assignments: moved, asOf: '2027-01-20' });
    expect(can(before, 'goalplan.view', emp(A, 'opsEmp'))).toBe(false);
  });

  it('a concurrent assignment counts as well as the primary one', () => {
    const concurrent = [
      ...A.assignments,
      {
        ...A.assignments.find((a) => a.employeeId === A.employee('opsEmp'))!,
        id: 't1-asg-opsEmp-concurrent',
        orgUnitId: A.unit('salesB'),
        isPrimary: false,
      },
    ];
    const p = buildAccessProfile({ ...headInputs, assignments: concurrent });
    expect(can(p, 'goalplan.view', emp(A, 'opsEmp'))).toBe(true);
  });

  it('a resigned employee whose assignment ended is out of scope', () => {
    expect(can(A.profileOf('head'), 'goalplan.view', emp(A, 'left'))).toBe(false);
    const lastWorkingDay = A.profileOf('head', { asOf: '2027-01-31' });
    expect(can(lastWorkingDay, 'goalplan.view', emp(A, 'left'))).toBe(true);
  });

  it('a resigned employee whose assignment was left open is still out of scope (fail closed)', () => {
    const assignments = A.assignments.map((a) => (a.employeeId === A.employee('left') ? { ...a, effectiveTo: null } : a));
    const p = buildAccessProfile({ ...headInputs, assignments });
    expect(can(p, 'goalplan.view', emp(A, 'left'))).toBe(false);
  });

  it('a Resigned employee with no last day recorded is out of scope (fail closed)', () => {
    const assignments = A.assignments.map((a) => (a.employeeId === A.employee('left') ? { ...a, effectiveTo: null } : a));
    const employees = A.employees.map((e) => (e.id === A.employee('left') ? { ...e, leftOn: null } : e));
    const p = buildAccessProfile({ ...headInputs, assignments, employees });
    expect(can(p, 'goalplan.view', emp(A, 'left'))).toBe(false);
  });
});

// ─── Union, BR-KPI-63, fail closed ─────────────────────────────────────────────────────────────

describe('the union of roles (BR-KPI-60)', () => {
  it('EMPLOYEE/Self + MANAGER/OrgUnit reaches both my plan and my units', () => {
    const head = A.profileOf('head');
    expect(head.roleCodes).toEqual(['EMPLOYEE', 'MANAGER']);
    expect(can(head, 'goalplan.edit', emp(A, 'head'))).toBe(true);
    expect(can(head, 'goalplan.edit', unit(A, 'salesA'))).toBe(true);
  });

  it('HR on top of MANAGER widens to the whole tenant', () => {
    const userRoles = [...A.userRoles, A.grant('head', 'HR', TENANT_SCOPE)];
    const p = A.profileOf('head', { userRoles });
    expect(p.roleCodes).toEqual(['EMPLOYEE', 'MANAGER', 'HR']);
    expect(can(p, 'goalplan.view', emp(A, 'opsEmp'))).toBe(true);
    expect(can(p, 'goalplan.lock')).toBe(true);
  });

  it('a duplicate grant changes nothing', () => {
    const once = A.profileOf('head');
    const twice = A.profileOf('head', { userRoles: [...A.userRoles, ...A.userRoles.filter((u) => u.userId === A.user('head'))] });
    for (const code of PERMISSION_CODES) {
      expect([can(twice, code), can(twice, code, emp(A, 'emp2'))]).toEqual([can(once, code), can(once, code, emp(A, 'emp2'))]);
    }
  });

  it('lists the roles of a user in ROLE_CODES order, de-duplicated', () => {
    const rows = [A.grant('hr', 'HR', TENANT_SCOPE), A.grant('hr', 'EMPLOYEE', TENANT_SCOPE), A.grant('hr', 'HR', TENANT_SCOPE)];
    expect(roleCodesOf(A.tenantId, A.user('hr'), A.roles, rows)).toEqual(['EMPLOYEE', 'HR']);
  });
});

describe('the company plan is readable by the whole tenant (BR-KPI-63)', () => {
  it('lets any goalplan.view holder read it — and only read it', () => {
    const selfEmp = A.profileOf('emp');
    expect(can(selfEmp, 'goalplan.view', company(A))).toBe(true);
    expect(can(selfEmp, 'goalplan.edit', company(A))).toBe(false);
    expect(can(selfEmp, 'actual.view', company(A))).toBe(false);
    const nullScopeManager = onlyRole(A, 'head', 'MANAGER', { scopeType: 'OrgUnit', scopeOrgUnitId: null, includeChildren: true });
    expect(can(nullScopeManager, 'goalplan.view', company(A))).toBe(true);
    expect(can(nullScopeManager, 'goalplan.edit', company(A))).toBe(false);
  });
});

describe('fails closed', () => {
  it('denies everything to an Inactive account', () => {
    const idle = A.profileOf('idle');
    expect(idle.active).toBe(false);
    expect(PERMISSION_CODES.some((code) => can(idle, code))).toBe(false);
    expect(visibleNavGroups([{ items: [{ url: '/my/kpi', permission: null }] }], idle)).toEqual([]);
  });

  it('ignores a USER_ROLE pointing at an unknown role, and a ROLE_PERMISSION at an unknown permission', () => {
    const unknownRole: UserRole = { ...A.grant('emp', 'HR', TENANT_SCOPE), roleId: 't1-role-NOPE' };
    expect(can(A.profileOf('emp', { userRoles: [unknownRole] }), 'org.view')).toBe(false);
    const rolePermissions = [{ tenantId: A.tenantId, roleId: A.role('EMPLOYEE'), permissionId: 'perm.goal.approve' }];
    expect(can(A.profileOf('emp', { rolePermissions }), 'goalplan.view')).toBe(false);
    const permissions = [{ id: 'perm.x', code: 'goal.approve', module: 'goal', description: '' }];
    expect(can(A.profileOf('emp', { permissions }), 'goalplan.view')).toBe(false);
  });

  it('denies an unknown code and an unresolved (null) resource without throwing', () => {
    const hr = A.profileOf('hr');
    expect(can(hr, 'goal.approve' as PermissionCode)).toBe(false);
    expect(can(hr, 'goalplan.view', null)).toBe(false);
  });
});

// ─── Tenant isolation (BR-KPI-50) ──────────────────────────────────────────────────────────────

describe('tenant isolation', () => {
  const resourcesOfA: PermissionResource[] = [
    emp(A, 'emp'),
    emp(A, 'head'),
    unit(A, 'sales'),
    unit(A, 'root'),
    company(A),
    wholeTenant(A),
  ];

  it.each(['emp', 'head', 'hr', 'admin', 'system'] as const)(
    'a tenant-B %s is denied every code on every tenant-A resource',
    (key) => {
      const profile = B.profileOf(key);
      for (const code of PERMISSION_CODES) {
        for (const resource of resourcesOfA) expect(can(profile, code, resource)).toBe(false);
      }
    },
  );

  it('ignores tenant-A rows passed into tenant B’s profile', () => {
    const mixed = B.inputsFor('emp', {
      roles: [...B.roles, ...A.roles],
      userRoles: [...B.userRoles, { ...A.grant('emp', 'ADMIN', TENANT_SCOPE), userId: B.user('emp') }],
      rolePermissions: [...B.rolePermissions, ...A.rolePermissions],
      orgUnits: [...B.orgUnits, ...A.orgUnits],
      assignments: [...B.assignments, ...A.assignments],
      employees: [...B.employees, ...A.employees],
    });
    const p = buildAccessProfile(mixed);
    expect(p.roleCodes).toEqual(['EMPLOYEE']);
    expect(can(p, 'org.manage')).toBe(false);
    expect(can(p, 'goalplan.view', emp(B, 'emp'))).toBe(true);
  });

  it('a tenant-A account cannot be profiled into tenant B', () => {
    const p = buildAccessProfile({ ...B.inputsFor('hr'), account: A.accounts.find((a) => a.id === A.user('hr'))! });
    expect(p.active).toBe(false);
    expect(PERMISSION_CODES.some((code) => can(p, code))).toBe(false);
  });
});

// ─── Resource helpers ──────────────────────────────────────────────────────────────────────────

describe('resource helpers', () => {
  it('builds a resource from a row’s owner, or null when the owner is unset', () => {
    expect(resourceOfOwner('t1', { ownerType: 'Company', ownerOrgUnitId: 't1-unit-root', ownerEmployeeId: null })).toEqual({
      kind: 'Company',
      tenantId: 't1',
    });
    expect(resourceOfOwner('t1', { ownerType: 'OrgUnit', ownerOrgUnitId: 'u', ownerEmployeeId: null })).toEqual({
      kind: 'OrgUnit',
      tenantId: 't1',
      orgUnitId: 'u',
    });
    expect(resourceOfOwner('t1', { ownerType: 'Employee', ownerOrgUnitId: null, ownerEmployeeId: 'e' })).toEqual({
      kind: 'Employee',
      tenantId: 't1',
      employeeId: 'e',
    });
    expect(resourceOfOwner('t1', { ownerType: 'Employee', ownerOrgUnitId: null, ownerEmployeeId: null })).toBeNull();
    expect(resourceOfOwner('t1', { ownerType: 'OrgUnit', ownerOrgUnitId: null, ownerEmployeeId: null })).toBeNull();
    expect(resourceOfSubject('t1', 'e')).toEqual({ kind: 'Employee', tenantId: 't1', employeeId: 'e' });
    expect(resourceOfSubject('t1', null)).toBeNull();
  });
});

// ─── Navigation ────────────────────────────────────────────────────────────────────────────────

describe('visibleNavGroups and canOpenPath', () => {
  const item = (url: string, permission: PermissionCode | null): PermissionGatedItem => ({ url, permission });
  const groups = [
    { label: 'mine', items: [item('/my/kpi', null), item('/my/tasks', null)] },
    { label: 'team', items: [item('/team/kpi', 'team.view')] },
    { label: 'admin', items: [item('/admin/library', 'library.manage'), item('/admin/library/import', 'goalplan.import')] },
  ];
  const selfEmp = A.profileOf('emp');
  const cnb = A.profileOf('cnb');

  it('keeps permitted items in order and drops empty groups', () => {
    expect(visibleNavGroups(groups, selfEmp).map((g) => g.label)).toEqual(['mine']);
    const forCnb = visibleNavGroups(groups, cnb);
    expect(forCnb.map((g) => g.label)).toEqual(['mine', 'admin']);
    expect(forCnb[1].items.map((i) => i.url)).toEqual(['/admin/library']);
  });

  it('shows everything to a profile holding every code', () => {
    expect(visibleNavGroups(groups, A.profileOf('admin'))).toEqual(groups);
  });

  it.each([
    ['/my/kpi', 'emp', true],
    ['/team/kpi', 'emp', false],
    ['/team/kpi', 'head', true],
    ['/team/kpi/', 'head', true],
    ['/team/kpi?tab=2#x', 'emp', false],
    ['/team/kpi/123', 'emp', false],
    ['/admin/library/123', 'cnb', true],
    ['/admin/libraryX', 'emp', true], // claimed by no item → open (route coverage keeps real routes claimed)
    ['/admin/library/import', 'cnb', false], // the longer prefix decides
    ['/admin/library/import/42', 'hr', true],
    ['/', 'emp', true],
    ['/khong-ton-tai', 'emp', true],
    ['/my/kpi', 'idle', false],
  ] as const)('%s for %s → %s', (path, key, allowed) => {
    expect(canOpenPath(path, groups, A.profileOf(key))).toBe(allowed);
  });
});
