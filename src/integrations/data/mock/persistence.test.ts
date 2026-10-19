import { describe, expect, it } from 'vitest';
import { SYNTRA } from '@/data/fixtures';
import type { DomainEvent } from '../types';
import { createMockGateway } from './createMockGateway';
import { newGateway, rejection, testSeed } from './gateway.test-util';
import { CLOCK_KEY, MemoryStorage } from './persistence';

const S = SYNTRA.tenantId;
const hr = SYNTRA.user(SYNTRA.personas.hr);
const position = { code: 'P-NEW', name: 'Vị trí mới', jobLevel: 'Staff' as const, status: 'Active' as const };
const reopen = (storage: MemoryStorage, seedVersion = 'test') => createMockGateway({ storage, latencyMs: 0, seed: testSeed, seedVersion });

describe('mock persistence', () => {
  it('nothing is read or written before the first call', () => {
    const storage = new MemoryStorage();
    createMockGateway({ storage, latencyMs: 0, seed: testSeed });
    expect(storage.length).toBe(0);
  });

  it('seeds storage on first use, then a second gateway reads what the first one wrote', async () => {
    const storage = new MemoryStorage();
    const first = reopen(storage);
    const saved = await first.org.savePosition(S, hr, position);
    expect(storage.keys().some((k) => k.startsWith(`kpi.t.${S}.`))).toBe(true);
    const second = reopen(storage);
    expect((await second.org.listPositions(S)).find((p) => p.id === saved.id)?.name).toBe('Vị trí mới');
  });

  it('a different seed version reseeds instead of mixing old rows with new code', async () => {
    const storage = new MemoryStorage();
    const saved = await reopen(storage, 'v1').org.savePosition(S, hr, position);
    const upgraded = reopen(storage, 'v2');
    expect((await upgraded.org.listPositions(S)).some((p) => p.id === saved.id)).toBe(false);
  });

  it('a save that fails half-way restores the keys already written, keeps memory, and emits nothing', async () => {
    const storage = new MemoryStorage();
    const { gateway } = newGateway({ storage, seedVersion: 'test' });
    await gateway.org.listRoles(S); // load + seed
    const heard: DomainEvent[] = [];
    gateway.events.subscribe(S, (e) => void heard.push(e));
    // recordActual writes two collections only when a snapshot is retired: fail the second key.
    const goal = (await gateway.goals.listGoals(S, { ownerEmployeeId: SYNTRA.employee('E016') }))[0];
    const period = (await gateway.goals.listPeriods(S, SYNTRA.id('PerformanceCycle', '2027'))).find((p) => p.label === 'T03');
    const before = storage.getItem(`kpi.t.${S}.GoalActual`);
    storage.failOn = (key) => key === `kpi.t.${S}.GoalActual`;
    const error = await rejection(gateway.actuals.recordActual(S, hr, { goalId: goal.id, periodId: period?.id as string, actualValue: 1, actualText: null, note: null }));
    storage.failOn = null;
    expect(error.code).toBe('ERR-KPI-03');
    expect(storage.getItem(`kpi.t.${S}.GoalActual`)).toBe(before);
    expect(heard).toEqual([]);
    expect((await gateway.actuals.listActuals(S, { goalIds: [goal.id], periodId: period?.id })).every((a) => a.actualValue !== 1)).toBe(true);
  });

  it('a multi-key save that fails on its SECOND key restores the first', async () => {
    const storage = new MemoryStorage();
    const { gateway } = newGateway({ storage, seedVersion: 'test' });
    await gateway.org.listRoles(S);
    const role = (await gateway.org.listRoles(S))[0];
    const beforeRp = storage.getItem(`kpi.t.${S}.RolePermission`);
    // setRolePermissions touches RolePermission only; saveCalcMethod touches CalcMethod then CalcTier.
    const method = (await gateway.library.listCalcMethods(S)).find((m) => m.methodType === 'TIERED');
    const tiers = await gateway.library.listCalcTiers(S, method?.id);
    const beforeMethod = storage.getItem(`kpi.t.${S}.CalcMethod`);
    storage.failOn = (key) => key === `kpi.t.${S}.CalcTier`;
    await rejection(gateway.library.saveCalcMethod(S, hr, { ...(method as object), name: 'Đổi tên' } as never, tiers));
    storage.failOn = null;
    expect(storage.getItem(`kpi.t.${S}.CalcMethod`)).toBe(beforeMethod);
    expect(storage.getItem(`kpi.t.${S}.RolePermission`)).toBe(beforeRp);
    expect(role).toBeDefined();
  });

  it('a stored row of another tenant fails loudly at load (ERR-KPI-01)', async () => {
    const storage = new MemoryStorage();
    await reopen(storage).org.listRoles(S);
    const key = `kpi.t.${S}.JobPosition`;
    const rows = JSON.parse(storage.getItem(key) as string) as { tenantId: string }[];
    rows[0].tenantId = 'someone-else';
    storage.setItem(key, JSON.stringify(rows));
    expect((await rejection(reopen(storage).org.listPositions(S))).code).toBe('ERR-KPI-01');
  });

  it('resetSeed wipes storage and memory together and loads the fixtures again', async () => {
    const storage = new MemoryStorage();
    const { gateway } = newGateway({ storage });
    const saved = await gateway.org.savePosition(S, hr, position);
    gateway.dev?.setNow('2027-06-01T02:00:00.000Z');
    await gateway.dev?.resetSeed();
    expect((await gateway.org.listPositions(S)).some((p) => p.id === saved.id)).toBe(false);
    expect(storage.getItem(CLOCK_KEY)).toBeNull();
  });

  it('a storage quota exceeded on first load fails the read (ERR-KPI-01), not silently', async () => {
    const storage = new MemoryStorage(1_000);
    expect((await rejection(createMockGateway({ storage, latencyMs: 0, seed: testSeed }).org.listRoles(S))).code).toBe('ERR-KPI-01');
  });

  it('saves the clock IN the write\'s batch: if the clock key fails, nothing of the write is stored, nothing is announced', async () => {
    const storage = new MemoryStorage();
    const { gateway } = newGateway({ storage, seedVersion: 'test' });
    await gateway.org.listRoles(S);
    const heard: DomainEvent[] = [];
    gateway.events.subscribe(S, (e) => void heard.push(e));
    const before = storage.getItem(`kpi.t.${S}.JobPosition`);
    storage.failOn = (key) => key === CLOCK_KEY;
    expect((await rejection(gateway.org.savePosition(S, hr, position))).code).toBe('ERR-KPI-03');
    storage.failOn = null;
    expect(storage.getItem(`kpi.t.${S}.JobPosition`)).toBe(before);
    expect((await gateway.org.listPositions(S)).some((p) => p.code === 'P-NEW')).toBe(false);
    expect(heard).toEqual([]);
  });

  it('a committed write saves the simulated time, and a reload continues from it', async () => {
    const storage = new MemoryStorage();
    const first = reopen(storage);
    first.dev?.setNow('2027-05-02T02:00:00.000Z');
    await first.org.savePosition(S, hr, position);
    const saved = JSON.parse(storage.getItem(CLOCK_KEY) as string) as { simulatedAt: string };
    expect(saved.simulatedAt >= '2027-05-02T02:00:00.000Z').toBe(true);
    expect(reopen(storage).clock.now() >= saved.simulatedAt).toBe(true);
  });

  it('a stored key that has gone missing fails the load (ERR-KPI-01) instead of showing an empty table', async () => {
    const storage = new MemoryStorage();
    await reopen(storage).org.listRoles(S);
    storage.removeItem(`kpi.t.${S}.Goal`);
    expect((await rejection(reopen(storage).goals.listGoals(S))).code).toBe('ERR-KPI-01');
  });

  it('a corrupt saved clock is reported, not silently replaced', () => {
    const storage = new MemoryStorage();
    storage.setItem(CLOCK_KEY, 'not json');
    const diagnostics: string[] = [];
    createMockGateway({ storage, latencyMs: 0, seed: testSeed, onDiagnostic: (m) => diagnostics.push(m) });
    expect(diagnostics.some((m) => m.includes(CLOCK_KEY))).toBe(true);
  });

  it('a new tenant is saved with all its tables, so it loads after a reload', async () => {
    const storage = new MemoryStorage();
    const first = reopen(storage);
    const created = await first.platform.saveTenant(hr, { code: 'NEWCO', name: 'Công ty mới', timezone: 'Asia/Ho_Chi_Minh', status: 'Active' });
    const again = reopen(storage);
    expect((await again.platform.listTenants()).map((t) => t.code)).toContain('NEWCO');
    await expect(again.org.listOrgUnits(created.id)).resolves.toEqual([]);
    // Its own audit log records its creation; no actor (the creator belongs to another tenant).
    expect((await again.system.listAuditLog(created.id)).items).toMatchObject([{ entityName: 'Tenant', action: 'CREATE', userId: null }]);
  });
});
