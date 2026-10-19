import { describe, expect, it } from 'vitest';
import { DEMO, SYNTRA } from '@/data/fixtures';
import type { EmployeeAssignment } from '@/data/types';
import type { DataGateway, DomainEvent } from '../types';
import { flush, newGateway, rejection } from './gateway.test-util';

/** T1's guards and the B1/B2/B3 behaviours, through the gateway (the rules themselves: `src/lib/*AdminRules.test.ts`). */
const S = SYNTRA.tenantId;
const admin = SYNTRA.user(SYNTRA.personas.admin);
const TODAY = '2027-04-06'; // SEED_NOW in Asia/Ho_Chi_Minh

const strip = <T extends { tenantId: string }>({ tenantId: _t, ...row }: T) => row;
const issueDetails = async (p: Promise<unknown>) => {
  const e = await rejection(p);
  return { code: e.code, details: e.issues.map((i) => i.detail) };
};
const assignmentsOf = async (gw: DataGateway, code: string) => gw.org.listAssignments(S, { employeeId: SYNTRA.employee(code) });

describe('org units', () => {
  it('refuses stopping a unit still in use, with the counts (ERR-KPI-14)', async () => {
    const { gateway } = newGateway();
    const kd = (await gateway.org.listOrgUnits(S)).find((u) => u.code === 'KDBH');
    const error = await rejection(gateway.org.saveOrgUnit(S, admin, { ...strip(kd as never), status: 'Inactive' } as never));
    expect(error.code).toBe('ERR-KPI-14');
    expect(error.issues.map((i) => [i.detail, i.data?.count])).toEqual([
      ['UNIT_HAS_STAFF', 5],
      ['UNIT_HAS_PLANS', expect.any(Number)],
    ]);
  });

  it('a renamed unit is saved; the Inactive seeded unit stays editable', async () => {
    const { gateway } = newGateway();
    const bl = (await gateway.org.listOrgUnits(S)).find((u) => u.code === 'BL');
    await expect(gateway.org.saveOrgUnit(S, admin, { ...strip(bl as never), name: 'Phòng Bán lẻ (cũ)' } as never)).resolves.toMatchObject({ name: 'Phòng Bán lẻ (cũ)' });
  });

  it('refuses a head who works elsewhere', async () => {
    const { gateway } = newGateway();
    const mkt = (await gateway.org.listOrgUnits(S)).find((u) => u.code === 'MKT');
    expect(await issueDetails(gateway.org.saveOrgUnit(S, admin, { ...strip(mkt as never), headEmployeeId: SYNTRA.employee('E016') } as never))).toEqual({ code: 'ERR-KPI-06', details: ['HEAD_NOT_IN_UNIT'] });
  });
});

describe('positions and employees', () => {
  it('refuses stopping a position in use', async () => {
    const { gateway } = newGateway();
    const staff = (await gateway.org.listPositions(S)).find((p) => p.code === 'STAFF');
    expect((await rejection(gateway.org.savePosition(S, admin, { ...strip(staff as never), status: 'Inactive' } as never))).code).toBe('ERR-KPI-14');
  });

  it('B3 — a resignation ends the assignments that run past the last day, in the same write', async () => {
    const { gateway } = newGateway();
    const e016 = await gateway.org.getEmployee(S, SYNTRA.employee('E016'));
    await gateway.org.saveEmployee(S, admin, { ...strip(e016), employmentStatus: 'Resigned', leftOn: '2027-04-30' });
    expect((await assignmentsOf(gateway, 'E016')).map((a) => a.effectiveTo)).toEqual(['2027-04-30']);
  });

  it('refuses a resignation without a last day, and a duplicate email', async () => {
    const { gateway } = newGateway();
    const e016 = await gateway.org.getEmployee(S, SYNTRA.employee('E016'));
    expect(await issueDetails(gateway.org.saveEmployee(S, admin, { ...strip(e016), employmentStatus: 'Resigned' }))).toEqual({ code: 'ERR-KPI-06', details: ['LEFT_ON_REQUIRED'] });
    expect(await issueDetails(gateway.org.saveEmployee(S, admin, { ...strip(e016), email: 'HUNG.DV@syntra.example' }))).toEqual({ code: 'ERR-KPI-06', details: ['EMAIL_TAKEN'] });
  });
});

