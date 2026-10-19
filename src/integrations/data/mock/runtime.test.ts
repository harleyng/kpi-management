import { describe, expect, it, vi } from 'vitest';
import { DEMO, SYNTRA } from '@/data/fixtures';
import { KpiDeferredError, KpiError } from '@/lib/errorCatalog';
import { GATEWAY_GROUPS, SYNC_GATEWAY_GROUPS, type DomainEvent } from '../types';
import { flush, newGateway, rejection } from './gateway.test-util';

const S = SYNTRA.tenantId;
const admin = SYNTRA.user(SYNTRA.personas.admin);
const position = { code: 'P-NEW', name: 'Vị trí mới', jobLevel: 'Staff' as const, status: 'Active' as const };

describe('mock runtime — the contract surface', () => {
  it('names itself the mock and exposes every group, with dev controls', () => {
    const { gateway } = newGateway();
    expect(gateway.adapter).toBe('mock');
    for (const group of GATEWAY_GROUPS) expect(gateway[group]).toBeDefined();
    expect(gateway.dev).toBeDefined();
  });

  it('classifies every async method once, by the wrapper that built it (read / write / system / platform)', () => {
    const { gateway } = newGateway();
    const declared = GATEWAY_GROUPS.filter((g) => !(SYNC_GATEWAY_GROUPS as readonly string[]).includes(g)).flatMap((g) =>
      Object.keys(gateway[g] as object).map((m) => `${g}.${m}`),
    );
    expect([...gateway.registry.methods.keys()].sort()).toEqual(declared.sort());
  });

  it('lists each deferred method with what it waits for; each rejects KpiDeferredError and is never retried', async () => {
    const { gateway } = newGateway();
    expect(gateway.registry.deferred.size).toBeGreaterThan(0);
    for (const [name, owner] of gateway.registry.deferred) {
      const [group, method] = name.split('.');
      const fn = (gateway as unknown as Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>)[group][method];
      const error = await rejection(fn(S, admin, {}));
      expect(error, name).toBeInstanceOf(KpiDeferredError);
      expect((error as KpiDeferredError).owner).toBe(owner);
      expect(error.code).toBe(gateway.registry.methods.get(name) === 'read' ? 'ERR-KPI-01' : 'ERR-KPI-03');
    }
  });

  it('a deferred method and a pending guard are never the same method', () => {
    const { gateway } = newGateway();
    for (const name of gateway.registry.pendingGuards.keys()) {
      expect(gateway.registry.deferred.has(name), name).toBe(false);
      expect(gateway.registry.methods.has(name) || name.startsWith('(every'), name).toBe(true);
    }
  });

  it('Gate 1, workflow lane: forms, launches, the scheduler, lock/unlock, cycles and plan edits are wired', () => {
    const { gateway } = newGateway();
    const wired = [
      'forms.startForm', 'forms.act', 'forms.listInbox', 'forms.saveEvaluationItems', 'forms.createLaunch', 'forms.cancelLaunch',
      'scheduler.runDue', 'goals.lockGoalPlan', 'goals.unlockGoalPlan', 'goals.setCycleStatus',
    ];
    const guarded = [
      'forms.saveWorkflow', 'forms.saveLaunchRule', 'forms.saveGoalChangeItems', 'forms.saveDelegation', 'forms.revokeDelegation',
      'goals.saveCycle', 'goals.savePeriods', 'goals.saveKgi', 'goals.deleteKgi', 'goals.saveGoal', 'goals.deleteGoal',
      'goals.setTargetLevels', 'goals.setPeriodTargets', 'goals.saveAlignment', 'goals.deleteAlignment',
    ];
    for (const name of [...wired, ...guarded]) {
      expect(gateway.registry.methods.has(name), name).toBe(true);
      expect(gateway.registry.deferred.has(name), name).toBe(false);
      expect(gateway.registry.pendingGuards.has(name), name).toBe(false);
    }
    // The scheduler is a system write: no actor (`runDue(tenantId)`).
    expect(gateway.registry.methods.get('scheduler.runDue')).toBe('system');
  });

  // Gate 1 (plan §6.2): every Phase 1 rule is wired. What stays deferred or unguarded is a Phase 2
  // track's own work package, named here — adding to this list is a Large change (fixtures README).
  it('Gate 1: nothing is deferred and no guard is pending, bar the tracks\' own work packages', () => {
    const { gateway } = newGateway();
    const { deferred, pendingGuards, trackOwned, auth, methods } = gateway.registry;
    const open = (names: Iterable<string>) => [...names].filter((n) => !trackOwned.has(n));
    expect(open(deferred.keys())).toEqual([]);
    expect(open(pendingGuards.keys())).toEqual([]);
    expect(Object.fromEntries([...trackOwned].sort(([a], [b]) => (a < b ? -1 : 1)))).toEqual({
      'actuals.commitImport': 'T4', // WBS 4.4.3 importRules
      'actuals.runSync': 'T4', // WBS 4.4.5 the simulated ERP Sale connector
      'actuals.stageImport': 'T4', // WBS 4.4.3
    });
    // Every user write declares its authorization (authorize.ts), deferred ones included.
    for (const [name, kind] of methods) if (kind === 'write') expect(auth.has(name), name).toBe(true);
  });
});

