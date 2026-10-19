import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SYNTRA } from '@/data/fixtures';
import type { Id } from '@/data/types';
import type { DataGateway } from '@/integrations/data/types';
import { newGateway } from '@/integrations/data/mock/gateway.test-util';
import { todayOf } from '@/lib/isoDate';
import { buildAccessProfile, can, type AccessProfile } from '@/lib/permissionRules';
import DashboardPage from './DashboardPage';

/**
 * The dashboard page over the seeded mock (Phase 3): the stored figures reach the screen, a manager
 * starts at their own unit, and a failed read is an error with "Thử lại" — never a page of zeros.
 */

const h = vi.hoisted(() => ({ gateway: null as unknown, session: null as unknown }));
vi.mock('@/integrations/data', () => ({ getDataGateway: () => h.gateway }));
vi.mock('@/contexts/useSession', () => ({ useSession: () => h.session }));

const S = SYNTRA.tenantId;
const TZ = 'Asia/Ho_Chi_Minh';

async function sessionFor(gw: DataGateway, userId: Id) {
  const [accounts, roles, userRoles, permissions, rolePermissions, orgUnits, assignments, employees] = await Promise.all([
    gw.org.listUserAccounts(S),
    gw.org.listRoles(S),
    gw.org.listUserRoles(S),
    gw.org.listPermissions(S),
    gw.org.listRolePermissions(S),
    gw.org.listOrgUnits(S),
    gw.org.listAssignments(S),
    gw.org.listEmployees(S, { includeResigned: true }),
  ]);
  const account = accounts.find((a) => a.id === userId);
  if (!account) throw new Error('account');
  const today = todayOf({ now: gw.clock.now(), tz: TZ });
  const access: AccessProfile = buildAccessProfile({ tenantId: S, account, roles, userRoles, permissions, rolePermissions, orgUnits, assignments, employees, asOf: today });
  return {
    tenantId: S,
    tenant: { id: S, timezone: TZ },
    user: { id: account.id, employeeId: account.employeeId, name: account.displayName, email: '' },
    access,
    today,
    can: (code: Parameters<typeof can>[1], resource?: Parameters<typeof can>[2]) => can(access, code, resource),
  };
}

async function renderAs(userId: Id, setup?: (gw: DataGateway) => void) {
  const { gateway } = newGateway();
  h.session = await sessionFor(gateway, userId);
  setup?.(gateway);
  h.gateway = gateway;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={['/dashboard/overview']}>
          <DashboardPage section="overview" />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return gateway;
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe('DashboardPage', () => {
  it('HR lands on T02 at the company: its Draft score labelled "Tạm tính", the three Khối without a plan of their own', async () => {
    await renderAs(SYNTRA.user(SYNTRA.personas.hr));
    const units = await screen.findByRole('table', { name: 'Các đơn vị trực thuộc' }, { timeout: 5000 });
    expect(screen.getByText('106,07')).toBeInTheDocument();
    expect(screen.getAllByText('Tạm tính').length).toBeGreaterThan(0);
    expect(within(units).getAllByText('Chưa có kế hoạch')).toHaveLength(3);
    expect(within(units).getByRole('button', { name: 'Khối Kinh doanh' })).toBeInTheDocument();
  });

  it('a manager starts at their own department — no company or Khối above it', async () => {
    await renderAs(SYNTRA.user(SYNTRA.personas.manager));
    const crumbs = await screen.findByRole('navigation', { name: 'Đường dẫn đơn vị' }, { timeout: 5000 });
    expect(crumbs).toHaveTextContent(/^Phòng Kinh doanh$/);
    expect(await screen.findByRole('table', { name: 'Nhân viên của Phòng Kinh doanh' })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Các đơn vị trực thuộc' })).toBeNull();
  });

  it('a failed read shows the catalogue error with "Thử lại" — never figures computed from half the data', async () => {
    await renderAs(SYNTRA.user(SYNTRA.personas.hr), (gw) => gw.dev?.setFailureMode({ enabled: true, methodPattern: 'org.listAssignments' }));
    expect(await screen.findByRole('button', { name: 'Thử lại' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Các đơn vị trực thuộc' })).toBeNull();
    expect(screen.queryByText('106,07')).toBeNull();
  });
});