describe('assignments — B1 transfer', () => {
  const transfer = (o: Partial<EmployeeAssignment> = {}) => ({
    employeeId: SYNTRA.employee('E016'),
    orgUnitId: SYNTRA.unit('MKT'),
    positionId: SYNTRA.id('JobPosition', 'STAFF'),
    managerEmployeeId: SYNTRA.employee('E007'),
    isPrimary: true,
    effectiveFrom: '2027-05-01',
    effectiveTo: null,
    ...o,
  });

  it('ends the running primary on D − 1 and adds the new one, one event each', async () => {
    const { gateway } = newGateway();
    const events: DomainEvent[] = [];
    gateway.events.subscribe(S, (e) => void events.push(e));
    const saved = await gateway.org.saveAssignment(S, admin, transfer());
    const rows = await assignmentsOf(gateway, 'E016');
    const byStart = [...rows].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    expect(byStart.map((a) => [a.orgUnitId, a.effectiveFrom, a.effectiveTo])).toEqual([
      [SYNTRA.unit('KDBH'), '2022-06-01', '2027-04-30'],
      [SYNTRA.unit('MKT'), '2027-05-01', null],
    ]);
    await flush();
    const changes = events.filter((e) => e.type === 'entity.changed' && e.entityName === 'EmployeeAssignment');
    expect(changes.map((e) => (e.type === 'entity.changed' ? e.action : null)).sort()).toEqual(['CREATE', 'UPDATE']);
    expect(saved.orgUnitId).toBe(SYNTRA.unit('MKT'));
  });

  it('a concurrent assignment ends nothing', async () => {
    const { gateway } = newGateway();
    await gateway.org.saveAssignment(S, admin, transfer({ isPrimary: false }));
    expect((await assignmentsOf(gateway, 'E016')).filter((a) => a.effectiveTo === null)).toHaveLength(2);
  });

  it('a refused transfer leaves nothing behind — no row, no event', async () => {
    const { gateway } = newGateway();
    const events: DomainEvent[] = [];
    gateway.events.subscribe(S, (e) => void events.push(e));
    // E014 heads E016's new line? No — E016 as manager of E006 while E006 manages E016: a loop.
    const loop = { ...transfer(), employeeId: SYNTRA.employee('E006'), orgUnitId: SYNTRA.unit('KDBH'), positionId: SYNTRA.id('JobPosition', 'HEAD'), managerEmployeeId: SYNTRA.employee('E016') };
    expect(await issueDetails(gateway.org.saveAssignment(S, admin, loop))).toEqual({ code: 'ERR-KPI-16', details: ['REPORTING_CYCLE'] });
    await flush();
    expect(events).toEqual([]);
    expect((await assignmentsOf(gateway, 'E006')).map((a) => a.effectiveTo)).toEqual([null]);
  });

  it('refuses a transfer that starts on or before the running assignment', async () => {
    const { gateway } = newGateway();
    expect(await issueDetails(gateway.org.saveAssignment(S, admin, transfer({ effectiveFrom: '2022-06-01' })))).toEqual({ code: 'ERR-KPI-06', details: ['PRIMARY_OVERLAP'] });
  });

  it('refuses a manager who had left before the assignment starts (ERR-KPI-16)', async () => {
    const { gateway } = newGateway();
    expect(await issueDetails(gateway.org.saveAssignment(S, admin, transfer({ managerEmployeeId: SYNTRA.employee('E024') })))).toEqual({ code: 'ERR-KPI-16', details: ['MANAGER_NOT_EMPLOYED'] });
  });
});