describe('mock runtime — per-call behaviour', () => {
  it('waits the configured latency', async () => {
    vi.useFakeTimers();
    try {
      const { gateway } = newGateway({ latencyMs: 200 });
      let done = false;
      const call = gateway.org.listRoles(S).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(150);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(60);
      await call;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('injects failures by method pattern: reads ERR-KPI-01, writes ERR-KPI-03, the rest untouched', async () => {
    const { gateway } = newGateway();
    gateway.dev?.setFailureMode({ enabled: true, methodPattern: 'org.*' });
    expect((await rejection(gateway.org.listRoles(S))).code).toBe('ERR-KPI-01');
    expect((await rejection(gateway.org.savePosition(S, admin, position))).code).toBe('ERR-KPI-03');
    await expect(gateway.library.listPerspectives(S)).resolves.toHaveLength(4);
    gateway.dev?.setFailureMode({ enabled: true });
    expect((await rejection(gateway.library.listPerspectives(S))).code).toBe('ERR-KPI-01');
    expect(() => gateway.clock.now()).not.toThrow();
    gateway.dev?.setFailureMode({ enabled: false });
    await expect(gateway.org.listRoles(S)).resolves.toHaveLength(6);
  });

  it('an injected write failure changes nothing', async () => {
    const { gateway } = newGateway();
    const before = await gateway.org.listPositions(S);
    gateway.dev?.setFailureMode({ enabled: true, methodPattern: '*.save*' });
    await rejection(gateway.org.savePosition(S, admin, position));
    gateway.dev?.setFailureMode({ enabled: false });
    expect(await gateway.org.listPositions(S)).toEqual(before);
  });

  it('hands out copies: mutating a result or a payload never reaches the store', async () => {
    const { gateway } = newGateway();
    const units = await gateway.org.listOrgUnits(S);
    units[0].name = 'Đã sửa ngoài gateway';
    expect((await gateway.org.listOrgUnits(S))[0].name).not.toBe('Đã sửa ngoài gateway');
    const payload = { ...position };
    const pending = gateway.org.savePosition(S, admin, payload);
    payload.name = 'Đổi sau khi gọi';
    expect((await pending).name).toBe('Vị trí mới');
  });

  it('passes a KpiError through unchanged', async () => {
    const { gateway } = newGateway();
    const error = await rejection(gateway.org.getEmployee(S, 'no-such-id'));
    expect(error.code).toBe('ERR-KPI-02');
  });

  it('serialises concurrent writes: two snapshots of one actual, exactly one current', async () => {
    const { gateway } = newGateway();
    const goal = (await gateway.goals.listGoals(S, { ownerEmployeeId: SYNTRA.employee('E016') }))[0];
    const [t04] = (await gateway.goals.listPeriods(S, goal.goalPlanId === '' ? '' : SYNTRA.id('PerformanceCycle', '2027'))).filter((p) => p.label === 'T04');
    const input = (v: number) => ({ goalId: goal.id, periodId: t04.id, actualValue: v, actualText: null, note: null });
    await Promise.all([gateway.actuals.recordActual(S, admin, input(1)), gateway.actuals.recordActual(S, admin, input(2))]);
    const all = await gateway.actuals.listActuals(S, { goalIds: [goal.id], periodId: t04.id, currentOnly: false });
    expect(all).toHaveLength(2);
    expect(all.filter((a) => a.isCurrent)).toHaveLength(1);
  });
});

describe('mock runtime — events', () => {
  it('emits entity.changed per row after a write, to the tenant\'s subscribers only', async () => {
    const { gateway } = newGateway();
    const heard: DomainEvent[] = [];
    const unsubscribe = gateway.events.subscribe(S, (e) => void heard.push(e));
    const saved = await gateway.org.savePosition(S, admin, position);
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ type: 'entity.changed', tenantId: S, entityName: 'JobPosition', entityId: saved.id, action: 'CREATE', actorUserId: admin, before: null });
    unsubscribe();
    await gateway.org.savePosition(S, admin, { ...saved, name: 'Đổi tên' });
    expect(heard).toHaveLength(1);
  });

  it('a listener that throws or rejects never fails the write and never stops other listeners', async () => {
    const diagnostics: string[] = [];
    const { gateway } = newGateway({ onDiagnostic: (message) => diagnostics.push(message) });
    const heard: string[] = [];
    gateway.events.subscribe(S, () => {
      throw new Error('boom');
    });
    gateway.events.subscribe(S, async () => {
      throw new Error('async boom');
    });
    gateway.events.subscribe(S, (e) => void heard.push(e.type));
    await expect(gateway.org.savePosition(S, admin, position)).resolves.toMatchObject({ code: 'P-NEW' });
    await flush();
    expect(heard).toEqual(['entity.changed']);
    expect(diagnostics).toHaveLength(2);
  });

  it('writes the audit entry IN the write\'s transaction — even with recordAudit failing', async () => {
    const { gateway } = newGateway();
    gateway.dev?.setFailureMode({ enabled: true, methodPattern: 'system.recordAudit' });
    const saved = await gateway.org.savePosition(S, admin, position);
    gateway.dev?.setFailureMode({ enabled: false });
    const page = await gateway.system.listAuditLog(S, { entityName: 'JobPosition', entityId: saved.id });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ userId: admin, action: 'CREATE', entityId: saved.id });
  });

  it('recordAudit refuses an event of another tenant, and is idempotent', async () => {
    const { gateway } = newGateway();
    const heard: DomainEvent[] = [];
    gateway.events.subscribe(S, (e) => void heard.push(e));
    await gateway.org.savePosition(S, admin, position);
    await flush();
    const event = heard[0] as Extract<DomainEvent, { type: 'entity.changed' }>;
    expect((await rejection(gateway.system.recordAudit(DEMO.tenantId, event))).code).toBe('ERR-KPI-06');
    const again = await gateway.system.recordAudit(S, event);
    expect(again.id).toBe(event.id);
    expect((await gateway.system.listAuditLog(S, { entityId: event.entityId })).items).toHaveLength(1);
  });
});

describe('mock runtime — errors are KpiError', () => {
  it('an unexpected throw in a write maps to ERR-KPI-03', async () => {
    const { gateway } = newGateway();
    // A Blob is required: a string makes the method throw its own KpiError…
    expect((await rejection(gateway.system.uploadFile(S, admin, { fileName: 'a.txt', mimeType: 'text/plain', data: 'x' as unknown as Blob }))).code).toBe('ERR-KPI-06');
    expect(new KpiError('ERR-KPI-03')).toBeInstanceOf(Error);
  });
});
