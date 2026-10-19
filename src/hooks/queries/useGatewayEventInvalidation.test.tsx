import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DEMO, SYNTRA } from '@/data/fixtures';
import { getDataGateway } from '@/integrations/data';
import { useGatewayEventInvalidation } from './useGatewayEventInvalidation';

const S = SYNTRA.tenantId;
const hr = SYNTRA.user(SYNTRA.personas.hr);

function setup(tenantId: string | null) {
  const client = new QueryClient();
  const spy = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(({ id }) => useGatewayEventInvalidation(id), { wrapper, initialProps: { id: tenantId } });
  const invalidated = () => spy.mock.calls.map(([filters]) => (filters as { queryKey: unknown[] }).queryKey);
  return { hook, spy, invalidated };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const position = (code: string) => ({ code, name: code, jobLevel: 'Staff' as const, status: 'Active' as const });

describe('useGatewayEventInvalidation', () => {
  it('invalidates the roots that read the changed entity, for the session\'s tenant', async () => {
    const { invalidated } = setup(S);
    await getDataGateway().org.savePosition(S, hr, position('INV-1'));
    await tick();
    expect(invalidated()).toEqual(expect.arrayContaining([[S, 'positions'], [S, 'auditLog']]));
    expect(invalidated()).not.toContainEqual([S, 'goals']);
  });

  it('flushes a burst of changes once per root', async () => {
    const { invalidated } = setup(S);
    await Promise.all([getDataGateway().org.savePosition(S, hr, position('INV-2')), getDataGateway().org.savePosition(S, hr, position('INV-3'))]);
    await tick();
    const positions = invalidated().filter((k) => k[1] === 'positions');
    expect(positions.length).toBeLessThanOrEqual(2);
    expect(positions.length).toBeGreaterThan(0);
  });

  it('hears nothing of another tenant, and follows a tenant switch', async () => {
    const { hook, invalidated } = setup(DEMO.tenantId);
    await getDataGateway().org.savePosition(S, hr, position('INV-4'));
    await tick();
    expect(invalidated()).toEqual([]);
    hook.rerender({ id: S });
    await getDataGateway().org.savePosition(S, hr, position('INV-5'));
    await tick();
    expect(invalidated()).toContainEqual([S, 'positions']);
  });

  it('does nothing after unmount, nor without a tenant', async () => {
    const mounted = setup(S);
    mounted.hook.unmount();
    const idle = setup(null);
    await getDataGateway().org.savePosition(S, hr, position('INV-6'));
    await tick();
    expect(mounted.invalidated()).toEqual([]);
    expect(idle.invalidated()).toEqual([]);
  });
});