describe('accounts and roles — B2 and the admin rails', () => {
  it('B2 — a new account of an employee gets EMPLOYEE / Self, which cannot be removed', async () => {
    const { gateway } = newGateway();
    const employee = await gateway.org.saveEmployee(S, admin, { employeeCode: 'E100', fullName: 'Người Mới', email: 'moi@syntra.example', hireDate: TODAY, employmentStatus: 'Probation', leftOn: null });
    const account = await gateway.org.saveUserAccount(S, admin, { employeeId: employee.id, login: 'moi.nn', displayName: 'Người Mới', authProvider: 'Local', status: 'Active' });
    const rows = await gateway.org.listUserRoles(S, account.id);
    const roles = await gateway.org.listRoles(S);
    expect(rows.map((r) => [roles.find((x) => x.id === r.roleId)?.code, r.scopeType])).toEqual([['EMPLOYEE', 'Self']]);
    expect(await issueDetails(gateway.org.deleteUserRole(S, admin, rows[0].id))).toEqual({ code: 'ERR-KPI-06', details: ['EMPLOYEE_SELF_REQUIRED'] });
  });

  it('refuses re-pointing an account at another person, and a second Active account', async () => {
    const { gateway } = newGateway();
    const account = await gateway.org.getUserAccount(S, SYNTRA.user('E016'));
    expect(await issueDetails(gateway.org.saveUserAccount(S, admin, { ...strip(account), employeeId: SYNTRA.employee('E017') }))).toEqual({ code: 'ERR-KPI-06', details: ['EMPLOYEE_IMMUTABLE'] });
    const old = await gateway.org.getUserAccount(S, SYNTRA.id('UserAccount', 'E033', 'old'));
    expect(await issueDetails(gateway.org.saveUserAccount(S, admin, { ...strip(old), status: 'Active' }))).toEqual({ code: 'ERR-KPI-06', details: ['ACCOUNT_EXISTS'] });
  });

  it('refuses the admin removing their own ADMIN role or deactivating their own account (ERR-KPI-15)', async () => {
    const { gateway } = newGateway();
    const roles = await gateway.org.listRoles(S);
    const adminRole = roles.find((r) => r.code === 'ADMIN')?.id;
    const own = (await gateway.org.listUserRoles(S, admin)).find((r) => r.roleId === adminRole);
    expect(await issueDetails(gateway.org.deleteUserRole(S, admin, own?.id as string))).toEqual({ code: 'ERR-KPI-15', details: ['SELF_LOCKOUT'] });
    const account = await gateway.org.getUserAccount(S, admin);
    expect(await issueDetails(gateway.org.saveUserAccount(S, admin, { ...strip(account), status: 'Inactive' }))).toEqual({ code: 'ERR-KPI-15', details: ['SELF_LOCKOUT'] });
  });

  it('refuses removing the last company-wide ADMIN, from another administrator', async () => {
    const { gateway } = newGateway();
    const roles = await gateway.org.listRoles(S);
    const adminRole = roles.find((r) => r.code === 'ADMIN')?.id as string;
    // Syntra has two: E032 and the system account. Remove the system account's, then try E032's from an HR admin.
    const rows = (await gateway.org.listUserRoles(S)).filter((r) => r.roleId === adminRole);
    const hr = SYNTRA.user(SYNTRA.personas.hr);
    await gateway.org.saveUserRole(S, admin, { userId: hr, roleId: adminRole, scopeType: 'Tenant', scopeOrgUnitId: null, includeChildren: false });
    for (const r of rows) await gateway.org.deleteUserRole(S, hr, r.id);
    const last = (await gateway.org.listUserRoles(S, hr)).find((r) => r.roleId === adminRole);
    expect((await rejection(gateway.org.deleteUserRole(S, hr, last?.id as string))).code).toBe('ERR-KPI-15');
  });

  it('refuses MANAGER on a Self scope', async () => {
    const { gateway } = newGateway();
    const manager = (await gateway.org.listRoles(S)).find((r) => r.code === 'MANAGER')?.id as string;
    expect(await issueDetails(gateway.org.saveUserRole(S, admin, { userId: SYNTRA.user('E016'), roleId: manager, scopeType: 'Self', scopeOrgUnitId: null, includeChildren: false }))).toEqual({
      code: 'ERR-KPI-06',
      details: ['SELF_SCOPE_ROLE'],
    });
  });

  it('setRolePermissions writes only the difference, and never takes user.manage from ADMIN', async () => {
    const { gateway } = newGateway();
    const roles = await gateway.org.listRoles(S);
    const hr = roles.find((r) => r.code === 'HR')?.id as string;
    const adminRole = roles.find((r) => r.code === 'ADMIN')?.id as string;
    const held = (await gateway.org.listRolePermissions(S)).filter((r) => r.roleId === hr).map((r) => r.permissionId);
    const events: DomainEvent[] = [];
    gateway.events.subscribe(S, (e) => void events.push(e));
    await gateway.org.setRolePermissions(S, admin, hr, [...held, 'perm.audit.view']);
    await flush();
    expect(events.filter((e) => e.type === 'entity.changed').map((e) => (e.type === 'entity.changed' ? e.action : null))).toEqual(['CREATE']);
    const adminHeld = (await gateway.org.listRolePermissions(S)).filter((r) => r.roleId === adminRole).map((r) => r.permissionId);
    const error = await rejection(gateway.org.setRolePermissions(S, admin, adminRole, adminHeld.filter((p) => p !== 'perm.user.manage')));
    expect(error.code).toBe('ERR-KPI-15');
  });
});

