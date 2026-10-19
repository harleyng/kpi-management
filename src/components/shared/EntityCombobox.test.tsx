import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { KpiError } from '@/lib/errorCatalog';
import type { QueryState } from '@/lib/queryState';
import { EntityCombobox, type ComboboxOption } from './EntityCombobox';

const query = (over: Partial<QueryState> = {}): QueryState => ({
  isPending: false,
  fetchStatus: 'idle',
  error: null,
  refetch: vi.fn(),
  ...over,
});

const options: ComboboxOption[] = [
  { id: 'a', label: 'Nguyễn Văn An' },
  { id: 'b', label: 'Trần Thị Bình' },
  { id: 'c', label: 'Lê Văn Cường' },
];

const base = {
  placeholder: 'Chọn nhân viên',
  searchPlaceholder: 'Tìm',
  emptyText: 'Chưa có nhân viên nào.',
};

const trigger = () => screen.getByRole('combobox');

describe('EntityCombobox trigger — never misreports the current value', () => {
  it('shows the placeholder with no value', () => {
    render(<EntityCombobox {...base} options={options} query={query()} value={null} onChange={vi.fn()} />);
    expect(trigger()).toHaveTextContent('Chọn nhân viên');
  });

  it('shows the selected label', () => {
    render(<EntityCombobox {...base} options={options} query={query()} value="b" onChange={vi.fn()} />);
    expect(trigger()).toHaveTextContent('Trần Thị Bình');
  });

  it('says "Đang tải…" while the list loads — not "missing"', () => {
    render(
      <EntityCombobox
        {...base}
        options={undefined}
        query={query({ isPending: true, fetchStatus: 'fetching' })}
        value="b"
        onChange={vi.fn()}
      />,
    );
    expect(trigger()).toHaveTextContent('Đang tải…');
  });

  it('uses the fallback label while loading when the caller knows it', () => {
    render(
      <EntityCombobox
        {...base}
        options={undefined}
        query={query({ isPending: true, fetchStatus: 'fetching' })}
        value="b"
        fallbackLabels={{ b: 'Trần Thị Bình' }}
        onChange={vi.fn()}
      />,
    );
    expect(trigger()).toHaveTextContent('Trần Thị Bình');
  });

  it('says the list failed to load when it cannot name the value', () => {
    render(
      <EntityCombobox
        {...base}
        options={undefined}
        query={query({ error: new KpiError('ERR-KPI-01') })}
        value="b"
        onChange={vi.fn()}
      />,
    );
    expect(trigger()).toHaveTextContent('Không tải được danh sách');
  });

  it('flags a loaded list that no longer holds the value, and keeps the clear button', () => {
    render(<EntityCombobox {...base} options={options} query={query()} value="gone" onChange={vi.fn()} />);
    expect(trigger()).toHaveTextContent('Không còn trong danh sách');
    expect(screen.getByRole('button', { name: 'Bỏ chọn' })).toBeInTheDocument();
  });

  it('summarises a multiple selection naming what was chosen', () => {
    render(
      <EntityCombobox
        {...base}
        multiple
        options={options}
        query={query()}
        value={['a', 'c']}
        onChange={vi.fn()}
        summarize={(labels) => `${labels[0]} và ${labels.length - 1} người khác`}
      />,
    );
    expect(trigger()).toHaveTextContent('Nguyễn Văn An và 1 người khác');
  });
});

describe('EntityCombobox list', () => {
  beforeAll(() => {
    // cmdk measures and scrolls its list; jsdom has neither.
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    Element.prototype.scrollIntoView ??= () => {};
  });

  const open = () => fireEvent.click(trigger());
  const search = (text: string) => fireEvent.change(screen.getByPlaceholderText('Tìm'), { target: { value: text } });
  const optionNames = () => screen.queryAllByRole('option').map((o) => o.textContent);

  it('finds a toned name typed without diacritics, and says when nothing matches', () => {
    render(<EntityCombobox {...base} options={options} query={query()} value={null} onChange={vi.fn()} />);
    open();
    search('nguyen');
    expect(optionNames()).toEqual(['Nguyễn Văn An']);
    search('xyz');
    expect(optionNames()).toEqual([]);
    expect(screen.getByText('Không có kết quả cho “xyz”. Thử từ khóa khác.')).toBeInTheDocument();
  });

  it('keeps a disabled option pickable only as the current value', () => {
    const withDisabled = [...options, { id: 'd', label: 'Phạm Văn Dũng', disabled: true }];
    const onChange = vi.fn();
    render(<EntityCombobox {...base} options={withDisabled} query={query()} value={null} onChange={onChange} />);
    open();
    const dung = screen.getByRole('option', { name: /Phạm Văn Dũng/ });
    expect(dung).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(dung);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not clear a non-clearable value when it is picked again', () => {
    const onChange = vi.fn();
    render(
      <EntityCombobox {...base} clearable={false} options={options} query={query()} value="a" onChange={onChange} />,
    );
    expect(screen.queryByRole('button', { name: 'Bỏ chọn' })).toBeNull();
    open();
    fireEvent.click(screen.getByRole('option', { name: /Nguyễn Văn An/ }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('toggles ids in multiple mode', () => {
    const onChange = vi.fn();
    render(
      <EntityCombobox
        {...base}
        multiple
        options={options}
        query={query()}
        value={['a']}
        onChange={onChange}
        summarize={(labels) => labels.join(', ')}
      />,
    );
    open();
    fireEvent.click(screen.getByRole('option', { name: /Trần Thị Bình/ }));
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
    fireEvent.click(screen.getByRole('option', { name: /Nguyễn Văn An/ }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('does not call an unasked (disabled) list empty', () => {
    render(
      <EntityCombobox
        {...base}
        options={undefined}
        query={query({ isPending: true, fetchStatus: 'idle' })}
        value={null}
        onChange={vi.fn()}
      />,
    );
    open();
    expect(screen.queryByText('Chưa có nhân viên nào.')).not.toBeInTheDocument();
  });
});
