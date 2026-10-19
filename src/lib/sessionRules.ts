/**
 * Session rules — who the simulated session is (plan §3.3). Pure, tested.
 *
 * The session never trusts what localStorage remembers: a stored tenant or person is used only if it
 * is still there and Active in the data just loaded; otherwise the session falls back to the first
 * usable one, in the gateway's order (the seed puts the demo's starting persona first).
 */

import {
  ROLE_CODES,
  type Employee,
  type EmployeeAssignment,
  type Id,
  type IsoDate,
  type IsoDateTime,
  type OrgUnit,
  type Permission,
  type Role,
  type RoleCode,
  type RolePermission,
  type Tenant,
  type UserAccount,
  type UserRole,
} from '@/data/types';
import { toZonedDate } from './isoDate';
import { roleCodesOf } from './permissionRules';

/** Everything the session loads for one tenant, in one query (`useSessionDirectory`). */
export interface SessionDirectory {
  tenantId: Id;
  accounts: readonly UserAccount[];
  employees: readonly Employee[];
  roles: readonly Role[];
  permissions: readonly Permission[];
  rolePermissions: readonly RolePermission[];
  userRoles: readonly UserRole[];
  orgUnits: readonly OrgUnit[];
  assignments: readonly EmployeeAssignment[];
}

/** One row of the person picker. */
export interface SessionPerson {
  userId: Id;
  employeeId: Id | null;
  name: string;
  /** The employee's email, else the login — what the account block shows under the name. */
  email: string;
  roles: RoleCode[];
  /** The group the picker files the person under. Display only — never used for access. */
  primaryRole: RoleCode | null;
  /** The unit of the primary assignment effective today, else of any effective one. */
  orgUnitName: string | null;
}

/** The stored tenant if it is still Active, else the first Active one; `null` when none is. */
export function pickTenant(tenants: readonly Tenant[], storedTenantId: Id | null): Tenant | null {
  const active = tenants.filter((t) => t.status === 'Active');
  return active.find((t) => t.id === storedTenantId) ?? active[0] ?? null;
}

/** The stored account if it is an Active account of this tenant, else the first one; `null` when none. */
export function pickAccount(tenantId: Id, accounts: readonly UserAccount[], storedUserId: Id | null): UserAccount | null {
  const active = accounts.filter((a) => a.tenantId === tenantId && a.status === 'Active');
  return active.find((a) => a.id === storedUserId) ?? active[0] ?? null;
}

/** Highest first. The picker files a person with several roles under the highest one. */
const ROLE_PRECEDENCE: readonly RoleCode[] = ['ADMIN', 'HR', 'CNB', 'BOD', 'MANAGER', 'EMPLOYEE'];

export function primaryRole(roles: readonly RoleCode[]): RoleCode | null {
  return ROLE_PRECEDENCE.find((role) => roles.includes(role)) ?? null;
}

/** The calendar date `now` falls on in the tenant's zone — `isoDate.toZonedDate`, kept under the session's name. */
export function tenantToday(now: IsoDateTime, timeZone: string): IsoDate {
  return toZonedDate(now, timeZone);
}

const collator = new Intl.Collator('vi', { sensitivity: 'base' });

/** The Active accounts of the tenant as picker rows, sorted by name. */
export function sessionPeople(directory: SessionDirectory, asOf: IsoDate): SessionPerson[] {
  const { tenantId } = directory;
  const employeeById = new Map(directory.employees.filter((e) => e.tenantId === tenantId).map((e) => [e.id, e]));
  const unitName = new Map(directory.orgUnits.filter((u) => u.tenantId === tenantId).map((u) => [u.id, u.name]));
  const effective = directory.assignments.filter(
    (a) => a.tenantId === tenantId && a.effectiveFrom <= asOf && (a.effectiveTo === null || asOf <= a.effectiveTo),
  );

  const unitOf = (employeeId: Id): string | null => {
    const mine = effective.filter((a) => a.employeeId === employeeId);
    const chosen = mine.find((a) => a.isPrimary) ?? mine[0];
    return chosen ? (unitName.get(chosen.orgUnitId) ?? null) : null;
  };

  return directory.accounts
    .filter((a) => a.tenantId === tenantId && a.status === 'Active')
    .map((account) => {
      const person = account.employeeId ? employeeById.get(account.employeeId) : undefined;
      const roles = roleCodesOf(tenantId, account.id, directory.roles, directory.userRoles);
      return {
        userId: account.id,
        employeeId: person?.id ?? null,
        name: account.displayName,
        email: person?.email ?? account.login,
        roles,
        primaryRole: primaryRole(roles),
        orgUnitName: person ? unitOf(person.id) : null,
      };
    })
    .sort((a, b) => collator.compare(a.name, b.name));
}

/** People grouped for the picker, in the demo's walk order (`ROLE_CODES`: NV → QL → HR → C&B → BOD → Admin); empty groups dropped. */
export function groupPeopleByRole(people: readonly SessionPerson[]): { role: RoleCode | null; people: SessionPerson[] }[] {
  const groups: { role: RoleCode | null; people: SessionPerson[] }[] = [...ROLE_CODES, null].map((role) => ({
    role,
    people: people.filter((p) => p.primaryRole === role),
  }));
  return groups.filter((g) => g.people.length > 0);
}
