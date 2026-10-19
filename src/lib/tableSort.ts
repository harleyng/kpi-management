/**
 * Client-side ordering for `DataTable` — a pure function so the awkward cases are settled once.
 *
 * - Strings compare with the Vietnamese collation (`vi`), so "Đ" sorts after "D" and tone marks
 *   do not scatter names across the list.
 * - Numbers compare numerically.
 * - A missing value (`null`/`undefined`/`NaN`) sorts LAST in BOTH directions: "no actual entered
 *   yet" is not the smallest actual, and it must not jump to the top when the user flips to
 *   descending (BR-KPI-32, design-system "Reporting figures honestly").
 * - Ties keep their incoming order (stable), so a secondary order the caller chose survives.
 */

export type SortDirection = 'asc' | 'desc';
export type SortValue = string | number | null | undefined;

const collator = new Intl.Collator('vi', { numeric: true });

function isMissing(value: SortValue): value is null | undefined {
  return value == null || (typeof value === 'number' && Number.isNaN(value));
}

export function compareSortValues(a: SortValue, b: SortValue): number {
  // Not `a - b`: Infinity − Infinity is NaN, which breaks the sort's contract.
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  return collator.compare(String(a), String(b));
}

/** Returns a new array; the input is never mutated. */
export function sortRows<T>(
  rows: readonly T[],
  sortValue: (row: T) => SortValue,
  direction: SortDirection,
): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row) }))
    .sort((x, y) => {
      const xMissing = isMissing(x.value);
      const yMissing = isMissing(y.value);
      if (xMissing || yMissing) {
        if (xMissing && yMissing) return x.index - y.index;
        return xMissing ? 1 : -1;
      }
      return sign * compareSortValues(x.value, y.value) || x.index - y.index;
    })
    .map(({ row }) => row);
}

/** The header button's cycle: unsorted → ascending → descending → unsorted. */
export function nextSortDirection(current: SortDirection | null): SortDirection | null {
  if (current === null) return 'asc';
  return current === 'asc' ? 'desc' : null;
}
