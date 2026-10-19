import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { OrgUnit } from '@/data/types';
import { KpiError } from '@/lib/errorCatalog';
import type { QueryState } from '@/lib/queryState';
import { OrgUnitTreeView } from './OrgUnitTree';

const unit = (id: string, parentId: string | null, name: string, unitType: OrgUnit['unitType']): OrgUnit => ({
  id,
  tenantId: 't1',
  parentId,
  code: id.toUpperCase(),
  name,
  unitType,
  headEmployeeId: null,
  effectiveFrom: '2027-01-01',
  effectiveTo: null,
  status: 'Active',
});

const units = [
  unit('co', null, 'Syntra', 'Company'),
  unit('kd', 'co', 'Khối Kinh doanh', 'Division'),
  unit('kd-mkt', 'kd', 'Phòng Marketing', 'Department'),
  unit('vh', 'co', 'Khối Vận hành', 'Division'),
];

const ready: QueryState = { isPending: false, fetchStatus: 'idle', error: null, refetch: vi.fn() };

const item = (name: string) => screen.getByRole('treeitem', { name: new RegExp(name) });

describe('OrgUnitTreeView', () => {
  it('opens the root, and the path to a selected unit', () => {
    render(
      <OrgUnitTreeView label="Cây tổ chức" units={units} query={ready} selected={['kd-mkt']} onSelectedChange={vi.fn()} />,
    );
    expect(item('Syntra')).toHaveAttribute('aria-expanded', 'true');
    expect(item('Khối Kinh doanh')).toHaveAttribute('aria-expanded', 'true');
    expect(item('Phòng Marketing')).toHaveAttribute('aria-selected', 'true');
    // One tab stop: the selected unit.
    expect(item('Phòng Marketing')).toHaveAttribute('tabindex', '0');
    expect(item('Syntra')).toHaveAttribute('tabindex', '-1');
  });

  it('moves focus with the arrows and expands with →', () => {
    render(<OrgUnitTreeView label="Cây tổ chức" units={units} query={ready} selected={[]} onSelectedChange={vi.fn()} />);
    const root = item('Syntra');
    act(() => root.focus());
    fireEvent.keyDown(root, { key: 'ArrowDown' });
    expect(item('Khối Kinh doanh')).toHaveFocus();

    expect(screen.queryByRole('treeitem', { name: /Phòng Marketing/ })).not.toBeInTheDocument();
    fireEvent.keyDown(item('Khối Kinh doanh'), { key: 'ArrowRight' });
    expect(item('Phòng Marketing')).toBeInTheDocument();

    fireEvent.keyDown(item('Khối Kinh doanh'), { key: 'ArrowLeft' });
    expect(screen.queryByRole('treeitem', { name: /Phòng Marketing/ })).not.toBeInTheDocument();
  });

  it('jumps with Home/End and selects with Enter in single mode', () => {
    const onSelectedChange = vi.fn();
    render(
      <OrgUnitTreeView label="Cây tổ chức" units={units} query={ready} selected={[]} onSelectedChange={onSelectedChange} />,
    );
    act(() => item('Syntra').focus());
    fireEvent.keyDown(item('Syntra'), { key: 'End' });
    expect(item('Khối Vận hành')).toHaveFocus();
    fireEvent.keyDown(item('Khối Vận hành'), { key: 'Home' });
    expect(item('Syntra')).toHaveFocus();
    fireEvent.keyDown(item('Syntra'), { key: 'Enter' });
    expect(onSelectedChange).toHaveBeenCalledWith(['co']);
  });

  it('narrows to matches and their path while searching (diacritics optional)', () => {
    render(
      <OrgUnitTreeView label="Cây tổ chức" searchable units={units} query={ready} selected={[]} onSelectedChange={vi.fn()} />,
    );
    fireEvent.change(screen.getByRole('searchbox', { name: 'Tìm đơn vị' }), { target: { value: 'van hanh' } });
    expect(screen.getAllByRole('treeitem').map((el) => el.textContent)).toEqual([
      expect.stringContaining('Syntra'),
      expect.stringContaining('Khối Vận hành'),
    ]);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Tìm đơn vị' }), { target: { value: 'zzz' } });
    expect(screen.getByText('Không có đơn vị nào khớp “zzz”.')).toBeInTheDocument();
  });

  it('marks an inactive unit in words, not only in grey', () => {
    render(
      <OrgUnitTreeView
        label="Cây tổ chức"
        units={[...units.slice(0, 3), { ...units[3], status: 'Inactive' }]}
        query={ready}
        selected={[]}
        onSelectedChange={vi.fn()}
      />,
    );
    expect(item('Khối Vận hành')).toHaveTextContent('(ngừng hoạt động)');
  });

  it('shows the failed-read message with a retry, and the empty sentence', () => {
    const refetch = vi.fn();
    const { rerender } = render(
      <OrgUnitTreeView
        label="Cây tổ chức"
        units={undefined}
        query={{ ...ready, error: new KpiError('ERR-KPI-01'), refetch }}
        selected={[]}
        onSelectedChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(refetch).toHaveBeenCalled();
    rerender(<OrgUnitTreeView label="Cây tổ chức" units={[]} query={ready} selected={[]} onSelectedChange={vi.fn()} />);
    expect(screen.getByText('Chưa có đơn vị nào.')).toBeInTheDocument();
  });

  it('toggles units in multiple mode without selecting their children', () => {
    const onSelectedChange = vi.fn();
    render(
      <OrgUnitTreeView
        label="Đơn vị nhận phiếu"
        multiple
        units={units}
        query={ready}
        selected={['vh']}
        onSelectedChange={onSelectedChange}
      />,
    );
    expect(screen.getByRole('tree')).toHaveAttribute('aria-multiselectable', 'true');
    fireEvent.keyDown(item('Syntra'), { key: ' ' });
    expect(onSelectedChange).toHaveBeenCalledWith(['vh', 'co']);
  });
});
