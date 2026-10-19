import { describe, expect, it } from 'vitest';
import { cloneDeep, deepFreeze, TenantData, Tx } from './store';

const globals = { tenants: new Map(), permissions: new Map() };
const position = { id: 'p1', tenantId: 't1', code: 'A', name: 'A', jobLevel: 'Staff', status: 'Active' } as const;

describe('mock store', () => {
  it('freezes stored rows: a group function that mutated one would throw, never change the store behind a transaction', () => {
    const data = TenantData.fromRows('t1', { JobPosition: [position] });
    const tx = new Tx(data, globals, { tenantId: 't1', now: '2027-04-06T02:00:00.000Z', actorUserId: null });
    const row = tx.get('JobPosition', 'p1');
    expect(() => {
      (row as { name: string }).name = 'B';
    }).toThrow(TypeError);
    expect(data.collections.get('JobPosition')?.get('p1')?.name).toBe('A');
  });

  it('a transaction changes nothing until applied', () => {
    const data = TenantData.fromRows('t1', { JobPosition: [position] });
    const tx = new Tx(data, globals, { tenantId: 't1', now: '2027-04-06T02:00:00.000Z', actorUserId: null });
    tx.update('JobPosition', { ...position, name: 'B' });
    expect(tx.get('JobPosition', 'p1').name).toBe('B');
    expect(data.collections.get('JobPosition')?.get('p1')?.name).toBe('A');
    tx.apply();
    expect(data.collections.get('JobPosition')?.get('p1')?.name).toBe('B');
  });

  it('refuses a row of another tenant, and a row whose key already exists', () => {
    const tx = new Tx(TenantData.fromRows('t1', { JobPosition: [position] }), globals, { tenantId: 't1', now: '', actorUserId: null });
    expect(() => tx.insert('JobPosition', { ...position, id: 'p2', tenantId: 't2' })).toThrow(/ERR-KPI-06/);
    expect(() => tx.insert('JobPosition', position)).toThrow(/ERR-KPI-06/);
  });

  it('cloneDeep copies plain data and passes Blobs through; deepFreeze reaches nested values', () => {
    const blob = new Blob(['x']);
    const value = { a: [{ b: 1 }], blob };
    const copy = cloneDeep(value);
    expect(copy).toEqual(value);
    expect(copy.a).not.toBe(value.a);
    expect(copy.blob).toBe(blob);
    deepFreeze(copy);
    expect(Object.isFrozen(copy.a[0])).toBe(true);
  });
});
