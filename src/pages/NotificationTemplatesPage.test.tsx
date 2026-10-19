import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SYNTRA } from '@/data/fixtures';
import { newGateway } from '@/integrations/data/mock/gateway.test-util';
import NotificationTemplatesPage from './NotificationTemplatesPage';

const h = vi.hoisted(() => ({ gateway: null as unknown }));
vi.mock('@/integrations/data', () => ({ getDataGateway: () => h.gateway }));
vi.mock('@/contexts/useSession', () => ({
  useSession: () => ({
    tenantId: SYNTRA.tenantId,
    user: { id: SYNTRA.user(SYNTRA.personas.admin) },
    tenant: { id: SYNTRA.tenantId, timezone: 'Asia/Ho_Chi_Minh' },
  }),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }) }));

const S = SYNTRA.tenantId;

function renderPage() {
  const { gateway } = newGateway();
  h.gateway = gateway;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter>
          <NotificationTemplatesPage />
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

const templateTable = () => screen.getByRole('table', { name: 'Mẫu thông báo theo sự kiện' });

describe('NotificationTemplatesPage', () => {
  it('lists every event × channel: in-app templates in use, e-mail not sent in P1, missing ones offered', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Sửa mẫu, Khởi chạy phiếu, Trong ứng dụng' });
    const rows = within(templateTable()).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(8);
    expect(within(templateTable()).getAllByText('Đang dùng')).toHaveLength(4);
    expect(within(templateTable()).getAllByText('Chưa gửi ở P1')).toHaveLength(4);
    expect(within(templateTable()).queryByText('Thiếu mẫu')).toBeNull();
    // Only FORM_LAUNCHED has a seeded e-mail template.
    expect(screen.getAllByRole('button', { name: /^Tạo mẫu, .*, Email$/ })).toHaveLength(3);
  });

  it('shows the reminder schedule read-only, with what the scheduler will really do', async () => {
    renderPage();
    const schedule = await screen.findByRole('table', { name: 'Lịch nhắc hạn theo bước quy trình' });
    expect(await within(schedule).findAllByText('1. Tự đánh giá')).not.toHaveLength(0);
    expect(within(schedule).getAllByText('Tự chuyển bước tiếp theo').length).toBeGreaterThan(0);
    expect(within(schedule).getAllByText('Không nhắc').length).toBeGreaterThan(0);
    expect(within(schedule).queryByRole('button')).toBeNull();
  });

  it('refuses a variable the event does not supply as you type, and saves a valid edit', async () => {
    const gateway = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa mẫu, Có phiếu cần xử lý, Trong ứng dụng' }));
    const dialog = await screen.findByRole('dialog');
    const subject = within(dialog).getByLabelText(/Tiêu đề/);
    expect(subject).toHaveFocus();

    fireEvent.change(subject, { target: { value: 'Phiếu bị trả: {{reason}}' } });
    expect(within(dialog).getByText(/Biến \{\{reason\}\} không dùng được cho sự kiện này/)).toBeInTheDocument();
    expect(subject).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(subject, { target: { value: 'Việc mới: phiếu {{formType}}' } });
    expect(within(dialog).getByText('Việc mới: phiếu Đánh giá KPI')).toBeInTheDocument(); // the preview
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu mẫu' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Đã lưu mẫu thông báo.'));
    const saved = (await gateway.system.listNotificationTemplates(S)).find((t) => t.eventCode === 'STEP_ASSIGNED' && t.channel === 'InApp');
    expect(saved?.subject).toBe('Việc mới: phiếu {{formType}}');
  });

  it('inserts a variable at the caret', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa mẫu, Phiếu bị trả lại, Trong ứng dụng' }));
    const dialog = await screen.findByRole('dialog');
    const subject = within(dialog).getByLabelText(/Tiêu đề/) as HTMLInputElement;
    fireEvent.change(subject, { target: { value: 'Trả lại: ' } });
    fireEvent.focus(subject);
    subject.setSelectionRange(9, 9);
    fireEvent.click(within(dialog).getByRole('button', { name: /^Chèn biến \{\{reason\}\}/ }));
    expect(subject.value).toBe('Trả lại: {{reason}}');
  });

  it('asks before discarding unsaved changes', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa mẫu, Nhắc hạn, Trong ứng dụng' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Tiêu đề/), { target: { value: 'Đổi' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    expect(await screen.findByRole('alertdialog', { name: 'Bỏ thay đổi?' })).toBeInTheDocument();
  });
});
