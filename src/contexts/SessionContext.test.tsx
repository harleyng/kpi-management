import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/components/layout/AppShell';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Tenant } from '@/data/types';
import { ERROR_CATALOG, KpiError } from '@/lib/errorCatalog';
import { buildTenant, type TestTenant } from '@/lib/permissionFixtures.test-util';
import { sessionActions } from '@/lib/sessionStore';
import { SessionProvider } from './SessionContext';
import { useSession, type SessionContextValue } from './useSession';

// ─── A fake gateway over the in-test tenants (never the mock adapter) ──────────────────────────

const A = buildTenant('t1');
const B = buildTenant('t2');

const h = vi.hoisted(() => ({
  gateway: null as unknown,
}));
vi.mock('@/integrations/data', () => ({ getDataGateway: () => h.gateway }));

interface FakeState {
  tenants: Tenant[];
  byTenant: Record<string, TestTenant>;
  failTenants: boolean;
  failDirectory: boolean;
  failClock: boolean;
  calls: string[];
}
let state: FakeState;

function fakeGateway() {
  const read = <T,>(method: string, tenantId: string, pick: (t: TestTenant) => readonly T[]) => {
    state.calls.push(`${method}:${tenantId}`);
    if (state.failDirectory) return Promise.reject(new KpiError('ERR-KPI-01'));
    const t = state.byTenant[tenantId];
    return Promise.resolve(t ? [...pick(t)] : []);
  };
  return {
    adapter: 'mock',
    clock: {
      now: () => {
        if (state.failClock) throw new KpiError('ERR-KPI-01', 'clock down');
        return '2027-02-15T03:00:00.000Z';
      },
    },
    platform: {
      listTenants: () => (state.failTenants ? Promise.reject(new KpiError('ERR-KPI-01')) : Promise.resolve([...state.tenants])),
    },
    org: {
      listUserAccounts: (id: string) => read('listUserAccounts', id, (t) => t.accounts),
      listEmployees: (id: string) => read('listEmployees', id, (t) => t.employees),
      listRoles: (id: string) => read('listRoles', id, (t) => t.roles),
      listPermissions: (id: string) => read('listPermissions', id, (t) => t.permissions),
      listRolePermissions: (id: string) => read('listRolePermissions', id, (t) => t.rolePermissions),
      listUserRoles: (id: string) => read('listUserRoles', id, (t) => t.userRoles),
      listOrgUnits: (id: string) => read('listOrgUnits', id, (t) => t.orgUnits),
      listAssignments: (id: string) => read('listAssignments', id, (t) => t.assignments),
    },
  };
}

// ─── Rendering ─────────────────────────────────────────────────────────────────────────────────

let session: SessionContextValue | null = null;

function Probe() {
  const s = useSession();
  session = s;
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <button type="button" onClick={() => navigate('/my/tasks')}>
        go-tasks
      </button>
      <span data-testid="who">{`${s.tenantId}|${s.user.id}`}</span>
      <span data-testid="path">{pathname}</span>
      <span data-testid="people">{s.people.map((p) => p.userId).join(',')}</span>
    </div>
  );
}

function renderApp(path = '/my/kpi', withShell = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const routes = withShell ? (
    <Route element={<AppShell />}>
      <Route path="*" element={<Probe />} />
    </Route>
  ) : (
    <Route path="*" element={<Probe />} />
  );
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[path]}>
          <SessionProvider>
            <Routes>{routes}</Routes>
          </SessionProvider>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const who = () => screen.findByTestId('who').then((el) => el.textContent);
const store = (value: unknown) => {
  localStorage.setItem('kpi.session.v1', typeof value === 'string' ? value : JSON.stringify(value));
  sessionActions.reload();
};

beforeEach(() => {
  localStorage.clear();
  sessionActions.reload();
  session = null;
  state = {
    tenants: [A.tenant, B.tenant],
    byTenant: { t1: A, t2: B },
    failTenants: false,
    failDirectory: false,
    failClock: false,
    calls: [],
  };
  h.gateway = fakeGateway();
});

// ─── Tests ─────────────────────────────────────────────────────────────────────────────────────

