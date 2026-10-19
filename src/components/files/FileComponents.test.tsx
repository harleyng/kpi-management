import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SYNTRA } from '@/data/fixtures';
import { newGateway } from '@/integrations/data/mock/gateway.test-util';
import { KpiError } from '@/lib/errorCatalog';
import { MAX_FILE_BYTES } from '@/lib/fileRules';
import { FileLink } from './FileLink';
import { FileUploadButton } from './FileUploadButton';

const h = vi.hoisted(() => ({ gateway: null as unknown }));
vi.mock('@/integrations/data', () => ({ getDataGateway: () => h.gateway }));
vi.mock('@/contexts/useSession', () => ({
  useSession: () => ({ tenantId: SYNTRA.tenantId, user: { id: SYNTRA.user('E016') }, tenant: { id: SYNTRA.tenantId, timezone: 'Asia/Ho_Chi_Minh' } }),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }) }));

function setup(ui: ReactNode) {
  const { gateway } = newGateway();
  h.gateway = gateway;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return gateway;
}

const pick = (file: File) => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
};

beforeEach(() => vi.clearAllMocks());

describe('FileUploadButton', () => {
  it('uploads an accepted file and hands back the stored row', async () => {
    const onUploaded = vi.fn();
    setup(<FileUploadButton onUploaded={onUploaded} />);
    expect(screen.getByRole('button', { name: 'Tải tệp lên' })).toHaveAccessibleDescription('PDF, ảnh, Word, Excel, CSV; tối đa 10 MB');
    pick(new File(['bằng chứng'], 'bang-chung.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'bang-chung.pdf', uploadedBy: SYNTRA.user('E016') })));
    expect(toast.success).toHaveBeenCalledWith('Đã tải tệp lên.');
  });

  it('refuses a file over the limit before sending it, saying which limit', async () => {
    const onUploaded = vi.fn();
    const gateway = setup(<FileUploadButton onUploaded={onUploaded} />);
    const upload = vi.spyOn(gateway.system, 'uploadFile');
    const big = new File(['x'], 'lon.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: MAX_FILE_BYTES + 1 });
    pick(big);
    expect(toast.error).toHaveBeenCalledWith('Dữ liệu chưa hợp lệ', { description: expect.stringContaining('Tệp lớn hơn 10 MB.') });
    expect(upload).not.toHaveBeenCalled();
    expect(onUploaded).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Tải tệp lên' })).toBeEnabled();
  });

  it('refuses a format outside the list', () => {
    setup(<FileUploadButton onUploaded={vi.fn()} />);
    pick(new File(['x'], 'cai-dat.exe', { type: 'application/x-msdownload' }));
    expect(toast.error).toHaveBeenCalledWith('Dữ liệu chưa hợp lệ', { description: expect.stringContaining('Định dạng tệp không được hỗ trợ.') });
  });
});

describe('FileLink', () => {
  it('names the file and its size, and opens it in a new tab', async () => {
    const gateway = setup(null);
    const file = await gateway.system.uploadFile(SYNTRA.tenantId, SYNTRA.user('E016'), { fileName: 'so-lieu.csv', mimeType: 'text/csv', data: new Blob(['a,b\n1,2']) });
    // jsdom has no blob URLs.
    URL.createObjectURL = vi.fn(() => 'blob:mock/1');
    URL.revokeObjectURL = vi.fn();
    const tab = { opener: {}, location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <FileLink fileId={file.id} />
      </QueryClientProvider>,
    );
    const link = await screen.findByRole('button', { name: 'Mở so-lieu.csv trong thẻ mới' });
    expect(link).toHaveTextContent('so-lieu.csv');
    expect(link).toHaveTextContent('7 B');
    fireEvent.click(link);
    expect(open).toHaveBeenCalledWith('', '_blank'); // synchronously, inside the click
    await waitFor(() => expect(tab.location.href).toMatch(/^blob:/));
    expect(tab.opener).toBeNull();
    open.mockRestore();
  });

  it('closes the blank tab and says so when the content is gone', async () => {
    const gateway = setup(null);
    const file = await gateway.system.uploadFile(SYNTRA.tenantId, SYNTRA.user('E016'), { fileName: 'a.txt', mimeType: 'text/plain', data: new Blob(['x']) });
    vi.spyOn(gateway.system, 'getFileUrl').mockRejectedValue(new KpiError('ERR-KPI-02', 'content lost on reload'));
    const tab = { opener: {}, location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <FileLink fileId={file.id} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Mở a.txt trong thẻ mới' }));
    await waitFor(() => expect(tab.close).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith('Không tìm thấy dữ liệu', { description: 'Bản ghi không tồn tại hoặc đã bị xóa.' });
    open.mockRestore();
  });
});
