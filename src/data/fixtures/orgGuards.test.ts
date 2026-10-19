import { describe, expect, it } from 'vitest';
import { accessIssues, accountIssues, tenantAdmins, userRoleIssues } from '@/lib/accessAdminRules';
import type { RuleIssue } from '@/lib/errorCatalog';
import { toZonedDate } from '@/lib/isoDate';
import { assignmentIssues, employeeIssues, positionIssues, tenantIssues, transferPlan, unitIssues } from '@/lib/orgAdminRules';
import { buildSeed, SEED_NOW, SYNTRA } from './index';
import type { TenantSeed } from './types';

/**
 * T1's guards (`orgAdminRules`, `accessAdminRules`) against the FROZEN seed: every seeded row must
 * stay editable (saving it back unchanged raises nothing), and every row must be one the guards would
 * have let you create — bar the exceptions listed here, each a deliberate edge case of the seed.
 */
const seed = buildSeed();

/** Rows the guards would refuse to CREATE today, and why (they predate the rule; re-saving them is fine). */
const CREATE_EXCEPTIONS: Readonly<Record<string, string>> = {
  // E040 (hired 2020-05-25) reports to E014, hired 2020-08-17: a manager not yet employed on the start date.
  [`EmployeeAssignment:${SYNTRA.id('EmployeeAssignment', 'E040', '1')}:MANAGER_NOT_EMPLOYED`]: 'E040 → E014 hired later',
};

function contextOf(t: TenantSeed) {
  const r = t.rows;
  return {
    units: r.OrgUnit,
    positions: r.JobPosition,
    employees: r.Employee,
    assignments: r.EmployeeAssignment,
    accounts: r.UserAccount,
    roles: r.Role,
    userRoles: r.UserRole,
    plans: r.GoalPlan,
    cycles: r.PerformanceCycle,
    today: toZonedDate(SEED_NOW, t.tenant.timezone),
  };
}

/** Every issue the guards raise over a tenant's rows, as `Entity:id:detail`; `asCreate` = no stored row. */
function issuesOf(t: TenantSeed, asCreate: boolean): string[] {
  const ctx = contextOf(t);
  const out: string[] = [];
  const add = (entity: string, id: string, issues: readonly RuleIssue[]) => out.push(...issues.map((i) => `${entity}:${id}:${i.detail ?? i.code}`));
  const prev = <T>(row: T) => (asCreate ? null : row);
  for (const u of ctx.units) add('OrgUnit', u.id, unitIssues(u, prev(u), ctx));
  for (const p of ctx.positions) add('JobPosition', p.id, positionIssues(p, prev(p), ctx));
  for (const e of ctx.employees) add('Employee', e.id, employeeIssues(e, prev(e), ctx));
  for (const a of ctx.assignments) {
    add('EmployeeAssignment', a.id, assignmentIssues(a, prev(a), ctx));
    add('EmployeeAssignment', a.id, transferPlan(a, prev(a), ctx.assignments).issues);
  }
  for (const a of ctx.accounts) add('UserAccount', a.id, accountIssues(a, prev(a), ctx));
  for (const r of ctx.userRoles) add('UserRole', r.id, userRoleIssues(r, prev(r), ctx));
  add('Tenant', t.tenant.id, tenantIssues(t.tenant, prev(t.tenant), t.tenant.id));
  return out;
}

describe.each(seed.tenants.map((t) => [t.tenant.code, t] as const))('the frozen seed meets the T1 guards — %s', (_, t) => {
  it('saving any seeded row back unchanged raises nothing', () => {
    expect(issuesOf(t, false)).toEqual([]);
  });

  it('every seeded row could have been created, bar the listed exceptions', () => {
    expect(issuesOf(t, true).filter((key) => !(key in CREATE_EXCEPTIONS))).toEqual([]);
  });

  it('has an Active company-wide ADMIN, and the unchanged rows pass the admin rails', () => {
    const r = t.rows;
    const state = { accounts: r.UserAccount, userRoles: r.UserRole, rolePermissions: r.RolePermission };
    const ctx = { tenantId: t.tenant.id, roles: r.Role, permissions: seed.permissions, units: r.OrgUnit, employees: r.Employee, assignments: r.EmployeeAssignment, today: contextOf(t).today };
    expect(tenantAdmins(state, ctx).length).toBeGreaterThan(0);
    for (const admin of tenantAdmins(state, ctx)) expect(accessIssues(state, state, { ...ctx, actorUserId: admin.id })).toEqual([]);
  });
});

it('every listed exception still happens (a stale entry is removed)', () => {
  const all = seed.tenants.flatMap((t) => issuesOf(t, true));
  for (const key of Object.keys(CREATE_EXCEPTIONS)) expect(all).toContain(key);
});