describe('SessionProvider — loading, failure, empty', () => {
  it('shows the loading shell with no children, then the session (first Active tenant and account)', async () => {
    renderApp();
    expect(screen.getByText('Đang tải phiên làm việc…')).toBeInTheDocument();
    expect(screen.queryByTestId('who')).toBeNull();
    expect(await who()).toBe('t1|t1-user-ceo');
  });

  it('renders the catalogue copy when the tenants cannot be read, and retries', async () => {
    state.failTenants = true;
    renderApp();
    expect(await screen.findByText(ERROR_CATALOG['ERR-KPI-01'].title)).toBeInTheDocument();
    expect(screen.getByText(ERROR_CATALOG['ERR-KPI-01'].message!)).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Dữ liệu giả lập' })).toBeInTheDocument();
    expect(screen.queryByTestId('who')).toBeNull();
    state.failTenants = false;
    fireEvent.click(screen.getByRole('button', { name: ERROR_CATALOG['ERR-KPI-01'].action! }));
    expect(await who()).toBe('t1|t1-user-ceo');
  });

  it('fails the whole session when any directory read fails — never a partial profile', async () => {
    state.failDirectory = true;
    renderApp();
    expect(await screen.findByText(ERROR_CATALOG['ERR-KPI-01'].title)).toBeInTheDocument();
    expect(screen.queryByTestId('who')).toBeNull();
  });

  it('treats a failing clock as the error state, not a crash', async () => {
    state.failClock = true;
    renderApp();
    expect(await screen.findByText(ERROR_CATALOG['ERR-KPI-01'].title)).toBeInTheDocument();
    expect(screen.queryByTestId('who')).toBeNull();
  });

  it('says so when no tenant is Active', async () => {
    state.tenants = [{ ...A.tenant, status: 'Suspended' }];
    renderApp();
    expect(await screen.findByText('Chưa có dữ liệu mẫu')).toBeInTheDocument();
    expect(screen.getByText(/Chưa có công ty nào đang hoạt động\./)).toBeInTheDocument();
  });

  it('says so when the tenant has no Active account, and offers the other tenant', async () => {
    state.byTenant.t1 = { ...A, accounts: A.accounts.map((a) => ({ ...a, status: 'Inactive' as const })) };
    renderApp();
    expect(await screen.findByText('Chưa có dữ liệu mẫu')).toBeInTheDocument();
    expect(screen.getByText(/Công ty này chưa có người dùng hoạt động nào/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `Chuyển sang ${B.tenant.name}` }));
    expect(await who()).toBe('t2|t2-user-ceo');
  });
});

describe('SessionProvider — the stored selection is a preference, never trusted', () => {
  it('restores a valid stored tenant and person', async () => {
    store({ tenantId: 't2', userIdByTenant: { t2: 't2-user-hr' } });
    renderApp();
    expect(await who()).toBe('t2|t2-user-hr');
  });

  it.each([
    ['a Suspended tenant', () => (state.tenants = [{ ...buildTenant('t3').tenant, status: 'Suspended' }, A.tenant, B.tenant]), { tenantId: 't3' }],
    ['a tenant that is gone', () => undefined, { tenantId: 't9' }],
    ['an Inactive person', () => undefined, { tenantId: 't1', userIdByTenant: { t1: 't1-user-idle' } }],
    ['another tenant’s person', () => undefined, { tenantId: 't1', userIdByTenant: { t1: 't2-user-hr' } }],
    ['corrupt JSON', () => undefined, '{oops'],
  ])('falls back from %s and writes the correction back', async (_label, arrange, stored) => {
    arrange();
    store(stored);
    renderApp();
    expect(await who()).toBe('t1|t1-user-ceo');
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('kpi.session.v1')!)).toMatchObject({
        tenantId: 't1',
        userIdByTenant: { t1: 't1-user-ceo' },
      }),
    );
  });
});

