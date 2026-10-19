import { describe, expect, it } from 'vitest';
import { SYNTRA } from '@/data/fixtures';
import { DEFAULT_ROLE_PERMISSIONS } from '@/lib/permissionRules';
import type { DomainEvent } from '../types';
import { newGateway, rejection } from './gateway.test-util';

const S = SYNTRA.tenantId;
const P = SYNTRA.personas;
const cycle2028 = SYNTRA.id('PerformanceCycle', '2028');

type AnyMethod = (...args: unknown[]) => Promise<unknown>;
const method = (gateway: object, name: string) => {
  const [group, fn] = name.split('.');
  return (gateway as Record<string, Record<string, AnyMethod>>)[group][fn];
};

const planFor = (employeeCode: string) =>
  ({ cycleId: cycle2028, planType: 'KPI', ownerType: 'Employee', ownerOrgUnitId: null, ownerEmployeeId: SYNTRA.employee(employeeCode) }) as const;

describe('authorization — every write declares its permission (authorize.ts)', () => {
  it('declares an auth for every user write that runs, and for every track-owned deferral', () => {
    const { gateway } = newGateway();
    const { methods, deferred, trackOwned, auth } = gateway.registry;
    for (const [name, kind] of methods) {
      if (kind !== 'write') continue;
      if (deferred.has(name) && !trackOwned.has(name)) continue; // still waiting for its rule (Gate 1 test)
      expect(auth.has(name), `${name} has no declared auth`).toBe(true);
    }
  });

  it('refuses every declared code to a user who lacks it (a plain employee) with ERR-KPI-05, before the body, and writes nothing', async () => {
    const { gateway } = newGateway();
    const employee = SYNTRA.user(P.employee); // E016: EMPLOYEE / Self only, heads no unit
    const held = new Set<string>(DEFAULT_ROLE_PERMISSIONS.EMPLOYEE);
    const heard: DomainEvent[] = [];
    gateway.events.subscribe(S, (e) => {
      heard.push(e);
    });
    let checked = 0;
    for (const [name, auth] of gateway.registry.auth) {
      if (typeof auth === 'string' || held.has(auth.permission) || gateway.registry.deferred.has(name)) continue;
      // Empty arguments: the permission check runs before the body reads them.
      const error = await rejection(method(gateway, name)(S, employee, {}, []));
      expect(error.code, name).toBe('ERR-KPI-05');
      expect(error.detail, name).toContain(auth.permission);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(20);
    expect(heard).toEqual([]);
  });
});

describe('authorization — scope (BR-KPI-60)', () => {
  it('an employee edits their own plan, never a peer\'s', async () => {
    const { gateway } = newGateway();
    const self = SYNTRA.user(P.employee); // E016
    await expect(gateway.goals.createGoalPlan(S, self, planFor('E016'))).resolves.toMatchObject({ status: 'Draft' });
    const peer = await rejection(gateway.goals.createGoalPlan(S, self, planFor('E017')));
    expect(peer.code).toBe('ERR-KPI-05');
  });

  it('a manager edits the plans of their unit (with children), not another unit\'s', async () => {
    const { gateway } = newGateway();
    const manager = SYNTRA.user(P.manager); // E006, head of KDBH
    await expect(gateway.goals.createGoalPlan(S, manager, planFor('E017'))).resolves.toBeDefined();
    const outside = await rejection(gateway.goals.createGoalPlan(S, manager, planFor(P.hr)));
    expect(outside.code).toBe('ERR-KPI-05');
  });

  it('HR (Tenant scope) edits any plan; a library edit still needs library.manage', async () => {
    const { gateway } = newGateway();
    const hr = SYNTRA.user(P.hr);
    await expect(gateway.goals.createGoalPlan(S, hr, planFor('E017'))).resolves.toBeDefined();
    const employee = await rejection(gateway.library.saveMeasureUnit(S, SYNTRA.user(P.employee), { code: 'X', name: 'X', symbol: 'x' } as never));
    expect(employee.code).toBe('ERR-KPI-05');
  });

  it('administering a tenant needs org.manage in the actor\'s own tenant', async () => {
    const { gateway } = newGateway();
    const input = { code: 'NEWCO', name: 'Công ty mới', timezone: 'Asia/Ho_Chi_Minh', status: 'Active' } as const;
    expect((await rejection(gateway.platform.saveTenant(SYNTRA.user(P.hr), input))).code).toBe('ERR-KPI-05');
    await expect(gateway.platform.saveTenant(SYNTRA.user(P.admin), input)).resolves.toMatchObject({ code: 'NEWCO' });
  });

  it('a payload naming an unknown plan is answered by the integrity check, not by a permission refusal', async () => {
    const { gateway } = newGateway();
    const error = await rejection(gateway.goals.saveGoal(S, SYNTRA.user(P.hr), { goalPlanId: 'no-such-plan' } as never));
    expect(error.code).not.toBe('ERR-KPI-05');
  });
});
