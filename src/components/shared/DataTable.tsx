import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { errorSpecOf } from '@/lib/errorCatalog';
import { isRefreshing, loadPhase, type QueryState } from '@/lib/queryState';
import { DEFAULT_PAGE_SIZE, paginate, serverPageSlice } from '@/lib/pagination';
import { nextSortDirection, sortRows, type SortDirection, type SortValue } from '@/lib/tableSort';
import { cn } from '@/lib/utils';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorStateCard';
import { Pagination } from './Pagination';

export interface DataTableColumn<T> {
  id: string;
  /** Sentence case; a numeric column names its unit here ("Trọng số (%)"), not in every cell. */
  header: string;
  /**
   * The cell. Returning `null`/`undefined`/`''` renders `—` (`<MissingValue/>`): a value we do not
   * have is never shown as blank or as `0` (BR-KPI-32).
   */
  cell: (row: T) => ReactNode;
  /** Right-aligned with tabular figures — targets, actuals, weights, percentages, scores. */
  numeric?: boolean;
  /**
   * Present → the header becomes a sort button. A missing value (`null`) always sorts last.
   * Ignored with `serverPage`: sorting one server page would misrepresent the whole list.
   */
  sortValue?: (row: T) => SortValue;
  /** Width hints, applied to the header and every cell of the column. */
  className?: string;
}

/** A list the GATEWAY pages (`Page<T>` from `listForms`, `listAuditLog`): `rows` is that one page. */
export interface ServerPage {
  /** 1-based. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

interface DataTableProps<T> {
  /** The table's accessible name ("Danh sách chỉ tiêu"). */
  label: string;
  columns: DataTableColumn<T>[];
  /** The rows to show — the query's data, after any filtering the screen does. */
  rows: readonly T[] | undefined;
  /** The `useQuery` result itself (its status half) — see `loadPhase`. */
  query: QueryState;
  getRowId: (row: T) => string;
  /** The FIRST-USE sentence ("Chưa có chỉ tiêu nào. Thêm chỉ tiêu từ thư viện."). */
  empty: ReactNode;
  emptyAction?: ReactNode;
  /**
   * Shown when the query is DISABLED and holds no rows (nothing has been asked yet — "Chọn kỳ để xem
   * số liệu."). Never the `empty` sentence: claiming a list is empty when nobody asked is a lie.
   * Omitted: the body stays blank under the headers.
   */
  idle?: ReactNode;
  /**
   * A search or filter is narrowing the rows. An empty result then says "nothing matches" with a
   * way to clear the filter, instead of the first-use sentence — two different situations.
   */
  isFiltered?: boolean;
  onClearFilters?: () => void;
  /** Client paging over `rows`; `null` turns it off. Ignored with `serverPage`. */
  pageSize?: number | null;
  /** Change it (e.g. to the search term) to send the table back to page 1. */
  pageResetKey?: unknown;
  serverPage?: ServerPage;
  /**
   * Search and filters — the left of the toolbar row, which sits ABOVE the table's card on the page
   * canvas (design-system.md, "Tables"). It renders in every state, so a failed read can still be
   * re-filtered.
   */
  toolbar?: ReactNode;
  /**
   * The list's primary action ("Thêm chỉ tiêu") — the right of the toolbar row. With it, an empty
   * list shows only its sentence: the button is already one line above, never twice.
   */
  actions?: ReactNode;
  /** `<TableRow>`s for a totals footer (a weight total) — computed by a rule, never here. */
  footer?: ReactNode;
}

const SKELETON_ROWS = 5;
const FILTERED_EMPTY = 'Không có dòng nào khớp bộ lọc.';

/**
 * The dense list every management screen uses (design-system.md, "Tables").
 *
 * State precedence, in order:
 * 1. **Error** — the catalogue's failed-read message replaces the rows, EVEN IF stale rows are
 *    cached: ERR-KPI-01 promises old data is not shown, and last week's actuals presented as
 *    current are the wrong number on a scorecard.
 * 2. **First load** — skeleton rows holding the layout (only while a fetch is actually running).
 * 3. **Empty** — the first-use sentence, or "nothing matches" when filtered.
 * 4. **Rows** — a background refetch keeps them on screen, dimmed and `aria-busy`.
 *
 * Rows that open something put a real button or link in a cell; the row itself is not clickable,
 * so the action is reachable by keyboard and named for a screen reader.
 */
