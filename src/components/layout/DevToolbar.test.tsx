import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SchedulerReport } from '@/integrations/data/types';
import { DEFAULT_LATENCY_MS, devActions, useDevStore } from '@/lib/devStore';
import { ERROR_CATALOG, KpiDeferredError } from '@/lib/errorCatalog';
import { DevToolbar } from './DevToolbar';

// ─── A fake gateway with only what the toolbar touches (never the mock adapter) ─────────────────

const NOW = '2027-04-06T02:00:00.000Z'; // 06/04/2027 09:00 in Vietnam

const h = vi.hoisted(() => ({ gateway: null as unknown }));
vi.mock('@/integrations/data', () => ({ getDataGateway: () => h.gateway }));
vi.mock('@/contexts/useSession', () => ({
  useSession: () => ({ tenantId: 't1', tenant: { id: 't1', timezone: 'Asia/Ho_Chi_Minh' } }),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const EMPTY_REPORT: SchedulerReport = { launchesFired: [], formsCreated: [], overdueHandled: [], remindersDue: [] };

function fakeGateway({ withDev = true } = {}) {
  return {
    adapter: 'mock',
    clock: { now: vi.fn(() => NOW) },
    scheduler: { runDue: vi.fn(async (_tenantId: string) => EMPTY_REPORT) },
    dev: withDev
      ? {
          resetSeed: vi.fn(async () => {}),
          setNow: vi.fn(),
          setLatency: vi.fn(),
          setFailureMode: vi.fn(),
        }
      : undefined,
  };
}
let gateway: ReturnType<typeof fakeGateway>;
const dev = () => gateway.dev!;

function renderToolbar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <DevToolbar />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

const trigger = () => screen.getByRole('button', { name: /Công cụ demo/ });
async function openToolbar() {
  fireEvent.click(trigger());
  await screen.findByText('Bây giờ:');
}
const button = (name: string) => screen.getByRole('button', { name });

beforeAll(() => {
  // Radix Select measures and scrolls its list; jsdom has neither.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  vi.clearAllMocks();
  devActions.reset();
  gateway = fakeGateway();
  h.gateway = gateway;
});

describe('DevToolbar — presence and trigger', () => {
  it('renders nothing when the adapter has no dev controls', () => {
    h.gateway = fakeGateway({ withDev: false });
    const { container } = renderToolbar();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the trigger, quiet while nothing is overridden', () => {
    renderToolbar();
    expect(trigger()).toBeInTheDocument();
    expect(trigger()).not.toHaveTextContent('Đang bật');
  });

  it('opens on the simulated now, in the tenant zone', async () => {
    renderToolbar();
    await openToolbar();
    expect(await screen.findByText('06/04/2027 09:00 (GMT+7)')).toBeInTheDocument();
    expect(screen.getByText('Chỉ có trên dữ liệu giả lập. Không ảnh hưởng hệ thống thật.')).toBeInTheDocument();
  });

  it('says "Đang bật" only while an override is active', async () => {
    renderToolbar();
    expect(trigger()).not.toHaveTextContent('Đang bật');
    act(() => devActions.setFailure({ enabled: true, methodPattern: null }));
    expect(trigger()).toHaveTextContent('Đang bật');
    act(() => devActions.setFailure({ enabled: false, methodPattern: null }));
    act(() => devActions.setLatency(DEFAULT_LATENCY_MS));
    expect(trigger()).not.toHaveTextContent('Đang bật');
    act(() => devActions.setClockOverridden(true));
    expect(trigger()).toHaveTextContent('Đang bật');
  });
});

describe('DevToolbar — clock', () => {
  it('+1 ngày moves the clock one day on from the current simulated now', async () => {
    renderToolbar();
    await openToolbar();
    fireEvent.click(button('+1 ngày'));
    await waitFor(() => expect(dev().setNow).toHaveBeenCalledWith('2027-04-07T02:00:00.000Z'));
    await waitFor(() => expect(trigger()).toHaveTextContent('Đang bật'));
  });

  it('+7 ngày moves it a week', async () => {
    renderToolbar();
    await openToolbar();
    fireEvent.click(button('+7 ngày'));
    await waitFor(() => expect(dev().setNow).toHaveBeenCalledWith('2027-04-13T02:00:00.000Z'));
  });

  it('Về thời điểm seed sends the clock back with null', async () => {
    act(() => devActions.setClockOverridden(true));
    renderToolbar();
    await openToolbar();
    fireEvent.click(button('Về thời điểm seed'));
    await waitFor(() => expect(dev().setNow).toHaveBeenCalledWith(null));
    await waitFor(() => expect(trigger()).not.toHaveTextContent('Đang bật'));
  });

  it('keeps Áp dụng disabled, with the reason, until the date and time are real', async () => {
    renderToolbar();
    await openToolbar();
    const field = screen.getByLabelText('Đặt ngày giờ');
    expect(button('Áp dụng')).toBeDisabled();
    expect(screen.getByText('Nhập ngày giờ hợp lệ.')).toBeInTheDocument();
    fireEvent.change(field, { target: { value: '2027-02-30T10:00' } });
    expect(button('Áp dụng')).toBeDisabled();
    fireEvent.change(field, { target: { value: '2027-05-01T08:30' } });
    expect(button('Áp dụng')).toBeEnabled();
    expect(screen.queryByText('Nhập ngày giờ hợp lệ.')).toBeNull();
    fireEvent.click(button('Áp dụng'));
    // 08:30 in Vietnam is 01:30 UTC.
    await waitFor(() => expect(dev().setNow).toHaveBeenCalledWith('2027-05-01T01:30:00.000Z'));
  });

  it('shows a refused clock change in the catalogue words', async () => {
    dev().setNow.mockImplementation(() => {
      throw new KpiDeferredError('write', 'dev.setNow', 'test');
    });
    renderToolbar();
    await openToolbar();
    fireEvent.click(button('+1 ngày'));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(ERROR_CATALOG['ERR-KPI-03'].title, { description: ERROR_CATALOG['ERR-KPI-03'].message }),
    );
    expect(trigger()).not.toHaveTextContent('Đang bật');
  });
});

describe('DevToolbar — latency', () => {
  it('150 ms sets the latency and becomes the pressed choice', async () => {
    renderToolbar();
    await openToolbar();
    expect(button('Không (0 ms)')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button('150 ms'));
    await waitFor(() => expect(dev().setLatency).toHaveBeenCalledWith(150));
    await waitFor(() => expect(button('150 ms')).toHaveAttribute('aria-pressed', 'true'));
    expect(button('Không (0 ms)')).toHaveAttribute('aria-pressed', 'false');
    expect(trigger()).toHaveTextContent('Đang bật');
  });
});

describe('DevToolbar — failure injection', () => {
  async function pickScope(label: string) {
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Áp dụng cho' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: label }));
  }

  it('fails one group: forms.*, then switches off with no pattern', async () => {
    renderToolbar();
    await openToolbar();
    await pickScope('Chỉ nhóm Biểu mẫu');
    expect(dev().setFailureMode).not.toHaveBeenCalled(); // off: only the choice changes
    fireEvent.click(screen.getByRole('switch', { name: 'Bật giả lập lỗi' }));
    await waitFor(() => expect(dev().setFailureMode).toHaveBeenCalledWith({ enabled: true, methodPattern: 'forms.*' }));
    expect(await screen.findByText(/Đang giả lập lỗi:/)).toHaveTextContent('Đang giả lập lỗi: forms.*');
    expect(trigger()).toHaveTextContent('Đang bật');

    fireEvent.click(screen.getByRole('switch', { name: 'Bật giả lập lỗi' }));
    await waitFor(() => expect(dev().setFailureMode).toHaveBeenLastCalledWith({ enabled: false }));
    await waitFor(() => expect(screen.queryByText(/Đang giả lập lỗi:/)).toBeNull());
  });

  it('fails every call by default, and moves the failure when the scope changes while on', async () => {
    renderToolbar();
    await openToolbar();
    fireEvent.click(screen.getByRole('switch', { name: 'Bật giả lập lỗi' }));
    await waitFor(() => expect(dev().setFailureMode).toHaveBeenCalledWith({ enabled: true }));
    expect(await screen.findByText(/Đang giả lập lỗi:/)).toHaveTextContent('Đang giả lập lỗi: mọi thao tác');
    await pickScope('Chỉ nhóm Mục tiêu');
    await waitFor(() => expect(dev().setFailureMode).toHaveBeenLastCalledWith({ enabled: true, methodPattern: 'goals.*' }));
  });
});

describe('DevToolbar — scheduler', () => {
  it('runs for the session tenant and says when nothing was due', async () => {
    renderToolbar();
    await openToolbar();
    fireEvent.click(button('Chạy bộ lập lịch'));
    await waitFor(() => expect(gateway.scheduler.runDue).toHaveBeenCalledWith('t1'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Không có việc nào đến hạn.'));
  });

  it('summarises what a tick did', async () => {
    gateway.scheduler.runDue.mockResolvedValue({
      launchesFired: ['l1'],
      formsCreated: ['f1', 'f2', 'f3'],
      overdueHandled: [],
      remindersDue: [{ formId: 'f9', stepId: 's1' }],
    });
    renderToolbar();
    await openToolbar();
    fireEvent.click(button('Chạy bộ lập lịch'));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Đã chạy bộ lập lịch: 1 đợt phát hành, 3 phiếu mới, 1 lời nhắc hạn.'),
    );
  });

  it('shows a rejection in the catalogue words', async () => {
    gateway.scheduler.runDue.mockRejectedValue(new KpiDeferredError('write', 'scheduler.runDue', 'Phase 1.5'));
    renderToolbar();
    await openToolbar();
    fireEvent.click(button('Chạy bộ lập lịch'));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(ERROR_CATALOG['ERR-KPI-03'].title, { description: ERROR_CATALOG['ERR-KPI-03'].message }),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('is blocked, with the reason, while the failure is on', async () => {
    act(() => devActions.setFailure({ enabled: true, methodPattern: null }));
    renderToolbar();
    await openToolbar();
    expect(button('Chạy bộ lập lịch')).toBeDisabled();
    expect(screen.getByText('Tắt giả lập lỗi để chạy bộ lập lịch.')).toBeInTheDocument();
  });
});

describe('DevToolbar — reset', () => {
  it('asks first; Hủy does nothing', async () => {
    renderToolbar();
    await openToolbar();
    fireEvent.click(button('Đặt lại dữ liệu mẫu'));
    const dialog = await screen.findByRole('alertdialog', { name: 'Đặt lại dữ liệu mẫu?' });
    expect(dialog).toHaveTextContent('Mọi thay đổi bạn đã nhập sẽ mất và dữ liệu quay về bản seed ban đầu, cho mọi công ty.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(dev().resetSeed).not.toHaveBeenCalled();
  });

  it('Đặt lại reseeds, clears the cache and puts every override back', async () => {
    act(() => {
      devActions.setLatency(1000);
      devActions.setFailure({ enabled: true, methodPattern: 'forms.*' });
      devActions.setClockOverridden(true);
    });
    const { client } = renderToolbar();
    client.setQueryData(['t1', 'goals'], ['stale row']);
    await openToolbar();
    fireEvent.click(button('Đặt lại dữ liệu mẫu'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đặt lại' }));
    await waitFor(() => expect(dev().resetSeed).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Đã đặt lại dữ liệu mẫu.'));
    expect(client.getQueryData(['t1', 'goals'])).toBeUndefined();
    expect(dev().setFailureMode).toHaveBeenCalledWith({ enabled: false });
    expect(dev().setLatency).toHaveBeenCalledWith(DEFAULT_LATENCY_MS);
    expect(useDevStore.getState()).toMatchObject({
      clockOverridden: false,
      latencyMs: DEFAULT_LATENCY_MS,
      failure: { enabled: false, methodPattern: null },
    });
    expect(trigger()).not.toHaveTextContent('Đang bật');
  });
});
