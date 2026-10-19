import { describe, expect, it } from 'vitest';
import { nextSortDirection, sortRows } from './tableSort';

interface Row {
  name: string;
  value: number | null;
}

const byValue = (r: Row) => r.value;
const byName = (r: Row) => r.name;

describe('sortRows', () => {
  const rows: Row[] = [
    { name: 'b', value: 10 },
    { name: 'a', value: null },
    { name: 'c', value: 2 },
    { name: 'd', value: 30 },
  ];

  it('orders numbers numerically, not as text', () => {
    expect(sortRows(rows, byValue, 'asc').map((r) => r.value)).toEqual([2, 10, 30, null]);
  });

  it('keeps a missing value last in BOTH directions', () => {
    expect(sortRows(rows, byValue, 'desc').map((r) => r.value)).toEqual([30, 10, 2, null]);
  });

  it('treats NaN as missing', () => {
    const withNaN: Row[] = [{ name: 'x', value: Number.NaN }, { name: 'y', value: 1 }];
    expect(sortRows(withNaN, byValue, 'asc').map((r) => r.name)).toEqual(['y', 'x']);
  });

  it('uses the Vietnamese collation: Đ after D, tone marks do not scatter names', () => {
    const names = ['Đỗ', 'Dương', 'An', 'Ánh', 'Bình'].map((name) => ({ name, value: 0 }));
    expect(sortRows(names, byName, 'asc').map((r) => r.name)).toEqual(['An', 'Ánh', 'Bình', 'Dương', 'Đỗ']);
  });

  it('orders a plain letter before its toned forms instead of tying them', () => {
    const toned = ['á', 'a', 'à'].map((name) => ({ name, value: 0 }));
    expect(sortRows(toned, byName, 'asc').map((r) => r.name)[0]).toBe('a');
  });

  it('handles infinities without breaking the order', () => {
    const inf: Row[] = [
      { name: 'x', value: Infinity },
      { name: 'y', value: -Infinity },
      { name: 'z', value: Infinity },
    ];
    expect(sortRows(inf, byValue, 'asc').map((r) => r.name)).toEqual(['y', 'x', 'z']);
  });

  it('compares embedded numbers naturally (KPI-2 before KPI-10)', () => {
    const codes = ['KPI-10', 'KPI-2', 'KPI-1'].map((name) => ({ name, value: 0 }));
    expect(sortRows(codes, byName, 'asc').map((r) => r.name)).toEqual(['KPI-1', 'KPI-2', 'KPI-10']);
  });

  it('is stable for ties', () => {
    const ties: Row[] = [
      { name: 'first', value: 1 },
      { name: 'second', value: 1 },
      { name: 'third', value: 1 },
    ];
    expect(sortRows(ties, byValue, 'desc').map((r) => r.name)).toEqual(['first', 'second', 'third']);
  });

  it('does not mutate its input', () => {
    const copy = [...rows];
    sortRows(rows, byValue, 'asc');
    expect(rows).toEqual(copy);
  });
});

describe('nextSortDirection', () => {
  it('cycles none → asc → desc → none', () => {
    expect(nextSortDirection(null)).toBe('asc');
    expect(nextSortDirection('asc')).toBe('desc');
    expect(nextSortDirection('desc')).toBeNull();
  });
});
