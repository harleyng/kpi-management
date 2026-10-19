/**
 * Pagination arithmetic — a pure slice over a list already in memory.
 *
 * The app reads a whole list at once through `getDataGateway()`,
 * so paging is a READING concern, not a fetching one: the user gets a page they can scan
 * instead of a wall of rows. Keeping the arithmetic here means the awkward cases — an empty
 * list, a page number left pointing past the end after a row was removed — are settled once
 * and tested, rather than re-derived on every screen that shows a table.
 */

/** Rows per page for the management tables. Ten fits the viewport without scrolling. */
export const DEFAULT_PAGE_SIZE = 10;

/**
 * The row counts a paged table may offer in its footer selector.
 *
 * `DEFAULT_PAGE_SIZE` must be one of them, or the selector opens showing a value it has no
 * option for — the trigger would render empty.
 */
export const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

export interface PageSlice<T> {
  /** The rows this page shows. */
  items: T[];
  /**
   * The page actually being shown, 1-based. It is CLAMPED into range, so a component may
   * hold a stale page number after the list shrinks and still render something valid.
   */
  page: number;
  /** Never below 1 — an empty list is still "page 1 of 1", never "page 1 of 0". */
  pageCount: number;
  /** 1-based position of the first row shown; `0` when there is nothing to show. */
  from: number;
  /** 1-based position of the last row shown; `0` when there is nothing to show. */
  to: number;
  /** Rows in the whole list, not just this page. */
  total: number;
}

/**
 * Slice `items` down to one page.
 *
 * ```ts
 * const [page, setPage] = useState(1);
 * const slice = paginate(rows, page);   // slice.page may differ from `page` — it is clamped
 * ```
 */
export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
): PageSlice<T> {
  const total = items.length;
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const pageCount = Math.max(1, Math.ceil(total / size));
  // `Math.floor(NaN) || 1` folds a missing or nonsensical page back to the first one.
  const safe = Math.min(Math.max(Math.floor(page) || 1, 1), pageCount);
  const start = (safe - 1) * size;
  const slice = items.slice(start, start + size);
  return {
    items: slice,
    page: safe,
    pageCount,
    from: slice.length === 0 ? 0 : start + 1,
    to: start + slice.length,
    total,
  };
}

/**
 * The footer range for a list the GATEWAY pages (`Page<T>`): the rows on screen are already one
 * page, so only the range is computed. `shown` is the number of rows that page actually holds.
 */
export function serverPageSlice(
  page: number,
  pageSize: number,
  total: number,
  shown: number,
): Omit<PageSlice<never>, 'items'> {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const pageCount = Math.max(1, Math.ceil(total / size));
  const safe = Math.min(Math.max(Math.floor(page) || 1, 1), pageCount);
  const from = shown === 0 ? 0 : (safe - 1) * size + 1;
  return { page: safe, pageCount, from, to: shown === 0 ? 0 : from + shown - 1, total };
}
