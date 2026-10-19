import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, paginate, serverPageSlice } from './pagination';

const rows = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('paginate', () => {
  it('returns the requested page and reports its 1-based range', () => {
    const slice = paginate(rows(25), 2, 10);
    expect(slice.items).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(slice.page).toBe(2);
    expect(slice.pageCount).toBe(3);
    expect(slice.from).toBe(11);
    expect(slice.to).toBe(20);
    expect(slice.total).toBe(25);
  });

  it('gives the last page whatever is left over', () => {
    const slice = paginate(rows(25), 3, 10);
    expect(slice.items).toEqual([21, 22, 23, 24, 25]);
    expect(slice.to).toBe(25);
  });

  it('reads an empty list as page 1 of 1 with an empty range', () => {
    const slice = paginate([], 1, 10);
    expect(slice).toEqual({ items: [], page: 1, pageCount: 1, from: 0, to: 0, total: 0 });
  });

  it('clamps a page past the end — a row removed must not blank the table', () => {
    // The user was on page 3, then rows were deleted and only one page remains.
    const slice = paginate(rows(5), 3, 10);
    expect(slice.page).toBe(1);
    expect(slice.items).toEqual([1, 2, 3, 4, 5]);
  });

  it('clamps zero, negative and fractional page numbers to a real page', () => {
    expect(paginate(rows(25), 0, 10).page).toBe(1);
    expect(paginate(rows(25), -4, 10).page).toBe(1);
    expect(paginate(rows(25), 2.7, 10).page).toBe(2);
    expect(paginate(rows(25), Number.NaN, 10).page).toBe(1);
  });

  it('refuses a page size below one instead of dividing by zero', () => {
    const slice = paginate(rows(3), 1, 0);
    expect(slice.pageCount).toBe(3);
    expect(slice.items).toEqual([1]);
  });

  it('defaults to DEFAULT_PAGE_SIZE rows a page', () => {
    expect(paginate(rows(50), 1).items).toHaveLength(DEFAULT_PAGE_SIZE);
  });
});

describe('PAGE_SIZE_OPTIONS', () => {
  it('contains the default, so the footer selector can always show the current size', () => {
    expect(PAGE_SIZE_OPTIONS).toContain(DEFAULT_PAGE_SIZE);
  });

  it('is ascending — a size list that jumps around reads as a bug', () => {
    expect([...PAGE_SIZE_OPTIONS]).toEqual([...PAGE_SIZE_OPTIONS].sort((a, b) => a - b));
  });
});

describe('serverPageSlice', () => {
  it('reports the range of the page the gateway returned', () => {
    expect(serverPageSlice(3, 20, 45, 5)).toEqual({ page: 3, pageCount: 3, from: 41, to: 45, total: 45 });
  });

  it('reads an empty page as an empty range', () => {
    expect(serverPageSlice(1, 20, 0, 0)).toEqual({ page: 1, pageCount: 1, from: 0, to: 0, total: 0 });
  });

  it('clamps a page past the end', () => {
    expect(serverPageSlice(9, 20, 45, 5).page).toBe(3);
  });
});