describe('SessionProvider — switching', () => {
  it('switches tenant through a fresh load, never showing the old tenant’s people', async () => {
    renderApp('/admin/library');
    await who();
    expect(screen.getByTestId('people').textContent!.split(',').every((id) => id.startsWith('t1-'))).toBe(true);

    act(() => session!.switchTenant('t2'));
    expect(screen.queryByTestId('who')).toBeNull(); // loading, not t1's session dressed as t2
    expect(await who()).toBe('t2|t2-user-ceo');
    expect(screen.getByTestId('people').textContent!.split(',').every((id) => id.startsWith('t2-'))).toBe(true);
    expect(screen.getByTestId('path').textContent).toBe('/my/kpi');
    // Every directory read for the new tenant carried the new tenant's id, and only it.
    const t2Calls = state.calls.filter((c) => c.endsWith(':t2'));
    expect(t2Calls).toContain('listUserAccounts:t2');
    expect(state.calls.every((c) => c.endsWith(':t1') || c.endsWith(':t2'))).toBe(true);
  });

  it('returns to the person last used in a tenant', async () => {
    renderApp();
    await who();
    act(() => session!.switchUser('t1-user-hr'));
    expect(await who()).toBe('t1|t1-user-hr');
    act(() => session!.switchTenant('t2'));
    expect(await who()).toBe('t2|t2-user-ceo');
    act(() => session!.switchTenant('t1'));
    expect(await who()).toBe('t1|t1-user-hr');
  });

  it('stays on the page when the new person may open it, goes home when not', async () => {
    store({ tenantId: 't1', userIdByTenant: { t1: 't1-user-hr' } });
    renderApp('/admin/library');
    await who();
    act(() => session!.switchUser('t1-user-cnb'));
    expect(await who()).toBe('t1|t1-user-cnb');
    expect(screen.getByTestId('path').textContent).toBe('/admin/library');
    act(() => session!.switchUser('t1-user-emp'));
    expect(await who()).toBe('t1|t1-user-emp');
    expect(screen.getByTestId('path').textContent).toBe('/my/kpi');
  });

  it('ignores a switch to an Inactive or unknown person', async () => {
    renderApp();
    await who();
    act(() => session!.switchUser('t1-user-idle'));
    act(() => session!.switchUser('t2-user-hr'));
    expect(await who()).toBe('t1|t1-user-ceo');
  });

  it('keeps the session value, `can` and the switch functions stable across unrelated re-renders', async () => {
    renderApp();
    await who();
    const first = session!;
    // A navigation re-renders the provider (it reads the location) without changing the session.
    fireEvent.click(screen.getByRole('button', { name: 'go-tasks' }));
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/my/tasks'));
    expect(session).toBe(first);
    expect(session!.can).toBe(first.can);
    expect(session!.switchUser).toBe(first.switchUser);
    expect(session!.switchTenant).toBe(first.switchTenant);
  });

  it('answers permission questions for the current person', async () => {
    store({ tenantId: 't1', userIdByTenant: { t1: 't1-user-head' } });
    renderApp();
    await who();
    expect(session!.roles).toEqual(['EMPLOYEE', 'MANAGER']);
    expect(session!.can('team.view')).toBe(true);
    expect(session!.can('goalplan.lock')).toBe(false);
    expect(session!.can('goalplan.view', { kind: 'Employee', tenantId: 't1', employeeId: A.employee('emp') })).toBe(true);
    expect(session!.can('goalplan.view', { kind: 'Employee', tenantId: 't2', employeeId: B.employee('emp') })).toBe(false);
  });
});

describe('the AppShell route guard', () => {
  it('blocks a typed-in route the person may not open, with the catalogue copy and a way home', async () => {
    renderApp('/system/users', true);
    // ceo (BOD) holds no user.manage.
    expect(await screen.findByText(ERROR_CATALOG['ERR-KPI-05'].title)).toBeInTheDocument();
    expect(screen.queryByTestId('who')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Về trang chủ' }));
    expect(await who()).toBe('t1|t1-user-ceo');
    expect(screen.getByTestId('path').textContent).toBe('/my/kpi');
  });

  it('lets the route through for a person holding its permission', async () => {
    store({ tenantId: 't1', userIdByTenant: { t1: 't1-user-admin' } });
    renderApp('/system/users', true);
    expect(await who()).toBe('t1|t1-user-admin');
    expect(screen.queryByText(ERROR_CATALOG['ERR-KPI-05'].title)).toBeNull();
  });

  it('shows only the permitted menu groups', async () => {
    renderApp('/my/kpi', true);
    await who();
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
    const groups = [...nav.querySelectorAll('[role="group"]')].map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual(['Của tôi', 'Điều hành']);
  });
});