export function DataTable<T>({
  label,
  columns,
  rows,
  query,
  getRowId,
  empty,
  emptyAction,
  idle,
  isFiltered = false,
  onClearFilters,
  pageSize = DEFAULT_PAGE_SIZE,
  pageResetKey,
  serverPage,
  toolbar,
  actions,
  footer,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ columnId: string; direction: SortDirection } | null>(null);
  const [page, setPage] = useState(1);
  const [clientPageSize, setClientPageSize] = useState(pageSize ?? DEFAULT_PAGE_SIZE);

  // Reset to page 1 when the caller says the list changed meaning (a new search term).
  const [lastResetKey, setLastResetKey] = useState(pageResetKey);
  if (!Object.is(lastResetKey, pageResetKey)) {
    setLastResetKey(pageResetKey);
    setPage(1);
  }

  const sortColumn = !serverPage && sort ? columns.find((c) => c.id === sort.columnId) : undefined;
  const sorted = useMemo(() => {
    if (!rows) return undefined;
    if (!sortColumn?.sortValue || !sort) return rows;
    return sortRows(rows, sortColumn.sortValue, sort.direction);
  }, [rows, sortColumn, sort]);

  const clientPaging = !serverPage && pageSize !== null;
  const slice = sorted && clientPaging ? paginate([...sorted], page, clientPageSize) : null;
  const visible = slice ? slice.items : sorted;

  const phase = loadPhase(query, rows !== undefined);
  const failed = phase === 'error';
  const firstLoad = phase === 'loading';
  const refreshing = isRefreshing(query, rows !== undefined);

  const toggleSort = (columnId: string) => {
    const current = sort?.columnId === columnId ? sort.direction : null;
    const next = nextSortDirection(current);
    setSort(next ? { columnId, direction: next } : null);
    setPage(1);
  };

  const span = columns.length;
  let body: ReactNode;
  if (failed) {
    body = (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={span} className="p-0">
          <ErrorState spec={errorSpecOf(query.error)} onAction={() => void query.refetch()} />
        </TableCell>
      </TableRow>
    );
  } else if (firstLoad) {
    body = Array.from({ length: SKELETON_ROWS }, (_, i) => (
      <TableRow key={i} className="hover:bg-transparent">
        {columns.map((column) => (
          <TableCell key={column.id} className={cn('px-3 py-2.5', column.className)}>
            <Skeleton className={cn('h-4', column.numeric ? 'ml-auto w-12' : 'w-3/4')} />
          </TableCell>
        ))}
      </TableRow>
    ));
  } else if (phase === 'idle') {
    body = idle ? (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={span} className="p-0">
          <EmptyState>{idle}</EmptyState>
        </TableCell>
      </TableRow>
    ) : null;
  } else if (!visible || visible.length === 0) {
    body = (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={span} className="p-0">
          {isFiltered ? (
            <EmptyState
              action={
                onClearFilters && (
                  <Button variant="outline" size="sm" onClick={onClearFilters}>
                    Xóa bộ lọc
                  </Button>
                )
              }
            >
              {FILTERED_EMPTY}
            </EmptyState>
          ) : (
            <EmptyState action={actions ? undefined : emptyAction}>{empty}</EmptyState>
          )}
        </TableCell>
      </TableRow>
    );
  } else {
    body = visible.map((row) => (
      <TableRow key={getRowId(row)} className="hover:bg-surface-alt">
        {columns.map((column) => (
          <TableCell
            key={column.id}
            className={cn('px-3 py-2', column.numeric && 'tabular text-right', column.className)}
          >
            {renderCell(column.cell(row))}
          </TableCell>
        ))}
      </TableRow>
    ));
  }

  const showRows = !failed && !firstLoad && visible && visible.length > 0;

  const card = (
    <Card>
      <CardContent className="p-0">
        <Table
          aria-label={label}
          aria-busy={firstLoad || refreshing || undefined}
          className={cn('transition-opacity', refreshing && 'opacity-60')}
        >
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((column) => (
                <HeaderCell
                  key={column.id}
                  column={column}
                  sortable={!serverPage && Boolean(column.sortValue)}
                  direction={sort?.columnId === column.id ? sort.direction : null}
                  onSort={() => toggleSort(column.id)}
                />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>{body}</TableBody>
          {footer && showRows && <TableFooter>{footer}</TableFooter>}
        </Table>

        {/* Server paging stays visible on an empty page past the end (the last row was deleted),
            or the user would have no way back. */}
        {serverPage && !failed && !firstLoad && serverPage.total > 0 && (
          <Pagination
            slice={serverPageSlice(serverPage.page, serverPage.pageSize, serverPage.total, visible?.length ?? 0)}
            onPageChange={serverPage.onPageChange}
          />
        )}
        {showRows && slice && (
          <Pagination
            slice={slice}
            onPageChange={setPage}
            pageSize={clientPageSize}
            onPageSizeChange={(size) => {
              setClientPageSize(size);
              setPage(1);
            }}
          />
        )}
      </CardContent>
    </Card>
  );

  if (!toolbar && !actions) return card;
  return (
    <div className="space-y-3">
      <div className="flex min-h-9 flex-wrap items-center gap-2">
        {toolbar}
        {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {card}
    </div>
  );
}

function HeaderCell<T>({
  column,
  sortable,
  direction,
  onSort,
}: {
  column: DataTableColumn<T>;
  sortable: boolean;
  direction: SortDirection | null;
  onSort: () => void;
}) {
  const ariaSort = direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none';
  const Icon = direction === 'asc' ? ChevronUp : direction === 'desc' ? ChevronDown : ChevronsUpDown;

  return (
    <TableHead
      aria-sort={sortable ? ariaSort : undefined}
      className={cn('h-9 px-3 text-xs font-medium', column.numeric && 'text-right', column.className)}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            'inline-flex w-full items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            column.numeric && 'justify-end',
            direction && 'text-foreground',
          )}
        >
          {column.header}
          <Icon className={cn('h-3.5 w-3.5 shrink-0', !direction && 'opacity-50')} aria-hidden />
        </button>
      ) : (
        column.header
      )}
    </TableHead>
  );
}

function renderCell(content: ReactNode): ReactNode {
  return content === null || content === undefined || content === '' ? <MissingValue /> : content;
}

/**
 * A value we do not have — `—` to the eye, "chưa có" to a screen reader. Never `0`: "chưa nhập số"
 * and "thực tế bằng 0" score differently (BR-KPI-32).
 */
export function MissingValue() {
  return (
    <span className="text-muted-foreground">
      <span aria-hidden>—</span>
      <span className="sr-only">chưa có</span>
    </span>
  );
}
