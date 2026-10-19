import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SYNTRA } from '@/data/fixtures';
import { newGateway } from '@/integrations/data/mock/gateway.test-util';
import AuditLogPage from './AuditLogPage';

const h = vi.hoisted(() => ({ gateway: null as unknown }));
vi.mock('@/integrations/data', () => ({ getDataGateway: () => h.gateway }));
vi.mock('@/contexts/useSession', () => ({
  useSession: () => ({
    tenantId: SYNTRA.tenantId,
    user: { id: SYNTRA.user(SYNTRA.personas.admin) },
    tenant: { id: SYNTRA.tenantId, timezone: 'Asia/Ho_Chi_Minh' },
  }),
}));

function renderPage(url = '/system/audit-log', gateway: unknown = newGateway().gateway) {
  h.gateway = gateway;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[url]}>
          <AuditLogPage />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const table = () => screen.getByRole('table', { name: 'Nhật ký thay đổi' });
const bodyRows = () => within(table()).getAllByRole('row').slice(1);

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});

describe('AuditLogPage', () => {
  it('lists the newest 50 entries; "Tải thêm" brings the rest and the count follows', async () => {
    // The seed holds 46 entries: five audited template edits take the log past one page.
    const { gateway } = newGateway();
    const admin = SYNTRA.user(SYNTRA.personas.admin);
    const [template] = await gateway.system.listNotificationTemplates(SYNTRA.tenantId);
    for (let i = 1; i <= 5; i++) await gateway.system.saveNotificationTemplate(SYNTRA.tenantId, admin, { ...template, subject: `${template.subject} (${i})` });
    renderPage('/system/audit-log', gateway);
    await screen.findAllByRole('button', { name: /^Xem chi tiết/ });
    expect(bodyRows()).toHaveLength(50);
    expect(screen.getByRole('status')).toHaveTextContent('Đang hiển thị 50 dòng mới nhất');
    fireEvent.click(screen.getByRole('button', { name: 'Tải thêm' }));
    expect(await screen.findByText('Đang hiển thị 51 dòng')).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(51);
    expect(screen.queryByRole('button', { name: 'Tải thêm' })).toBeNull();
    // The button went away: focus is on the count, not lost.
    await waitFor(() => expect(screen.getByRole('status')).toHaveFocus());
  });

  it('a deep link shows one record\'s history: a system auto-lock, then HR\'s unlock with its reason', async () => {
    const plan = SYNTRA.id('GoalPlan', SYNTRA.id('PerformanceCycle', '2027'), 'E017');
    renderPage(`/system/audit-log?entityName=GoalPlan&entityId=${plan}`);
    await screen.findAllByRole('button', { name: /^Xem chi tiết/ });
    const rows = bodyRows();
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Mở khóa')).toBeInTheDocument();
    expect(within(rows[0]).getByText(/Gia hạn đăng ký KPI/)).toBeInTheDocument();
    expect(within(rows[1]).getByText('Khóa')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Hệ thống')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Đang hiển thị 2 dòng');
    expect(screen.queryByRole('button', { name: 'Tải thêm' })).toBeNull();
  });

  it('the detail shows the changed fields in words', async () => {
    const plan = SYNTRA.id('GoalPlan', SYNTRA.id('PerformanceCycle', '2027'), 'E017');
    renderPage(`/system/audit-log?entityName=GoalPlan&entityId=${plan}`);
    const [unlock] = await screen.findAllByRole('button', { name: /^Xem chi tiết, Mở khóa Goal Plan/ });
    fireEvent.click(unlock);
    const dialog = await screen.findByRole('dialog', { name: 'Chi tiết thay đổi' });
    const changes = within(dialog).getByRole('table', { name: 'Các trường thay đổi' });
    expect(within(changes).getByText('Trạng thái')).toBeInTheDocument();
    expect(within(changes).getByText('Đã khóa')).toBeInTheDocument();
    expect(within(changes).getByText('Đã gửi')).toBeInTheDocument();
  });

  it('a backwards date range is refused in place and queries nothing', async () => {
    renderPage('/system/audit-log?from=2027-04-06&to=2027-04-01');
    expect(await screen.findByRole('alert')).toHaveTextContent('“Đến ngày” phải bằng hoặc sau “Từ ngày”.');
    expect(screen.getByText('Sửa khoảng ngày để xem nhật ký.')).toBeInTheDocument();
  });

  it('a filter that matches nothing says so and offers to clear it', async () => {
    renderPage('/system/audit-log?entityName=PayrollExport');
    expect(await screen.findByText('Không có dòng nào khớp bộ lọc.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Xóa bộ lọc' }).length).toBeGreaterThan(0);
  });
});
