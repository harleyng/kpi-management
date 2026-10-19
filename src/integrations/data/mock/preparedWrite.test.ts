import { describe, expect, it, vi } from 'vitest';
import { SEED_NOW, SEED_VERSION, SYNTRA } from '@/data/fixtures';
import type { Id } from '@/data/types';
import type { DomainEvent } from '../types';
import { rejection, testSeed } from './gateway.test-util';
import { Runtime } from './runtime';
import type { Tx } from './store';

/**
 * `Runtime.preparedWrite` (T6) — a write with async work between reading and committing. Exercised on
 * a plain position rename so the runtime's guarantees are tested apart from the payroll file.
 */

const S = SYNTRA.tenantId;
const admin = SYNTRA.user(SYNTRA.personas.admin);
const employee = SYNTRA.user(SYNTRA.personas.employee);

function setup() {
  const rt = new Runtime({ storage: null, latencyMs: 0, seed: testSeed, seedVersion: SEED_VERSION, seedNow: SEED_NOW, onDiagnostic: () => {} });
  const positionId = (testSeed().tenants.find((t) => t.tenant.id === S)?.rows.JobPosition[0].id ?? '') as Id;
  const read = rt.read('test.position', (tx) => tx.get('JobPosition', positionId));
  const rename = rt.write('test.rename', { permission: 'org.manage' }, (tx, name: string) => tx.update('JobPosition', { ...tx.get('JobPosition', positionId), name }));
  const deactivate = rt.write('test.deactivate', { permission: 'org.manage' }, (tx, userId: Id) => tx.update('UserAccount', { ...tx.get('UserAccount', userId), status: 'Inactive' }));
  const events: DomainEvent[] = [];
  rt.bus.subscribe(S, (e) => {
    events.push(e);
  });
  return { rt, positionId, read, rename, deactivate, events };
}

type Steps = {
  prepare?: (tx: Tx) => string;
  produce?: (prepared: string) => Promise<string>;
  afterCommit?: (result: unknown, produced: string) => void;
};

function prepared(rt: Runtime, positionId: Id, steps: Steps = {}) {
  const prepare = vi.fn(steps.prepare ?? ((tx: Tx) => tx.get('JobPosition', positionId).name));
  const produce = vi.fn(steps.produce ?? (async (name: string) => `${name} (đã xử lý)`));
  const afterCommit = vi.fn(steps.afterCommit ?? (() => {}));
  const write = rt.preparedWrite('test.prepared', { permission: 'org.manage' }, {
    prepare,
    produce,
    apply: (tx, _name, produced) => tx.update('JobPosition', { ...tx.get('JobPosition', positionId), name: produced }),
    afterCommit,
  });
  return { write, prepare, produce, afterCommit };
}

describe('Runtime.preparedWrite', () => {
  it('registers as a write with its declared auth', () => {
    const { rt, positionId } = setup();
    prepared(rt, positionId);
    expect(rt.registry.methods.get('test.prepared')).toBe('write');
    expect(rt.registry.auth.get('test.prepared')).toEqual({ permission: 'org.manage' });
  });

  it('prepares, produces, applies and commits; afterCommit and the events come only after the save', async () => {
    const { rt, positionId, read, events } = setup();
    const before = (await read(S)).name;
    const { write, afterCommit } = prepared(rt, positionId, {
      afterCommit: () => expect(events).toEqual([]), // not announced yet
    });
    const result = await write(S, admin);
    expect(result.name).toBe(`${before} (đã xử lý)`);
    expect((await read(S)).name).toBe(`${before} (đã xử lý)`);
    expect(afterCommit).toHaveBeenCalledTimes(1);
    expect(afterCommit.mock.calls[0][1]).toBe(`${before} (đã xử lý)`);
    expect(events.map((e) => e.type)).toEqual(['entity.changed']);
  });

  it('authorizes BEFORE preparing: a refused actor has nothing built (ERR-KPI-05)', async () => {
    const { rt, positionId } = setup();
    const { write, prepare, produce } = prepared(rt, positionId);
    expect((await rejection(write(S, employee))).code).toBe('ERR-KPI-05');
    expect(prepare).not.toHaveBeenCalled();
    expect(produce).not.toHaveBeenCalled();
  });

  it('authorizes again at commit: an account deactivated meanwhile is refused and nothing is written', async () => {
    const { rt, positionId, read, deactivate } = setup();
    const before = (await read(S)).name;
    const { write, afterCommit } = prepared(rt, positionId, {
      produce: async (name) => {
        await deactivate(S, admin, admin);
        return `${name}!`;
      },
    });
    expect((await rejection(write(S, admin))).code).toBe('ERR-KPI-05');
    expect((await read(S)).name).toBe(before);
    expect(afterCommit).not.toHaveBeenCalled();
  });

  it('refuses with ERR-KPI-04 CHANGED_DURING_WRITE when the data moved during produce, and writes nothing of its own', async () => {
    const { rt, positionId, read, rename, events } = setup();
    const { write, afterCommit } = prepared(rt, positionId, {
      produce: async (name) => {
        await rename(S, admin, 'Đổi tên giữa chừng');
        return `${name} (cũ)`;
      },
    });
    const error = await rejection(write(S, admin));
    expect(error).toMatchObject({ code: 'ERR-KPI-04', detail: 'CHANGED_DURING_WRITE' });
    expect((await read(S)).name).toBe('Đổi tên giữa chừng');
    expect(afterCommit).not.toHaveBeenCalled();
    expect(events).toHaveLength(1); // the rename's only
  });

  it('maps a failure of produce to ERR-KPI-03 and writes nothing', async () => {
    const { rt, positionId, read, events } = setup();
    const before = (await read(S)).name;
    const { write } = prepared(rt, positionId, {
      produce: async () => {
        throw new Error('render failed');
      },
    });
    const error = await rejection(write(S, admin));
    expect(error.code).toBe('ERR-KPI-03');
    expect(error.detail).toContain('test.prepared');
    expect((await read(S)).name).toBe(before);
    expect(events).toEqual([]);
  });

  it('injected failure fires once, before anything is prepared (ERR-KPI-03)', async () => {
    const { rt, positionId } = setup();
    const { write, prepare } = prepared(rt, positionId);
    rt.setFailureMode({ enabled: true, methodPattern: 'test.prepared' });
    expect((await rejection(write(S, admin))).code).toBe('ERR-KPI-03');
    expect(prepare).not.toHaveBeenCalled();
  });

  it('a KpiError thrown by prepare reaches the caller as it is', async () => {
    const { rt, positionId } = setup();
    const { write } = prepared(rt, positionId, { prepare: (tx) => tx.get('JobPosition', 'nowhere').name });
    expect((await rejection(write(S, admin))).code).toBe('ERR-KPI-02');
  });
});
