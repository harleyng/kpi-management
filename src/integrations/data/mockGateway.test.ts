import { describe, expect, it } from 'vitest';
import { SYNTRA } from '@/data/fixtures';
import { mockGateway } from './mockGateway';
import { GATEWAY_GROUPS } from './types';

describe('mockGateway (the app\'s default instance)', () => {
  it('names itself the mock adapter and exposes every contract group plus the dev controls', () => {
    expect(mockGateway.adapter).toBe('mock');
    for (const group of GATEWAY_GROUPS) expect(mockGateway[group]).toBeDefined();
    expect(mockGateway.dev).toBeDefined();
  });

  it('serves the seed (memory only under Vitest — no localStorage write)', async () => {
    const tenants = await mockGateway.platform.listTenants();
    expect(tenants.map((t) => t.name)).toEqual(['Syntra', 'Demo Co']);
    expect((await mockGateway.org.listRoles(SYNTRA.tenantId)).length).toBe(6);
    expect(localStorage.getItem('kpi.meta')).toBeNull();
  });

  it('stays invisible to tooling that probes objects (thenables, JSON, matchers)', async () => {
    expect((mockGateway.org as { then?: unknown }).then).toBeUndefined();
    expect(() => JSON.stringify(mockGateway.org)).not.toThrow();
    await expect(Promise.resolve(mockGateway.org)).resolves.toBe(mockGateway.org);
  });
});
