import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LATENCY_MS, devActions, useDevStore } from '@/lib/devStore';
import { useRunScheduler, useSetFailureMode, useSetLatency, useSetSimulatedNow, useSimulatedNow } from './dev';
import { DEV_NOW_KEY } from './keys';
import { hasDevControls, useResetSeed } from './session';

const h = vi.hoisted(() => ({ gateway: null as unknown }));
vi.mock('@/integrations/data', () => ({ getDataGateway: () => h.gateway }));
vi.mock('@/contexts/useSession', () => ({
  // A DST zone, so the shift provably happens in the TENANT's zone, not in UTC.
  useSession: () => ({ tenantId: 't1', tenant: { id: 't1', timezone: 'America/New_York' } }),
}));

function fakeGateway(now = '2027-03-13T17:00:00.000Z') {
  return {
    clock: { now: vi.fn(() => now) },
    scheduler: { runDue: vi.fn(async () => ({ launchesFired: [], formsCreated: [], overdueHandled: [], remindersDue: [] })) },
    dev: { resetSeed: vi.fn(async () => {}), setNow: vi.fn(), setLatency: vi.fn(), setFailureMode: vi.fn() },
  };
}
let gateway: ReturnType<typeof fakeGateway>;

function setup<T>(hook: () => T) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...renderHook(hook, { wrapper }), client, invalidate };
}

beforeEach(() => {
  devActions.reset();
  gateway = fakeGateway();
  h.gateway = gateway;
});

describe('dev hooks', () => {
  it('hasDevControls follows the adapter', () => {
    expect(hasDevControls()).toBe(true);
    h.gateway = { ...gateway, dev: undefined };
    expect(hasDevControls()).toBe(false);
  });

  it('useSimulatedNow reads the gateway clock under the non-tenant dev key', async () => {
    const { result, client } = setup(() => useSimulatedNow());
    await waitFor(() => expect(result.current.data).toBe('2027-03-13T17:00:00.000Z'));
    expect(client.getQueryData(DEV_NOW_KEY)).toBe('2027-03-13T17:00:00.000Z');
  });

  it('a day shift counts in the tenant zone from the clock as it reads now, then invalidates everything', async () => {
    const { result, invalidate } = setup(() => useSetSimulatedNow());
    // 12:00 EST on 13/03 → 12:00 EDT on 14/03 (only 23 hours later).
    await act(() => result.current.mutateAsync({ shiftDays: 1 }));
    expect(gateway.dev.setNow).toHaveBeenCalledWith('2027-03-14T16:00:00.000Z');
    expect(invalidate).toHaveBeenCalledWith();
    expect(useDevStore.getState().clockOverridden).toBe(true);
    await act(() => result.current.mutateAsync({ to: null }));
    expect(gateway.dev.setNow).toHaveBeenLastCalledWith(null);
    expect(useDevStore.getState().clockOverridden).toBe(false);
  });

  it('latency and failure mode mirror into the store only once the gateway took them', async () => {
    gateway.dev.setLatency.mockImplementationOnce(() => {
      throw new Error('refused');
    });
    const latency = setup(() => useSetLatency());
    await act(() => latency.result.current.mutateAsync(1000).catch(() => {}));
    expect(useDevStore.getState().latencyMs).toBe(DEFAULT_LATENCY_MS);
    await act(() => latency.result.current.mutateAsync(1000));
    expect(useDevStore.getState().latencyMs).toBe(1000);
    expect(latency.invalidate).toHaveBeenCalledWith();

    const failure = setup(() => useSetFailureMode());
    await act(() => failure.result.current.mutateAsync({ enabled: true, methodPattern: null }));
    // "Every call" is no pattern at all, not an empty glob.
    expect(gateway.dev.setFailureMode).toHaveBeenLastCalledWith({ enabled: true });
    await act(() => failure.result.current.mutateAsync({ enabled: true, methodPattern: 'results.*' }));
    expect(gateway.dev.setFailureMode).toHaveBeenLastCalledWith({ enabled: true, methodPattern: 'results.*' });
    expect(useDevStore.getState().failure).toEqual({ enabled: true, methodPattern: 'results.*' });
    expect(failure.invalidate).toHaveBeenCalledWith();
  });

  it('useRunScheduler runs for the session tenant and invalidates only that tenant', async () => {
    const { result, invalidate } = setup(() => useRunScheduler());
    await act(() => result.current.mutateAsync());
    expect(gateway.scheduler.runDue).toHaveBeenCalledWith('t1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['t1'] });
  });

  it('useResetSeed reseeds, restores the defaults on the gateway and in the store, and drops every cached row', async () => {
    act(() => {
      devActions.setLatency(1000);
      devActions.setFailure({ enabled: true, methodPattern: null });
      devActions.setClockOverridden(true);
    });
    const { result, client } = setup(() => useResetSeed());
    client.setQueryData(['t1', 'goals'], ['stale']);
    client.setQueryData(['t2', 'orgUnits'], ['stale']);
    await act(() => result.current.mutateAsync());
    expect(gateway.dev.resetSeed).toHaveBeenCalledTimes(1);
    expect(gateway.dev.setFailureMode).toHaveBeenCalledWith({ enabled: false });
    expect(gateway.dev.setLatency).toHaveBeenCalledWith(DEFAULT_LATENCY_MS);
    expect(client.getQueryData(['t1', 'goals'])).toBeUndefined();
    expect(client.getQueryData(['t2', 'orgUnits'])).toBeUndefined();
    expect(useDevStore.getState()).toEqual({
      clockOverridden: false,
      latencyMs: DEFAULT_LATENCY_MS,
      failure: { enabled: false, methodPattern: null },
    });
  });
});
