import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SYNTRA } from '@/data/fixtures';
import { newGateway } from '@/integrations/data/mock/gateway.test-util';
import { NotificationBell } from './NotificationBell';

// The real mock adapter on the seed; only the session is stubbed (who is signed in).
const h = vi.hoisted(() => ({ gateway: null as unknown, userId: '' }));
vi.mock('@/integrations/data', () => ({ getDataGateway: () => h.gateway }));
vi.mock('@/contexts/useSession', () => ({
  useSession: () => ({ tenantId: SYNTRA.tenantId, user: { id: h.userId }, tenant: { id: SYNTRA.tenantId, timezone: 'Asia/Ho_Chi_Minh' } }),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }) }));

const S = SYNTRA.tenantId;

function Location() {
  const location = useLocation();
  return <output aria-label="location">{location.pathname + location.search}</output>;
}

function renderBell(employeeCode: string) {
  const { gateway } = newGateway();
  h.gateway = gateway;
  h.userId = SYNTRA.user(employeeCode);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={['/dashboard/overview']}>
          <NotificationBell />
          <Location />
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
beforeEach(() => vi.clearAllMocks());

describe('NotificationBell', () => {
  it('counts the unread in-app notices (the manager has two forms waiting)', async () => {
    renderBell('E006');
    expect(await screen.findByRole('button', { name: 'Thông báo, 2 chưa đọc' })).toBeInTheDocument();
  });

  it('never counts or lists an e-mail row, and says when nothing is unread', async () => {
    renderBell('E016'); // two read launch notices (T03, Q1) + a Queued e-mail
    const bell = await screen.findByRole('button', { name: 'Thông báo' });
    fireEvent.click(bell);
    // Nothing unread: the panel opens on "Tất cả".
    const list = await screen.findByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('Đợt Đánh giá KPI tháng 03/2027 đã bắt đầu')).toBeInTheDocument();
    expect(within(list).getByText('Đợt Đánh giá KPI quý 1/2027 đã bắt đầu')).toBeInTheDocument();
    expect(screen.queryByText(/\[Syntra KPI\]/)).toBeNull();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Chưa đọc' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Chưa đọc' }));
    expect(await screen.findByText('Không có thông báo chưa đọc.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đánh dấu tất cả đã đọc' })).toBeDisabled();
  });

  it('opening a notice marks it read and goes to the form', async () => {
    const gateway = renderBell('E006');
    fireEvent.click(await screen.findByRole('button', { name: 'Thông báo, 2 chưa đọc' }));
    const rows = await screen.findAllByRole('button', { name: /^Chưa đọc\. Bạn có phiếu Đánh giá KPI cần xử lý/ });
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[0]);

    expect(screen.getByLabelText('location').textContent).toMatch(/^\/forms\//);
    await waitFor(async () =>
      expect((await gateway.system.listNotifications(S, SYNTRA.user('E006'), { unreadOnly: true })).items).toHaveLength(1),
    );
    expect(await screen.findByRole('button', { name: 'Thông báo, 1 chưa đọc' })).toBeInTheDocument();
  });

  it('"Đánh dấu tất cả đã đọc" clears the count', async () => {
    const gateway = renderBell('E006');
    fireEvent.click(await screen.findByRole('button', { name: 'Thông báo, 2 chưa đọc' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Đánh dấu tất cả đã đọc' }));
    expect(await screen.findByRole('button', { name: 'Thông báo' })).toBeInTheDocument();
    expect((await gateway.system.listNotifications(S, SYNTRA.user('E006'), { unreadOnly: true })).items).toEqual([]);
  });
});
