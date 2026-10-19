import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { employee, user } from '@/test/builders';
import { KpiError, ruleIssue } from '@/lib/errorCatalog';
import { issuesOf, ResignError, useResignEmployee, useSaveOrgUnit } from './org';

const h = vi.hoisted(() => ({ gateway: null as unknown }));
vi.mock('@/integrations/data', () => ({ getDataGateway: () => h.gateway }));
vi.mock('@/contexts/useSession', () => ({ useSession: () => ({ tenantId: 't1', user: { id: 'u-admin' } }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const calls: string[] = [];
function fakeGateway(fail: { lock?: boolean; resign?: boolean; unit?: boolean } = {}) {
  return {
    org: {
      saveOrgUnit: vi.fn(async () => {
        if (fail.unit) throw new KpiError('ERR-KPI-14', 'in use', [ruleIssue('ERR-KPI-14', 'status', 'UNIT_HAS_STAFF', { count: 5 })]);
        return { id: 'ou' };
      }),
      saveUserAccount: vi.fn(async (_t: string, _a: string, input: { id: string; status: string }) => {
        calls.push(`account:${input.status}`);
        if (fail.lock) throw new KpiError('ERR-KPI-15', 'self');
        return input;
      }),
      saveEmployee: vi.fn(async (_t: string, _a: string, input: { leftOn: string }) => {
        calls.push(`employee:${input.leftOn}`);
        if (fail.resign) throw new KpiError('ERR-KPI-03', 'storage');
        return input;
      }),
    },
  };
}

function setup<T>(hook: () => T) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...renderHook(hook, { wrapper }), invalidate };
}

beforeEach(() => {
  calls.length = 0;
});

describe('T1 org mutations', () => {
  it('a refused write keeps its rule issues for the form and still invalidates its roots', async () => {
    h.gateway = fakeGateway({ unit: true });
    const { result, invalidate } = setup(() => useSaveOrgUnit());
    await act(async () => {
      await result.current.mutateAsync({} as never).catch(() => undefined);
    });
    await waitFor(() => expect(issuesOf(result.current.error).map((i) => i.detail)).toEqual(['UNIT_HAS_STAFF']));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['t1', 'orgUnits'] }));
  });

  const args = { employee: employee({ id: 'e1' }), leftOn: '2027-04-30', activeAccounts: [user({ id: 'u1' })] };

  it('a resignation sets the account Inactive FIRST, then records the last day', async () => {
    h.gateway = fakeGateway();
    const { result } = setup(() => useResignEmployee());
    await act(async () => {
      await result.current.mutateAsync(args);
    });
    expect(calls).toEqual(['account:Inactive', 'employee:2027-04-30']);
  });

  it('says which step failed: the account (nothing changed) or the resignation (account already Inactive)', async () => {
    for (const [fail, stage, expected] of [
      [{ lock: true }, 'lock', ['account:Inactive']],
      [{ resign: true }, 'resign', ['account:Inactive', 'employee:2027-04-30']],
    ] as const) {
      calls.length = 0;
      h.gateway = fakeGateway(fail);
      const { result, invalidate } = setup(() => useResignEmployee());
      await act(async () => {
        await result.current.mutateAsync(args).catch(() => undefined);
      });
      await waitFor(() => expect(result.current.error).toBeInstanceOf(ResignError));
      expect((result.current.error as ResignError).stage).toBe(stage);
      expect(calls).toEqual(expected);
      await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['t1', 'userAccounts'] }));
    }
  });
});
