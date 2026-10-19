import { describe, expect, it } from 'vitest';
import { KpiError } from '@/lib/errorCatalog';
import { mockGateway } from './mockGateway';
import { GATEWAY_GROUPS } from './types';

describe('mockGateway (Phase 1.1 stub)', () => {
  it('names itself the mock adapter', () => {
    expect(mockGateway.adapter).toBe('mock');
  });

  it('exposes every contract group', () => {
    for (const group of GATEWAY_GROUPS) expect(mockGateway[group]).toBeDefined();
  });

  it('rejects an async call with a coded error, the way a real adapter fails — never an empty list', async () => {
    await expect(mockGateway.goals.listGoalPlans('tenant-a')).rejects.toBeInstanceOf(KpiError);
    await expect(mockGateway.goals.listGoalPlans('tenant-a')).rejects.toThrow(/goals\.listGoalPlans is not implemented/);
  });

  it('throws on the synchronous groups', () => {
    expect(() => mockGateway.events.subscribe('tenant-a', () => {})).toThrow(/events\.subscribe/);
    expect(() => mockGateway.clock.now()).toThrow(/clock\.now/);
  });

  it('stays invisible to tooling that probes objects (thenables, JSON, matchers)', async () => {
    expect((mockGateway.org as { then?: unknown }).then).toBeUndefined();
    expect(() => JSON.stringify(mockGateway.org)).not.toThrow();
    await expect(Promise.resolve(mockGateway.org)).resolves.toBe(mockGateway.org);
  });
});
