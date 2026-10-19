import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { KpiError } from '@/lib/errorCatalog';
import type { QueryState } from '@/lib/queryState';
import { DataTable, type DataTableColumn } from './DataTable';

interface Row {
  id: string;
  name: string;
  actual: number | null;
}

const columns: DataTableColumn<Row>[] = [
  { id: 'name', header: 'Chỉ tiêu', cell: (r) => r.name, sortValue: (r) => r.name },
  { id: 'actual', header: 'Thực tế', numeric: true, cell: (r) => r.actual, sortValue: (r) => r.actual },
];

const rows: Row[] = [
  { id: '1', name: 'Doanh thu', actual: 120 },
  { id: '2', name: 'Chi phí', actual: null },
  { id: '3', name: 'Ăn uống', actual: 5 },
];

const query = (over: Partial<QueryState> = {}): QueryState => ({
  isPending: false,
  fetchStatus: 'idle',
  error: null,
  refetch: vi.fn(),
  ...over,
});

const renderTable = (props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) =>
  render(
    <DataTable<Row>
      label="Danh sách chỉ tiêu"
      columns={columns}
      rows={rows}
      query={query()}
      getRowId={(r) => r.id}
      empty="Chưa có chỉ tiêu nào."
      {...props}
    />,
  );

const bodyNames = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent);

describe('DataTable', () => {
  it('shows the failed-read message INSTEAD of stale rows, with a retry', () => {
    const refetch = vi.fn();
    renderTable({ query: query({ error: new KpiError('ERR-KPI-01'), refetch }) });
    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được dữ liệu');
    expect(screen.queryByText('Doanh thu')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows skeleton rows on a first load; a disabled query never claims the list is empty', () => {
    const { rerender } = renderTable({ rows: undefined, query: query({ isPending: true, fetchStatus: 'fetching' }) });
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Chưa có chỉ tiêu nào.')).not.toBeInTheDocument();

    rerender(
      <DataTable<Row>
        label="Danh sách chỉ tiêu"
        columns={columns}
        rows={undefined}
        query={query({ isPending: true, fetchStatus: 'idle' })}
        getRowId={(r) => r.id}
        empty="Chưa có chỉ tiêu nào."
        idle="Chọn kỳ để xem số liệu."
      />,
    );
    expect(screen.queryByText('Chưa có chỉ tiêu nào.')).not.toBeInTheDocument();
    expect(screen.getByText('Chọn kỳ để xem số liệu.')).toBeInTheDocument();
  });

  it('puts the toolbar and the primary action ABOVE the table card, in every state', () => {
    const { container, rerender } = renderTable({
      toolbar: <input aria-label="Tìm chỉ tiêu" />,
      actions: <button type="button">Thêm chỉ tiêu</button>,
      query: query({ error: new KpiError('ERR-KPI-01') }),
    });
    const table = screen.getByRole('table');
    const search = screen.getByRole('textbox', { name: 'Tìm chỉ tiêu' });
    // Still there when the read failed — the user can re-filter or add.
    expect(screen.getByRole('button', { name: 'Thêm chỉ tiêu' })).toBeInTheDocument();
    // Not inside the card that holds the table.
    const card = table.closest('.rounded-lg, [class*="rounded"]')!;
    expect(card.contains(search)).toBe(false);
    expect(container.firstElementChild!.contains(search)).toBe(true);

    rerender(
      <DataTable<Row>
        label="Danh sách chỉ tiêu"
        columns={columns}
        rows={[]}
        query={query()}
        getRowId={(r) => r.id}
        empty="Chưa có chỉ tiêu nào."
        emptyAction={<button type="button">Thêm chỉ tiêu</button>}
        actions={<button type="button">Thêm chỉ tiêu</button>}
      />,
    );
    // With `actions`, the empty state does not repeat the button.
    expect(screen.getByText('Chưa có chỉ tiêu nào.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Thêm chỉ tiêu' })).toHaveLength(1);
  });

  it('renders just the card without a toolbar or actions', () => {
    const { container } = renderTable();
    expect(container.firstElementChild!.querySelector('table')).not.toBeNull();
    expect(container.firstElementChild!.className).not.toContain('space-y-3');
  });

  it('says "nothing matches" with a clear action when a filter emptied the list', () => {
    const onClearFilters = vi.fn();
    renderTable({ rows: [], isFiltered: true, onClearFilters });
    expect(screen.getByText('Không có dòng nào khớp bộ lọc.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }));
    expect(onClearFilters).toHaveBeenCalled();
  });

  it('renders a missing value as "—", never blank or 0', () => {
    renderTable();
    const row = screen.getByText('Chi phí').closest('tr')!;
    expect(within(row).getAllByRole('cell')[1]).toHaveTextContent('—chưa có');
  });

  it('pages client-side and goes back to page 1 when the reset key changes', () => {
    const many: Row[] = Array.from({ length: 12 }, (_, i) => ({ id: String(i), name: `KPI ${i + 1}`, actual: i }));
    const props = {
      label: 'Danh sách chỉ tiêu',
      columns,
      rows: many,
      query: query(),
      getRowId: (r: Row) => r.id,
      empty: 'Chưa có chỉ tiêu nào.',
    };
    const { rerender } = render(<DataTable<Row> {...props} pageSize={10} pageResetKey="" />);
    expect(screen.getByText('1–10 trên 12')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect(screen.getByText('11–12 trên 12')).toBeInTheDocument();

    rerender(<DataTable<Row> {...props} pageSize={10} pageResetKey="doanh" />);
    expect(screen.getByText('1–10 trên 12')).toBeInTheDocument();
  });

  it('keeps the server pager on an empty page past the end, and does not offer sorting', () => {
    const onPageChange = vi.fn();
    renderTable({ rows: [], serverPage: { page: 4, pageSize: 20, total: 45, onPageChange } });
    expect(screen.getByRole('navigation', { name: 'Phân trang' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Trang trước' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
    expect(within(screen.getByRole('columnheader', { name: 'Thực tế' })).queryByRole('button')).toBeNull();
  });

  it('shows the totals footer only alongside rows', () => {
    const footer = (
      <tr>
        <td>Tổng trọng số</td>
      </tr>
    );
    const { rerender } = renderTable({ footer });
    expect(screen.getByText('Tổng trọng số')).toBeInTheDocument();
    rerender(
      <DataTable<Row>
        label="Danh sách chỉ tiêu"
        columns={columns}
        rows={[]}
        query={query()}
        getRowId={(r) => r.id}
        empty="Chưa có chỉ tiêu nào."
        footer={footer}
      />,
    );
    expect(screen.queryByText('Tổng trọng số')).not.toBeInTheDocument();
  });

  it('sorts from the header, keeping missing values last, and exposes aria-sort', () => {
    renderTable();
    const header = screen.getByRole('columnheader', { name: /Thực tế/ });
    expect(header).toHaveAttribute('aria-sort', 'none');

    fireEvent.click(within(header).getByRole('button'));
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    expect(bodyNames()).toEqual(['Ăn uống', 'Doanh thu', 'Chi phí']);

    fireEvent.click(within(header).getByRole('button'));
    expect(header).toHaveAttribute('aria-sort', 'descending');
    expect(bodyNames()).toEqual(['Doanh thu', 'Ăn uống', 'Chi phí']);
  });
});