describe('tenant — BR-KPI-73', () => {
  it('refuses an unknown time zone and suspending your own company', async () => {
    const { gateway } = newGateway();
    const tenant = await gateway.platform.getTenant(S);
    const { id, code, name, status } = tenant;
    expect(await issueDetails(gateway.platform.saveTenant(admin, { id, code, name, status, timezone: 'GMT+7' }))).toEqual({ code: 'ERR-KPI-06', details: ['TIMEZONE_INVALID'] });
    expect(await issueDetails(gateway.platform.saveTenant(admin, { id, code, name, timezone: tenant.timezone, status: 'Suspended' }))).toEqual({ code: 'ERR-KPI-15', details: ['SUSPEND_OWN_TENANT'] });
    await expect(gateway.platform.saveTenant(admin, { id, code, name: 'Syntra JSC', timezone: tenant.timezone, status })).resolves.toMatchObject({ name: 'Syntra JSC' });
  });
});

describe('tenant isolation of the new guards', () => {
  it.each([
    ['managerEmployeeId', { managerEmployeeId: DEMO.employee('D002') }],
    ['orgUnitId', { orgUnitId: DEMO.unit('KD') }],
  ])('a Demo Co %s in a Syntra assignment answers like a missing id', async (field, change) => {
    const { gateway } = newGateway();
    const base = { employeeId: SYNTRA.employee('E016'), orgUnitId: SYNTRA.unit('MKT'), positionId: SYNTRA.id('JobPosition', 'STAFF'), managerEmployeeId: null, isPrimary: false, effectiveFrom: '2027-05-01', effectiveTo: null };
    const foreign = await rejection(gateway.org.saveAssignment(S, admin, { ...base, ...change }));
    const missing = await rejection(gateway.org.saveAssignment(S, admin, { ...base, [field]: '00000000-0000-4000-8000-000000000000' }));
    expect(foreign.code).toBe('ERR-KPI-06');
    expect(foreign.detail?.replace(/[0-9a-f-]{36}/g, 'ID')).toBe(missing.detail?.replace(/[0-9a-f-]{36}/g, 'ID'));
    expect(foreign.issues).toEqual([]);
  });

  it('a Demo Co role in a Syntra role assignment answers like a missing id', async () => {
    const { gateway } = newGateway();
    const demoRole = (await gateway.org.listRoles(DEMO.tenantId)).find((r) => r.code === 'MANAGER')?.id as string;
    const row = { userId: SYNTRA.user('E016'), roleId: demoRole, scopeType: 'Self' as const, scopeOrgUnitId: null, includeChildren: false };
    const foreign = await rejection(gateway.org.saveUserRole(S, admin, row));
    const missing = await rejection(gateway.org.saveUserRole(S, admin, { ...row, roleId: '00000000-0000-4000-8000-000000000000' }));
    expect(foreign.detail?.replace(/[0-9a-f-]{36}/g, 'ID')).toBe(missing.detail?.replace(/[0-9a-f-]{36}/g, 'ID'));
    expect(foreign.issues).toEqual([]);
  });
});
