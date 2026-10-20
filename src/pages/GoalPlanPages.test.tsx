import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SYNTRA } from '@/data/fixtures';
import type { GoalPlan, Id } from '@/data/types';
import type { DataGateway } from '@/integrations/data/types';
import { newGateway } from '@/integrations/data/mock/gateway.test-util';
import { todayOf } from '@/lib/isoDate';
import { buildAccessProfile, can, resourceOfOwner, type AccessProfile } from '@/lib/permissionRules';
import { GoalPage, PlanPage } from './GoalPlanPages';

/**
 * The plan / goal pages over the seeded mock: a plan id typed into a route the person may not use
 * reads as "not found" (ERR-KPI-02) — the plan's owner never shows — and a plan they may see opens.
 */

const h = vi.hoisted(() => ({ gateway: null as unknown, session: null as unknown }));
vi.mock('@/integrations/data', () => ({ getDataGateway: () => h.gateway }));
vi.mock('@/contexts/useSession', () => ({ useSession: () => h.session }));

const S = SYNTRA.tenantId;
const TZ = 'Asia/Ho_Chi_Minh';
const NOT_FOUND = 'Không tìm thấy dữ liệu';

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

async function setup(persona: string) {
  const { gateway } = newGateway();
  const session = await sessionFor(gateway, SYNTRA.user(persona));
  h.gateway = gateway;
  h.session = session;
  const plans = await gateway.goals.listGoalPlans(S, {});
  const employees = await gateway.org.listEmployees(S, { includeResigned: true });
  const ownerName = (p: GoalPlan) => employees.find((e) => e.id === p.ownerEmployeeId)?.fullName ?? '';
  const visible = (p: GoalPlan) => session.can('goalplan.view', resourceOfOwner(S, p));
  return { plans, ownerName, visible, session };
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/my/kpi/plans/:planId" element={<PlanPage kind="my" />} />
            <Route path="/my/kpi/plans/:planId/goals/:goalId" element={<GoalPage kind="my" />} />
            <Route path="/team/kpi/members/:planId" element={<PlanPage kind="members" />} />
            <Route path="/admin/cycles/plans/:cycleId/:planId" element={<PlanPage kind="cycles" />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe('PlanPage / GoalPage — the route access guard', () => {
  it('an employee opens their own plan under "KPI của tôi"', async () => {
    const { plans, ownerName, session } = await setup(SYNTRA.personas.employee);
    const mine = plans.find((p) => p.ownerType === 'Employee' && p.ownerEmployeeId === session.user.employeeId);
    if (!mine) throw new Error('seed: the employee persona has a plan');
    renderAt(`/my/kpi/plans/${mine.id}`);
    expect(await screen.findByRole('heading', { level: 1, name: `Goal Plan của ${ownerName(mine)}` }, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: 'Danh sách chỉ tiêu của Goal Plan' }, { timeout: 5000 })).toBeInTheDocument();
  });

  it('their own goal opens on its page with the three facet tabs, the plan in the trail', async () => {
    const { plans, ownerName, session } = await setup(SYNTRA.personas.employee);
    const mine = plans.find((p) => p.ownerType === 'Employee' && p.ownerEmployeeId === session.user.employeeId);
    if (!mine) throw new Error('seed: the employee persona has a plan');
    const goal = (await (h.gateway as DataGateway).goals.listGoals(S, { goalPlanIds: [mine.id] })).find((g) => g.visibility === 'PUBLIC');
    if (!goal) throw new Error('seed: a goal');
    renderAt(`/my/kpi/plans/${mine.id}/goals/${goal.id}?tab=split`);
    expect(await screen.findByRole('heading', { level: 1, name: goal.name }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: `Goal Plan của ${ownerName(mine)}` })).toHaveAttribute('href', `/my/kpi/plans/${mine.id}`);
    expect(screen.getByRole('tab', { name: 'Phân bổ theo kỳ' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Thông tin' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Liên kết' })).toBeInTheDocument();
  });

  it("a colleague's plan id under /my/kpi reads as not found, without the owner's name", async () => {
    const { plans, ownerName, session } = await setup(SYNTRA.personas.employee);
    const other = plans.find((p) => p.ownerType === 'Employee' && p.ownerEmployeeId !== session.user.employeeId);
    if (!other) throw new Error('seed: another employee plan');
    renderAt(`/my/kpi/plans/${other.id}`);
    expect(await screen.findByText(NOT_FOUND, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(ownerName(other)))).not.toBeInTheDocument();
  });

  it("a goal page of a colleague's plan reads as not found too", async () => {
    const { plans, session } = await setup(SYNTRA.personas.employee);
    const other = plans.find((p) => p.ownerType === 'Employee' && p.ownerEmployeeId !== session.user.employeeId);
    if (!other) throw new Error('seed: another employee plan');
    const goals = await (h.gateway as DataGateway).goals.listGoals(S, { goalPlanIds: [other.id] });
    renderAt(`/my/kpi/plans/${other.id}/goals/${goals[0]?.id ?? 'x'}`);
    expect(await screen.findByText(NOT_FOUND, {}, { timeout: 5000 })).toBeInTheDocument();
    if (goals[0]) expect(screen.queryByRole('heading', { level: 1, name: goals[0].name })).not.toBeInTheDocument();
  });

  it("a manager cannot open, under KPI nhân viên, a plan outside their scope", async () => {
    const { plans, visible } = await setup(SYNTRA.personas.manager);
    const outside = plans.find((p) => p.ownerType === 'Employee' && !visible(p));
    if (!outside) throw new Error('seed: a plan outside the manager scope');
    renderAt(`/team/kpi/members/${outside.id}`);
    expect(await screen.findByText(NOT_FOUND, {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('an unknown plan id reads as not found', async () => {
    await setup(SYNTRA.personas.hr);
    renderAt('/team/kpi/members/no-such-plan');
    expect(await screen.findByText(NOT_FOUND, {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('HR: a plan under another cycle\'s route reads as not found', async () => {
    const { plans } = await setup(SYNTRA.personas.hr);
    renderAt(`/admin/cycles/plans/not-its-cycle/${plans[0].id}`);
    expect(await screen.findByText(NOT_FOUND, {}, { timeout: 5000 })).toBeInTheDocument();
  });
});
