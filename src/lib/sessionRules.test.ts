import { describe, expect, it } from 'vitest';
import type { RoleCode, Tenant, UserAccount } from '@/data/types';
import { buildTenant, AS_OF } from './permissionFixtures.test-util';
import {
  groupPeopleByRole,
  pickAccount,
  pickTenant,
  primaryRole,
  sessionPeople,
  tenantToday,
  type SessionDirectory,
} from './sessionRules';

const A = buildTenant('t1');
const B = buildTenant('t2');
const suspended: Tenant = { ...buildTenant('t3').tenant, status: 'Suspended' };

const directoryOf = (t: ReturnType<typeof buildTenant>): SessionDirectory => ({
  tenantId: t.tenantId,
  accounts: t.accounts,
  employees: t.employees,
  roles: t.roles,
  permissions: t.permissions,
  rolePermissions: t.rolePermissions,
  userRoles: t.userRoles,
  orgUnits: t.orgUnits,
  assignments: t.assignments,
});

describe('pickTenant', () => {
  const tenants = [suspended, A.tenant, B.tenant];

  it.each([
    ['the stored tenant when it is Active', 't2', 't2'],
    ['the first Active tenant when nothing is stored', null, 't1'],
    ['the first Active tenant when the stored one is gone', 't9', 't1'],
    ['the first Active tenant when the stored one is Suspended', 't3', 't1'],
  ])('picks %s', (_label, stored, expected) => {
    expect(pickTenant(tenants, stored)?.id).toBe(expected);
  });

  it('returns null when no tenant is Active', () => {
    expect(pickTenant([suspended], 't3')).toBeNull();
    expect(pickTenant([], null)).toBeNull();
  });
});

describe('pickAccount', () => {
  const firstActive = A.accounts.find((a) => a.status === 'Active')!.id;

  it.each([
    ['the stored account when it is Active', A.user('hr'), A.user('hr')],
    ['the first Active account when nothing is stored', null, firstActive],
    ['the first Active account when the stored one is Inactive', A.user('idle'), firstActive],
    ['the first Active account when the stored one is another tenant’s', B.user('hr'), firstActive],
    ['the first Active account when the stored one is gone', 't1-user-gone', firstActive],
  ])('picks %s', (_label, stored, expected) => {
    expect(pickAccount('t1', [...A.accounts, ...B.accounts], stored)?.id).toBe(expected);
  });

  it('never returns another tenant’s account, and null when the tenant has no Active account', () => {
    expect(pickAccount('t1', B.accounts, B.user('hr'))).toBeNull();
    const inactive: UserAccount[] = A.accounts.map((a) => ({ ...a, status: 'Inactive' }));
    expect(pickAccount('t1', inactive, A.user('hr'))).toBeNull();
  });
});

describe('primaryRole', () => {
  it.each<[RoleCode[], RoleCode | null]>([
    [['EMPLOYEE'], 'EMPLOYEE'],
    [['EMPLOYEE', 'MANAGER'], 'MANAGER'],
    [['EMPLOYEE', 'MANAGER', 'BOD'], 'BOD'],
    [['EMPLOYEE', 'CNB', 'HR'], 'HR'],
    [['ADMIN'], 'ADMIN'],
    [[], null],
  ])('%j → %s', (roles, expected) => {
    expect(primaryRole(roles)).toBe(expected);
  });
});

describe('tenantToday', () => {
  it.each([
    ['2027-01-31T17:30:00.000Z', 'Asia/Ho_Chi_Minh', '2027-02-01'],
    ['2027-01-31T16:59:59.000Z', 'Asia/Ho_Chi_Minh', '2027-01-31'],
    ['2027-01-31T17:30:00.000Z', 'UTC', '2027-01-31'],
    ['2027-12-31T23:30:00.000+07:00', 'Asia/Ho_Chi_Minh', '2027-12-31'],
  ])('%s in %s is %s', (now, zone, expected) => {
    expect(tenantToday(now, zone)).toBe(expected);
  });

  it('refuses something that is not an instant', () => {
    expect(() => tenantToday('hôm nay', 'UTC')).toThrow(RangeError);
  });
});

describe('sessionPeople', () => {
  const people = sessionPeople(directoryOf(A), AS_OF);

  it('lists only the tenant’s Active accounts', () => {
    const ids = people.map((p) => p.userId);
    expect(ids).toContain(A.user('hr'));
    expect(ids).toContain(A.user('system'));
    expect(ids).not.toContain(A.user('idle'));
    expect(ids).not.toContain(A.user('left'));
    expect(ids.every((id) => id.startsWith('t1-'))).toBe(true);
  });

  it('gives each person their roles, primary role, unit and email', () => {
    const head = people.find((p) => p.userId === A.user('head'))!;
    expect(head).toMatchObject({
      roles: ['EMPLOYEE', 'MANAGER'],
      primaryRole: 'MANAGER',
      orgUnitName: 'Đơn vị sales',
      email: 'head@t1.test',
    });
    const system = people.find((p) => p.userId === A.user('system'))!;
    expect(system).toMatchObject({ employeeId: null, orgUnitName: null, email: 'system@t1', primaryRole: 'ADMIN' });
  });

  it('ignores another tenant’s rows mixed into the directory', () => {
    const mixed = directoryOf(A);
    mixed.accounts = [...A.accounts, ...B.accounts];
    mixed.userRoles = [...A.userRoles, ...B.userRoles];
    expect(sessionPeople(mixed, AS_OF).map((p) => p.userId)).toEqual(people.map((p) => p.userId));
  });

  it('groups people in the demo walk order and drops empty groups', () => {
    const groups = groupPeopleByRole(people);
    expect(groups.map((g) => g.role)).toEqual(['EMPLOYEE', 'MANAGER', 'HR', 'CNB', 'BOD', 'ADMIN']);
    expect(groups.find((g) => g.role === 'ADMIN')!.people).toHaveLength(2); // admin + system
    expect(groupPeopleByRole(people.filter((p) => p.primaryRole === 'HR')).map((g) => g.role)).toEqual(['HR']);
  });
});
